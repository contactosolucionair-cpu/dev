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
import { sanitizeRuta } from '../api/_utils/itinerario.js';

var ok = 0, fail = 0;

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

console.log('\nResumen');
console.log('  \x1b[32m' + ok + ' ok\x1b[0m   ' + (fail ? '\x1b[31m' + fail + ' fallan\x1b[0m' : '\x1b[2m0 fallan\x1b[0m') + '\n');
process.exit(fail ? 1 : 0);
