/**
 * scripts/backfill-iata.mjs
 *
 * Backfill histórico de `origen_iata` / `destino_iata` en `reclamos`.
 *
 * La captura YA valida IATA (src/js/airport-select.js pone el código elegido en
 * data-iata), pero hasta este ciclo solo se persistía el label ("Buenos Aires (EZE)").
 * Este script porta el `resolve()` de ese archivo a Node y resuelve el histórico
 * contra src/data/airports.json.
 *
 * NO toca ninguna columna legacy: `origen` y `destino` quedan intactos (siguen siendo
 * el texto de display que lee toda la UI actual). Lo único que escribe es
 * `origen_iata` / `destino_iata`, y solo cuando el match es inequívoco. Lo que no
 * resuelve queda NULL —el motor emitirá FALTA_DATO— y se lista al final con el id y
 * el texto original para corregirlo a mano en el backoffice.
 *
 * Uso:
 *   node scripts/backfill-iata.mjs --dry-run    # no escribe nada, muestra qué haría
 *   node scripts/backfill-iata.mjs
 *
 * Env vars (acepta los dos nombres; los de /api son SUPABASE_*):
 *   SB_URL | SUPABASE_URL
 *   SB_KEY | SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

var __dirname = dirname(fileURLToPath(import.meta.url));

var SB_URL = process.env.SB_URL || process.env.SUPABASE_URL;
var SB_KEY = process.env.SB_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
var DRY_RUN = process.argv.includes('--dry-run');

/* Cuántos PATCH en paralelo. PostgREST no hace un PATCH masivo con un valor
   distinto por fila, así que va uno por caso, en lotes. */
var LOTE = 10;

/* ------------------------------------------------------------------ */
/* Índice de aeropuertos (puerto de src/js/airport-select.js)          */
/* ------------------------------------------------------------------ */

/* Mismos alias que el front, para que el resultado del backfill coincida con lo
   que hubiera resuelto el combobox en su momento. */
var ALIASES = {
  EZE: 'ezeiza pistarini buenos aires',
  AEP: 'aeroparque jorge newbery buenos aires',
  COR: 'cordoba pajas blancas',
  BRC: 'bariloche',
  USH: 'ushuaia',
  MDZ: 'mendoza',
  IGR: 'iguazu cataratas',
  SLA: 'salta',
  ROS: 'rosario',
  MVD: 'montevideo',
  SCL: 'santiago de chile',
  GRU: 'san pablo sao paulo guarulhos',
  MAD: 'madrid barajas',
  BCN: 'barcelona',
  JFK: 'nueva york new york',
  MIA: 'miami',
};

function norm(s) {
  return (s == null ? '' : String(s))
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // saca acentos
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

var airports = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'airports.json'), 'utf8'));
var byIata = {};
for (var i = 0; i < airports.length; i++) {
  var a = airports[i];
  a._c = norm(a.city);
  a._n = norm(a.name);
  a._i = a.iata.toLowerCase();
  a._s = a._c + ' ' + a._n + ' ' + a._i + (ALIASES[a.iata] ? ' ' + norm(ALIASES[a.iata]) : '');
  byIata[a.iata] = a;
}

/* Búsqueda rankeada — idéntica a la del front. */
function search(q, limit) {
  q = norm(q); limit = limit || 8;
  if (!q) return [];
  var res = [];
  for (var i = 0; i < airports.length; i++) {
    var a = airports[i], sc = -1;
    if (a._i === q) sc = 0;                 // código exacto
    else if (a._c === q) sc = 1;            // ciudad exacta
    else if (a._c.indexOf(q) === 0) sc = 2; // ciudad empieza con
    else if (a._i.indexOf(q) === 0) sc = 3; // código empieza con
    else if (a._n.indexOf(q) === 0) sc = 4; // nombre empieza con
    else if (a._s.indexOf(q) !== -1) sc = 5;// contiene (incluye alias)
    if (sc >= 0) res.push({ a: a, sc: sc });
  }
  res.sort(function (x, y) { return x.sc - y.sc || x.a._c.length - y.a._c.length; });
  return res.slice(0, limit).map(function (r) { return r.a; });
}

/* Resolvedor "confiado": devuelve el aeropuerto SOLO si el match es inequívoco. */
function resolve(text) {
  if (!text) return null;
  var t = String(text);
  var m = t.match(/\(([A-Za-z]{3})\)/);                 // "Buenos Aires (EZE)"
  if (m && byIata[m[1].toUpperCase()]) return byIata[m[1].toUpperCase()];
  var codes = t.match(/\b[A-Z]{3}\b/g);                 // "EZE - Buenos Aires" (formato IA)
  if (codes) {
    for (var k = 0; k < codes.length; k++) {
      if (byIata[codes[k]]) return byIata[codes[k]];
    }
  }
  var bare = t.trim().toUpperCase();                    // "eze"
  if (/^[A-Z]{3}$/.test(bare) && byIata[bare]) return byIata[bare];
  var q = norm(t);
  var exact = null, exactCount = 0;
  for (var i = 0; i < airports.length; i++) {
    var a = airports[i];
    if (a._c === q || a._n === q) { exact = a; exactCount++; }
  }
  if (exact && exactCount === 1) return exact;          // ciudad/nombre único
  var hits = search(t, 2);
  if (hits.length === 1) return hits[0];                // única sugerencia
  return null;
}

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

function sbHeaders(extra) {
  return Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, extra || {});
}

async function traerPendientes() {
  /* El prompt pide `origen_iata IS NULL`; se usa OR para agarrar también las filas
     donde solo falta el destino (p. ej. una corrida previa resolvió el origen). */
  var url = SB_URL + '/rest/v1/reclamos'
    + '?select=id,ref_code,origen,destino,origen_iata,destino_iata'
    + '&or=(origen_iata.is.null,destino_iata.is.null)'
    + '&deleted_at=is.null'
    + '&order=creado_en.asc';
  var r = await fetch(url, { headers: sbHeaders() });
  var texto = await r.text();
  if (!r.ok) throw new Error('GET reclamos ' + r.status + ': ' + texto.slice(0, 300));
  return JSON.parse(texto);
}

async function patchFila(id, patch) {
  var r = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error('PATCH ' + id + ' ' + r.status + ': ' + (await r.text()).slice(0, 200));
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('Faltan SB_URL / SB_KEY (o SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }

  console.log('[backfill-iata] ' + airports.length + ' aeropuertos indexados' + (DRY_RUN ? ' · DRY RUN (no escribe)' : ''));

  var filas = await traerPendientes();
  console.log('[backfill-iata] ' + filas.length + ' casos con IATA incompleto\n');

  var pendientes = [];   // { id, ref, patch }
  var noResueltos = [];  // { id, ref, campo, texto }

  filas.forEach(function (f) {
    var patch = {};
    [['origen', 'origen_iata'], ['destino', 'destino_iata']].forEach(function (par) {
      var display = par[0], col = par[1];
      if (f[col]) return;                                     // ya resuelto
      if (!f[display]) {
        noResueltos.push({ id: f.id, ref: f.ref_code, campo: display, texto: '(vacío)' });
        return;
      }
      var a = resolve(f[display]);
      if (a) patch[col] = a.iata;
      else noResueltos.push({ id: f.id, ref: f.ref_code, campo: display, texto: f[display] });
    });
    if (Object.keys(patch).length) pendientes.push({ id: f.id, ref: f.ref_code, patch: patch });
  });

  if (DRY_RUN) {
    pendientes.forEach(function (p) {
      console.log('  ' + (p.ref || p.id) + ' → ' + JSON.stringify(p.patch));
    });
  } else {
    var fallidos = 0;
    for (var i = 0; i < pendientes.length; i += LOTE) {
      var lote = pendientes.slice(i, i + LOTE);
      var results = await Promise.allSettled(lote.map(function (p) { return patchFila(p.id, p.patch); }));
      results.forEach(function (r, j) {
        if (r.status === 'rejected') { fallidos++; console.error('  ✗ ' + (lote[j].ref || lote[j].id) + ': ' + r.reason.message); }
      });
      console.log('  ... ' + Math.min(i + LOTE, pendientes.length) + '/' + pendientes.length);
    }
    if (fallidos) console.error('\n[backfill-iata] ' + fallidos + ' PATCH fallaron (ver arriba).');
  }

  console.log('\n[backfill-iata] Resueltos: ' + pendientes.length + ' casos (' +
    pendientes.reduce(function (n, p) { return n + Object.keys(p.patch).length; }, 0) + ' campos)');
  console.log('[backfill-iata] Sin resolver: ' + noResueltos.length + ' campos');
  noResueltos.forEach(function (n) {
    console.log('  · ' + (n.ref || '—') + ' [' + n.id + '] ' + n.campo + ' = "' + n.texto + '"');
  });
}

/* Solo corre si se lo invoca directo; importarlo expone el puerto de resolve()
   para poder testearlo sin tocar la base. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(function (e) { console.error('[backfill-iata] Error:', e.message); process.exit(1); });
}

export { norm, search, resolve };
