/**
 * /api/abogados?action=<accion>
 *
 * Portal de abogados (espejo del portal de agencias). vercel.json reescribe
 * /api/abogados/:action → /api/abogados?action=:action
 *
 * Acciones:
 *   register       POST  Alta de abogado (estado pendiente)
 *   login          POST  Autenticación
 *   claims         GET   Casos asignados al abogado autenticado
 *   update-estado  POST  Cambia el estado de mediación de un caso asignado
 *   sign           GET   URL firmada de un adjunto de un caso asignado
 */
import { verifyAbogado } from './_utils/abogado-auth.js';
import { ESTADO_A_INSTANCIA } from './_utils/instancias.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

/* Estados que el abogado puede setear (avance de la mediación) */
var ESTADOS_ABOGADO = ['derivado_mediacion', 'mediacion_notificada', 'en_mediacion', 'acuerdo'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  var action = (req.query && req.query.action) || '';

  try {
    if (action === 'register')      return await handleRegister(req, res, SB_URL, SB_KEY);
    if (action === 'login')         return await handleLogin(req, res, SB_URL, SB_KEY);
    if (action === 'claims')        return await handleClaims(req, res, SB_URL, SB_KEY);
    if (action === 'update-estado') return await handleUpdateEstado(req, res, SB_URL, SB_KEY);
    if (action === 'sign')          return await handleSign(req, res, SB_URL, SB_KEY);
    return res.status(404).json({ error: 'Acción no encontrada: ' + action });
  } catch (err) {
    console.error('[abogados/' + action + '] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

/* ------------------------------------------------------------------ */
/* REGISTER                                                            */
/* ------------------------------------------------------------------ */
async function handleRegister(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var body      = req.body || {};
  var nombre    = (body.nombre    || '').trim();
  var matricula = (body.matricula || '').trim();
  var colegio   = (body.colegio   || '').trim();
  var domicilio = (body.domicilio || '').trim();
  var email     = (body.email     || '').trim().toLowerCase();
  var telefono  = (body.telefono  || '').trim();
  var password  = (body.password  || '');

  if (!nombre || !email || !password || !colegio || !domicilio)
    return res.status(400).json({ error: 'Nombre, email, contraseña, colegio y domicilio son obligatorios.' });

  /* Alta vía endpoint admin (service role) con email ya confirmado: evita el paso de
     confirmación por email y la ofuscación del signup para emails ya existentes. */
  var signupRes = await fetch(SB_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    body: JSON.stringify({ email: email, password: password, email_confirm: true }),
  });
  var signupText = await signupRes.text();
  var signupJson;
  try { signupJson = JSON.parse(signupText); } catch (e) { return res.status(500).json({ error: 'Error al crear usuario.' }); }

  if (!signupRes.ok) {
    var low = signupText.toLowerCase();
    if (signupRes.status === 422 || low.indexOf('already') > -1 || low.indexOf('exists') > -1 || low.indexOf('registered') > -1)
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    return res.status(400).json({ error: signupJson.msg || signupJson.message || 'Error al registrar usuario.' });
  }

  var authUserId = signupJson.id || (signupJson.user && signupJson.user.id);
  if (!authUserId) return res.status(500).json({ error: 'No se pudo obtener el ID de usuario.' });

  var rowRes = await fetch(SB_URL + '/rest/v1/abogados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      auth_user_id: authUserId, nombre: nombre, matricula: matricula || null,
      colegio: colegio, domicilio: domicilio,
      email: email, telefono: telefono || null, estado: 'pendiente',
    }),
  });
  if (!rowRes.ok) {
    console.error('[abogados/register] Insert error:', (await rowRes.text()).substring(0, 300));
    return res.status(500).json({ error: 'Error al guardar datos del abogado.' });
  }
  return res.status(200).json({ success: true });
}

/* ------------------------------------------------------------------ */
/* LOGIN                                                              */
/* ------------------------------------------------------------------ */
async function handleLogin(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var body     = req.body || {};
  var email    = (body.email    || '').trim().toLowerCase();
  var password = (body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });

  var authRes = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY },
    body: JSON.stringify({ email: email, password: password }),
  });
  if (!authRes.ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

  var authJson;
  try { authJson = JSON.parse(await authRes.text()); } catch (e) { return res.status(500).json({ error: 'Error de autenticación.' }); }
  var token  = authJson.access_token;
  var userId = authJson.user && authJson.user.id;
  if (!token || !userId) return res.status(500).json({ error: 'Error al obtener token.' });

  var agRes = await fetch(SB_URL + '/rest/v1/abogados?auth_user_id=eq.' + userId + '&limit=1', {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
  });
  var rows;
  try { rows = JSON.parse(await agRes.text()); } catch (e) { rows = []; }

  /* Fallback: si el email ya existía en Supabase Auth al registrarse, el signup se
     ofusca y la fila pudo quedar con un auth_user_id distinto del real. Buscar por
     email y reparar el vínculo para que verifyAbogado (por auth_user_id) funcione. */
  if (!rows || !rows.length) {
    var byEmailRes = await fetch(SB_URL + '/rest/v1/abogados?email=eq.' + encodeURIComponent(email) + '&limit=1', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    });
    try { rows = JSON.parse(await byEmailRes.text()); } catch (e) { rows = []; }
    if (rows && rows.length && rows[0].auth_user_id !== userId) {
      await fetch(SB_URL + '/rest/v1/abogados?id=eq.' + rows[0].id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ auth_user_id: userId }),
      });
    }
  }
  if (!rows || !rows.length) return res.status(403).json({ error: 'No existe una cuenta de abogado asociada a este email.' });

  var ab = rows[0];
  if (ab.estado === 'pendiente')
    return res.status(200).json({ success: true, estado: 'pendiente', abogado: { nombre: ab.nombre, estado: ab.estado } });
  if (ab.estado === 'suspendida')
    return res.status(403).json({ error: 'Tu cuenta está suspendida. Contactate con SolucionAir.' });

  return res.status(200).json({
    success: true, token: token, email: email,
    abogado: { id: ab.id, nombre: ab.nombre, matricula: ab.matricula, estado: ab.estado },
  });
}

/* ------------------------------------------------------------------ */
/* CLAIMS (casos asignados)                                            */
/* ------------------------------------------------------------------ */
async function handleClaims(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  var abogado = await verifyAbogado(req, SB_URL, SB_KEY);
  if (!abogado) return res.status(401).json({ error: 'No autorizado.' });

  var fields = 'id,ref_code,nombre,email,telefono,aerolinea,vuelo_nro,fecha_vuelo,origen,destino,pnr,'
    + 'tipo_reclamo,tipo_incidencia,causa_informada,horas_retraso,moneda_gastos,monto_gastos,gastos_detalle,'
    + 'tipo_caso_equipaje,descripcion_equipaje,valor_equipaje,acompanantes,'
    + 'estado,estado_historial,fecha_mediacion,adjuntos,creado_en';

  var sbRes = await fetch(
    SB_URL + '/rest/v1/reclamos?abogado_id=eq.' + abogado.id + '&estado=neq.eliminado&order=creado_en.desc&select=' + fields,
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
  );
  var sbText = await sbRes.text();
  if (!sbRes.ok) {
    console.error('[abogados/claims] Supabase error:', sbText.substring(0, 300));
    return res.status(500).json({ error: 'Error al consultar casos.' });
  }
  var parsed = JSON.parse(sbText);
  return res.status(200).json({ success: true, claims: Array.isArray(parsed) ? parsed : [] });
}

/* ------------------------------------------------------------------ */
/* UPDATE ESTADO (avance de mediación)                                */
/* ------------------------------------------------------------------ */
async function handleUpdateEstado(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  var abogado = await verifyAbogado(req, SB_URL, SB_KEY);
  if (!abogado) return res.status(401).json({ error: 'No autorizado.' });

  var body = req.body || {};
  var casoId = (body.id || '').trim();
  var estado = (body.estado || '').trim();
  if (!casoId) return res.status(400).json({ error: 'id de caso requerido.' });
  if (ESTADOS_ABOGADO.indexOf(estado) === -1) return res.status(400).json({ error: 'Estado no permitido.' });

  /* Verificar que el caso esté asignado a este abogado */
  var chkRes = await fetch(
    SB_URL + '/rest/v1/reclamos?id=eq.' + casoId + '&abogado_id=eq.' + abogado.id + '&select=id,estado_historial,instancia_historial&limit=1',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
  );
  var chkRows;
  try { chkRows = JSON.parse(await chkRes.text()); } catch (e) { chkRows = []; }
  if (!chkRows.length) return res.status(403).json({ error: 'El caso no está asignado a tu cuenta.' });

  var nowIso = new Date().toISOString();
  var historial = Array.isArray(chkRows[0].estado_historial) ? chkRows[0].estado_historial : [];
  historial.push({ estado: estado, fecha: nowIso, por: 'abogado' });

  /* Además del estado legacy, mapear al modelo nuevo (instancia/momento) */
  var mapped = ESTADO_A_INSTANCIA[estado] || { instancia: 'mediacion', momento: 'preparacion' };
  var instHist = Array.isArray(chkRows[0].instancia_historial) ? chkRows[0].instancia_historial : [];
  instHist.push({ instancia: mapped.instancia, momento: mapped.momento, fecha: nowIso, por: 'abogado' });

  var patch = {
    estado: estado, estado_historial: historial,
    instancia: mapped.instancia, momento: mapped.momento, instancia_historial: instHist,
  };
  if (estado === 'acuerdo') {
    patch.acuerdo_instancia = 'mediacion';
    patch.fecha_acuerdo = nowIso;
  }

  var updRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + casoId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!updRes.ok) return res.status(500).json({ error: 'Error al actualizar el estado.' });
  return res.status(200).json({ success: true, estado: estado, estado_historial: historial, instancia: mapped.instancia, momento: mapped.momento });
}

/* ------------------------------------------------------------------ */
/* SIGN (URL firmada de un adjunto del caso asignado)                 */
/* ------------------------------------------------------------------ */
async function handleSign(req, res, SB_URL, SB_KEY) {
  var abogado = await verifyAbogado(req, SB_URL, SB_KEY);
  if (!abogado) return res.status(401).json({ error: 'No autorizado.' });

  var bucket = req.query.bucket || 'reclamos';
  var path   = req.query.path || '';
  if (!path) return res.status(400).json({ error: 'path requerido.' });

  /* El path empieza con el ref_code del caso: verificar que ese caso sea del abogado */
  var refCode = path.split('/')[0];
  var ownRes = await fetch(
    SB_URL + '/rest/v1/reclamos?ref_code=eq.' + encodeURIComponent(refCode) + '&abogado_id=eq.' + abogado.id + '&select=id&limit=1',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
  );
  var ownRows;
  try { ownRows = JSON.parse(await ownRes.text()); } catch (e) { ownRows = []; }
  if (!ownRows.length) return res.status(403).json({ error: 'No autorizado a ver este documento.' });

  var resp = await fetch(SB_URL + '/storage/v1/object/sign/' + bucket + '/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!resp.ok) return res.status(resp.status).json({ error: await resp.text() });
  var data = await resp.json();
  var rel = data.signedURL || data.signedUrl || '';
  var full = rel.indexOf('/storage/v1') === 0 ? (SB_URL + rel) : (SB_URL + '/storage/v1' + rel);
  return res.status(200).json({ signedURL: full });
}
