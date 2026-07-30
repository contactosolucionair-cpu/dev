/**
 * scripts/backfill-candidatos.mjs
 *
 * Backfill del histórico hacia la CAPA DE EVIDENCIA (`datos_extraidos`).
 *
 * Los formularios ya capturan datos que el motor necesita, pero como DECLARACIÓN DEL
 * PASAJERO. Por el contrato §1.1 un campo crítico no se auto-verifica desde una sola
 * fuente declarativa, así que estos valores NO pueden escribirse como canónicos: las
 * columnas `demora_llegada_min` y `protesta` quedan NULL y las carga un humano en el
 * backoffice. Pero tampoco se tiran: se guardan como CANDIDATOS con procedencia, para
 * que el motor pueda emitir análisis provisional sobre el histórico desde el día uno y
 * el backoffice muestre el diff candidato-vs-canónico.
 *
 * Candidatos que escribe:
 *   horas_retraso (h)          → demora_llegada_min (h × 60)
 *   pir_presentado/pir_numero  → protesta {realizada, medio:'pir', numero}
 *
 * La protesta va SIN fecha a propósito: el intake nunca capturó la fecha del PIR, y el
 * gate de caducidad (Res 1532 Art. 20 a / Montreal Art. 31) se computa con la fecha de
 * la protesta. Sin fecha, el gate sigue siendo FALTA_DATO — que es lo correcto.
 *
 * Idempotente: reemplaza los candidatos previos del mismo `campo` con
 * `fuente: 'declaracion_pasajero'` en vez de apilarlos, y nunca toca candidatos de
 * otras fuentes (adjunto, api_vuelo, admin).
 *
 * Uso:
 *   node scripts/backfill-candidatos.mjs --dry-run
 *   node scripts/backfill-candidatos.mjs
 *
 * Env vars: SB_URL | SUPABASE_URL · SB_KEY | SUPABASE_SERVICE_ROLE_KEY
 */
var SB_URL = process.env.SB_URL || process.env.SUPABASE_URL;
var SB_KEY = process.env.SB_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
var DRY_RUN = process.argv.includes('--dry-run');

var LOTE = 10;
var FUENTE = 'declaracion_pasajero';

function sbHeaders(extra) {
  return Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, extra || {});
}

async function traerFilas() {
  var url = SB_URL + '/rest/v1/reclamos'
    + '?select=id,ref_code,horas_retraso,pir_presentado,pir_numero,datos_extraidos'
    + '&or=(horas_retraso.not.is.null,pir_presentado.not.is.null)'
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

/* Candidatos derivables de una fila. Devuelve [] si no hay nada que declarar. */
function candidatosDe(f, ahora) {
  var out = [];

  /* Demora de llegada: el form pregunta "¿cuántas horas más tarde llegaste a tu
     destino final?" en horas enteras → minutos, que es la unidad del contrato. */
  var horas = Number(f.horas_retraso);
  if (f.horas_retraso != null && isFinite(horas) && horas > 0) {
    out.push({
      campo: 'demora_llegada_min',
      valor: Math.round(horas * 60),
      fuente: FUENTE,
      verificado: false,
      extraido_en: ahora,
    });
  }

  /* Protesta. El dominio del form (si | no | no_sabe) mapea 1:1 al del contrato
     (§1.2 fila 17: realizada si | no | desconocido). `medio` solo cuando hubo PIR. */
  var pir = f.pir_presentado;
  if (pir === 'si' || pir === 'no' || pir === 'no_sabe') {
    var valor = { realizada: pir === 'no_sabe' ? 'desconocido' : pir };
    if (pir === 'si') {
      valor.medio = 'pir';
      if (f.pir_numero) valor.numero = f.pir_numero;
    }
    out.push({
      campo: 'protesta',
      valor: valor,
      fuente: FUENTE,
      verificado: false,
      extraido_en: ahora,
    });
  }

  return out;
}

async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('Faltan SB_URL / SB_KEY (o SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }

  var ahora = new Date().toISOString();
  console.log('[backfill-candidatos]' + (DRY_RUN ? ' DRY RUN (no escribe)' : ''));

  var filas = await traerFilas();
  console.log('[backfill-candidatos] ' + filas.length + ' casos con datos declarativos\n');

  var pendientes = [];
  var porCampo = {};

  filas.forEach(function (f) {
    var nuevos = candidatosDe(f, ahora);
    if (!nuevos.length) return;

    var previos = Array.isArray(f.datos_extraidos) ? f.datos_extraidos : [];
    var campos = nuevos.map(function (c) { return c.campo; });
    /* Saca los candidatos declarativos previos de los mismos campos (idempotencia);
       los de otras fuentes quedan intactos. */
    var conservados = previos.filter(function (c) {
      return !(c && c.fuente === FUENTE && campos.indexOf(c.campo) !== -1);
    });

    nuevos.forEach(function (c) { porCampo[c.campo] = (porCampo[c.campo] || 0) + 1; });
    pendientes.push({ id: f.id, ref: f.ref_code, patch: { datos_extraidos: conservados.concat(nuevos) }, nuevos: nuevos });
  });

  if (DRY_RUN) {
    pendientes.forEach(function (p) {
      console.log('  ' + (p.ref || p.id) + ' → ' + p.nuevos.map(function (c) {
        return c.campo + '=' + JSON.stringify(c.valor);
      }).join(' · '));
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
    if (fallidos) console.error('\n[backfill-candidatos] ' + fallidos + ' PATCH fallaron (ver arriba).');
  }

  console.log('\n[backfill-candidatos] Casos con candidatos: ' + pendientes.length);
  Object.keys(porCampo).forEach(function (k) { console.log('  · ' + k + ': ' + porCampo[k]); });
  console.log('[backfill-candidatos] Columnas canónicas: sin tocar (siguen NULL, las carga un humano).');
}

main().catch(function (e) { console.error('[backfill-candidatos] Error:', e.message); process.exit(1); });
