/**
 * tests/fixtures/escaneo.js
 *
 * Datos del caso real que motivó el ciclo de ciudades multi-aeropuerto: ida USH→EZE,
 * vuelta AEP→USH. Buenos Aires con sus dos aeropuertos es lo que rompía la extracción,
 * así que es el fixture por defecto de todo lo que toque dirección afectada.
 */

/* Subconjunto de src/data/airports.json con la forma real de esos registros. El archivo
   completo son 6000+ entradas y ~800 KB: para el DOM alcanza con los tres del caso. */
export var AEROPUERTOS = [
  { iata: 'USH', city: 'Ushuaia', name: 'Malvinas Argentinas', country: 'Argentina', lat: -54.843, lon: -68.295, pais_iso: 'AR' },
  { iata: 'EZE', city: 'Buenos Aires', name: 'Ministro Pistarini', country: 'Argentina', lat: -34.822, lon: -58.535, pais_iso: 'AR' },
  { iata: 'AEP', city: 'Buenos Aires', name: 'Jorge Newbery', country: 'Argentina', lat: -34.559, lon: -58.415, pais_iso: 'AR' },
];

export var SEGMENTOS_IDA_VUELTA = [
  { orden: 1, direccion: 'ida',    origen: 'USH - Ushuaia',      destino: 'EZE - Buenos Aires', vuelo_nro: 'AR 1891', aerolinea_operadora: 'Aerolineas Argentinas', fecha: '2026-07-21' },
  { orden: 2, direccion: 'vuelta', origen: 'AEP - Buenos Aires', destino: 'USH - Ushuaia',      vuelo_nro: 'AR 1890', aerolinea_operadora: 'Aerolineas Argentinas', fecha: '2026-07-28' },
];

export var SEGMENTOS_SOLO_IDA = [
  { orden: 1, direccion: 'ida', origen: 'USH - Ushuaia', destino: 'EZE - Buenos Aires', vuelo_nro: 'AR 1891', aerolinea_operadora: '', fecha: '2026-07-21' },
];

/** Respuesta de `/api/process-ticket` tal como la devuelve el escaneo con IA. */
export function respuestaEscaneo(segmentos) {
  return {
    success: true,
    data: {
      nombre: 'Juan Pablo Mario Adaniya', email: '', telefono: '', doc_numero: '',
      aerolinea: 'Aerolineas Argentinas', vuelo_nro: 'AR 1891', numero_ticket: '', pnr: '',
      origen: 'USH - Ushuaia', destino: 'EZE - Buenos Aires', escalas: '',
      fecha_vuelo: '2026-07-21', incidencia_detectada: '', gastos_monto: '', gastos_moneda: '',
      direccion_afectada_sugerida: '',
      segmentos: segmentos || SEGMENTOS_IDA_VUELTA,
    },
  };
}

/**
 * Stub de `fetch` para el form público: sirve el subconjunto de aeropuertos, el flag de
 * IA encendido y la respuesta del escaneo. Cualquier otra URL devuelve `{}`.
 */
export function fetchEscaneo(segmentos) {
  return function (url) {
    var u = String(url);
    var json = function (body) { return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body); } }); };
    if (u.indexOf('airports.json') > -1) return json(AEROPUERTOS);
    if (u.indexOf('public-config') > -1) return json({ ai_extraccion: true });
    if (u.indexOf('process-ticket') > -1) return json(respuestaEscaneo(segmentos));
    return json({});
  };
}
