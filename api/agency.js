/**
 * /api/agency?action=<accion>
 *
 * Handler consolidado para todas las rutas del portal B2B de agencias.
 * vercel.json reescribe /api/agency/:action → /api/agency?action=:action
 *
 * Acciones disponibles:
 *   register      POST  Alta de agencia (estado pendiente)
 *   login         POST  Autenticación de agencia
 *   claims        GET   Casos de la agencia autenticada
 *   submit-claim  POST  Carga de nuevo caso B2B
 *   stats         GET   KPIs y comisión estimada
 */
import { verifyAgency } from './_utils/agency-auth.js';

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

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
    if (action === 'register') return await handleRegister(req, res, SB_URL, SB_KEY);
    if (action === 'login')    return await handleLogin(req, res, SB_URL, SB_KEY);
    if (action === 'claims')   return await handleClaims(req, res, SB_URL, SB_KEY);
    if (action === 'submit-claim') return await handleSubmitClaim(req, res, SB_URL, SB_KEY);
    if (action === 'stats')    return await handleStats(req, res, SB_URL, SB_KEY);
    return res.status(404).json({ error: 'Acción no encontrada: ' + action });
  } catch (err) {
    console.error('[agency/' + action + '] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

/* ------------------------------------------------------------------ */
/* REGISTER                                                            */
/* ------------------------------------------------------------------ */
async function handleRegister(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body     = req.body || {};
  var nombre   = (body.nombre   || '').trim();
  var tipo     = (body.tipo     || '').trim();
  var cuit_dni = (body.cuit_dni || '').trim();
  var email    = (body.email    || '').trim().toLowerCase();
  var telefono = (body.telefono || '').trim();
  var password = (body.password || '');

  if (!nombre || !tipo || !email || !password)
    return res.status(400).json({ error: 'Nombre, tipo, email y contraseña son obligatorios.' });
  if (tipo !== 'agencia' && tipo !== 'individual')
    return res.status(400).json({ error: 'Tipo debe ser "agencia" o "individual".' });

  console.log('[agency/register] Registrando:', email, tipo);

  var signupRes = await fetch(SB_URL + '/auth/v1/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY },
    body: JSON.stringify({ email: email, password: password }),
  });
  var signupText = await signupRes.text();
  console.log('[agency/register] Auth signup status:', signupRes.status);

  var signupJson;
  try { signupJson = JSON.parse(signupText); } catch (e) { return res.status(500).json({ error: 'Error al crear usuario.' }); }

  if (!signupRes.ok) {
    if (signupText.indexOf('already registered') > -1 || signupText.indexOf('already exists') > -1)
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    return res.status(400).json({ error: signupJson.msg || signupJson.message || 'Error al registrar usuario.' });
  }

  var authUserId = signupJson.id || (signupJson.user && signupJson.user.id);
  if (!authUserId) return res.status(500).json({ error: 'No se pudo obtener el ID de usuario.' });

  var rowRes = await fetch(SB_URL + '/rest/v1/agencias', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      auth_user_id: authUserId, nombre: nombre, tipo: tipo,
      cuit_dni: cuit_dni || null, email: email, telefono: telefono || null, estado: 'pendiente',
    }),
  });

  if (!rowRes.ok) {
    var rowErr = await rowRes.text();
    console.error('[agency/register] Insert error:', rowErr.substring(0, 300));
    return res.status(500).json({ error: 'Error al guardar datos de agencia.' });
  }

  console.log('[agency/register] Agencia creada (pendiente):', email);
  return res.status(200).json({ success: true });
}

/* ------------------------------------------------------------------ */
/* LOGIN                                                               */
/* ------------------------------------------------------------------ */
async function handleLogin(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body     = req.body || {};
  var email    = (body.email    || '').trim().toLowerCase();
  var password = (body.password || '');

  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });

  console.log('[agency/login] Intento de login:', email);

  var authRes = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY },
    body: JSON.stringify({ email: email, password: password }),
  });
  var authText = await authRes.text();
  console.log('[agency/login] Auth status:', authRes.status);

  if (!authRes.ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

  var authJson;
  try { authJson = JSON.parse(authText); } catch (e) { return res.status(500).json({ error: 'Error de autenticación.' }); }

  var token  = authJson.access_token;
  var userId = authJson.user && authJson.user.id;
  if (!token || !userId) return res.status(500).json({ error: 'Error al obtener token.' });

  var agRes  = await fetch(SB_URL + '/rest/v1/agencias?auth_user_id=eq.' + userId + '&limit=1', {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
  });
  var rows;
  try { rows = JSON.parse(await agRes.text()); } catch (e) { rows = []; }

  if (!rows || !rows.length)
    return res.status(403).json({ error: 'No existe una cuenta de agencia asociada a este email.' });

  var ag = rows[0];
  console.log('[agency/login] Agencia encontrada, estado:', ag.estado);

  if (ag.estado === 'pendiente')
    return res.status(200).json({ success: true, estado: 'pendiente', agencia: { nombre: ag.nombre, estado: ag.estado, tipo: ag.tipo } });
  if (ag.estado === 'suspendida')
    return res.status(403).json({ error: 'Tu cuenta está suspendida. Contactate con SolucionAir.' });

  return res.status(200).json({
    success: true, token: token, email: email,
    agencia: { id: ag.id, nombre: ag.nombre, estado: ag.estado, tipo: ag.tipo, comision_pct: ag.comision_pct },
  });
}

/* ------------------------------------------------------------------ */
/* CLAIMS                                                              */
/* ------------------------------------------------------------------ */
async function handleClaims(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var agencia = await verifyAgency(req, SB_URL, SB_KEY);
  if (!agencia) return res.status(401).json({ error: 'No autorizado.' });

  console.log('[agency/claims] Cargando casos para agencia:', agencia.id);

  var fields = 'id,ref_code,nombre,email,telefono,aerolinea,vuelo_nro,fecha_vuelo,origen,destino,tipo_reclamo,tipo_incidencia,estado,firma_estado,agente_nombre,agente_email,creado_en,novedades,ai_raw';

  var sbRes = await fetch(
    SB_URL + '/rest/v1/reclamos?agencia_id=eq.' + agencia.id + '&deleted_at=is.null&order=creado_en.desc&select=' + fields,
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
  );
  var sbText = await sbRes.text();
  if (!sbRes.ok) {
    console.error('[agency/claims] Supabase error:', sbText.substring(0, 400));
    var sbErr = '';
    try { sbErr = JSON.parse(sbText).message || JSON.parse(sbText).error || ''; } catch (e) {}
    var msg = sbErr.indexOf('does not exist') > -1
      ? 'Faltan columnas en la tabla reclamos. Corré la migración SQL (ALTER TABLE) en Supabase.'
      : 'Error al consultar casos: ' + (sbErr || sbRes.status);
    return res.status(500).json({ error: msg });
  }

  var parsed = JSON.parse(sbText);
  return res.status(200).json({ success: true, claims: Array.isArray(parsed) ? parsed : [] });
}

/* ------------------------------------------------------------------ */
/* SUBMIT-CLAIM                                                        */
/* ------------------------------------------------------------------ */
async function handleSubmitClaim(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var agencia = await verifyAgency(req, SB_URL, SB_KEY);
  if (!agencia) return res.status(401).json({ error: 'No autorizado.' });

  var body   = req.body || {};
  var email  = (body.email  || '').trim().toLowerCase();
  var nombre = (body.nombre || '').trim();
  if (!email || !nombre) return res.status(400).json({ error: 'Nombre y email del pasajero son obligatorios.' });
  if (!body.cliente_autorizacion_declarada) return res.status(400).json({ error: 'Debe declarar la autorización del cliente.' });

  var caseNum = Date.now() % 100000;
  var refCode = 'CSA' + String(caseNum).padStart(5, '0');
  console.log('[agency/submit-claim] Agencia:', agencia.id, '| ref:', refCode, '| pasajero:', email);

  var row = {
    canal: 'B2B', fuente: 'Agencia',
    agencia_id: agencia.id, agente_nombre: agencia.nombre || null, agente_email: agencia.email || null,
    cliente_autorizacion_declarada: true, firma_estado: 'pendiente_envio',
    nombre: nombre, email: email,
    telefono:        body.telefono        || null,
    documento_tipo:  body.documento_tipo  || null,
    documento_numero: body.documento_numero || null,
    aerolinea:       body.aerolinea       || null,
    vuelo_nro:       body.vuelo_nro       || null,
    fecha_vuelo:     body.fecha_vuelo     || null,
    origen:          body.origen          || null,
    destino:         body.destino         || null,
    pnr:             body.pnr             || null,
    tipo_reclamo:    body.tipo_reclamo    || 'vuelo',
    tipo_incidencia: body.tipo_incidencia || null,
    horas_retraso:   body.horas_retraso  ? parseInt(body.horas_retraso)  || null : null,
    anticipacion_aviso:     body.anticipacion_aviso     || null,
    ofrecimiento_aerolinea: body.ofrecimiento_aerolinea || null,
    causa_informada: body.causa_informada || null,
    moneda_gastos:   body.moneda_gastos   || null,
    monto_gastos:    body.monto_gastos   ? parseFloat(body.monto_gastos)  || null : null,
    gastos_detalle:  body.gastos_detalle  || null,
    tipo_caso_equipaje:    body.tipo_caso_equipaje    || null,
    descripcion_equipaje:  body.descripcion_equipaje  || null,
    valor_equipaje:        body.valor_equipaje       ? parseFloat(body.valor_equipaje) || null : null,
    fecha_entrega_equipaje: body.fecha_entrega_equipaje || null,
    ref_code: refCode, estado: 'pendiente', fecha_carga: new Date().toISOString(),
    ip_firmante: (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || null,
  };

  var insertRes = await fetch(SB_URL + '/rest/v1/reclamos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!insertRes.ok) {
    var insertErr = await insertRes.text();
    console.error('[agency/submit-claim] INSERT error:', insertErr.substring(0, 400));
    return res.status(500).json({ error: 'Error al guardar el caso.' });
  }

  /* Subir adjuntos */
  var scannedDocs = Array.isArray(body.scanned_files) ? body.scanned_files : [];
  var docUrls = [];
  for (var di = 0; di < scannedDocs.length; di++) {
    var sf = scannedDocs[di];
    try {
      var ext   = (sf.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
      var sfPath = refCode + '/doc_' + (di + 1) + '.' + ext;
      var sfRes = await fetch(SB_URL + '/storage/v1/object/reclamos/' + sfPath, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': sf.mimeType || 'image/jpeg', 'x-upsert': 'true' },
        body: Buffer.from(sf.base64, 'base64'),
      });
      if (sfRes.ok) docUrls.push({ tipo: 'documento_viaje', url: SB_URL + '/storage/v1/object/public/reclamos/' + sfPath, nombre: sf.name || ('doc_' + (di + 1) + '.' + ext) });
    } catch (sfErr) { console.error('[agency/submit-claim] Doc upload error:', sfErr.message); }
  }

  if (docUrls.length) {
    try {
      await fetch(SB_URL + '/rest/v1/reclamos?ref_code=eq.' + refCode, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
        body: JSON.stringify({ adjuntos: docUrls }),
      });
    } catch (e) { console.error('[agency/submit-claim] Adjuntos PATCH error:', e.message); }
  }

  console.log('[agency/submit-claim] Caso creado:', refCode, '| firma pendiente de WhatsApp manual');
  return res.status(200).json({ success: true, refCode: refCode });
}

/* ------------------------------------------------------------------ */
/* STATS                                                               */
/* ------------------------------------------------------------------ */
async function handleStats(req, res, SB_URL, SB_KEY) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var agencia = await verifyAgency(req, SB_URL, SB_KEY);
  if (!agencia) return res.status(401).json({ error: 'No autorizado.' });

  console.log('[agency/stats] Stats para agencia:', agencia.id);

  var sbRes = await fetch(
    SB_URL + '/rest/v1/reclamos?agencia_id=eq.' + agencia.id + '&deleted_at=is.null&select=estado,monto_compensacion',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
  );
  var sbText = await sbRes.text();
  if (!sbRes.ok) {
    console.error('[agency/stats] Supabase error:', sbText.substring(0, 300));
    return res.status(500).json({ error: 'Error al consultar estadísticas.' });
  }

  var claims = JSON.parse(sbText) || [];
  var total  = claims.length;
  var por_estado = {};
  claims.forEach(function (c) {
    var e = c.estado || 'pendiente';
    por_estado[e] = (por_estado[e] || 0) + 1;
  });

  var exitosos   = (por_estado['aprobado'] || 0) + (por_estado['resuelto'] || 0);
  var tasa_exito = total > 0 ? Math.round((exitosos / total) * 100) : null;
  var comision_pct = parseFloat(agencia.comision_pct) || 10;
  var comision_estimada = null;
  claims.forEach(function (c) {
    if ((c.estado === 'aprobado' || c.estado === 'resuelto') && c.monto_compensacion) {
      if (comision_estimada === null) comision_estimada = 0;
      comision_estimada += parseFloat(c.monto_compensacion) * (comision_pct / 100);
    }
  });
  if (comision_estimada !== null) comision_estimada = Math.round(comision_estimada * 100) / 100;

  return res.status(200).json({ success: true, total: total, por_estado: por_estado, tasa_exito: tasa_exito, comision_estimada: comision_estimada });
}
