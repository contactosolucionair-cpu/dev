/**
 * Sanitización determinística de ruta (origen / destino / escalas) para la
 * salida del extractor de IA. Problema que resuelve: en reservas ida y vuelta
 * donde la vuelta usa OTRO aeropuerto de la misma ciudad (ej. ida USH→EZE,
 * vuelta AEP→USH), la IA colapsa todo en un viaje con escalas y devuelve
 * origen == destino. Acá se razona por CIUDAD (área metropolitana), se
 * limpian escalas espurias y se recupera el destino real de la ida.
 * Compartido por api/process-ticket.js y api/analyze-document.js.
 *
 * ALCANCE: esto cubre los CAMPOS SUELTOS de compatibilidad, que desde el ciclo
 * Intake v2 son el camino de fallback — el itinerario primario viaja en
 * `segmentos`, y ahí el mismo colapso se manifiesta como tramos mal asignados a
 * una sola dirección. La guarda determinística sobre `segmentos` es un ciclo
 * aparte (ciclo B) y va a vivir en este mismo archivo reutilizando METRO/metroOf.
 */

/* Áreas metropolitanas con múltiples aeropuertos comerciales relevantes. */
export var METRO = {
  EZE: 'BUE', AEP: 'BUE',
  GRU: 'SAO', CGH: 'SAO', VCP: 'SAO',
  GIG: 'RIO', SDU: 'RIO',
  JFK: 'NYC', LGA: 'NYC', EWR: 'NYC',
  LHR: 'LON', LGW: 'LON', STN: 'LON', LTN: 'LON', LCY: 'LON',
  CDG: 'PAR', ORY: 'PAR',
  FCO: 'ROM', CIA: 'ROM',
  MXP: 'MIL', LIN: 'MIL', BGY: 'MIL',
  NRT: 'TYO', HND: 'TYO',
  ICN: 'SEL', GMP: 'SEL',
  KIX: 'OSA', ITM: 'OSA',
  ORD: 'CHI', MDW: 'CHI',
  IAD: 'WAS', DCA: 'WAS', BWI: 'WAS',
  SVO: 'MOW', DME: 'MOW', VKO: 'MOW',
  IST: 'IST', SAW: 'IST'
};

/* Primer código IATA presente en un texto tipo "EZE - Buenos Aires". */
export function iataOf(txt) {
  var m = String(txt || '').toUpperCase().match(/\b[A-Z]{3}\b/);
  return m ? m[0] : null;
}

/* Ciudad metropolitana de un texto de aeropuerto; la IATA misma si no
   pertenece a un área metro conocida; null si no hay IATA legible. */
export function metroOf(txt) {
  var code = iataOf(txt);
  if (!code) return null;
  return METRO[code] || code;
}

function splitEscalas(s) {
  return String(s || '').split(',')
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return !!x; });
}

/**
 * Sanitiza la ruta extraída por IA. Recibe strings crudos, devuelve
 * { origen, destino, escalas } con el mismo contrato (escalas = string
 * separado por comas, posiblemente vacío).
 *
 * Regla 1: una "escala" en la misma ciudad que el origen o el destino es
 *          siempre un artefacto de parseo → se elimina.
 * Regla 2: origen y destino en la misma ciudad = ida y vuelta colapsada.
 *          Recuperación: la primera escala que NO sea de la ciudad de
 *          origen es, con altísima probabilidad, el destino real de la
 *          ida (caso USH→USH, escalas [EZE, AEP] → destino EZE). Si no
 *          hay de dónde recuperar, destino queda vacío para que el
 *          usuario lo complete (el frontend ya muestra "Confirmá el
 *          aeropuerto" ante campo sin resolver).
 * Fallback: si origen o destino no traen IATA legible, la detección de
 *          "misma ciudad" cae a la comparación legacy de los primeros
 *          3 caracteres en mayúsculas.
 */
export function sanitizeRuta(origen, destino, escalas) {
  var o = String(origen || '').trim();
  var d = String(destino || '').trim();
  var list = splitEscalas(escalas);
  var mo = metroOf(o);
  var md = metroOf(d);

  /* Regla 1 */
  list = list.filter(function (e) {
    var me = metroOf(e);
    if (!me) return true;
    return me !== mo && me !== md;
  });

  /* Regla 2 */
  var mismaCiudad = (mo && md)
    ? (mo === md)
    : (!!o && !!d && o.substring(0, 3).toUpperCase() === d.substring(0, 3).toUpperCase());

  if (o && d && mismaCiudad) {
    var recovered = null;
    for (var i = 0; i < list.length; i++) {
      var me2 = metroOf(list[i]);
      if (me2 && me2 !== mo) { recovered = list[i]; list.splice(i, 1); break; }
    }
    if (recovered) {
      d = recovered;
      md = metroOf(d);
      /* re-filtrar contra el nuevo destino (ej. sacar AEP si destino pasó a EZE) */
      list = list.filter(function (e) {
        var me3 = metroOf(e);
        return !me3 || (me3 !== mo && me3 !== md);
      });
    } else {
      d = '';
    }
  }

  return { origen: o, destino: d, escalas: list.join(', ') };
}

/* ==================================================================== */
/* Cortes de dirección sobre el itinerario tramo por tramo               */
/* ==================================================================== */

/**
 * Forma mínima común a las DOS representaciones de un tramo, para que las reglas de
 * corte se escriban una sola vez:
 *
 *   forma IA        {orden, direccion, origen: 'EZE - Buenos Aires', destino, ...}
 *   forma canónica  {orden, origen_iata: 'EZE', destino_iata, carrier_operante, ...}
 */
function minimo(s) {
  if (!s || typeof s !== 'object') return null;
  var o = iataOf(s.origen_iata || s.origen);
  var d = iataOf(s.destino_iata || s.destino);
  var f = String(s.fecha || '').slice(0, 10);
  return { o: o, d: d, fecha: /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : '' };
}

function diasEntre(a, b) {
  var ta = Date.parse(a + 'T00:00:00Z'), tb = Date.parse(b + 'T00:00:00Z');
  if (!isFinite(ta) || !isFinite(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

/**
 * Índices donde el itinerario cambia de dirección. Un corte en `i` significa que la
 * dirección termina en el tramo `i` y la siguiente empieza en `i + 1`.
 *
 * Reglas, en orden de confianza:
 *
 *   1. TEMPORAL — entre la llegada de un tramo y la salida del siguiente pasan 2 días o
 *      más. El umbral es 2 y no 1 a propósito: sin horarios, una conexión que cruza
 *      medianoche aparece como un día de diferencia y NO es un corte.
 *   2. METROPOLITANA — se llega a un aeropuerto y se sale de OTRO de la misma ciudad
 *      (EZE / AEP). Es el caso USH→EZE, AEP→USH que motivó el ciclo: no es una escala,
 *      es el punto de retorno.
 *   3. RETORNO AL ORIGEN — el itinerario termina en la ciudad de partida.
 *
 * La 3 corre SOLO si las dos primeras no encontraron nada, y esto es una decisión de
 * implementación que vale la pena explicar: la regla es indiferente al punto de corte
 * (mira el último destino del itinerario, no el tramo `i`), así que aplicada en paralelo
 * marcaría TODOS los límites de cualquier ida y vuelta. En un EZE→ATL, ATL→TUL, TUL→ATL,
 * ATL→EZE ensuciaría el corte correcto —que la regla 1 encuentra sola, porque ida y
 * vuelta están a días de distancia— con dos falsos, y el itinerario terminaría marcado
 * como ambiguo en vez de partido. Como último recurso, en cambio, resuelve justo el caso
 * que las otras dos no ven: el ida y vuelta de dos tramos por el mismo aeropuerto y sin
 * fechas utilizables, donde devuelve un único límite. Con más de dos tramos y sin
 * ninguna otra señal devuelve varios, que es la respuesta honesta: no hay con qué saber.
 */
export function cortesDeDireccion(segmentos) {
  var t = (Array.isArray(segmentos) ? segmentos : []).map(minimo).filter(Boolean);
  if (t.length < 2) return [];

  var cortes = [];
  for (var i = 0; i < t.length - 1; i++) {
    var a = t[i], b = t[i + 1];

    var dias = (a.fecha && b.fecha) ? diasEntre(a.fecha, b.fecha) : null;
    if (dias !== null && dias >= 2) { cortes.push(i); continue; }

    var ma = a.d ? metroOf(a.d) : null;
    var mb = b.o ? metroOf(b.o) : null;
    if (a.d && b.o && a.d !== b.o && ma && ma === mb) { cortes.push(i); continue; }
  }
  if (cortes.length) return cortes;

  var metroOrigen = t[0].o ? metroOf(t[0].o) : null;
  var ultimo = t[t.length - 1].d;
  if (!metroOrigen || !ultimo || metroOf(ultimo) !== metroOrigen) return [];
  var candidatos = [];
  for (var j = 0; j < t.length - 1; j++) candidatos.push(j);
  return candidatos;
}

/** Comparador cronológico: por fecha cuando las dos existen, si no por `orden`. */
function cronologico(a, b) {
  var fa = String(a.fecha || '').slice(0, 10), fb = String(b.fecha || '').slice(0, 10);
  if (fa && fb && fa !== fb) return fa < fb ? -1 : 1;
  return (parseInt(a.orden, 10) || 0) - (parseInt(b.orden, 10) || 0);
}

/**
 * Corrige la `direccion` de los tramos que devolvió el modelo (forma IA).
 *
 * NO inventa ni elimina tramos: solo los ordena cronológicamente y los re-etiqueta.
 *
 *   - Un corte  → todo lo anterior es 'ida', todo lo posterior 'vuelta'.
 *   - Cero cortes → pasa tal cual, con las etiquetas del modelo.
 *   - Más de un corte → NO se adivina: pasan tal cual y se marca `ambiguos`. Un
 *     itinerario de tres tramos o más puede tener escalas largas, tramos abiertos o
 *     tres ciudades; elegir uno de varios cortes sería inventar.
 *
 * Devuelve `{segmentos, ambiguos}` y no solo el array porque el flag tiene que llegar a
 * la respuesta del endpoint.
 */
export function sanitizeSegmentos(segmentos) {
  var segs = (Array.isArray(segmentos) ? segmentos : []).filter(function (s) {
    return s && typeof s === 'object';
  });
  if (segs.length < 2) return { segmentos: segs, ambiguos: false };

  var ordenados = segs.slice().sort(cronologico);
  ordenados.forEach(function (s, i) { s.orden = i + 1; });

  var cortes = cortesDeDireccion(ordenados);
  if (cortes.length !== 1) return { segmentos: ordenados, ambiguos: cortes.length > 1 };

  var corte = cortes[0];
  ordenados.forEach(function (s, i) { s.direccion = i <= corte ? 'ida' : 'vuelta'; });
  return { segmentos: ordenados, ambiguos: false };
}

/**
 * La sugerencia de dirección sigue al TRAMO, no a la etiqueta vieja.
 *
 * Si el modelo dijo que la incidencia fue en la "ida" y el tramo que señalaba quedó
 * re-etiquetado como vuelta, la sugerencia tiene que pasar a vuelta: lo que el modelo
 * vio es dónde ocurrió el incidente, no cómo se llama esa mitad del viaje.
 */
export function seguirSugerencia(sugerida, antes, despues) {
  var s = String(sugerida == null ? '' : sugerida).trim().toLowerCase();
  if (s !== 'ida' && s !== 'vuelta') return '';
  var previos = Array.isArray(antes) ? antes : [];
  var ancla = null;
  for (var i = 0; i < previos.length; i++) {
    if (previos[i] && previos[i].direccion === s) { ancla = previos[i]; break; }
  }
  if (!ancla) return '';
  var actuales = Array.isArray(despues) ? despues : [];
  for (var j = 0; j < actuales.length; j++) {
    var d = actuales[j];
    if (d && d.origen === ancla.origen && d.destino === ancla.destino && d.vuelo_nro === ancla.vuelo_nro) {
      return d.direccion || '';
    }
  }
  return '';
}

/**
 * ¿Los tramos canónicos que mandó el cliente describen MÁS DE UNA dirección?
 *
 * La forma canónica no tiene campo `direccion` —por diseño el formulario manda una sola
 * dirección, la afectada— así que acá no hay nada que corregir: un corte es la evidencia
 * de que llegó un itinerario que no debería. Los tramos se persisten intactos y el
 * hallazgo viaja como candidato en `datos_extraidos`, porque la base no puede depender
 * de que el front se porte bien.
 */
export function segmentosCanonicosAmbiguos(segmentos) {
  return cortesDeDireccion(segmentos).length > 0;
}
