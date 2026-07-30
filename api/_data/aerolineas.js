/**
 * api/_data/aerolineas.js
 *
 * Aerolíneas operadas en la práctica: {nombre, iata, pais_licencia, comunitario}.
 * `comunitario` = licencia de explotación de un Estado miembro de la UE (Reg. 261/2004
 * art. 3.1.b). Reemplaza al viejo `aerolineas.json`: es un módulo ESM para que el motor
 * lo consuma con import estático y el bundler de Vercel lo empaquete con la función.
 *
 * Mismo criterio que `paises-ue.js`: los datos del motor viajan como módulos, no como
 * archivos leídos en runtime.
 */
export default [
  { "nombre": "Aerolíneas Argentinas", "iata": "AR", "pais_licencia": "AR", "comunitario": false },
  { "nombre": "Flybondi",              "iata": "FO", "pais_licencia": "AR", "comunitario": false },
  { "nombre": "JetSMART",              "iata": "JA", "pais_licencia": "CL", "comunitario": false },
  { "nombre": "LATAM",                 "iata": "LA", "pais_licencia": "CL", "comunitario": false },
  { "nombre": "Iberia",                "iata": "IB", "pais_licencia": "ES", "comunitario": true },
  { "nombre": "Air Europa",            "iata": "UX", "pais_licencia": "ES", "comunitario": true },
  { "nombre": "Level",                 "iata": null, "pais_licencia": "ES", "comunitario": true },
  { "nombre": "American Airlines",     "iata": "AA", "pais_licencia": "US", "comunitario": false },
  { "nombre": "United Airlines",       "iata": "UA", "pais_licencia": "US", "comunitario": false },
  { "nombre": "Delta Air Lines",       "iata": "DL", "pais_licencia": "US", "comunitario": false },
  { "nombre": "Copa Airlines",         "iata": "CM", "pais_licencia": "PA", "comunitario": false },
  { "nombre": "Avianca",               "iata": "AV", "pais_licencia": "CO", "comunitario": false },
  { "nombre": "GOL",                   "iata": "G3", "pais_licencia": "BR", "comunitario": false },
  { "nombre": "Azul",                  "iata": "AD", "pais_licencia": "BR", "comunitario": false },
  { "nombre": "British Airways",       "iata": "BA", "pais_licencia": "GB", "comunitario": false },
  { "nombre": "Air France",            "iata": "AF", "pais_licencia": "FR", "comunitario": true },
  { "nombre": "KLM",                   "iata": "KL", "pais_licencia": "NL", "comunitario": true },
  { "nombre": "Lufthansa",             "iata": "LH", "pais_licencia": "DE", "comunitario": true },
  { "nombre": "TAP Air Portugal",      "iata": "TP", "pais_licencia": "PT", "comunitario": true },
  { "nombre": "Turkish Airlines",      "iata": "TK", "pais_licencia": "TR", "comunitario": false },
  { "nombre": "Emirates",              "iata": "EK", "pais_licencia": "AE", "comunitario": false },
  { "nombre": "Qatar Airways",         "iata": "QR", "pais_licencia": "QA", "comunitario": false }
];
