/**
 * api/_utils/motor-normalizar.js
 *
 * Fila de `reclamos` → objeto `caso` que consume el motor legal (contrato §1).
 *
 * FUNCIÓN PURA: sin fetch, sin `new Date()` implícito, sin leer env vars. Todo lo que
 * necesita entra por parámetro, así se testea en aislamiento y el resultado es
 * reproducible (misma fila → mismo caso).
 *
 * Lo que hace, y solo eso:
 *   1. Copia los campos canónicos de la Tabla A tal como están (no los reinterpreta).
 *   2. Deriva el Paso 0 del ruteo: países, ámbito EU261, internacional/doméstico,
 *      distancia ortodrómica, banda del Art. 7(1), condición de comunitario del carrier.
 *   3. Clasifica la CALIDAD del dato de los campos críticos: ausente, en conflicto o
 *      sin verificar. NO decide qué hacer con eso — eso es del evaluador (§2 regla 3).
 *
 * Lo que NO hace:
 *   - No resuelve nodos EVAL, no elige marco, no calcula montos ni prescripción.
 *   - No presume nada: donde falta el dato deja `null` y lo registra.
 *
 * ------------------------------------------------------------------
 * LA UNIDAD DE ANÁLISIS ES LA DIRECCIÓN AFECTADA (enmienda legal v2.1.2)
 * ------------------------------------------------------------------
 * El Pin 4 resolvía conexiones pero no direcciones: leído al pie de la letra ("origen =
 * primer aeropuerto, destino final = último"), un billete de ida y vuelta EZE→MAD→EZE
 * daba origen = destino, distancia 0 y los tests corridos sobre un par inexistente.
 *
 * La v2.1.2 lo precisa: en un billete redondo (o multi-destino) cada DIRECCIÓN es un
 * itinerario independiente a efectos de los tests, la distancia y el destino final. La
 * unidad de análisis es la dirección AFECTADA por el incidente.
 *
 * Cómo se traduce acá:
 *   - `segmentos[].afectado: true` marca el tramo donde ocurrió el hecho (a lo sumo uno).
 *   - De ahí sale la dirección afectada, y de ella `origen_iata`, `destino_iata`, `ruta`,
 *     la distancia, el nodo borde hub-UE y el carrier operante del Test A2.
 *   - Las direcciones se separan solas: el itinerario corta donde un tramo no engancha
 *     con el anterior o donde vuelve a un aeropuerto ya visitado (el giro del redondo).
 *   - Sin ningún tramo marcado y con más de una dirección, no se adivina cuál es: se
 *     analiza la primera y se deja un aviso. El backoffice además advierte en pantalla.
 *   - Sin `segmentos`, el comportamiento es el de siempre: mandan las columnas
 *     `origen_iata`/`destino_iata` y el carrier sale de la columna legacy `aerolinea`.
 *
 * ------------------------------------------------------------------
 * FORMA DEL OBJETO `caso`
 * ------------------------------------------------------------------
 * {
 *   id, ref_code,                        // trazabilidad, sin efecto legal
 *
 *   // — Tabla A canónica (tal cual, sin derivar) —
 *   incidentes: ['demora'],
 *   origen_iata, destino_iata,           // de la DIRECCIÓN AFECTADA (display aparte, en origen/destino)
 *   segmentos: [{orden, origen_iata, destino_iata, carrier_operante, fecha, afectado}],
 *   billete_unico: true|false|null,
 *   demora_salida_min, demora_llegada_min: number|null,
 *   antelacion_aviso_dias: number|null,
 *   reencaminamiento: {...}|null,
 *   atencion_ofrecida: {...}|null,
 *   fecha_incidente: 'YYYY-MM-DD'|null,
 *   causa_alegada: string|null,
 *   protesta: {realizada, fecha, medio}|null,
 *   checkin_presentacion: 'en_hora'|'tarde'|'no_presentado'|'no_aplica'|'desconocido',
 *   gastos_items: [{concepto, monto, moneda, fecha, archivo, fuente}],
 *   gastos_total_declarado: {monto, moneda}|null,   // declaración del pasajero, NO es ítem
 *
 *   // — derivados (Paso 0 del Componente 2) —
 *   origen: {iata, pais_iso, ambito_eu261, montreal_parte, lat, lon}|null,
 *   destino_final: {...}|null,
 *   ruta: [{...}],                       // endpoints de la dirección afectada, en orden
 *   direccion_afectada: {desde, hasta, ordenes: [1,2], marcada: bool}|null,
 *   direcciones_total: number,           // cuántas direcciones describen los segmentos
 *   carrier_operante: {nombre, iata, pais_licencia, comunitario}|null,
 *   carriers_por_segmento: [{orden, carrier}],
 *   internacional: true|false|null,
 *   paises: ['AR','ES'],                 // ISO-2 del itinerario, en orden, sin repetir
 *   intracomunitario: true|false|null,   // afecta la banda del Art. 7(1)
 *   transita_hub_eu261: true|false,      // nodo borde Wegener (Pin 4)
 *   distancia_km: number|null,
 *   banda_eu261: '<=1500'|'1500-3500'|'>3500'|null,
 *   montreal_ambos_partes: true|null,
 *
 *   // — calidad del dato (insumo de §2 regla 3) —
 *   campos_ausentes: [],                 // crítico en null → FALTA_DATO
 *   campos_en_conflicto: [],             // crítico con conflicto:true → FALTA_DATO (§1.1)
 *   campos_sin_verificar: [],            // tiene valor y no hay conflicto → provisional
 *   campos_falta_dato: [],               // ausentes ∪ en_conflicto (atajo del evaluador)
 *   avisos: [],                          // inconsistencias no legales que conviene ver
 * }
 */

/* Campos críticos: consecuencia legal directa, nunca se presumen ni se auto-verifican
   desde una sola fuente declarativa (contrato §1.1).
   `billete_unico` va incluido siguiendo §1.2 fila 4 ("Crítico: sí — afecta Test A"),
   aunque la enumeración de §1.1 lo omite. Discrepancia registrada en
   docs/motor-capa1-pendientes-legales.md. */
export var CAMPOS_CRITICOS = [
  'incidentes',
  'fecha_incidente',
  'demora_salida_min',
  'demora_llegada_min',
  'antelacion_aviso_dias',
  'protesta',
  'checkin_presentacion',
  'causa_alegada',
  'billete_unico',
];

var CHECKIN_VALIDOS = ['en_hora', 'tarde', 'no_presentado', 'no_aplica', 'desconocido'];

/* `reprogramacion` es válido en todo el dominio pero solo TIENE RÉGIMEN desde el
   10-oct-2024 (Art. 42 del Reglamento Dec. 809/2024). Para incidentes anteriores rige la
   Res. 1532, que no lo conoce como tipo propio: ahí el ruleset IV-A lo devuelve NO_APLICA
   con el motivo explícito, en vez de que el normalizador lo descarte en silencio. Quién
   decide es el ruleset, que es donde vive la ley. */
var INCIDENTES_VALIDOS = [
  'demora', 'cancelacion', 'reprogramacion', 'denegacion_embarque', 'downgrade', 'conexion_perdida',
  'equipaje_demora', 'equipaje_dano', 'equipaje_perdida', 'muerte_lesion',
];

/* ------------------------------------------------------------------ */
/* Helpers de datos auxiliares                                         */
/* ------------------------------------------------------------------ */

function normTexto(s) {
  return (s == null ? '' : String(s))
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Índice IATA → aeropuerto, a partir del array de src/data/airports.json.
 * Se construye una vez por request y se pasa a normalizarCaso().
 */
export function construirIndiceAeropuertos(lista) {
  var idx = {};
  (lista || []).forEach(function (a) {
    if (a && a.iata) idx[String(a.iata).toUpperCase()] = a;
  });
  return idx;
}

/**
 * Índice de aerolíneas por IATA y por nombre normalizado, desde api/_data/aerolineas.js.
 * El nombre hace falta porque la columna legacy `aerolinea` es texto libre.
 */
export function construirIndiceAerolineas(lista) {
  var porIata = {}, porNombre = {};
  (lista || []).forEach(function (a) {
    if (!a) return;
    if (a.iata) porIata[String(a.iata).toUpperCase()] = a;
    if (a.nombre) porNombre[normTexto(a.nombre)] = a;
  });
  return { porIata: porIata, porNombre: porNombre };
}

/**
 * Busca una aerolínea por nombre libre o código.
 * Devuelve `null` si no está en el seed → `comunitario: null` (desconocido), que el
 * motor traduce a FALTA_DATO solo si el Test A2 lo necesita (contrato §1.4).
 */
function buscarAerolinea(idxAero, texto) {
  if (!texto || !idxAero) return null;
  var t = String(texto).trim();
  var porIata = idxAero.porIata[t.toUpperCase()];
  if (porIata) return porIata;
  var n = normTexto(t);
  if (idxAero.porNombre[n]) return idxAero.porNombre[n];
  /* Coincidencia por prefijo: "LATAM Airlines Argentina" → "LATAM". Solo si es
     inequívoca (un único candidato), igual criterio que el resolvedor de aeropuertos. */
  var claves = Object.keys(idxAero.porNombre).filter(function (k) {
    return n.indexOf(k) === 0 || k.indexOf(n) === 0;
  });
  if (claves.length === 1) return idxAero.porNombre[claves[0]];
  return null;
}

/**
 * Distancia ortodrómica en km (Art. 7(4) EU261: origen → destino final).
 * Radio medio de la Tierra = 6371 km.
 */
export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  var R = 6371;
  var rad = function (x) { return x * Math.PI / 180; };
  var dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Banda del Art. 7(1) según la tabla del Pin 6.
 *
 * El detalle que se suele perder: la fila de €400 es "intracomunitarios > 1500 km Y
 * demás 1500–3500 km". Para un vuelo INTRACOMUNITARIO la fila no tiene techo, así que
 * uno de 4000 km sigue siendo banda de €400, no de €600.
 *
 * Por eso depende de `intracomunitario`, que es tri-estado. Si no se sabe si el vuelo
 * es intracomunitario, la ambigüedad solo importa por encima de 3500 km (abajo las dos
 * filas coinciden): ahí devuelve `null` en vez de elegir.
 *
 * Los montos NO viven acá: esta función devuelve la ETIQUETA de banda y el ruleset la
 * traduce a euros. Así el evaluador no contiene ningún número legal.
 */
export function bandaEu261(distanciaKm, intracomunitario) {
  if (distanciaKm == null) return null;
  if (distanciaKm <= 1500) return '<=1500';
  if (intracomunitario === true) return '1500-3500';   // fila de €400, sin techo
  if (distanciaKm <= 3500) return '1500-3500';         // ambas filas coinciden acá
  if (intracomunitario === false) return '>3500';
  return null;                                          // >3500 y no se sabe si es intra-UE
}

/* ------------------------------------------------------------------ */
/* Normalización                                                       */
/* ------------------------------------------------------------------ */

function comoArray(v) { return Array.isArray(v) ? v : []; }

function comoNumero(v) {
  if (v == null || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function comoIata(v) {
  var s = (v == null ? '' : String(v)).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/**
 * Parte los segmentos en DIRECCIONES (enmienda legal v2.1.2) y devuelve, por dirección,
 * la lista de índices de `segmentos` que la componen.
 *
 * Corta en dos situaciones, las dos observables sin más dato que los IATA:
 *   1. El tramo no engancha con el anterior (destino del previo ≠ origen del actual):
 *      son itinerarios distintos, no una conexión.
 *   2. El tramo aterriza en un aeropuerto YA visitado en la dirección en curso: eso es
 *      el giro de un ida y vuelta (EZE→MAD, MAD→EZE parte en dos direcciones), no una
 *      escala. JFK→MAD, MAD→EZE no vuelve sobre nada: es una sola dirección con hub.
 *
 * Un tramo sin alguno de sus dos extremos corta también: sin IATA no se puede afirmar
 * que enganche, y encadenarlo a ciegas es exactamente la clase de presunción que el
 * motor no hace.
 */
export function partirEnDirecciones(segmentos) {
  var dirs = [], actual = null, visitados = [];
  (segmentos || []).forEach(function (s, i) {
    var cortar = !actual;
    if (actual) {
      var previo = segmentos[actual[actual.length - 1]];
      if (!previo.destino_iata || !s.origen_iata) cortar = true;
      else if (previo.destino_iata !== s.origen_iata) cortar = true;
      else if (s.destino_iata && visitados.indexOf(s.destino_iata) !== -1) cortar = true;
    }
    if (cortar) {
      actual = [];
      dirs.push(actual);
      visitados = s.origen_iata ? [s.origen_iata] : [];
    }
    actual.push(i);
    if (s.destino_iata && visitados.indexOf(s.destino_iata) === -1) visitados.push(s.destino_iata);
  });
  return dirs;
}

/** Descripción de un aeropuerto para el ruteo. `null` si el IATA no se conoce. */
function puntoRuta(iata, idxAeropuertos, paises) {
  var code = comoIata(iata);
  if (!code) return null;
  var a = idxAeropuertos[code] || null;
  var iso = a && a.pais_iso ? String(a.pais_iso).toUpperCase() : null;
  return {
    iata: code,
    pais_iso: iso,
    /* tri-estado: true/false firmes, null para territorios cuya cobertura no está
       decidida (ver TERRITORIOS_AMBIGUOS en api/_data/paises-ue.js) */
    ambito_eu261: iso ? paises.enAmbitoEU261(iso) : null,
    montreal_parte: iso ? paises.montrealParte(iso) : null,
    lat: a && a.lat != null ? a.lat : null,
    lon: a && a.lon != null ? a.lon : null,
    ciudad: a ? a.city || null : null,
    conocido: !!a,
  };
}

/**
 * Fila de `reclamos` → objeto `caso`.
 *
 * @param {Object} row               Fila de reclamos (select=*)
 * @param {Object} idxAeropuertos    construirIndiceAeropuertos(airports.json)
 * @param {Object} idxAerolineas     construirIndiceAerolineas(aerolineas.js)
 * @param {Object} paises            módulo api/_data/paises-ue.js
 * @returns {Object} caso
 */
export function normalizarCaso(row, idxAeropuertos, idxAerolineas, paises) {
  row = row || {};
  idxAeropuertos = idxAeropuertos || {};
  var meta = (row.campos_meta && typeof row.campos_meta === 'object') ? row.campos_meta : {};
  var avisos = [];

  /* ---- Tabla A canónica ---- */
  var incidentes = comoArray(row.incidentes).filter(function (i) {
    if (INCIDENTES_VALIDOS.indexOf(i) !== -1) return true;
    avisos.push('incidente desconocido, ignorado: ' + String(i));
    return false;
  });

  var segmentos = comoArray(row.segmentos)
    .map(function (s, i) {
      return {
        orden: comoNumero(s && s.orden) != null ? comoNumero(s.orden) : i + 1,
        origen_iata: comoIata(s && s.origen_iata),
        destino_iata: comoIata(s && s.destino_iata),
        carrier_operante: (s && s.carrier_operante) || null,
        fecha: (s && s.fecha) || null,
        /* v2.1.2: el tramo donde ocurrió el incidente. Ausente = false, nunca null: es
           una marca, no un dato del que se pueda dudar. */
        afectado: !!(s && s.afectado === true),
      };
    })
    .sort(function (a, b) { return a.orden - b.orden; });

  var checkin = row.checkin_presentacion || 'desconocido';
  if (CHECKIN_VALIDOS.indexOf(checkin) === -1) {
    avisos.push('checkin_presentacion con valor no reconocido ("' + checkin + '"), se trata como desconocido');
    checkin = 'desconocido';
  }

  /* El total que declara el pasajero NO es un ítem de gasto (§1.2 fila 14): es un
     candidato contrastable contra la suma de ítems, insumo del EVAL de suficiencia
     probatoria. Las columnas legacy monto_gastos/moneda_gastos son exactamente eso. */
  var totalDeclarado = comoNumero(row.monto_gastos);
  var gastosTotalDeclarado = totalDeclarado == null ? null
    : { monto: totalDeclarado, moneda: row.moneda_gastos || null };

  /* ---- Dirección afectada: la unidad de análisis (enmienda legal v2.1.2) ---- */
  var direcciones = partirEnDirecciones(segmentos);
  var marcados = [];
  segmentos.forEach(function (s, i) { if (s.afectado) marcados.push(i); });
  if (marcados.length > 1) {
    avisos.push('hay ' + marcados.length + ' tramos marcados como afectados y solo puede haber uno; se toma el primero (tramo ' + segmentos[marcados[0]].orden + ')');
  }
  var idxAfectado = marcados.length ? marcados[0] : null;

  var idxDireccion = 0;
  if (idxAfectado != null) {
    direcciones.forEach(function (d, n) { if (d.indexOf(idxAfectado) !== -1) idxDireccion = n; });
  } else if (direcciones.length > 1) {
    /* Acá está el sesgo que la v2.1.2 vino a cerrar: sin tramo marcado se analiza la
       primera dirección, que en un redondo es la IDA. Si el incidente fue en la vuelta,
       el análisis es sobre el itinerario equivocado — por eso se avisa y el backoffice
       lo advierte en pantalla. No se adivina. */
    avisos.push('los segmentos describen ' + direcciones.length + ' direcciones y ninguna está marcada como afectada; se analiza la primera. Marcá el tramo del incidente para que el motor use la dirección correcta');
  }
  var segsDireccion = (direcciones[idxDireccion] || []).map(function (i) { return segmentos[i]; });

  /* ---- Ruta: la dirección afectada manda si hay segmentos cargados ---- */
  var origenIata = comoIata(row.origen_iata);
  var destinoIata = comoIata(row.destino_iata);

  if (segsDireccion.length) {
    var segOrigen = segsDireccion[0].origen_iata;
    var segDestino = segsDireccion[segsDireccion.length - 1].destino_iata;
    /* Los segmentos son el dato fino (los carga un humano en el backoffice) y definen
       el itinerario; las columnas quedan como respaldo. Si discrepan se avisa, no se
       elige en silencio. */
    if (segOrigen && origenIata && segOrigen !== origenIata) {
      avisos.push('origen_iata (' + origenIata + ') no coincide con el primer tramo de la dirección afectada (' + segOrigen + '); manda el segmento');
    }
    if (segDestino && destinoIata && segDestino !== destinoIata) {
      avisos.push('destino_iata (' + destinoIata + ') no coincide con el último tramo de la dirección afectada (' + segDestino + '); manda el segmento');
    }
    origenIata = segOrigen || origenIata;
    destinoIata = segDestino || destinoIata;
  }

  var origen = puntoRuta(origenIata, idxAeropuertos, paises);
  var destinoFinal = puntoRuta(destinoIata, idxAeropuertos, paises);

  if (origenIata && origen && !origen.conocido) avisos.push('IATA de origen no está en airports.json: ' + origenIata);
  if (destinoIata && destinoFinal && !destinoFinal.conocido) avisos.push('IATA de destino no está en airports.json: ' + destinoIata);

  /* Endpoints en orden, para que los tests de ruteo puedan recorrer el itinerario. Solo
     los de la dirección afectada: la otra dirección es un itinerario distinto y no
     activa marcos por su cuenta (v2.1.2). */
  var ruta = [];
  if (segsDireccion.length) {
    segsDireccion.forEach(function (s) {
      var o = puntoRuta(s.origen_iata, idxAeropuertos, paises);
      var d = puntoRuta(s.destino_iata, idxAeropuertos, paises);
      if (o) ruta.push(o);
      if (d) ruta.push(d);
    });
  } else {
    if (origen) ruta.push(origen);
    if (destinoFinal) ruta.push(destinoFinal);
  }

  /* ---- Países e internacional/doméstico (Paso 0 punto 4) ---- */
  var paisesRuta = [];
  var hayPaisDesconocido = false;
  ruta.forEach(function (p) {
    if (!p.pais_iso) { hayPaisDesconocido = true; return; }
    if (paisesRuta.indexOf(p.pais_iso) === -1) paisesRuta.push(p.pais_iso);
  });

  var internacional = null;
  if (!hayPaisDesconocido && paisesRuta.length) internacional = paisesRuta.length > 1;
  else if (paisesRuta.length > 1) internacional = true;  // ya cruza fronteras, falte o no un dato

  /* ---- Intracomunitario (define la banda del Art. 7(1), ver bandaEu261) ---- */
  var intracomunitario = null;
  if (origen && destinoFinal && origen.pais_iso && destinoFinal.pais_iso) {
    var oUE = paises.UE.has(origen.pais_iso), dUE = paises.UE.has(destinoFinal.pais_iso);
    var oAmb = origen.ambito_eu261, dAmb = destinoFinal.ambito_eu261;
    if (oUE && dUE) intracomunitario = true;
    else if (oAmb === false || dAmb === false) intracomunitario = false;
    /* Resto: los dos dentro del ámbito pero no los dos en la UE (p. ej. ES→NO), o algún
       territorio sin clasificar. Si "intracomunitario" abarca al EEE/CH es una cuestión
       legal abierta → queda null y bandaEu261() solo se ve afectado por encima de
       3500 km. Registrado en docs/motor-capa1-pendientes-legales.md. */
  }

  /* ---- Nodo borde por hub UE (Pin 4) ---- */
  var extremosFueraUE = !!(origen && destinoFinal
    && origen.ambito_eu261 === false && destinoFinal.ambito_eu261 === false);
  var hubIntermedio = false;
  if (segsDireccion.length > 1) {
    /* Intermedios = todos los endpoints de la DIRECCIÓN AFECTADA salvo su primer origen
       y su último destino. Mirar el billete entero metería como "hub intermedio" el
       aeropuerto donde el itinerario da la vuelta, que no es una escala (v2.1.2). */
    for (var i = 0; i < segsDireccion.length; i++) {
      var esPrimero = i === 0, esUltimo = i === segsDireccion.length - 1;
      if (!esPrimero) {
        var pi = puntoRuta(segsDireccion[i].origen_iata, idxAeropuertos, paises);
        if (pi && pi.ambito_eu261 === true) hubIntermedio = true;
      }
      if (!esUltimo) {
        var pd = puntoRuta(segsDireccion[i].destino_iata, idxAeropuertos, paises);
        if (pd && pd.ambito_eu261 === true) hubIntermedio = true;
      }
    }
  }
  var transitaHub = extremosFueraUE && hubIntermedio;

  /* ---- Distancia y banda ---- */
  var distanciaKm = haversineKm(origen, destinoFinal);
  if (distanciaKm != null) distanciaKm = Math.round(distanciaKm);
  var banda = bandaEu261(distanciaKm, intracomunitario);

  /* ---- Carrier operante ---- */
  var carriersPorSegmento = segmentos.map(function (s) {
    return { orden: s.orden, carrier: buscarAerolinea(idxAerolineas, s.carrier_operante) };
  });
  /* Sin segmentos cargados, la columna legacy `aerolinea` es lo único que hay. Es el
     transportista COMERCIALIZADOR según el formulario, no necesariamente el operante
     (Tabla A fila 5 exige el operante) → se avisa. */
  /* El Test A2 pregunta por el transportista OPERANTE del vuelo en cuestión: sale del
     tramo afectado si está marcado, y si no del primero de la dirección afectada
     (v2.1.2). En un redondo, el primer tramo del billete puede ser de otra aerolínea
     que ni siquiera voló el trayecto del incidente. */
  var carrierCaso = null;
  if (idxAfectado != null) {
    carrierCaso = buscarAerolinea(idxAerolineas, segmentos[idxAfectado].carrier_operante);
    if (!carrierCaso && segsDireccion.length) carrierCaso = buscarAerolinea(idxAerolineas, segsDireccion[0].carrier_operante);
  } else if (segsDireccion.length) {
    carrierCaso = buscarAerolinea(idxAerolineas, segsDireccion[0].carrier_operante);
  } else if (row.aerolinea) {
    carrierCaso = buscarAerolinea(idxAerolineas, row.aerolinea);
    avisos.push('carrier tomado de la columna `aerolinea` (declarada en el formulario); Tabla A fila 5 pide el transportista OPERANTE, cargar `segmentos` para precisarlo');
  }
  if (row.aerolinea && !carrierCaso) {
    avisos.push('aerolínea "' + row.aerolinea + '" no está en api/_data/aerolineas.js → comunitario desconocido');
  }

  /* ---- Montreal: ambos Estados parte (Test E) ---- */
  var montrealAmbos = null;
  if (internacional === true && origen && destinoFinal) {
    montrealAmbos = (origen.montreal_parte === true && destinoFinal.montreal_parte === true) ? true : null;
  }

  /* ---- Calidad del dato de los campos críticos ---- */
  var valores = {
    incidentes: incidentes.length ? incidentes : null,
    fecha_incidente: row.fecha_incidente || null,
    demora_salida_min: comoNumero(row.demora_salida_min),
    demora_llegada_min: comoNumero(row.demora_llegada_min),
    antelacion_aviso_dias: comoNumero(row.antelacion_aviso_dias),
    /* `desconocido` es ausencia de dato, no un valor: v2.1 fila 18 lo dice para
       check-in y fila 17 usa el mismo vocabulario para la protesta. */
    protesta: (row.protesta && row.protesta.realizada && row.protesta.realizada !== 'desconocido') ? row.protesta : null,
    checkin_presentacion: checkin === 'desconocido' ? null : checkin,
    causa_alegada: row.causa_alegada || null,
    billete_unico: typeof row.billete_unico === 'boolean' ? row.billete_unico : null,
  };

  var ausentes = [], enConflicto = [], sinVerificar = [];
  CAMPOS_CRITICOS.forEach(function (campo) {
    var m = meta[campo] || {};
    if (m.conflicto === true) { enConflicto.push(campo); return; }   // §1.1: conflicto = FALTA_DATO
    if (valores[campo] == null) { ausentes.push(campo); return; }
    if (m.verificado !== true) sinVerificar.push(campo);
  });

  return {
    id: row.id || null,
    ref_code: row.ref_code || null,

    /* Tabla A canónica */
    incidentes: incidentes,
    origen_iata: origenIata,
    destino_iata: destinoIata,
    segmentos: segmentos,
    billete_unico: valores.billete_unico,
    demora_salida_min: valores.demora_salida_min,
    demora_llegada_min: valores.demora_llegada_min,
    antelacion_aviso_dias: valores.antelacion_aviso_dias,
    reencaminamiento: row.reencaminamiento || null,
    atencion_ofrecida: row.atencion_ofrecida || null,
    fecha_incidente: valores.fecha_incidente,
    causa_alegada: valores.causa_alegada,
    protesta: row.protesta || null,
    checkin_presentacion: checkin,
    gastos_items: comoArray(row.gastos_items),
    gastos_total_declarado: gastosTotalDeclarado,

    /* Derivados */
    origen: origen,
    destino_final: destinoFinal,
    ruta: ruta,
    direccion_afectada: segsDireccion.length ? {
      desde: segsDireccion[0].origen_iata,
      hasta: segsDireccion[segsDireccion.length - 1].destino_iata,
      ordenes: segsDireccion.map(function (s) { return s.orden; }),
      /* false = la eligió el motor por ser la primera, no la marcó nadie. */
      marcada: idxAfectado != null,
    } : null,
    direcciones_total: direcciones.length,
    carrier_operante: carrierCaso,
    carriers_por_segmento: carriersPorSegmento,
    internacional: internacional,
    paises: paisesRuta,
    intracomunitario: intracomunitario,
    transita_hub_eu261: transitaHub,
    distancia_km: distanciaKm,
    banda_eu261: banda,
    montreal_ambos_partes: montrealAmbos,

    /* Calidad del dato */
    campos_ausentes: ausentes,
    campos_en_conflicto: enConflicto,
    campos_sin_verificar: sinVerificar,
    campos_falta_dato: ausentes.concat(enConflicto),
    avisos: avisos,
  };
}
