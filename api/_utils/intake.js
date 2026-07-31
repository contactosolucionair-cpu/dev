/**
 * api/_utils/intake.js
 *
 * Helpers PUROS del intake (ciclo Intake v2). Sin fetch, sin env vars, sin fechas
 * implícitas: entra un valor, sale un valor. Los comparten `api/process-ticket.js`
 * (alta B2C) y `api/agency.js` (alta B2B), que antes saneaban cada uno por su lado.
 *
 * Dos frentes:
 *   1. Lo que devuelve la extracción con IA: texto de un modelo, se acepta con la
 *      forma esperada o no se acepta.
 *   2. Lo que arma el front para las columnas del motor legal (`segmentos`,
 *      `incidentes`, `datos_extraidos`), con la semántica de DIRECCIÓN AFECTADA de la
 *      enmienda legal v2.1.2: el par origen/destino canónico es el de la dirección
 *      donde ocurrió el incidente, no el del billete entero.
 */

/** Texto de la IA → string limpio. `null`, "N/A" y compañía son ausencia de dato. */
export function limpiarTexto(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  var l = s.toLowerCase();
  if (l === 'null' || l === 'undefined' || l === 'n/a' || l === 'unknown') return '';
  return s;
}

/** 'EZE - Buenos Aires' → 'EZE'. Sin código de 3 letras al frente devuelve ''. */
export function iataDeEtiqueta(v) {
  var s = limpiarTexto(v).toUpperCase();
  var m = s.match(/^([A-Z]{3})\b/);
  return m ? m[1] : '';
}

/** Código IATA suelto → 'EZE' | null. Mismo criterio que el resto del codebase. */
export function iata3(v) {
  var s = (v === null || v === undefined ? '' : String(v)).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/**
 * `parsed.segmentos` de la IA → array saneado para el front.
 *
 * Un tramo sin sus dos extremos no sirve para nada de lo que viene después (ni ficha
 * en pantalla, ni IATA, ni dirección), así que se descarta entero en vez de viajar a
 * medias. `direccion` es tri-estado: '' significa "el modelo no supo", y el front NO
 * presume 'ida' — esa presunción es justo el sesgo que el ciclo vino a sacar.
 */
export function sanearSegmentosIa(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  raw.forEach(function (s) {
    if (!s || typeof s !== 'object') return;
    var o = limpiarTexto(s.origen), d = limpiarTexto(s.destino);
    if (!o || !d) return;
    var dir = limpiarTexto(s.direccion).toLowerCase();
    var orden = parseInt(s.orden, 10);
    out.push({
      orden: isFinite(orden) && orden > 0 ? orden : out.length + 1,
      direccion: (dir === 'ida' || dir === 'vuelta') ? dir : '',
      origen: o,
      destino: d,
      vuelo_nro: limpiarTexto(s.vuelo_nro),
      aerolinea_operadora: limpiarTexto(s.aerolinea_operadora),
      fecha: limpiarTexto(s.fecha),
    });
  });
  out.sort(function (a, b) { return a.orden - b.orden; });
  /* Renumerado 1..n sin huecos: el front referencia los tramos por ese orden. */
  out.forEach(function (s, i) { s.orden = i + 1; });
  return out;
}

/**
 * `direccion_afectada_sugerida` de la IA → 'ida' | 'vuelta' | ''.
 * Sugerir una dirección que no aparece en ningún tramo extraído sería incoherente:
 * en ese caso se devuelve '' y decide el pasajero.
 */
export function normalizarDireccionSugerida(raw, segmentos) {
  var d = limpiarTexto(raw).toLowerCase();
  if (d !== 'ida' && d !== 'vuelta') return '';
  var hay = (segmentos || []).some(function (s) { return s && s.direccion === d; });
  return hay ? d : '';
}

/* ------------------------------------------------------------------ */
/* Columnas del motor legal (contrato §1)                              */
/* ------------------------------------------------------------------ */

/**
 * Columnas del DOMINIO LEGAL: las escribe `set-datos-legales` y solo él.
 *
 * `set-campo` (el editor genérico del drawer) es un input de texto libre que persiste lo
 * que el operador tipea y no deriva nada. Dejarlo tocar estas columnas producía DOS
 * escritores con semánticas distintas sobre el mismo dato — el que valida contra el
 * dominio y deriva, y el que escribe cualquier string— que es la anatomía exacta del
 * defecto 6bis.3 (ver `docs/motor-capa1-pendientes-legales.md`): editar
 * `tipo_incidencia` a mano dejaba `incidentes` sin actualizar, y gana el segundo porque es
 * el que lee el motor.
 *
 * La regla es **un dominio, un escritor**. El editor de datos legales del drawer ya valida
 * y deriva bien; el genérico rechaza estos campos con un error que dice a dónde ir.
 *
 * Dos grupos:
 *  - Lo que `set-datos-legales` escribe (contrato de entrada del motor, §1.2).
 *  - Las columnas legacy de las que se DERIVA `incidentes`: cambiarlas por afuera
 *    desincroniza el campo crítico que el motor consume.
 */
export var CAMPOS_DOMINIO_LEGAL = [
  /* Contrato de entrada del motor */
  'incidentes', 'fecha_incidente', 'demora_salida_min', 'demora_llegada_min',
  'antelacion_aviso_dias', 'billete_unico', 'causa_alegada', 'origen_iata', 'destino_iata',
  'checkin_presentacion', 'protesta', 'reencaminamiento', 'atencion_ofrecida', 'segmentos',
  /* `gastos_items` es el canónico; monto/moneda son su espejo derivado y se reescriben en
     el mismo PATCH. Editarlos sueltos los desincroniza del itemizado. */
  'gastos_items', 'monto_gastos', 'moneda_gastos',
  /* Fuentes de la derivación de `incidentes` */
  'tipo_incidencia', 'tipo_reclamo', 'tipo_caso_equipaje',
];

/**
 * Clave de comparación para un valor de DOMINIO CERRADO: minúsculas, sin acentos, sin
 * espacios de más.
 *
 * Existe por un defecto real y caro: `tipo_incidencia` llegó a la base con etiquetas de
 * interfaz —"Reprogramación", "Denegación Embarque", "Demora"— y tanto esta derivación
 * como el `CASE` de `migration_015` comparaban por igualdad exacta contra las claves en
 * minúscula. Resultado: 8 de 19 casos con `incidentes: []`, que es un campo CRÍTICO, así
 * que el motor los leía como FALTA_DATO y no podía clasificar el incidente. Nadie se
 * enteró durante meses porque el síntoma es silencioso.
 *
 * La lección quedó anotada en el registro de pendientes: antes de mapear un dominio, mirar
 * los valores que la base TIENE, no los que debería tener.
 */
export function claveDominio(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // saca acentos y la tilde de la ñ
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

var INCIDENTES_VALIDOS = [
  'demora', 'cancelacion', 'reprogramacion', 'denegacion_embarque', 'downgrade', 'conexion_perdida',
  'equipaje_demora', 'equipaje_dano', 'equipaje_perdida', 'muerte_lesion',
];

/**
 * Campos legacy del formulario → `incidentes` (Tabla A fila 6, campo CRÍTICO).
 *
 * Mismo mapeo que el UPDATE de `supabase/migration_015_motor_capa1.sql`, para que un
 * caso nuevo y uno migrado se lean igual. Es un CONJUNTO: un caso vuelo+equipaje
 * acumula el incidente de vuelo Y el de equipaje.
 *
 * Sin tipo de equipaje NO se presume 'equipaje_demora': correría el gate de protesta
 * con los plazos equivocados (3/7 días daño vs. 10/21 pérdida).
 *
 * `reprogramacion` es tipo PROPIO desde la decisión legal D1 (v2.2): el Art. 42 del
 * Reglamento Dec. 809/2024 le da un régimen distinto al de la cancelación —incidentales
 * sí, alternativas y reintegro no—, así que mapearla a `cancelacion` concedía derechos
 * que la norma no otorga. El mapeo viejo (v2.1.1) sigue siendo correcto para los
 * incidentes anteriores al 10-oct-2024, y de eso se ocupa el ruleset IV-A: acá se escribe
 * el tipo real y la ley aplicable la elige el motor por `fecha_incidente`.
 */
export function derivarIncidentes(tipoReclamo, tipoIncidencia, tipoCasoEquipaje) {
  var tr = claveDominio(tipoReclamo) || 'vuelo';
  var out = [];

  if (tr === 'vuelo' || tr === 'vuelo_equipaje') {
    /* Las claves están normalizadas: minúsculas, sin acentos y con los espacios
       colapsados. Las variantes con espacio existen porque la base las tiene. */
    var porIncidencia = {
      cancelacion: 'cancelacion',
      reprogramacion: 'reprogramacion',
      demora: 'demora',
      overbooking: 'denegacion_embarque',
      denegacion: 'denegacion_embarque',
      'denegacion embarque': 'denegacion_embarque',
      'denegacion de embarque': 'denegacion_embarque',
    };
    var i = porIncidencia[claveDominio(tipoIncidencia)];
    if (i) out.push(i);
  }

  if (tr === 'equipaje' || tr === 'vuelo_equipaje') {
    /* `dano` es lo que queda de "daño" al descomponer la ñ; `danio` es el valor canónico
       del formulario. Los dos tienen que llegar al mismo lado. */
    var porEquipaje = {
      perdida: 'equipaje_perdida',
      danio: 'equipaje_dano',
      dano: 'equipaje_dano',
      demora: 'equipaje_demora',
    };
    var e = porEquipaje[claveDominio(tipoCasoEquipaje)];
    if (e) out.push(e);
  }

  return out.filter(function (v, n, arr) {
    return INCIDENTES_VALIDOS.indexOf(v) !== -1 && arr.indexOf(v) === n;
  });
}

/**
 * `segmentos` del payload del front → la columna JSONB del contrato §1.3.
 *
 * El front manda los tramos con IATA ya resuelto por `airport-select.js` y marca cuál
 * es el afectado. Acá solo se sanea: forma esperada, un tramo sin ningún extremo se
 * descarta, y `afectado` queda en UNO como máximo (la dirección afectada es una sola).
 *
 * NO se escribe `carrier_operante` desde el formulario público: la Tabla A fila 5 pide
 * el transportista OPERANTE y al pasajero no se le pregunta (fuente: documentos, admin
 * o API de vuelos). Lo que sí llega del scan viaja como candidato en `datos_extraidos`.
 */
export function sanearSegmentosCanonicos(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  raw.forEach(function (s, i) {
    if (!s || typeof s !== 'object') return;
    var o = iata3(s.origen_iata), d = iata3(s.destino_iata);
    if (!o && !d) return;
    var orden = parseInt(s.orden, 10);
    var seg = {
      orden: isFinite(orden) && orden > 0 ? orden : out.length + 1,
      origen_iata: o,
      destino_iata: d,
      carrier_operante: limpiarTexto(s.carrier_operante) || null,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(limpiarTexto(s.fecha).slice(0, 10)) ? limpiarTexto(s.fecha).slice(0, 10) : null,
      afectado: s.afectado === true || s.afectado === 'true',
    };
    out.push(seg);
  });
  out.sort(function (a, b) { return a.orden - b.orden; });
  out.forEach(function (s, i) { s.orden = i + 1; });

  var yaMarcado = false;
  out.forEach(function (s) {
    if (!s.afectado) return;
    if (yaMarcado) s.afectado = false;
    yaMarcado = true;
  });
  return out;
}

/**
 * Extremos de la dirección afectada a partir de los segmentos canónicos.
 *
 * Es el mismo criterio del motor (`api/_utils/motor-normalizar.js`), pero acá alcanza
 * con la marca: el front ya arma UNA sola dirección por caso (la del problema), así
 * que el par es su primer origen y su último destino. Si no hay segmentos, devuelve
 * nulls y mandan los campos sueltos del formulario.
 */
export function extremosDireccionAfectada(segmentos) {
  var segs = Array.isArray(segmentos) ? segmentos : [];
  if (!segs.length) return { origen_iata: null, destino_iata: null };
  return {
    origen_iata: segs[0].origen_iata || null,
    destino_iata: segs[segs.length - 1].destino_iata || null,
  };
}

/**
 * Candidatos con procedencia para `datos_extraidos` (contrato §1.1).
 *
 * `fuente` distingue de dónde salió el itinerario: del scan de un documento
 * (`adjunto`) o de lo que tipeó el pasajero (`declaracion_pasajero`). En los dos casos
 * `verificado: false`: la marca del tramo afectado es declarativa y los campos
 * críticos no se autoverifican desde una sola fuente declarativa (§1.1).
 */
export function candidatosItinerario(segmentos, fuente, ahoraIso) {
  var segs = Array.isArray(segmentos) ? segmentos : [];
  if (!segs.length) return [];
  var f = (fuente === 'adjunto') ? 'adjunto' : 'declaracion_pasajero';
  var out = [{
    campo: 'segmentos',
    valor: segs,
    fuente: f,
    extraido_en: ahoraIso || null,
  }];
  var ext = extremosDireccionAfectada(segs);
  if (ext.origen_iata) out.push({ campo: 'origen_iata', valor: ext.origen_iata, fuente: f, extraido_en: ahoraIso || null });
  if (ext.destino_iata) out.push({ campo: 'destino_iata', valor: ext.destino_iata, fuente: f, extraido_en: ahoraIso || null });
  return out;
}
