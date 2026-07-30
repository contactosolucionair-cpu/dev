/**
 * tests/api-bundle.test.js
 *
 * Lo que tiene que sobrevivir al bundler de Vercel.
 *
 *   node tests/api-bundle.test.js
 *
 * 1. TRIPWIRE `import.meta`. El repo no declara `"type": "module"`, así que Vercel compila
 *    las funciones de `/api` a CommonJS, donde `import.meta` no existe. En local no se nota:
 *    Node detecta la sintaxis ESM del archivo y la habilita, así que el mismo código pasa
 *    los tests y muere en producción con `Cannot use 'import.meta' outside a module`. Eso
 *    fue exactamente lo que tumbó a `analizar-caso`. Este test es la única defensa
 *    automatizada que existe contra esa clase de bug: si vuelve a aparecer bajo `api/`,
 *    falla acá y no en Vercel.
 *
 *    Nota: el escaneo es texto crudo, comentarios incluidos. Es a propósito — un scanner
 *    que entienda comentarios es un scanner con agujeros. Si necesitás nombrar la sintaxis
 *    en un comentario de `api/`, nombrala partida.
 *
 * 2. ESPEJO DE DATOS. `api/_data/airports.js` es una copia derivada de
 *    `src/data/airports.json` (el JSON no se puede borrar: el front lo pide por fetch y
 *    `scripts/enrich-airports.mjs` lo reescribe). Si los dos se separan, el motor analiza
 *    con un padrón de aeropuertos distinto al que ve el usuario cargando el formulario.
 *
 * 3. SMOKE del cargador: `cargarDatosMotor()` devuelve índices utilizables sin tocar el
 *    filesystem.
 *
 * Exit code distinto de 0 si algo falla.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

import aeropuertosModulo from '../api/_data/airports.js';
import { cargarDatosMotor } from '../api/_utils/motor-datos.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var RAIZ = join(__dirname, '..');
var API = join(RAIZ, 'api');

var ok = 0, fail = 0;

function chk(cond, msg, extra) {
  if (cond) { ok++; console.log('  \x1b[32mOK\x1b[0m     ' + msg); }
  else { fail++; console.log('  \x1b[31mFALLA\x1b[0m  ' + msg); if (extra) console.log('         ' + extra); }
}

/** Todos los .js bajo un directorio, recursivo. */
function archivosJs(dir) {
  var salida = [];
  readdirSync(dir).forEach(function (nombre) {
    var ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) { salida = salida.concat(archivosJs(ruta)); return; }
    if (/\.(js|mjs|cjs)$/.test(nombre)) salida.push(ruta);
  });
  return salida;
}

console.log('\n\x1b[1mTRIPWIRE import.meta bajo api/\x1b[0m');

var archivos = archivosJs(API);
chk(archivos.length > 0, 'el escaneo encuentra archivos (' + archivos.length + ' .js bajo api/)',
  'si esto falla, el tripwire no está mirando nada y los demás OK no valen');

var culpables = [];
archivos.forEach(function (ruta) {
  readFileSync(ruta, 'utf8').split('\n').forEach(function (linea, i) {
    if (linea.indexOf('import.meta') > -1) {
      culpables.push(relative(RAIZ, ruta).split(sep).join('/') + ':' + (i + 1));
    }
  });
});
chk(culpables.length === 0, 'ningún archivo de api/ usa import.meta',
  culpables.length ? 'aparece en: ' + culpables.join(', ') + ' — Vercel compila /api a CommonJS y ahí no existe' : '');

console.log('\n\x1b[1mEspejo de datos\x1b[0m');

var jsonCrudo = readFileSync(join(RAIZ, 'src', 'data', 'airports.json'), 'utf8');
var aeropuertosJson = JSON.parse(jsonCrudo);
chk(Array.isArray(aeropuertosModulo) && aeropuertosModulo.length === aeropuertosJson.length,
  'api/_data/airports.js tiene los mismos ' + aeropuertosJson.length + ' aeropuertos que src/data/airports.json',
  'módulo: ' + (Array.isArray(aeropuertosModulo) ? aeropuertosModulo.length : typeof aeropuertosModulo));
chk(JSON.stringify(aeropuertosModulo) === JSON.stringify(aeropuertosJson),
  'api/_data/airports.js es idéntico a src/data/airports.json',
  'se separaron: regenerá el módulo (es `export default` + el texto del JSON, tal cual)');

console.log('\n\x1b[1mCargador del motor\x1b[0m');

var datos = cargarDatosMotor();
chk(!!(datos.idxAeropuertos && datos.idxAeropuertos.EZE && datos.idxAeropuertos.EZE.pais_iso === 'AR'),
  'cargarDatosMotor() indexa aeropuertos (EZE → AR)');
chk(!!(datos.idxAerolineas && datos.idxAerolineas.porIata && datos.idxAerolineas.porIata.AR),
  'cargarDatosMotor() indexa aerolíneas (AR)',
  'claves del índice: ' + Object.keys(datos.idxAerolineas || {}).join(', '));
chk(datos.paises && typeof datos.paises === 'object' && !!Object.keys(datos.paises).length,
  'cargarDatosMotor() trae el módulo de países');
chk(cargarDatosMotor() === datos, 'la caché de módulo devuelve la misma instancia');

console.log('\n\x1b[1m━━━ RESUMEN\x1b[0m');
console.log('  ' + ok + ' OK · ' + fail + ' fallan\n');
process.exit(fail ? 1 : 0);
