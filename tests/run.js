/**
 * tests/run.js — corre la suite entera.
 *
 *   npm test
 *
 * Cada archivo `*.test.js` corre en su propio proceso: son suites independientes, con
 * su propio exit code, y así una que se cuelgue o explote no se lleva puestas a las
 * demás. Sin framework, igual que el resto del repo.
 *
 * Exit code distinto de 0 si alguna falla.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

var AQUI = path.dirname(fileURLToPath(import.meta.url));

/* Orden deliberado: primero lo puro y rápido, después lo que levanta un DOM entero. */
var ORDEN = ['intake.test.js', 'itinerario.test.js', 'motor.test.js', 'formularios.test.js', 'escaneo.test.js'];

var encontrados = fs.readdirSync(AQUI).filter(function (f) { return /\.test\.js$/.test(f); });
var suites = ORDEN.filter(function (f) { return encontrados.indexOf(f) > -1; })
  .concat(encontrados.filter(function (f) { return ORDEN.indexOf(f) === -1; }));

var fallaron = [];
suites.forEach(function (archivo) {
  console.log('\n\x1b[1m\x1b[36m━━━ ' + archivo + ' \x1b[0m');
  var r = spawnSync(process.execPath, [path.join(AQUI, archivo)], { stdio: 'inherit' });
  if (r.status !== 0) fallaron.push(archivo);
});

console.log('\n\x1b[1m━━━ TOTAL \x1b[0m');
if (fallaron.length) {
  console.log('  \x1b[31m' + fallaron.length + ' de ' + suites.length + ' suites fallan:\x1b[0m ' + fallaron.join(', ') + '\n');
  process.exit(1);
}
console.log('  \x1b[32mlas ' + suites.length + ' suites en verde\x1b[0m\n');
