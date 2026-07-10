/**
 * /api/admin?action=<accion>
 *
 * Handler admin consolidado (reemplaza api/admin/agencies.js y api/admin/docs.js).
 * Protegido con ADMIN_PASSWORD (env var); el frontend manda header X-Admin-Password.
 *
 * Acciones:
 *   agencias          GET   Lista agencias + conteo de casos
 *   agencia-accion    POST  {id, action: aprobar|suspender|reactivar}
 *   abogados          GET   Lista abogados + conteo de casos
 *   abogado-accion    POST  {id, action: aprobar|suspender|reactivar}
 *   abogados-activos  GET   Lista abogados activos (para derivar a mediación)
 *   sign              POST  ?bucket&path → URL firmada de Storage
 *   upload            POST  ?id&filename&tipo&nombre  (body binario) → sube adjunto
 *   remove            POST  {id, index} → quita un adjunto
 *   retag             POST  {id, index, tipo} → reetiqueta un adjunto existente
 *   download-zip      POST  ?id → ZIP con todos los adjuntos del caso
 *   create-case       POST  {datos del caso} → alta manual desde backoffice + mail al cliente
 *
 * bodyParser desactivado: 'upload' necesita el body crudo; el resto parsea JSON a mano.
 */
import JSZip from 'jszip';

export const config = { api: { bodyParser: false } };

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
    if (action === 'abogados')         return await listEntidades(res, SB_URL, SB_KEY, 'abogados');
    if (action === 'abogado-accion')   return await accionEntidad(req, res, SB_URL, SB_KEY, 'abogados');
    if (action === 'abogados-activos') return await abogadosActivos(res, SB_URL, SB_KEY);
    if (action === 'alertas-get')      return await alertasGet(res, SB_URL, SB_KEY);
    if (action === 'alertas-save')     return await alertasSave(req, res, SB_URL, SB_KEY);
    if (action === 'sign')             return await signUrl(req, res, SB_URL, SB_KEY);
    if (action === 'upload')           return await uploadDoc(req, res, SB_URL, SB_KEY);
    if (action === 'remove')           return await removeAdj(req, res, SB_URL, SB_KEY);
    if (action === 'retag')            return await retagAdj(req, res, SB_URL, SB_KEY);
    if (action === 'download-zip')     return await downloadZip(req, res, SB_URL, SB_KEY);
    if (action === 'create-case')      return await createCase(req, res, SB_URL, SB_KEY);
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
  var countRes = await fetch(SB_URL + '/rest/v1/reclamos?estado=neq.eliminado&select=' + campo,
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
  if (!id || ['aprobar', 'suspender', 'reactivar'].indexOf(accion) === -1)
    return res.status(400).json({ error: 'id y action son requeridos.' });

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
    pnr:              body.pnr               || null,
    tipo_reclamo:     body.tipo_reclamo      || 'vuelo',
    tipo_incidencia:  body.tipo_incidencia   || null,
    horas_retraso:    body.horas_retraso ? parseInt(body.horas_retraso) || null : null,
    anticipacion_aviso:     body.anticipacion_aviso     || null,
    ofrecimiento_aerolinea: body.ofrecimiento_aerolinea || null,
    causa_informada:  body.causa_informada   || null,
    moneda_gastos:    body.moneda_gastos     || null,
    monto_gastos:     body.monto_gastos ? parseFloat(body.monto_gastos) || null : null,
    gastos_detalle:   body.gastos_detalle    || null,
    tipo_caso_equipaje:    body.tipo_caso_equipaje    || null,
    descripcion_equipaje:  body.descripcion_equipaje  || null,
    valor_equipaje:        body.valor_equipaje ? parseFloat(body.valor_equipaje) || null : null,
    fecha_entrega_equipaje: body.fecha_entrega_equipaje || null,
    ref_code: refCode, estado: 'pendiente', fecha_carga: nowIso,
    estado_historial: [{ estado: 'pendiente', fecha: nowIso, por: 'admin' }],
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
          from: 'SolucionAir <onboarding@resend.dev>',
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
