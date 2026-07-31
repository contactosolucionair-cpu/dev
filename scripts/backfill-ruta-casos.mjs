/**
 * scripts/backfill-ruta-casos.mjs
 *
 * Carga la RUTA de un puñado de casos identificados uno por uno: `origen_iata`,
 * `destino_iata` y `segmentos`.
 *
 * Por qué no `backfill-iata.mjs`: ese script resuelve el label contra `airports.json` y
 * procesa TODA la tabla. Sobre estos ocho casos probamos su resolvedor y escribía dos
 * valores inventados —"Milán" caía en LIN, uno de los tres aeropuertos de Milán, y
 * "AEP y luefo EZE" se quedaba con el primer código descartando el segundo—. Acá los
 * hechos los resolvió un humano leyendo cada expediente, y el script solo los escribe.
 *
 * Además carga `segmentos`, que `backfill-iata.mjs` no toca. Sin tramos el motor no puede
 * computar el destino contractual y el bloque de jurisdicción sale `no_computable`; y un
 * ida y vuelta no se puede expresar con dos columnas sueltas.
 *
 * Garantías, en el mismo espíritu que migration_016:
 *   - Alcance cerrado: solo los ref_code de la tabla de abajo. Nada de "todas las filas
 *     que cumplan X".
 *   - No pisa nada: cada caso se escribe solo si hoy tiene `origen_iata` en null Y
 *     `segmentos` vacío. Si alguien ya lo cargó a mano, se saltea y lo avisa.
 *   - `--dry-run` muestra el PATCH de cada caso sin mandar nada.
 *
 * Uso:
 *   node scripts/backfill-ruta-casos.mjs --dry-run
 *   node scripts/backfill-ruta-casos.mjs
 *
 * Env vars (acepta los dos nombres, igual que el resto de los scripts):
 *   SB_URL | SUPABASE_URL
 *   SB_KEY | SUPABASE_SERVICE_ROLE_KEY
 */
import { pathToFileURL } from 'node:url';
import { validarSbUrl } from './_env.mjs';
import { partirEnDirecciones } from '../api/_utils/motor-normalizar.js';

var SB_URL = process.env.SB_URL || process.env.SUPABASE_URL;
var SB_KEY = process.env.SB_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
var DRY_RUN = process.argv.includes('--dry-run');

/* ------------------------------------------------------------------ */
/* Los hechos, caso por caso (resueltos por JPA el 31-jul-2026)        */
/* ------------------------------------------------------------------ */

/**
 * `tramos`: en orden de vuelo. `afectado` marca el tramo donde ocurrió el incidente y de
 * ahí sale la dirección que analiza el motor (enmienda v2.1.2).
 * `fecha`: solo donde se conoce. El tramo afectado hereda `fecha_incidente` del caso, que
 * es lo que la migración 015 dejó igual a `fecha_vuelo`; la vuelta de un redondo queda en
 * null a propósito — inventarla sería peor que no tenerla.
 * `pendiente`: el caso no se escribe hasta que el dato esté confirmado.
 */
var CASOS = [
  /* --- Solo ida: un tramo, y es el afectado --- */
  { ref: 'AA001',  tramos: [{ o: 'EZE', d: 'MIA' }] },
  { ref: 'AA002',  tramos: [{ o: 'EZE', d: 'BPS' }] },
  { ref: 'CSA084', tramos: [{ o: 'EZE', d: 'TUL' }] },
  { ref: 'CSA085', tramos: [{ o: 'ATH', d: 'CPH' }] },
  { ref: 'CSA086', tramos: [{ o: 'EZE', d: 'BLR' }] },
  { ref: 'CSA087', tramos: [{ o: 'AEP', d: 'GRU' }] },

  /* --- Ida y vuelta: dos tramos, uno solo afectado --- */

  /* Ida y vuelta sin escalas, con la vuelta saliendo por OTRO aeropuerto de la misma
     ciudad (AEP a la ida, EZE a la vuelta) — el caso que motivó medio ciclo de trabajo.
     Se canceló la IDA, así que la dirección analizada es BRC→AEP. */
  {
    ref: 'CSA081',
    tramos: [
      { o: 'BRC', d: 'AEP', afectado: true },
      { o: 'EZE', d: 'BRC' },
    ],
  },

  /* Ida y vuelta europeo con el incidente en la ida. Los dos extremos los resolvió JPA: el
     resolvedor automático elegía LIN entre los tres aeropuertos de Milán sin fundamento, y
     "Barcelona" quedaba ambiguo contra la Barcelona de Venezuela (BLA).
     SUPUESTO: la vuelta es simétrica, MXP→BCN. No está confirmado que el regreso haya
     salido de Malpensa; si fue Linate o Bérgamo, cambia este tramo y nada más — el par
     canónico sale de la dirección afectada (BCN→MXP) y el destino contractual de un
     redondo es el punto de partida (BCN) en cualquier caso. */
  {
    ref: 'AA003',
    tramos: [
      { o: 'BCN', d: 'MXP', afectado: true },
      { o: 'MXP', d: 'BCN' },
    ],
  },
];

/* ------------------------------------------------------------------ */

function armarSegmentos(caso, fechaIncidente) {
  var tramos = caso.tramos;
  /* Sin marca explícita, el afectado es el primero: en un solo-ida no hay otra opción, y
     en un redondo la marca es obligatoria (por eso esos casos van con `pendiente`). */
  var hayMarca = tramos.some(function (t) { return t.afectado === true; });
  return tramos.map(function (t, i) {
    var afectado = hayMarca ? t.afectado === true : i === 0;
    return {
      orden: i + 1,
      origen_iata: t.o,
      destino_iata: t.d,
      /* El carrier operante nunca se tipea a mano (Tabla A fila 5). */
      carrier_operante: '',
      fecha: afectado ? (fechaIncidente || null) : (t.fecha || null),
      afectado: afectado,
    };
  });
}

/**
 * Extremos de la dirección afectada: la semántica canónica de `origen_iata`/`destino_iata`
 * (enmienda v2.1.2).
 *
 * Usa `partirEnDirecciones()` del normalizador a propósito, en vez de recorrer los tramos
 * acá. Una primera versión de este script encadenaba por igualdad de aeropuerto —"el
 * siguiente tramo sale de donde llegó el anterior"— y en un ida y vuelta BCN→MXP + MXP→BCN
 * devolvía BCN→BCN: la vuelta parece una escala. Es exactamente el colapso que la v2.1.2
 * vino a cerrar. Compartir la función garantiza además que estas columnas describan la
 * misma dirección que el motor va a analizar.
 */
function extremos(segs) {
  var dirs = partirEnDirecciones(segs);
  var idx = segs.findIndex(function (s) { return s.afectado; });
  var dir = dirs.filter(function (d) { return d.indexOf(idx) !== -1; })[0] || dirs[0];
  var primero = segs[dir[0]], ultimo = segs[dir[dir.length - 1]];
  return { origen_iata: primero.origen_iata, destino_iata: ultimo.destino_iata };
}

async function main() {
  /* Los dos argumentos, y se toma el valor de vuelta: el validador chequea que la clave
     esté y devuelve la URL normalizada sin barra final. Llamarlo con uno solo lo hacía
     morir con "faltan las variables" aunque estuvieran las dos. */
  SB_URL = validarSbUrl(SB_URL, SB_KEY);

  var cab = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };

  /* Pre-flight: que las columnas que se van a escribir EXISTAN. Este script falló ocho
     veces seguidas mandando `itinerario_fuente`, que parece columna porque los formularios
     la mandan en el payload, pero es la procedencia con la que se etiquetan los candidatos
     de `datos_extraidos`. El `--dry-run` no lo detectó porque no toca el camino de
     escritura: un ensayo que nunca arma el PATCH no puede validarlo. Ahora sí. */
  var COLUMNAS_PATCH = ['origen_iata', 'destino_iata', 'segmentos'];
  var muestraRes = await fetch(SB_URL + '/rest/v1/reclamos?select=*&limit=1', { headers: cab });
  if (!muestraRes.ok) { console.error('Error al leer el esquema:', await muestraRes.text()); process.exit(1); }
  var muestra = await muestraRes.json();
  if (muestra.length) {
    var inexistentes = COLUMNAS_PATCH.filter(function (c) { return !(c in muestra[0]); });
    if (inexistentes.length) {
      console.error('\n[backfill-ruta] Estas columnas no existen en `reclamos`: ' + inexistentes.join(', ')
        + '\n      El PATCH las rechazaría entero. Corregí COLUMNAS_PATCH y el objeto `patch`.\n');
      process.exit(1);
    }
  }

  var refs = CASOS.map(function (c) { return c.ref; });
  var url = SB_URL + '/rest/v1/reclamos?ref_code=in.(' + refs.join(',') + ')'
    + '&select=id,ref_code,origen,destino,origen_iata,destino_iata,segmentos,fecha_incidente';
  var r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
  if (!r.ok) { console.error('Error al leer:', await r.text()); process.exit(1); }
  var filas = await r.json();

  console.log('[backfill-ruta] ' + filas.length + ' de ' + refs.length + ' casos encontrados'
    + (DRY_RUN ? ' · DRY RUN (no escribe)' : ''));

  var escritos = 0, salteados = 0, pendientes = 0;

  for (var i = 0; i < CASOS.length; i++) {
    var caso = CASOS[i];
    var fila = filas.filter(function (f) { return f.ref_code === caso.ref; })[0];

    if (!fila) { console.log('  ✗ ' + caso.ref + ': no está en la base'); salteados++; continue; }

    if (caso.pendiente) {
      console.log('  ⏸ ' + caso.ref + ': PENDIENTE — ' + caso.pendiente);
      pendientes++; continue;
    }

    var yaTiene = fila.origen_iata || (Array.isArray(fila.segmentos) && fila.segmentos.length);
    if (yaTiene) {
      console.log('  ⏭ ' + caso.ref + ': ya tiene ruta cargada (' + (fila.origen_iata || '—')
        + '→' + (fila.destino_iata || '—') + ', ' + ((fila.segmentos || []).length) + ' tramos), se saltea');
      salteados++; continue;
    }

    var segs = armarSegmentos(caso, fila.fecha_incidente);
    var ext = extremos(segs);
    /* Solo columnas reales. `itinerario_fuente` NO es una: es la etiqueta de procedencia
       con la que los endpoints marcan los candidatos de `datos_extraidos`, y mandarla en
       el PATCH hacía que PostgREST rechazara la fila entera. */
    var patch = {
      origen_iata: ext.origen_iata,
      destino_iata: ext.destino_iata,
      segmentos: segs,
    };

    console.log('  → ' + caso.ref + ': "' + (fila.origen || '—') + '" / "' + (fila.destino || '—') + '"'
      + '  ⇒  ' + ext.origen_iata + '→' + ext.destino_iata
      + ' · ' + segs.length + ' tramo' + (segs.length > 1 ? 's' : '')
      + ' (afectado: ' + segs.filter(function (s) { return s.afectado; })[0].orden + ')');

    if (DRY_RUN) { escritos++; continue; }

    var p = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + fila.id, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json', apikey: SB_KEY,
        Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    });
    if (!p.ok) { console.error('    ERROR al escribir ' + caso.ref + ': ' + (await p.text())); salteados++; continue; }
    escritos++;
  }

  console.log('\n[backfill-ruta] ' + escritos + (DRY_RUN ? ' se escribirían' : ' escritos')
    + ' · ' + salteados + ' salteados · ' + pendientes + ' pendientes de dato');
  if (pendientes) console.log('  Los pendientes necesitan que se complete la tabla CASOS de este archivo.');
  if (!DRY_RUN && escritos) console.log('  Falta correr "Analizar caso" en el backoffice: el motor no se dispara solo.');
}

/* Solo corre si se lo invoca directo: así la lógica de armado se puede verificar sin
   credenciales ni base, que es como se probó antes de dispararlo. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(function (e) { console.error(e); process.exit(1); });
}

export { armarSegmentos, extremos, CASOS };
