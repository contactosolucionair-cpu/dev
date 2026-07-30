/**
 * scripts/enrich-airports.mjs
 *
 * Script one-off: agrega `lat`, `lon` y `pais_iso` a cada aeropuerto de
 * src/data/airports.json, cruzando por código IATA contra el dataset abierto
 * OurAirports (dominio público).
 *
 * Por qué se necesitan:
 *   - lat/lon → distancia ortodrómica origen→destino final (haversine), que define la
 *     banda del Art. 7(1) EU261 (≤1500 / 1500-3500 / >3500 km).
 *   - pais_iso → el `country` que ya tenía el JSON es el nombre en inglés ("Germany"),
 *     y los sets de api/_data/paises-ue.js están en ISO-2. Sin este puente el motor no
 *     puede decidir si un aeropuerto está en la UE/EEE/CH ni si el transporte es
 *     internacional. OurAirports trae la columna iso_country, que es exactamente eso.
 *
 * PRESERVA el formato y los campos previos: mismo array, mismo orden, mismas claves
 * (iata, city, name, country) y una sola línea sin indentar, para que
 * src/js/airport-select.js lo siga cargando igual.
 *
 * Uso:
 *   node scripts/enrich-airports.mjs --dry-run   # solo reporta, no escribe
 *   node scripts/enrich-airports.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

var __dirname = dirname(fileURLToPath(import.meta.url));
var JSON_PATH = join(__dirname, '..', 'src', 'data', 'airports.json');
var CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
var DRY_RUN = process.argv.includes('--dry-run');

/* Parser CSV mínimo (RFC 4180: comillas dobles, comas y saltos dentro del campo).
   El dataset tiene nombres con comas ("Aachen-Merzbrück, Airport") y comillas
   escapadas, así que no alcanza con split(','). */
function parseCsv(texto) {
  var filas = [], fila = [], campo = '', enComillas = false;
  for (var i = 0; i < texto.length; i++) {
    var ch = texto[i];
    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }   // comilla escapada
        else enComillas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') { enComillas = true; }
    else if (ch === ',') { fila.push(campo); campo = ''; }
    else if (ch === '\n') { fila.push(campo); campo = ''; filas.push(fila); fila = []; }
    else if (ch === '\r') { /* ignora CR de CRLF */ }
    else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

async function main() {
  var lista = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  console.log('[enrich-airports] ' + lista.length + ' aeropuertos en airports.json' + (DRY_RUN ? ' · DRY RUN (no escribe)' : ''));

  console.log('[enrich-airports] Bajando ' + CSV_URL + ' …');
  var r = await fetch(CSV_URL);
  if (!r.ok) throw new Error('GET airports.csv ' + r.status + ' — sin acceso al dataset, no se inventan coordenadas.');
  var csv = await r.text();
  console.log('[enrich-airports] ' + (csv.length / 1048576).toFixed(1) + ' MB descargados');

  var filas = parseCsv(csv);
  var head = filas[0];
  var cIata = head.indexOf('iata_code');
  var cLat  = head.indexOf('latitude_deg');
  var cLon  = head.indexOf('longitude_deg');
  var cIso  = head.indexOf('iso_country');
  if (cIata < 0 || cLat < 0 || cLon < 0 || cIso < 0) {
    throw new Error('El CSV cambió de formato (faltan columnas esperadas): ' + head.slice(0, 20).join(','));
  }

  /* Índice IATA → datos. El dataset tiene filas sin IATA (heliopuertos, cerrados);
     se saltean. Si un IATA aparece repetido gana el primero con coordenadas válidas. */
  var porIata = {};
  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    var iata = (f[cIata] || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata) || porIata[iata]) continue;
    var lat = parseFloat(f[cLat]), lon = parseFloat(f[cLon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    porIata[iata] = { lat: lat, lon: lon, iso: (f[cIso] || '').trim().toUpperCase() || null };
  }
  console.log('[enrich-airports] ' + Object.keys(porIata).length + ' códigos IATA con coordenadas en el dataset');

  var sinCoords = [], sinIso = 0, conCoords = 0;
  var salida = lista.map(function (a) {
    /* Se reconstruye el objeto en orden explícito para que las claves previas queden
       primero y el diff del JSON sea legible. Nunca se pierde un campo existente. */
    var base = {};
    Object.keys(a).forEach(function (k) { if (k[0] !== '_') base[k] = a[k]; });

    var d = porIata[(a.iata || '').toUpperCase()];
    if (d) {
      base.lat = Math.round(d.lat * 1e6) / 1e6;   // 6 decimales ≈ 10 cm, de sobra
      base.lon = Math.round(d.lon * 1e6) / 1e6;
      if (d.iso) base.pais_iso = d.iso; else sinIso++;
      conCoords++;
    } else {
      sinCoords.push(a.iata + ' — ' + (a.city || '') + ' / ' + (a.country || ''));
    }
    return base;
  });

  if (!DRY_RUN) {
    /* Una sola línea, sin indentar: mismo formato que tenía el archivo. */
    writeFileSync(JSON_PATH, JSON.stringify(salida) + '\n', 'utf8');
    console.log('[enrich-airports] airports.json reescrito');
  }

  console.log('\n[enrich-airports] Con lat/lon: ' + conCoords + '/' + lista.length +
    ' (' + (conCoords / lista.length * 100).toFixed(1) + '%)');
  console.log('[enrich-airports] Con lat/lon pero sin iso_country: ' + sinIso);
  console.log('[enrich-airports] SIN coordenadas: ' + sinCoords.length);
  sinCoords.forEach(function (s) { console.log('  · ' + s); });
}

main().catch(function (e) { console.error('[enrich-airports] Error:', e.message); process.exit(1); });
