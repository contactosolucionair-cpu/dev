/**
 * tests/gastos.test.js
 *
 * Gastos itemizados y su espejo derivado (`api/_utils/gastos.js`). Sin framework:
 *
 *   node tests/gastos.test.js
 *
 * Por qué existe esta suite: `gastos_items` es el canónico y
 * `monto_gastos`/`moneda_gastos` son un espejo que se reescribe en el MISMO write. La
 * regla estaba escrita en tres lugares y aplicada en uno solo — las dos vías de alta
 * (pública y por agencia) escribían el espejo con el canónico vacío. El motor legal
 * cuenta `gastos_items.length` para el nodo de suficiencia probatoria, así que esos
 * casos se evaluaban como si el pasajero no hubiera declarado ningún gasto. El defecto
 * era silencioso: nada fallaba, solo puntuaba distinto.
 *
 * Lo que NO cubre, porque necesita base: que el INSERT real persista las tres columnas
 * juntas. Eso se prueba en staging.
 *
 * Exit code distinto de 0 si algo falla.
 */
import { normalizarGastosItems, espejoDeGastos, aplicarGastos } from '../api/_utils/gastos.js';

var TTY = process.stdout.isTTY;
function c(codigo, s) { return TTY ? '\x1b[' + codigo + 'm' + s + '\x1b[0m' : s; }
var verde = function (s) { return c('32', s); };
var rojo = function (s) { return c('31', s); };

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

console.log('\nGastos itemizados — canónico y espejo derivado\n');

/* ---------- normalización ---------- */

correr('un gasto completo conserva las seis claves del contrato', function () {
  var r = normalizarGastosItems([
    { concepto: 'Hotel una noche', monto: '120.50', moneda: 'usd', fecha: '2026-06-14', archivo: 'Gasto 1 - USD 120.50.pdf' },
  ], 'declaracion_pasajero');
  return igual('cantidad', r.length, 1)
    || igual('forma', r[0], {
      concepto: 'Hotel una noche',
      monto: 120.5,
      moneda: 'USD',
      fecha: '2026-06-14',
      archivo: 'Gasto 1 - USD 120.50.pdf',
      fuente: 'declaracion_pasajero',
    });
});

correr('la moneda se normaliza a mayúsculas SIEMPRE', function () {
  var r = normalizarGastosItems([
    { concepto: 'a', monto: 10, moneda: 'eur' },
    { concepto: 'b', monto: 10, moneda: 'Eur' },
    { concepto: 'c', monto: 10, moneda: ' EUR ' },
  ], 'admin');
  return igual('las tres son EUR', r.map(function (g) { return g.moneda; }), ['EUR', 'EUR', 'EUR']);
});

correr('sin monto no es un gasto: se descarta', function () {
  var r = normalizarGastosItems([
    { concepto: 'sin monto' },
    { concepto: 'monto vacío', monto: '' },
    { concepto: 'monto basura', monto: 'ocho dólares' },
    { concepto: 'monto negativo', monto: -5 },
    { concepto: 'válido', monto: 1 },
  ], 'admin');
  return igual('solo sobrevive el válido', r.map(function (g) { return g.concepto; }), ['válido']);
});

correr('monto cero SÍ es un gasto (0 no es lo mismo que ausente)', function () {
  var r = normalizarGastosItems([{ concepto: 'cortesía', monto: 0 }], 'admin');
  return igual('se conserva', r.length, 1) || igual('monto', r[0].monto, 0);
});

correr('la fuente por defecto depende de quién carga', function () {
  var pub = normalizarGastosItems([{ monto: 1 }], 'declaracion_pasajero');
  var age = normalizarGastosItems([{ monto: 1 }], 'agencia');
  var adm = normalizarGastosItems([{ monto: 1 }], 'admin');
  var explicita = normalizarGastosItems([{ monto: 1, fuente: 'adjunto' }], 'admin');
  return igual('pública', pub[0].fuente, 'declaracion_pasajero')
    || igual('agencia', age[0].fuente, 'agencia')
    || igual('admin', adm[0].fuente, 'admin')
    || igual('explícita gana', explicita[0].fuente, 'adjunto');
});

correr('entrada basura no rompe ni inventa gastos', function () {
  return igual('undefined', normalizarGastosItems(undefined, 'admin'), [])
    || igual('null', normalizarGastosItems(null, 'admin'), [])
    || igual('no es array', normalizarGastosItems('Hotel USD 120', 'admin'), [])
    || igual('array de basura', normalizarGastosItems([null, 'x', 7, {}], 'admin'), []);
});

correr('el comprobante viaja en `archivo`, y su ausencia es null', function () {
  var r = normalizarGastosItems([
    { monto: 1, archivo: 'Gasto 1 - ARS 1.00.jpg' },
    { monto: 2 },
    { monto: 3, archivo: '   ' },
  ], 'admin');
  return igual('archivos', r.map(function (g) { return g.archivo; }), ['Gasto 1 - ARS 1.00.jpg', null, null]);
});

/* ---------- espejo ---------- */

correr('una sola moneda: el espejo es la suma', function () {
  var items = normalizarGastosItems([
    { monto: 120, moneda: 'USD' }, { monto: 30, moneda: 'USD' },
  ], 'admin');
  return igual('espejo', espejoDeGastos(items), { monto_gastos: 150, moneda_gastos: 'USD' });
});

correr('varias monedas: gana la de mayor suma, sin mezclar', function () {
  var items = normalizarGastosItems([
    { monto: 120, moneda: 'USD' },
    { monto: 30, moneda: 'USD' },
    { monto: 8000, moneda: 'ARS' },
    { monto: 45, moneda: 'EUR' },
  ], 'admin');
  /* 8000 ARS > 150 USD como NÚMERO. El espejo no convierte monedas: refleja la de mayor
     suma nominal y el detalle real queda en gastos_items. */
  return igual('espejo', espejoDeGastos(items), { monto_gastos: 8000, moneda_gastos: 'ARS' });
});

correr("'eur' y 'EUR' no cuentan como dos monedas", function () {
  var items = normalizarGastosItems([
    { monto: 100, moneda: 'eur' }, { monto: 50, moneda: 'EUR' },
  ], 'admin');
  return igual('una sola moneda sumada', espejoDeGastos(items), { monto_gastos: 150, moneda_gastos: 'EUR' });
});

correr('sin moneda se asume ARS', function () {
  var items = normalizarGastosItems([{ monto: 10 }], 'admin');
  return igual('espejo', espejoDeGastos(items), { monto_gastos: 10, moneda_gastos: 'ARS' });
});

correr('sin gastos el espejo queda en null, no en cero', function () {
  return igual('vacío', espejoDeGastos([]), { monto_gastos: null, moneda_gastos: null })
    || igual('undefined', espejoDeGastos(undefined), { monto_gastos: null, moneda_gastos: null });
});

correr('la suma redondea a dos decimales', function () {
  var items = normalizarGastosItems([
    { monto: 0.1, moneda: 'USD' }, { monto: 0.2, moneda: 'USD' },
  ], 'admin');
  return igual('sin coma flotante sucia', espejoDeGastos(items).monto_gastos, 0.3);
});

/* ---------- canónico + espejo juntos ---------- */

correr('aplicarGastos escribe las TRES columnas en la misma fila', function () {
  var fila = { nombre: 'Juan' };
  aplicarGastos(fila, [
    { concepto: 'Hotel', monto: 120, moneda: 'USD', archivo: 'Gasto 1 - USD 120.00.pdf' },
    { concepto: 'Taxi', monto: 30, moneda: 'USD', archivo: 'Gasto 2 - USD 30.00.jpg' },
  ], 'declaracion_pasajero');
  return igual('ítems', fila.gastos_items.length, 2)
    || igual('espejo monto', fila.monto_gastos, 150)
    || igual('espejo moneda', fila.moneda_gastos, 'USD')
    || igual('no pisa lo demás', fila.nombre, 'Juan');
});

correr('sin gastos el canónico queda [] y el espejo null (no se omiten)', function () {
  var fila = {};
  aplicarGastos(fila, undefined, 'declaracion_pasajero');
  return igual('canónico', fila.gastos_items, [])
    || igual('espejo monto', fila.monto_gastos, null)
    || igual('espejo moneda', fila.moneda_gastos, null);
});

correr('REGRESIÓN: el canónico nunca queda vacío con espejo lleno', function () {
  /* Este es exactamente el defecto que tenían las dos vías de alta. Si alguna vez
     vuelve a pasar, el motor cuenta cero gastos itemizados y el caso puntúa distinto
     sin que nada falle a la vista. */
  var casos = [
    [{ monto: 120, moneda: 'USD' }],
    [{ monto: 1, moneda: 'ars' }, { monto: 2, moneda: 'ARS' }],
    [{ concepto: 'x', monto: 0 }],
  ];
  for (var i = 0; i < casos.length; i++) {
    var fila = {};
    aplicarGastos(fila, casos[i], 'declaracion_pasajero');
    var espejoLleno = fila.monto_gastos !== null;
    var canonicoVacio = fila.gastos_items.length === 0;
    var dif = igual('caso ' + i + ': espejo lleno con canónico vacío', espejoLleno && canonicoVacio, false);
    if (dif) return dif;
  }
  return null;
});

correr('REGRESIÓN inversa: espejo null obliga a canónico vacío', function () {
  var fila = {};
  aplicarGastos(fila, [{ concepto: 'sin monto' }], 'admin');
  return igual('canónico vacío', fila.gastos_items, [])
    || igual('espejo null', fila.monto_gastos, null);
});

console.log('\nResumen');
console.log('  ' + verde(ok + ' ok') + '   ' + (fail ? rojo(fail + ' fallan') : '0 fallan') + '\n');
process.exit(fail ? 1 : 0);
