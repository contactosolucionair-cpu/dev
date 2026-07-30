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
