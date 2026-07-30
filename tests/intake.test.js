/**
 * tests/intake.test.js
 *
 * Helpers puros del intake (`api/_utils/intake.js`). Sin framework ni dependencias:
 *
 *   node tests/intake.test.js
 *
 * Qué cubre: el saneo de lo que devuelve la extracción con IA (que es texto de un
 * modelo y puede venir de cualquier forma) y la derivación de las columnas del motor
 * legal. Todo es mecánico y verificable sin criterio legal.
 *
 * Lo que NO cubre, porque necesita credenciales y documentos reales: la llamada a
 * Gemini. La aceptación de la Fase 1 sobre documentos de verdad (reserva ida y vuelta
 * con escalas, pasaje de un tramo, documento ilegible) se corre en staging.
 *
 * Exit code distinto de 0 si algo falla.
 */
import {
  limpiarTexto, iataDeEtiqueta, iata3, sanearSegmentosIa, normalizarDireccionSugerida,
  derivarIncidentes, sanearSegmentosCanonicos, extremosDireccionAfectada,
  candidatosItinerario,
} from '../api/_utils/intake.js';

/* Colores, apagados solos si la salida no es una terminal (igual que motor.test.js). */
var TTY = process.stdout.isTTY;
function c(codigo, s) { return TTY ? '[' + codigo + 'm' + s + '[0m' : s; }
var verde = function (s) { return c('32', s); };
var rojo = function (s) { return c('31', s); };
var gris = function (s) { return c('90', s); };

var ok = 0, fail = 0;

function igual(etiqueta, real, esperado) {
  var r = JSON.stringify(real), e = JSON.stringify(esperado);
  if (r === e) { ok++; return null; }
  fail++;
  return etiqueta + ': esperado ' + e + ', real ' + r;
}

function correr(nombre, fn) {
  var dif = null;
  try { dif = fn(); } catch (err) { fail++; dif = 'lanzó: ' + (err && err.message ? err.message : String(err)); }
  if (dif) console.log('  ' + rojo('✗ ' + nombre) + '\n      ' + dif);
  else console.log('  ' + verde('✓ ' + nombre));
}

console.log('\nIntake v2 — helpers puros\n');

correr('limpiarTexto: los "null" de la IA son ausencia de dato', function () {
  return igual('null string', limpiarTexto('null'), '')
    || igual('N/A', limpiarTexto('N/A'), '')
    || igual('undefined real', limpiarTexto(undefined), '')
    || igual('texto con espacios', limpiarTexto('  Iberia  '), 'Iberia');
});

correr('iataDeEtiqueta: "EZE - Buenos Aires" → EZE', function () {
  return igual('etiqueta completa', iataDeEtiqueta('EZE - Buenos Aires'), 'EZE')
    || igual('minúsculas', iataDeEtiqueta('mad - Madrid'), 'MAD')
    || igual('sin código', iataDeEtiqueta('Buenos Aires'), '')
    || igual('vacío', iataDeEtiqueta(''), '');
});

correr('(b) pasaje de un solo tramo → segmentos de un elemento', function () {
  var r = sanearSegmentosIa([
    { orden: 1, direccion: 'ida', origen: 'EZE - Buenos Aires', destino: 'MAD - Madrid', vuelo_nro: 'IB6844', aerolinea_operadora: 'Iberia', fecha: '2026-05-10' },
  ]);
  return igual('un tramo', r.length, 1)
    || igual('contenido', r[0], { orden: 1, direccion: 'ida', origen: 'EZE - Buenos Aires', destino: 'MAD - Madrid', vuelo_nro: 'IB6844', aerolinea_operadora: 'Iberia', fecha: '2026-05-10' });
});

correr('(c) documento ilegible → segmentos vacío, sin inventar nada', function () {
  return igual('array vacío', sanearSegmentosIa([]), [])
    || igual('clave ausente', sanearSegmentosIa(undefined), [])
    || igual('no es array', sanearSegmentosIa('EZE→MAD'), [])
    || igual('basura adentro', sanearSegmentosIa([null, 'x', {}, { origen: 'EZE - Buenos Aires' }]), []);
});

correr('(a) ida y vuelta con escalas: orden cronológico y renumerado sin huecos', function () {
  /* Desordenados a propósito, y con un hueco (9) para ver el renumerado. */
  var r = sanearSegmentosIa([
    { orden: 9, direccion: 'vuelta', origen: 'ATL - Atlanta', destino: 'EZE - Buenos Aires' },
    { orden: 1, direccion: 'ida', origen: 'EZE - Buenos Aires', destino: 'ATL - Atlanta' },
    { orden: 3, direccion: 'vuelta', origen: 'TUL - Tulsa', destino: 'ATL - Atlanta' },
    { orden: 2, direccion: 'ida', origen: 'ATL - Atlanta', destino: 'TUL - Tulsa' },
  ]);
  return igual('cuatro tramos', r.length, 4)
    || igual('renumerado', r.map(function (s) { return s.orden; }), [1, 2, 3, 4])
    || igual('cronología respetada', r.map(function (s) { return s.origen.slice(0, 3); }), ['EZE', 'ATL', 'TUL', 'ATL'])
    || igual('direcciones', r.map(function (s) { return s.direccion; }), ['ida', 'ida', 'vuelta', 'vuelta']);
});

correr('dirección desconocida queda vacía: nunca se presume "ida"', function () {
  var r = sanearSegmentosIa([{ origen: 'EZE - Buenos Aires', destino: 'MAD - Madrid', direccion: 'no se' }]);
  return igual('tri-estado', r[0].direccion, '');
});

correr('la sugerencia de dirección es sugerencia, y coherente con los tramos', function () {
  var segs = [{ orden: 1, direccion: 'ida', origen: 'EZE - Buenos Aires', destino: 'MAD - Madrid' }];
  return igual('valor válido presente en los tramos', normalizarDireccionSugerida('vuelta', [{ direccion: 'vuelta' }]), 'vuelta')
    /* Sugerir la vuelta de un viaje del que no se extrajo ningún tramo de vuelta. */
    || igual('incoherente → vacía', normalizarDireccionSugerida('vuelta', segs), '')
    || igual('basura → vacía', normalizarDireccionSugerida('probablemente la ida', segs), '')
    || igual('ausente → vacía', normalizarDireccionSugerida(undefined, segs), '');
});

correr('derivarIncidentes: tipos reales, la vigencia la elige el motor', function () {
  return igual('demora', derivarIncidentes('vuelo', 'demora', null), ['demora'])
    /* D1 (v2.2): la reprogramación pasó a ser tipo propio. Mapearla a cancelación
       concedía los derechos del Art. 41 —alternativas y reintegro— que el Art. 42 no da.
       El intake escribe el tipo real y el ruleset de cada vigencia decide qué significa:
       bajo la 1532 sale NO_APLICA con el motivo, bajo el 809/2024 tiene régimen propio. */
    || igual('reprogramación → tipo propio (D1)', derivarIncidentes('vuelo', 'reprogramacion', null), ['reprogramacion'])
    || igual('overbooking', derivarIncidentes('vuelo', 'overbooking', null), ['denegacion_embarque'])
    || igual('denegación', derivarIncidentes('vuelo', 'denegacion', null), ['denegacion_embarque'])
    || igual('equipaje dañado', derivarIncidentes('equipaje', null, 'danio'), ['equipaje_dano'])
    /* Conjunto: el combo acumula los dos incidentes. */
    || igual('vuelo + equipaje', derivarIncidentes('vuelo_equipaje', 'cancelacion', 'perdida'), ['cancelacion', 'equipaje_perdida'])
    /* Sin tipo de equipaje no se presume: los plazos de protesta son distintos. */
    || igual('equipaje sin tipo', derivarIncidentes('equipaje', null, null), [])
    || igual('incidencia desconocida', derivarIncidentes('vuelo', 'lo_que_sea', null), []);
});

correr('segmentos canónicos: IATA, un solo afectado, orden 1..n', function () {
  var r = sanearSegmentosCanonicos([
    { orden: 2, origen_iata: 'mad', destino_iata: 'EZE', afectado: true, fecha: '2026-05-24' },
    { orden: 1, origen_iata: 'EZE', destino_iata: 'MAD', afectado: true, fecha: 'no es fecha' },
    { origen_iata: '', destino_iata: '' },
  ]);
  return igual('dos tramos (el vacío se descarta)', r.length, 2)
    || igual('IATA normalizado', r[0].origen_iata, 'EZE')
    || igual('un solo afectado, el primero marcado', r.map(function (s) { return s.afectado; }), [true, false])
    || igual('fecha inválida → null', r[0].fecha, null)
    || igual('fecha válida', r[1].fecha, '2026-05-24');
});

correr('extremos de la dirección afectada', function () {
  var segs = sanearSegmentosCanonicos([
    { orden: 1, origen_iata: 'MAD', destino_iata: 'ATL' },
    { orden: 2, origen_iata: 'ATL', destino_iata: 'EZE', afectado: true },
  ]);
  return igual('par de la dirección', extremosDireccionAfectada(segs), { origen_iata: 'MAD', destino_iata: 'EZE' })
    || igual('sin segmentos', extremosDireccionAfectada([]), { origen_iata: null, destino_iata: null });
});

correr('candidatos con procedencia para datos_extraidos', function () {
  var segs = sanearSegmentosCanonicos([{ orden: 1, origen_iata: 'EZE', destino_iata: 'MAD', afectado: true }]);
  var deScan = candidatosItinerario(segs, 'adjunto', '2026-07-30T10:00:00Z');
  var aMano = candidatosItinerario(segs, 'declaracion_pasajero', '2026-07-30T10:00:00Z');
  return igual('tres candidatos', deScan.length, 3)
    || igual('campos', deScan.map(function (d) { return d.campo; }), ['segmentos', 'origen_iata', 'destino_iata'])
    || igual('fuente del scan', deScan[0].fuente, 'adjunto')
    || igual('fuente manual', aMano[0].fuente, 'declaracion_pasajero')
    || igual('sin segmentos, sin candidatos', candidatosItinerario([], 'adjunto', null), []);
});

correr('payload real del formulario → columnas del motor (ida y vuelta, incidente en la vuelta)', function () {
  /* Esto es exactamente lo que manda el front tras un scan EZE→ATL→TUL / TUL→ATL→EZE
     con el problema en la vuelta: solo los tramos de esa dirección. */
  var payload = {
    tipo_reclamo: 'vuelo', tipo_incidencia: 'cancelacion', tipo_caso_equipaje: null,
    tipo_viaje: 'ida_vuelta', itinerario_fuente: 'adjunto',
    segmentos: [
      { orden: 1, origen_iata: 'TUL', destino_iata: 'ATL', carrier_operante: 'Delta', fecha: '2026-05-24', afectado: true },
      { orden: 2, origen_iata: 'ATL', destino_iata: 'EZE', carrier_operante: 'Delta', fecha: '2026-05-24', afectado: false },
    ],
  };
  var segs = sanearSegmentosCanonicos(payload.segmentos);
  var ext = extremosDireccionAfectada(segs);
  var inc = derivarIncidentes(payload.tipo_reclamo, payload.tipo_incidencia, payload.tipo_caso_equipaje);
  var cand = candidatosItinerario(segs, payload.itinerario_fuente, '2026-07-30T10:00:00Z');
  return igual('dos tramos', segs.length, 2)
    /* El par canónico es el de la dirección afectada: leído como billete entero daría
       EZE→EZE, que es lo que la enmienda v2.1.2 vino a cerrar. */
    || igual('origen/destino de la dirección afectada', [ext.origen_iata, ext.destino_iata], ['TUL', 'EZE'])
    || igual('el afectado sigue siendo el primero', segs.map(function (s) { return s.afectado; }), [true, false])
    || igual('incidentes derivado del formulario', inc, ['cancelacion'])
    || igual('candidatos con fuente adjunto', cand.map(function (c) { return c.campo + ':' + c.fuente; }),
        ['segmentos:adjunto', 'origen_iata:adjunto', 'destino_iata:adjunto']);
});

console.log('\nResumen');
console.log('  ' + verde(ok + ' ok') + '   ' + (fail ? rojo(fail + ' fallan') : gris('0 fallan')) + '\n');
process.exit(fail ? 1 : 0);
