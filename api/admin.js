/**
 * /api/admin?action=<accion>
 *
 * Handler admin consolidado (reemplaza api/admin/agencies.js y api/admin/docs.js).
 * Protegido con ADMIN_PASSWORD (env var); el frontend manda header X-Admin-Password.
 *
 * Acciones:
 *   agencias          GET   Lista agencias + conteo de casos
 *   agencia-accion    POST  {id, action: aprobar|suspender|reactivar|eliminar}
 *   abogados          GET   Lista abogados + conteo de casos
 *   abogado-accion    POST  {id, action: aprobar|suspender|reactivar|eliminar}
 *   abogados-activos  GET   Lista abogados activos (para derivar a mediación)
 *   agencia-reset-password / abogado-reset-password
 *                     POST  {id, password} → reset asistido de la contraseña
 *
 * 'eliminar' es borrado REAL (fila + usuario de Auth) y sólo se permite con cero
 * casos asociados; sirve para limpiar cuentas de prueba. Ver eliminarEntidad().
 *   sign              POST  ?bucket&path → URL firmada de Storage
 *   upload            POST  ?id&filename&tipo&nombre  (body binario) → sube adjunto
 *   remove            POST  {id, index} → quita un adjunto
 *   retag             POST  {id, index, tipo} → reetiqueta un adjunto existente
 *   set-visibles-abogado POST {id, visibles:[index,...]} → marca qué adjuntos
 *                           (por índice) se muestran al abogado asignado. El resto
 *                           queda oculto. Opt-in: un adjunto sin este flag NO se
 *                           muestra (ver panel-abogado.html).
 *   download-zip      POST  ?id → ZIP con todos los adjuntos del caso
 *   create-case       POST  {datos del caso} → alta manual desde backoffice + mail al cliente
 *   generar-documento POST  ?tipo=poder|patrocinio|tyc&idioma=es|en&caso_id= (+ body {overrides})
 *                           → genera el PDF (poder o convenio de patrocinio) y lo devuelve
 *                           como descarga directa. No se sube a Storage ni se toca `adjuntos`:
 *                           es solo un generador de documentos, la carga del PDF ya firmado
 *                           sigue siendo manual (como cualquier otro adjunto).
 *   analizar-caso     POST  {id} → corre el motor legal determinista (Capa 1) sobre el caso
 *                           y guarda el resultado en `analisis_legal = {actual, historial}`.
 *                           Devuelve el análisis. NO escribe ninguna otra columna.
 *                           Datos incompletos NO son error: el motor los emite como
 *                           FALTA_DATO y el endpoint responde 200 igual.
 *
 * bodyParser desactivado: 'upload' necesita el body crudo; el resto parsea JSON a mano.
 */
import JSZip from 'jszip';
import { generarDocumentoLegal } from './_utils/legal-docs.js';
import { borrarUsuarioAuth, resetPasswordAuth } from './_utils/cuentas.js';

export const config = { api: { bodyParser: false } };

/* Código IATA del combobox del alta manual. Sanea sin bloquear: si no es un código de
   3 letras devuelve null y el alta sigue igual. La columna en null es exactamente lo
   que el motor legal lee como FALTA_DATO. */
function iata3(v) {
  var s = (v == null ? '' : String(v)).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function getJson(req) {
  var raw = await getRawBody(req);
  try { return JSON.parse(raw.toString() || '{}'); } catch (e) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');

  if (req.method === 'OPTIONS') return res.status(200).end();

  var SB_URL    = process.env.SUPABASE_URL;
  var SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ADMIN_PWD = process.env.ADMIN_PASSWORD;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  if (ADMIN_PWD) {
    var sentPwd = req.headers['x-admin-password'] || '';
    if (sentPwd !== ADMIN_PWD) return res.status(401).json({ error: 'No autorizado.' });
  }

  var action = (req.query && req.query.action) || '';

  try {
    if (action === 'agencias')         return await listEntidades(res, SB_URL, SB_KEY, 'agencias');
    if (action === 'agencia-accion')   return await accionEntidad(req, res, SB_URL, SB_KEY, 'agencias');
    if (action === 'agencia-config')   return await agenciaConfig(req, res, SB_URL, SB_KEY);
    if (action === 'abogados')         return await listEntidades(res, SB_URL, SB_KEY, 'abogados');
    if (action === 'abogado-accion')   return await accionEntidad(req, res, SB_URL, SB_KEY, 'abogados');
    if (action === 'abogados-activos') return await abogadosActivos(res, SB_URL, SB_KEY);
    if (action === 'agencia-reset-password') return await resetPassword(req, res, SB_URL, SB_KEY, 'agencias');
    if (action === 'abogado-reset-password') return await resetPassword(req, res, SB_URL, SB_KEY, 'abogados');
    if (action === 'alertas-get')      return await alertasGet(res, SB_URL, SB_KEY);
    if (action === 'alertas-save')     return await alertasSave(req, res, SB_URL, SB_KEY);
    if (action === 'sign')             return await signUrl(req, res, SB_URL, SB_KEY);
    if (action === 'upload')           return await uploadDoc(req, res, SB_URL, SB_KEY);
    if (action === 'remove')           return await removeAdj(req, res, SB_URL, SB_KEY);
    if (action === 'retag')            return await retagAdj(req, res, SB_URL, SB_KEY);
    if (action === 'set-visibles-abogado') return await setVisiblesAbogado(req, res, SB_URL, SB_KEY);
    if (action === 'download-zip')     return await downloadZip(req, res, SB_URL, SB_KEY);
    if (action === 'create-case')      return await createCase(req, res, SB_URL, SB_KEY);
    if (action === 'generar-documento') return await generarDocumento(req, res, SB_URL, SB_KEY);
    if (action === 'analizar-caso')     return await analizarCasoLegal(req, res, SB_URL, SB_KEY);
    return res.status(404).json({ error: 'Acción no encontrada: ' + action });
  } catch (err) {
    console.error('[admin/' + action + '] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

/* ------------------------------------------------------------------ */
/* Listar agencias / abogados (con conteo de casos)                    */
/* ------------------------------------------------------------------ */
async function listEntidades(res, SB_URL, SB_KEY, tabla) {
  var entRes  = await fetch(SB_URL + '/rest/v1/' + tabla + '?order=creado_en.desc&select=*',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  var entText = await entRes.text();
  if (!entRes.ok) {
    console.error('[admin/' + tabla + '] Supabase error:', entText.substring(0, 300));
    return res.status(500).json({ error: 'Error al consultar ' + tabla + '. Verificá que la migración SQL fue ejecutada.' });
  }
  var entidades = JSON.parse(entText);
  if (!Array.isArray(entidades)) entidades = [];

  /* Conteo de casos por entidad */
  var campo  = tabla === 'agencias' ? 'agencia_id' : 'abogado_id';
  var conteo = {};
  var countRes = await fetch(SB_URL + '/rest/v1/reclamos?deleted_at=is.null&select=' + campo,
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  if (countRes.ok) {
    var rows = JSON.parse(await countRes.text());
    if (Array.isArray(rows)) rows.forEach(function (r) {
      if (r[campo]) conteo[r[campo]] = (conteo[r[campo]] || 0) + 1;
    });
  }
  entidades = entidades.map(function (e) { return Object.assign({}, e, { num_casos: conteo[e.id] || 0 }); });

  var key = tabla === 'agencias' ? 'agencias' : 'abogados';
  var out = { success: true };
  out[key] = entidades;
  return res.status(200).json(out);
}

/* ------------------------------------------------------------------ */
/* Aprobar / suspender / reactivar agencia o abogado                   */
/* ------------------------------------------------------------------ */
async function accionEntidad(req, res, SB_URL, SB_KEY, tabla) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var body   = await getJson(req);
  var id     = (body.id     || '').trim();
  var accion = (body.action || '').trim();
  if (!id || ['aprobar', 'suspender', 'reactivar', 'eliminar'].indexOf(accion) === -1)
    return res.status(400).json({ error: 'id y action son requeridos.' });

  if (accion === 'eliminar') return await eliminarEntidad(res, SB_URL, SB_KEY, tabla, id);

  var nuevoEstado = accion === 'suspender' ? 'suspendida' : 'activa';
  var patch = { estado: nuevoEstado };
  if (accion === 'aprobar') patch.aprobada_en = new Date().toISOString();

  var patchRes = await fetch(SB_URL + '/rest/v1/' + tabla + '?id=eq.' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) {
    console.error('[admin/' + tabla + '-accion] PATCH error:', (await patchRes.text()).substring(0, 300));
    return res.status(500).json({ error: 'Error al actualizar ' + tabla + '.' });
  }
  return res.status(200).json({ success: true, nuevo_estado: nuevoEstado });
}

/* ------------------------------------------------------------------ */
/* Eliminar agencia o abogado (borrado real, sólo si no tiene casos)   */
/* ------------------------------------------------------------------ */
/**
 * Borra la fila + el usuario de Supabase Auth, liberando el email para poder
 * reutilizarlo. Pensado para limpiar cuentas de prueba.
 *
 * Sólo se permite con CERO casos asociados: si tuviera casos, borrar la fila
 * dejaría `agencia_id`/`abogado_id` apuntando a la nada y el backoffice
 * mostraría el UUID en vez del nombre. En ese caso el frontend ofrece
 * "Suspender", que es reversible. El conteo acá NO filtra por deleted_at a
 * propósito: un caso en la papelera puede restaurarse, así que también cuenta.
 */
async function eliminarEntidad(res, SB_URL, SB_KEY, tabla, id) {
  var campo = tabla === 'agencias' ? 'agencia_id' : 'abogado_id';

  var entRes = await fetch(SB_URL + '/rest/v1/' + tabla + '?id=eq.' + id + '&select=id,nombre,email,auth_user_id&limit=1',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  var entRows;
  try { entRows = JSON.parse(await entRes.text()); } catch (e) { entRows = []; }
  if (!entRows || !entRows.length) return res.status(404).json({ error: 'No encontrado.' });
  var entidad = entRows[0];

  /* Conteo incluyendo la papelera. */
  var casosRes = await fetch(SB_URL + '/rest/v1/reclamos?' + campo + '=eq.' + id + '&select=id',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  if (!casosRes.ok) {
    console.error('[admin/' + tabla + '-eliminar] Error contando casos:', (await casosRes.text()).substring(0, 200));
    return res.status(500).json({ error: 'No se pudo verificar si tiene casos asociados.' });
  }
  var casos;
  try { casos = JSON.parse(await casosRes.text()); } catch (e) { casos = []; }
  var numCasos = Array.isArray(casos) ? casos.length : 0;

  if (numCasos > 0) {
    return res.status(409).json({
      error: 'No se puede eliminar: tiene ' + numCasos + ' caso(s) asociado(s), incluyendo la papelera. Usá "Suspender".',
      num_casos: numCasos,
    });
  }

  var delRes = await fetch(SB_URL + '/rest/v1/' + tabla + '?id=eq.' + id, {
    method: 'DELETE',
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
  });
  if (!delRes.ok) {
    console.error('[admin/' + tabla + '-eliminar] DELETE error:', (await delRes.text()).substring(0, 300));
    return res.status(500).json({ error: 'Error al eliminar el registro.' });
  }

  /* Liberar el email en Auth. Best-effort: la fila ya no existe igual. */
  var authOk = await borrarUsuarioAuth(SB_URL, SB_KEY, entidad.auth_user_id);
  console.log('[admin/' + tabla + '-eliminar] Eliminado:', entidad.email, '| usuario Auth borrado:', authOk);

  return res.status(200).json({ success: true, eliminado: true, auth_borrado: authOk });
}

/* ------------------------------------------------------------------ */
/* Resetear la contraseña de una agencia o abogado                     */
/* ------------------------------------------------------------------ */
/**
 * Reset asistido: el admin define la contraseña nueva y se la pasa al titular
 * por fuera (WhatsApp). Es la red de seguridad mientras no exista el flujo de
 * autogestión "olvidé mi contraseña" por email.
 */
async function resetPassword(req, res, SB_URL, SB_KEY, tabla) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var body = await getJson(req);
  var id = (body.id || '').trim();
  var password = body.password || '';
  if (!id) return res.status(400).json({ error: 'id es requerido.' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });

  var entRes = await fetch(SB_URL + '/rest/v1/' + tabla + '?id=eq.' + id + '&select=id,email,auth_user_id&limit=1',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  var rows;
  try { rows = JSON.parse(await entRes.text()); } catch (e) { rows = []; }
  if (!rows || !rows.length) return res.status(404).json({ error: 'No encontrado.' });
  if (!rows[0].auth_user_id) return res.status(400).json({ error: 'Esta cuenta no tiene usuario de acceso asociado.' });

  var r = await resetPasswordAuth(SB_URL, SB_KEY, rows[0].auth_user_id, password);
  if (!r.ok) return res.status(500).json({ error: r.error });

  console.log('[admin/' + tabla + '-reset-password] Contraseña actualizada para:', rows[0].email);
  return res.status(200).json({ success: true, email: rows[0].email });
}

/* ------------------------------------------------------------------ */
/* Configuración de comisiones de una agencia                          */
/* ------------------------------------------------------------------ */
var COMISION_MODOS = ['por_exito', 'por_caso_viable', 'mixta'];

async function agenciaConfig(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var body = await getJson(req);
  var id = (body.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id es requerido.' });

  var patch = {};

  if (body.comision_modo !== undefined) {
    var modo = (body.comision_modo || '').trim();
    if (COMISION_MODOS.indexOf(modo) === -1) return res.status(400).json({ error: 'comision_modo inválido.' });
    patch.comision_modo = modo;
  }
  if (body.comision_pct !== undefined && body.comision_pct !== null && body.comision_pct !== '') {
    var pct = Number(body.comision_pct);
    if (isNaN(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'comision_pct debe estar entre 0 y 100.' });
    patch.comision_pct = pct;
  }
  if (body.comision_valor_fijo !== undefined && body.comision_valor_fijo !== null && body.comision_valor_fijo !== '') {
    var vf = Number(body.comision_valor_fijo);
    if (isNaN(vf) || vf < 0) return res.status(400).json({ error: 'comision_valor_fijo debe ser un número no negativo.' });
    patch.comision_valor_fijo = vf;
  }

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No hay cambios que guardar.' });

  var patchRes = await fetch(SB_URL + '/rest/v1/agencias?id=eq.' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) {
    console.error('[admin/agencia-config] PATCH error:', (await patchRes.text()).substring(0, 300));
    return res.status(500).json({ error: 'Error al guardar la configuración de comisión.' });
  }
  return res.status(200).json({ success: true, config: patch });
}

/* ------------------------------------------------------------------ */
/* Abogados activos (para el select de derivación a mediación)         */
/* ------------------------------------------------------------------ */
async function abogadosActivos(res, SB_URL, SB_KEY) {
  var r = await fetch(SB_URL + '/rest/v1/abogados?estado=eq.activa&order=nombre.asc&select=id,nombre,matricula',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  if (!r.ok) return res.status(500).json({ error: 'Error al consultar abogados.' });
  var rows = JSON.parse(await r.text());
  return res.status(200).json({ success: true, abogados: Array.isArray(rows) ? rows : [] });
}

/* ------------------------------------------------------------------ */
/* Reglas de alerta (config global)                                    */
/* ------------------------------------------------------------------ */
async function alertasGet(res, SB_URL, SB_KEY) {
  var r = await fetch(SB_URL + '/rest/v1/site_config?id=eq.global&select=alertas_reglas&limit=1',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  if (!r.ok) return res.status(200).json({ success: true, reglas: null });
  var rows = JSON.parse(await r.text());
  var reglas = (rows && rows.length) ? rows[0].alertas_reglas : null;
  return res.status(200).json({ success: true, reglas: reglas || null });
}

async function alertasSave(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var body = await getJson(req);
  var reglas = Array.isArray(body.reglas) ? body.reglas : [];
  var r = await fetch(SB_URL + '/rest/v1/site_config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: 'global', alertas_reglas: reglas, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    console.error('[admin/alertas-save] error:', (await r.text()).substring(0, 300));
    return res.status(500).json({ error: 'Error al guardar reglas de alerta' });
  }
  return res.status(200).json({ success: true, reglas: reglas });
}

/* ------------------------------------------------------------------ */
/* Storage: URL firmada                                                */
/* ------------------------------------------------------------------ */
async function signUrl(req, res, SB_URL, SB_KEY) {
  var bucket = req.query.bucket || 'reclamos';
  var path   = req.query.path;
  if (!path) return res.status(400).json({ error: 'path es requerido' });
  var resp = await fetch(SB_URL + '/storage/v1/object/sign/' + bucket + '/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!resp.ok) return res.status(resp.status).json({ error: await resp.text() });
  var data = await resp.json();
  /* Supabase devuelve signedURL relativo (/object/sign/...). Hay que prefijar /storage/v1. */
  var rel = data.signedURL || data.signedUrl || '';
  var full = rel.indexOf('/storage/v1') === 0 ? (SB_URL + rel) : (SB_URL + '/storage/v1' + rel);
  return res.status(200).json({ signedURL: full });
}

/* ------------------------------------------------------------------ */
/* Storage: subir adjunto                                              */
/* ------------------------------------------------------------------ */
async function uploadDoc(req, res, SB_URL, SB_KEY) {
  var bucket      = req.query.bucket || 'reclamos';
  var id          = req.query.id;
  var filename    = req.query.filename;
  var tipo        = req.query.tipo || 'documento';
  var nombre      = req.query.nombre;
  var contentType = req.headers['content-type'] || 'application/octet-stream';
  if (!id || !filename) return res.status(400).json({ error: 'id y filename son requeridos' });

  var safeName = filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_');

  var caseResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=id,ref_code,adjuntos',
    { headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY } });
  var cases = await caseResp.json();
  if (!cases.length) return res.status(404).json({ error: 'Caso no encontrado' });
  var claim = cases[0];

  var path    = claim.ref_code + '/' + safeName;
  var rawBody = await getRawBody(req);

  var uploadResp = await fetch(SB_URL + '/storage/v1/object/' + bucket + '/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: rawBody,
  });
  if (!uploadResp.ok) return res.status(uploadResp.status).json({ error: await uploadResp.text() });

  var adjuntos = Array.isArray(claim.adjuntos) ? claim.adjuntos : [];
  adjuntos = adjuntos.filter(function (a) { return a.path !== path; });
  var newAdj = { tipo: tipo, bucket: bucket, path: path, nombre: nombre || safeName };
  adjuntos.push(newAdj);

  var patchResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ adjuntos: adjuntos }),
  });
  if (!patchResp.ok) return res.status(patchResp.status).json({ error: await patchResp.text() });
  return res.status(200).json({ success: true, adjunto: newAdj, adjuntos: adjuntos });
}

/* ------------------------------------------------------------------ */
/* Storage: quitar adjunto                                             */
/* ------------------------------------------------------------------ */
async function removeAdj(req, res, SB_URL, SB_KEY) {
  var body  = await getJson(req);
  var id    = body.id;
  var index = body.index;
  if (!id || index === undefined) return res.status(400).json({ error: 'id e index son requeridos' });

  var caseResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=id,adjuntos',
    { headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY } });
  var cases = await caseResp.json();
  if (!cases.length) return res.status(404).json({ error: 'Caso no encontrado' });

  var adjuntos = Array.isArray(cases[0].adjuntos) ? cases[0].adjuntos.slice() : [];
  adjuntos.splice(index, 1);

  var patchResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ adjuntos: adjuntos }),
  });
  if (!patchResp.ok) return res.status(patchResp.status).json({ error: await patchResp.text() });
  return res.status(200).json({ success: true, adjuntos: adjuntos });
}

/* ------------------------------------------------------------------ */
/* Storage: reetiquetar un adjunto existente (reusar archivo ya subido) */
/* ------------------------------------------------------------------ */
async function retagAdj(req, res, SB_URL, SB_KEY) {
  var body  = await getJson(req);
  var id    = body.id;
  var index = body.index;
  var tipo  = body.tipo;
  if (!id || index === undefined || !tipo) return res.status(400).json({ error: 'id, index y tipo son requeridos' });

  var caseResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=id,adjuntos',
    { headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY } });
  var cases = await caseResp.json();
  if (!cases.length) return res.status(404).json({ error: 'Caso no encontrado' });

  var adjuntos = Array.isArray(cases[0].adjuntos) ? cases[0].adjuntos.slice() : [];
  if (!adjuntos[index]) return res.status(400).json({ error: 'Adjunto no encontrado' });
  adjuntos[index] = Object.assign({}, adjuntos[index], { tipo: tipo });

  var patchResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ adjuntos: adjuntos }),
  });
  if (!patchResp.ok) return res.status(patchResp.status).json({ error: await patchResp.text() });
  return res.status(200).json({ success: true, adjuntos: adjuntos });
}

/* ------------------------------------------------------------------ */
/* Storage: elegir qué adjuntos ve el abogado asignado                 */
/* ------------------------------------------------------------------ */
async function setVisiblesAbogado(req, res, SB_URL, SB_KEY) {
  var body     = await getJson(req);
  var id       = body.id;
  var visibles = Array.isArray(body.visibles) ? body.visibles : [];
  if (!id) return res.status(400).json({ error: 'id requerido' });

  var caseResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=id,adjuntos',
    { headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY } });
  var cases = await caseResp.json();
  if (!cases.length) return res.status(404).json({ error: 'Caso no encontrado' });

  var adjuntos = Array.isArray(cases[0].adjuntos) ? cases[0].adjuntos.slice() : [];
  adjuntos = adjuntos.map(function (a, i) {
    return Object.assign({}, a, { visible_abogado: visibles.indexOf(i) !== -1 });
  });

  var patchResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ adjuntos: adjuntos }),
  });
  if (!patchResp.ok) return res.status(patchResp.status).json({ error: await patchResp.text() });
  return res.status(200).json({ success: true, adjuntos: adjuntos });
}

/* ------------------------------------------------------------------ */
/* Storage: ZIP con todos los adjuntos de un caso                      */
/* ------------------------------------------------------------------ */
function resolveBucketPath(a) {
  var bucket = a.bucket || 'reclamos';
  var path   = a.path || null;
  if (!path && a.url) {
    var mk = a.url.indexOf('/object/public/');
    if (mk > -1) {
      var rest = a.url.substring(mk + '/object/public/'.length);
      var sl = rest.indexOf('/');
      if (sl > -1) { bucket = rest.substring(0, sl); path = decodeURIComponent(rest.substring(sl + 1)); }
    }
  }
  return { bucket: bucket, path: path };
}

async function downloadZip(req, res, SB_URL, SB_KEY) {
  var id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id es requerido' });

  var caseResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=id,ref_code,adjuntos',
    { headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY } });
  var cases = await caseResp.json();
  if (!cases.length) return res.status(404).json({ error: 'Caso no encontrado' });
  var claim = cases[0];
  var adjuntos = Array.isArray(claim.adjuntos) ? claim.adjuntos : [];

  var zip = new JSZip();
  var usedNames = {};
  var added = 0;

  for (var i = 0; i < adjuntos.length; i++) {
    var a = adjuntos[i];
    var loc = resolveBucketPath(a);
    if (!loc.path) continue; /* link externo (ej. carpeta de Drive): no hay bytes para zippear */

    var fileResp = await fetch(SB_URL + '/storage/v1/object/' + loc.bucket + '/' + loc.path,
      { headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY } });
    if (!fileResp.ok) continue;
    var arrBuf = await fileResp.arrayBuffer();

    var name = (a.nombre || loc.path.split('/').pop() || ('documento_' + i)).replace(/[\\/]/g, '_');
    if (usedNames[name]) name = (i + 1) + '_' + name;
    usedNames[name] = true;

    zip.file(name, arrBuf);
    added++;
  }

  if (!added) return res.status(404).json({ error: 'No hay documentos descargables para este caso' });

  var zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  var safeRef = (claim.ref_code || 'reclamo').replace(/[^a-zA-Z0-9._-]/g, '_');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="' + safeRef + '_adjuntos.zip"');
  return res.status(200).send(zipBuffer);
}

/* ------------------------------------------------------------------ */
/* Alta manual de caso desde el backoffice (+ mail al cliente)         */
/* ------------------------------------------------------------------ */
async function createCase(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var body   = await getJson(req);
  var email  = (body.email  || '').trim().toLowerCase();
  var nombre = (body.nombre || '').trim();
  if (!nombre || !email) return res.status(400).json({ error: 'Nombre y email del pasajero son obligatorios.' });

  var caseNum = Date.now() % 100000;
  var refCode = 'CSA' + String(caseNum).padStart(5, '0');
  var nowIso  = new Date().toISOString();

  var row = {
    canal: 'B2C', fuente: 'Backoffice',
    nombre: nombre, email: email,
    telefono:         body.telefono         || null,
    documento_tipo:   body.documento_tipo   || null,
    documento_numero: body.documento_numero || null,
    aerolinea:        body.aerolinea        || null,
    vuelo_nro:        body.vuelo_nro         || null,
    fecha_vuelo:      body.fecha_vuelo       || null,
    origen:           body.origen            || null,
    destino:          body.destino           || null,
    /* `origen`/`destino` siguen siendo el label de display, sin cambios. Estos dos son
       el dato canónico que consume el motor legal (Tabla A filas 1 y 2). */
    origen_iata:      iata3(body.origen_iata),
    destino_iata:     iata3(body.destino_iata),
    pnr:              body.pnr               || null,
    tipo_reclamo:     body.tipo_reclamo      || 'vuelo',
    tipo_incidencia:  body.tipo_incidencia   || null,
    horas_retraso:    body.horas_retraso ? parseInt(body.horas_retraso) || null : null,
    anticipacion_aviso:     body.anticipacion_aviso     || null,
    ofrecimiento_aerolinea: body.ofrecimiento_aerolinea || null,
    viajo_finalmente:       body.viajo_finalmente       || null,
    embarque_presentado:    body.embarque_presentado    || null,
    pasaje_alternativo_monto:  body.pasaje_alternativo_monto  ? parseFloat(body.pasaje_alternativo_monto) || null : null,
    pasaje_alternativo_moneda: body.pasaje_alternativo_moneda || null,
    causa_informada:  body.causa_informada   || null,
    moneda_gastos:    body.moneda_gastos     || null,
    monto_gastos:     body.monto_gastos ? parseFloat(body.monto_gastos) || null : null,
    gastos_detalle:   body.gastos_detalle    || null,
    tipo_caso_equipaje:    body.tipo_caso_equipaje    || null,
    descripcion_equipaje:  body.descripcion_equipaje  || null,
    valor_equipaje:        body.valor_equipaje ? parseFloat(body.valor_equipaje) || null : null,
    fecha_entrega_equipaje: body.fecha_entrega_equipaje || null,
    equipaje_no_entregado:  body.equipaje_no_entregado === true || body.equipaje_no_entregado === 'true' || false,
    pir_presentado:   body.pir_presentado || null,
    pir_numero:       body.pir_numero || null,
    documentos:       Array.isArray(body.documentos) ? body.documentos : [],
    acompanantes:     Array.isArray(body.acompanantes) ? body.acompanantes : [],
    ref_code: refCode, estado: 'pendiente', fecha_carga: nowIso,
    /* Un caso cargado a mano no pasó por la aceptación online: los dos documentos
       arrancan pendientes y se marcan 'no_aplica' desde el detalle si no hacen falta. */
    tyc_estado: 'pendiente_envio', firma_estado: 'pendiente_envio',
    instancia: 'evaluacion', momento: null,
    estado_historial: [{ estado: 'pendiente', fecha: nowIso, por: 'admin' }],
    instancia_historial: [{ instancia: 'evaluacion', momento: null, fecha: nowIso, por: 'sistema' }],
  };

  var insertRes = await fetch(SB_URL + '/rest/v1/reclamos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!insertRes.ok) {
    console.error('[admin/create-case] INSERT error:', (await insertRes.text()).substring(0, 400));
    return res.status(500).json({ error: 'Error al guardar el caso.' });
  }
  var insertedId = null;
  try { var ins = JSON.parse(await insertRes.text()); insertedId = (Array.isArray(ins) ? ins[0] : ins).id; } catch (e) {}

  /* Mail de confirmación al cliente (Resend) */
  var RESEND_KEY = process.env.RESEND_API_KEY;
  var emailSent  = false;
  if (RESEND_KEY) {
    try {
      var vuelo = body.vuelo_nro || 'N/A', aerolinea = body.aerolinea || 'N/A';
      var clientRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
        body: JSON.stringify({
          from: 'SolucionAir <no-reply@solucionair.com>',
          to: email,
          subject: 'SolucionAir — Reclamo ' + refCode + ' recibido',
          html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF">'
            + '<div style="background:#2D4A3E;padding:24px 28px;border-radius:8px 8px 0 0">'
            + '<h1 style="color:#D4A853;font-size:20px;margin:0;font-weight:700">SolucionAir</h1>'
            + '<p style="color:#C0D8C8;font-size:12px;margin:5px 0 0">Compensaciones por vuelos y equipaje</p></div>'
            + '<div style="padding:28px;border:1px solid #E0DCD4;border-top:none;border-radius:0 0 8px 8px">'
            + '<h2 style="color:#2D4A3E;font-size:18px;margin:0 0 12px">Hola ' + nombre + ',</h2>'
            + '<p style="color:#3A3A3A;font-size:14px;line-height:1.6;margin:0 0 16px">Registramos tu reclamo y ya está siendo revisado por nuestro equipo.</p>'
            + '<div style="background:#F7F5F0;border-radius:6px;padding:16px;margin:16px 0">'
            + '<table style="width:100%;border-collapse:collapse">'
            + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Referencia</td><td style="padding:6px 0;font-weight:700;font-size:14px;text-align:right;color:#2D4A3E">' + refCode + '</td></tr>'
            + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Vuelo</td><td style="padding:6px 0;font-size:13px;text-align:right">' + vuelo + ' (' + aerolinea + ')</td></tr>'
            + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Estado</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#D4A853;font-weight:700">Pendiente de revisión</td></tr>'
            + '</table></div>'
            + '<p style="margin-top:20px;font-size:13px">Saludos,<br/><strong style="color:#2D4A3E">Equipo SolucionAir</strong></p>'
            + '<hr style="margin-top:24px;border:none;border-top:1px solid #E0DCD4"/>'
            + '<p style="color:#999;font-size:11px;margin-top:12px">Correo automático. Referencia: ' + refCode + '.</p>'
            + '</div></div>',
        }),
      });
      emailSent = clientRes.ok;
    } catch (e) { console.error('[admin/create-case] Resend error:', e.message); }
  }

  return res.status(200).json({ success: true, refCode: refCode, id: insertedId, emailSent: emailSent });
}

/* ------------------------------------------------------------------ */
/* Generar documento legal (poder / patrocinio / T&C) — descarga       */
/* directa, no se sube a Storage ni se toca `adjuntos`.                */
/* ------------------------------------------------------------------ */
var OVERRIDE_CAMPOS = ['domicilio_real', 'fecha_nacimiento', 'cuil', 'documento_tipo',
  'documento_numero', 'pais_emisor', 'id_fiscal_extranjero'];

async function generarDocumento(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var tipo    = (req.query.tipo    || '').trim();
  var idioma  = (req.query.idioma  || 'es').trim();
  var casoId  = (req.query.caso_id || '').trim();
  if (['poder', 'patrocinio', 'tyc'].indexOf(tipo) === -1) return res.status(400).json({ error: 'tipo debe ser poder, patrocinio o tyc.' });
  if (!casoId) return res.status(400).json({ error: 'caso_id es requerido.' });

  var body = {};
  try { body = await getJson(req); } catch (e) { body = {}; }

  /* Overrides confirmados en el popup: persistirlos en reclamos antes de generar,
     para que queden disponibles y precargados la próxima vez. */
  if (body.overrides && typeof body.overrides === 'object') {
    var patch = {};
    OVERRIDE_CAMPOS.forEach(function (campo) {
      if (Object.prototype.hasOwnProperty.call(body.overrides, campo)) patch[campo] = body.overrides[campo] || null;
    });
    if (Object.keys(patch).length) {
      var ovRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + casoId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!ovRes.ok) {
        console.error('[admin/generar-documento] Error al persistir overrides:', (await ovRes.text()).substring(0, 300));
        return res.status(500).json({ error: 'Error al guardar los datos confirmados.' });
      }
    }
  }

  var caseResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + casoId + '&select=*',
    { headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY } });
  var cases = await caseResp.json();
  if (!Array.isArray(cases) || !cases.length) return res.status(404).json({ error: 'Caso no encontrado.' });
  var reclamo = cases[0];

  var abogado = null;
  if (tipo === 'patrocinio') {
    if (!reclamo.abogado_id) return res.status(400).json({ error: 'El caso no tiene un abogado asignado.', faltantes: ['Abogado asignado al caso'] });
    var abogRes = await fetch(SB_URL + '/rest/v1/abogados?id=eq.' + reclamo.abogado_id + '&select=*',
      { headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY } });
    var abogRows = await abogRes.json();
    if (Array.isArray(abogRows) && abogRows.length) abogado = abogRows[0];
  }

  /* Pasajeros seleccionados para el documento: índice 0 = titular, 1..N = acompañantes.
     El acompañante hereda los datos compartidos del caso (vuelo, ruta, ref) y aporta
     sus propios datos personales; los campos de patrocinio (fecha nac., domicilio, CUIL,
     etc.) solo existen si se cargaron a mano desde el backoffice. */
  var acomps = Array.isArray(reclamo.acompanantes) ? reclamo.acompanantes : [];
  var SHARED = ['aerolinea', 'vuelo_nro', 'fecha_vuelo', 'origen', 'destino', 'ref_code', 'pnr', 'tipo_reclamo'];
  var PERSONALES = ['nombre', 'documento_tipo', 'documento_numero', 'email', 'fecha_nacimiento',
    'domicilio_real', 'cuil', 'telefono', 'pais_emisor', 'id_fiscal_extranjero'];
  var indices = (Array.isArray(body.pasajeros) && body.pasajeros.length)
    ? body.pasajeros.map(Number)
    : [0];
  var personas = [];
  for (var i = 0; i < indices.length; i++) {
    var idx = indices[i];
    if (idx === 0) { personas.push(reclamo); continue; }
    var a = acomps[idx - 1];
    if (!a) return res.status(400).json({ error: 'Pasajero acompañante inexistente (índice ' + idx + ').' });
    var persona = {};
    SHARED.forEach(function (k) { persona[k] = reclamo[k]; });
    PERSONALES.forEach(function (k) { persona[k] = (a[k] != null ? a[k] : ''); });
    if ((!persona.documento_tipo || !persona.documento_numero) && Array.isArray(a.documentos) && a.documentos[0]) {
      persona.documento_tipo = persona.documento_tipo || a.documentos[0].tipo || '';
      persona.documento_numero = persona.documento_numero || a.documentos[0].numero || '';
    }
    personas.push(persona);
  }

  try {
    var out = await generarDocumentoLegal({ tipo: tipo, idioma: idioma, reclamo: reclamo, abogado: abogado, personas: personas });
    var COMBINING_MARKS = new RegExp('[̀-ͯ]', 'g');
    var filenameAscii = out.filename.normalize('NFD').replace(COMBINING_MARKS, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filenameAscii + '"; filename*=UTF-8\'\'' + encodeURIComponent(out.filename));
    return res.status(200).send(out.buffer);
  } catch (err) {
    if (err.faltantes) return res.status(400).json({ error: err.message, faltantes: err.faltantes });
    console.error('[admin/generar-documento] Error:', err.message);
    return res.status(500).json({ error: 'Error al generar el documento.' });
  }
}

/* ------------------------------------------------------------------ */
/* Motor legal Capa 1: analizar un caso                                */
/* ------------------------------------------------------------------ */
/**
 * POST /api/admin?action=analizar-caso   body {id}
 *
 * Corre el motor determinista (normalizador + evaluador) sobre el caso y guarda el
 * resultado en la columna `analisis_legal`, con forma {actual, historial}.
 *
 * Dos garantías que importan:
 *
 *  - NO escribe ninguna otra columna. El PATCH lleva una sola clave. El motor es de
 *    lectura: no corrige datos del caso ni toca instancia, estado ni esperas.
 *  - Datos incompletos NO son error. Un caso vacío devuelve 200 con un análisis lleno de
 *    FALTA_DATO. Solo hay error si falla la base, falta el id, o no están los archivos
 *    de datos auxiliares (eso sí es un problema de deploy y conviene que grite).
 *
 * El motor es determinista: dos llamadas seguidas sobre un caso sin cambios devuelven el
 * mismo `actual` salvo `fecha_analisis`. Lo que sí cambia es `historial`, que apila el
 * análisis anterior (capado a los últimos 10 para no inflar la fila).
 */
var HISTORIAL_MAX = 10;

async function analizarCasoLegal(req, res, SB_URL, SB_KEY) {
  var body = await getJson(req);
  var id = (body.id || '').toString().trim();
  if (!id) return res.status(400).json({ error: 'Falta el id del reclamo.' });

  /* Módulos y datos del motor en carga diferida: airports.json pesa ~800 KB y no tiene
     que costarle un cold start a las otras acciones de este handler. */
  var normalizarCaso, analizar, seleccionarRuleset, datos;
  try {
    var mNorm = await import('./_utils/motor-normalizar.js');
    var mMotor = await import('./_utils/motor-legal.js');
    var mDatos = await import('./_utils/motor-datos.js');
    normalizarCaso = mNorm.normalizarCaso;
    analizar = mMotor.analizar;
    seleccionarRuleset = mMotor.seleccionarRuleset;
    datos = mDatos.cargarDatosMotor();
  } catch (err) {
    console.error('[admin/analizar-caso] No se pudieron cargar los datos del motor:', err.message);
    return res.status(500).json({ error: 'El motor legal no está disponible: ' + err.message });
  }

  var caseResp = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + encodeURIComponent(id) + '&select=*&limit=1',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  var caseText = await caseResp.text();
  if (!caseResp.ok) {
    console.error('[admin/analizar-caso] Supabase error:', caseText.substring(0, 300));
    return res.status(500).json({ error: 'Error al leer el reclamo.' });
  }
  var filas;
  try { filas = JSON.parse(caseText); } catch (e) { filas = []; }
  if (!Array.isArray(filas) || !filas.length) return res.status(404).json({ error: 'Reclamo no encontrado.' });
  var fila = filas[0];

  /* De acá en adelante nada debería tirar: el motor emite FALTA_DATO en vez de fallar.
     El try igual está por si una regla del ruleset tiene un bug, para responder con un
     mensaje claro en vez de un 500 pelado. */
  var analisis;
  try {
    var caso = normalizarCaso(fila, datos.idxAeropuertos, datos.idxAerolineas, datos.paises);
    var ruleset = seleccionarRuleset(caso.fecha_incidente);
    analisis = analizar(caso, ruleset, new Date().toISOString(), { disparado_por: 'manual' });
  } catch (err) {
    console.error('[admin/analizar-caso] Error del motor en', fila.ref_code, '·', err.message);
    return res.status(500).json({ error: 'El motor falló al analizar el caso: ' + err.message });
  }

  /* Historial: el análisis anterior pasa a la pila, lo más nuevo primero. */
  var previo = (fila.analisis_legal && typeof fila.analisis_legal === 'object') ? fila.analisis_legal : null;
  var historial = (previo && Array.isArray(previo.historial)) ? previo.historial.slice() : [];
  if (previo && previo.actual) historial.unshift(previo.actual);
  if (historial.length > HISTORIAL_MAX) historial = historial.slice(0, HISTORIAL_MAX);

  var patchRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
    /* Una sola clave a propósito: el análisis no puede modificar el caso. */
    body: JSON.stringify({ analisis_legal: { actual: analisis, historial: historial } }),
  });
  if (!patchRes.ok) {
    var patchErr = await patchRes.text();
    console.error('[admin/analizar-caso] PATCH error:', patchErr.substring(0, 300));
    /* El análisis se corrió bien; lo que falló es guardarlo. Se devuelve igual para que
       el backoffice pueda mostrarlo, avisando que no quedó persistido. */
    return res.status(200).json({ success: true, guardado: false, error_guardado: 'No se pudo guardar el análisis.', analisis: analisis });
  }

  console.log('[admin/analizar-caso]', fila.ref_code, '· marcos:', (analisis.resumen.marcos_activos || []).join(',') || 'ninguno',
    '· reclamables:', analisis.resumen.categorias_reclamables, '· provisional:', analisis.provisional);

  return res.status(200).json({
    success: true,
    guardado: true,
    analisis: analisis,
    historial_len: historial.length,
  });
}
