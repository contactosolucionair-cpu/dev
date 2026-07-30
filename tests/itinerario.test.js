/**
 * tests/itinerario.test.js
 *
 * `sanitizeRuta` de `api/_utils/itinerario.js`: los cinco casos de aceptación del ciclo
 * de ciudades multi-aeropuerto.
 *
 *   node tests/itinerario.test.js
 *
 * El bug: una reserva ida y vuelta cuyo regreso sale de OTRO aeropuerto de la misma
 * ciudad (ida USH→EZE, vuelta AEP→USH) llegaba colapsada en un solo viaje —origen USH,
 * destino USH, escalas "EZE, AEP"—. La guarda anterior comparaba los primeros 3
 * caracteres: detectaba el origen == destino pero solo sabía vaciar el destino.
 *
 * ALCANCE: esto cubre los CAMPOS SUELTOS de compatibilidad, que son el camino de
 * fallback. El itinerario primario viaja en `segmentos`, y ahí el mismo colapso se
 * manifiesta como tramos mal asignados a una sola dirección — guarda pendiente (ciclo B).
 *
 * Exit code distinto de 0 si algo falla.
 */
import {
  sanitizeRuta, sanitizeSegmentos, seguirSugerencia, segmentosCanonicosAmbiguos,
} from '../api/_utils/itinerario.js';

var ok = 0, fail = 0;

function chk(cond, msg, extra) {
  if (cond) { ok++; console.log('  \x1b[32mOK\x1b[0m     ' + msg); }
  else { fail++; console.log('  \x1b[31mFALLA\x1b[0m  ' + msg); if (extra) console.log('         ' + extra); }
}

/** Atajo para escribir tramos en forma IA. */
function ia(orden, direccion, origen, destino, vuelo, fecha) {
  return { orden: orden, direccion: direccion, origen: origen, destino: destino, vuelo_nro: vuelo || '', aerolinea_operadora: '', fecha: fecha || '' };
}
/** Atajo para escribir tramos en forma canónica (la que se persiste). */
function can(orden, o, d, fecha) {
  return { orden: orden, origen_iata: o, destino_iata: d, carrier_operante: null, fecha: fecha || null, afectado: orden === 1 };
}
var dirs = function (r) { return r.segmentos.map(function (s) { return s.direccion; }).join(','); };

var CASOS = [
  { n: 1, desc: 'ida y vuelta colapsada: recupera el destino real de la ida',
    in: ['USH - Ushuaia', 'USH - Ushuaia', 'EZE - Buenos Aires, AEP - Buenos Aires'],
    esp: { origen: 'USH - Ushuaia', destino: 'EZE - Buenos Aires', escalas: '' } },
  { n: 2, desc: 'misma ciudad sin escalas: no hay de dónde recuperar, destino vacío',
    in: ['EZE - Buenos Aires', 'AEP - Buenos Aires', ''],
    esp: { origen: 'EZE - Buenos Aires', destino: '', escalas: '' } },
  { n: 3, desc: 'escala legítima: no se toca nada',
    in: ['EZE - Buenos Aires', 'TUL - Tulsa', 'ATL - Atlanta'],
    esp: { origen: 'EZE - Buenos Aires', destino: 'TUL - Tulsa', escalas: 'ATL - Atlanta' } },
  { n: 4, desc: 'sin IATA legible: cae al fallback de los 3 caracteres',
    in: ['Ushuaia', 'Ushuaia', ''],
    esp: { origen: 'Ushuaia', destino: '', escalas: '' } },
  { n: 5, desc: 'escala espuria en la ciudad del destino: se elimina',
    in: ['USH - Ushuaia', 'EZE - Buenos Aires', 'AEP - Buenos Aires'],
    esp: { origen: 'USH - Ushuaia', destino: 'EZE - Buenos Aires', escalas: '' } },
];

console.log('\n\x1b[1msanitizeRuta — casos de aceptación\x1b[0m');
CASOS.forEach(function (c) {
  var got = sanitizeRuta(c.in[0], c.in[1], c.in[2]);
  var bien = got.origen === c.esp.origen && got.destino === c.esp.destino && got.escalas === c.esp.escalas;
  if (bien) { ok++; console.log('  \x1b[32mOK\x1b[0m     #' + c.n + ' ' + c.desc); }
  else {
    fail++;
    console.log('  \x1b[31mFALLA\x1b[0m  #' + c.n + ' ' + c.desc);
    console.log('         entrada:  ' + JSON.stringify(c.in));
    console.log('         obtenido: ' + JSON.stringify(got));
    console.log('         esperado: ' + JSON.stringify(c.esp));
  }
});

/* ==================================================================== */
/* sanitizeSegmentos — corrección de dirección (forma IA)                */
/* ==================================================================== */

console.log('\n\x1b[1msanitizeSegmentos — forma IA\x1b[0m');

/* EL CASO REAL: el modelo no vio el corte y etiquetó todo como ida. El corte se detecta
   por regla metropolitana (llega a EZE, sale de AEP). */
{
  var r = sanitizeSegmentos([
    ia(1, 'ida', 'USH - Ushuaia', 'EZE - Buenos Aires', 'AR 1891', '2026-07-21'),
    ia(2, 'ida', 'AEP - Buenos Aires', 'USH - Ushuaia', 'AR 1890', '2026-07-28'),
  ]);
  chk(dirs(r) === 'ida,vuelta', 'caso real USH→EZE / AEP→USH ambos "ida" → re-split correcto', 'obtenido: ' + dirs(r));
  chk(r.ambiguos === false, 'no queda marcado ambiguo');
  chk(r.segmentos.length === 2, 'no inventa ni elimina tramos');
}

/* Ida y vuelta simétrica ya bien etiquetada: el resultado tiene que ser el mismo. */
{
  var r2 = sanitizeSegmentos([
    ia(1, 'ida', 'EZE - Buenos Aires', 'MAD - Madrid', 'IB 6844', '2026-03-01'),
    ia(2, 'vuelta', 'MAD - Madrid', 'EZE - Buenos Aires', 'IB 6845', '2026-03-15'),
  ]);
  chk(dirs(r2) === 'ida,vuelta', 'ida y vuelta simétrica ya correcta → passthrough sin cambios', 'obtenido: ' + dirs(r2));
  chk(r2.ambiguos === false, 'tampoco es ambigua');
}

/* Solo ida con escala legítima: mismo aeropuerto, mismo día, no vuelve al origen. */
{
  var r3 = sanitizeSegmentos([
    ia(1, 'ida', 'EZE - Buenos Aires', 'ATL - Atlanta', 'DL 110', '2026-05-02'),
    ia(2, 'ida', 'ATL - Atlanta', 'TUL - Tulsa', 'DL 2754', '2026-05-02'),
  ]);
  chk(dirs(r3) === 'ida,ida', 'solo ida con escala legítima → sin corte', 'obtenido: ' + dirs(r3));
  chk(r3.ambiguos === false, 'y sin marca de ambigüedad');
}

/* Corte por fechas, sin horarios: mismo aeropuerto en los dos sentidos, 9 días de por
   medio. Es la regla temporal la que lo separa. */
{
  var r4 = sanitizeSegmentos([
    ia(1, 'ida', 'EZE - Buenos Aires', 'MAD - Madrid', 'IB 6844', '2026-03-01'),
    ia(2, 'ida', 'MAD - Madrid', 'EZE - Buenos Aires', 'IB 6845', '2026-03-10'),
  ]);
  chk(dirs(r4) === 'ida,vuelta', 'corte por fechas (9 días) con solo fechas → re-split', 'obtenido: ' + dirs(r4));
}

/* Una conexión que cruza medianoche son fechas consecutivas y NO es corte: por eso el
   umbral es 2 días y no 1. */
{
  var r5 = sanitizeSegmentos([
    ia(1, 'ida', 'EZE - Buenos Aires', 'MAD - Madrid', 'IB 6844', '2026-03-01'),
    ia(2, 'ida', 'MAD - Madrid', 'BCN - Barcelona', 'IB 999', '2026-03-02'),
  ]);
  chk(dirs(r5) === 'ida,ida', 'conexión que cruza medianoche (1 día) → NO es corte', 'obtenido: ' + dirs(r5));
}

/* Multi-corte: tres ciudades con días de por medio entre todas. No se adivina. */
{
  var r6 = sanitizeSegmentos([
    ia(1, 'ida', 'EZE - Buenos Aires', 'MAD - Madrid', 'IB 1', '2026-03-01'),
    ia(2, 'ida', 'MAD - Madrid', 'FCO - Roma', 'AZ 2', '2026-03-10'),
    ia(3, 'ida', 'FCO - Roma', 'EZE - Buenos Aires', 'AZ 3', '2026-03-20'),
  ]);
  chk(r6.ambiguos === true, 'multi-corte → marcado ambiguo');
  chk(dirs(r6) === 'ida,ida,ida', 'y las etiquetas del modelo quedan intactas', 'obtenido: ' + dirs(r6));
  chk(r6.segmentos.length === 3, 'sin perder tramos');
}

/* La sugerencia sigue al tramo, no a la etiqueta vieja. */
console.log('\n\x1b[1mseguirSugerencia\x1b[0m');
{
  var antes = [
    ia(1, 'ida', 'USH - Ushuaia', 'EZE - Buenos Aires', 'AR 1891', '2026-07-21'),
    ia(2, 'ida', 'AEP - Buenos Aires', 'USH - Ushuaia', 'AR 1890', '2026-07-28'),
  ];
  /* El modelo vio la incidencia en el segundo tramo pero lo llamó "ida". */
  var despues = sanitizeSegmentos(antes.map(function (s) { var c = {}; for (var k in s) c[k] = s[k]; return c; })).segmentos;
  chk(seguirSugerencia('ida', antes, despues) === 'ida', 'ancla en el primer tramo "ida" → sigue siendo ida');
  var antes2 = [
    ia(1, 'vuelta', 'USH - Ushuaia', 'EZE - Buenos Aires', 'AR 1891', '2026-07-21'),
    ia(2, 'ida', 'AEP - Buenos Aires', 'USH - Ushuaia', 'AR 1890', '2026-07-28'),
  ];
  var despues2 = sanitizeSegmentos(antes2.map(function (s) { var c = {}; for (var k in s) c[k] = s[k]; return c; })).segmentos;
  chk(seguirSugerencia('ida', antes2, despues2) === 'vuelta',
    'el tramo que el modelo llamó "ida" quedó re-etiquetado vuelta → la sugerencia pasa a vuelta',
    'obtenido: ' + seguirSugerencia('ida', antes2, despues2));
  chk(seguirSugerencia('', antes, despues) === '', 'sin sugerencia devuelve vacío');
}

/* ==================================================================== */
/* segmentosCanonicosAmbiguos — detección en los inserts                 */
/* ==================================================================== */

console.log('\n\x1b[1msegmentosCanonicosAmbiguos — forma canónica\x1b[0m');

chk(segmentosCanonicosAmbiguos([can(1, 'USH', 'EZE', '2026-07-21'), can(2, 'AEP', 'USH', '2026-07-28')]) === true,
  'corte por metro (llega EZE / sale AEP) → flag');

chk(segmentosCanonicosAmbiguos([can(1, 'EZE', 'ATL', '2026-05-02'), can(2, 'ATL', 'TUL', '2026-05-02')]) === false,
  'una sola dirección con escala legítima → sin flag');

chk(segmentosCanonicosAmbiguos([can(1, 'EZE', 'MAD', '2026-03-01'), can(2, 'MAD', 'EZE', '2026-03-10')]) === true,
  'corte por fechas (9 días) → flag');

chk(segmentosCanonicosAmbiguos([can(1, 'EZE', 'MAD', '2026-03-01')]) === false,
  'un solo tramo nunca puede tener corte');

chk(segmentosCanonicosAmbiguos([]) === false, 'sin tramos, sin flag');

console.log('\nResumen');
console.log('  \x1b[32m' + ok + ' ok\x1b[0m   ' + (fail ? '\x1b[31m' + fail + ' fallan\x1b[0m' : '\x1b[2m0 fallan\x1b[0m') + '\n');
process.exit(fail ? 1 : 0);
