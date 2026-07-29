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
import { etapaExterna } from './_utils/instancias.js';
import { emailEnUso, mensajeEmailEnUso, crearUsuarioAuth, borrarUsuarioAuth } from './_utils/cuentas.js';

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

  /* Un email = una cuenta, en agencias Y en abogados. El índice UNIQUE de
     migration_012 y Supabase Auth son la garantía real; este chequeo existe
     para devolver un mensaje claro antes de crear nada. */
  var enUso = await emailEnUso(SB_URL, SB_KEY, email);
  if (enUso.enUso) return res.status(409).json({ error: mensajeEmailEnUso(enUso.tabla) });

  var alta = await crearUsuarioAuth(SB_URL, SB_KEY, email, password);
  if (!alta.ok) {
    console.log('[agency/register] Alta en Auth fallida:', alta.error);
    if (alta.duplicado) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    return res.status(400).json({ error: alta.error });
  }
  var authUserId = alta.id;

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
    /* Rollback: sin esto queda un usuario huérfano en Auth con el email ocupado. */
    await borrarUsuarioAuth(SB_URL, SB_KEY, authUserId);
    if (rowErr.indexOf('idx_agencias_email_unico') > -1 || rowErr.indexOf('duplicate key') > -1)
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
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

  var fields = 'id,ref_code,nombre,email,telefono,aerolinea,vuelo_nro,fecha_vuelo,origen,destino,'
    + 'tipo_reclamo,tipo_incidencia,estado,firma_estado,agente_nombre,agente_email,creado_en,'
    + 'instancia,momento,resultado,instancia_historial,esperas,acompanantes,'
    + 'monto_reclamado,monto_reclamado_moneda,monto_acordado,monto_acordado_moneda,fecha_acuerdo';

  var sbRes = await fetch(
    SB_URL + '/rest/v1/reclamos?agencia_id=eq.' + agencia.id + '&order=creado_en.desc&select=' + fields,
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
  /* Adjuntar la vista externa de etapa (derivada de instancia/momento/resultado)
     y la comisión que le corresponde a la agencia por ese caso. */
  var claims = (Array.isArray(parsed) ? parsed : []).map(function (c) {
    var e = etapaExterna(c);
    var com = comisionDeCaso(agencia, c);
    var monedas = Object.keys(com);
    return Object.assign({}, c, {
      etapa: e.etapa,
      etapa_label: e.label,
      /* Un caso siempre resuelve a una sola moneda; se manda plano para la tabla. */
      comision: monedas.length ? com[monedas[0]].estimada : null,
      comision_moneda: monedas.length ? monedas[0] : null,
      comision_confirmada: monedas.length ? com[monedas[0]].confirmada : null,
    });
  });
  return res.status(200).json({ success: true, claims: claims });
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
    /* La agencia declara tener la autorización del pasajero (cláusula 18 de los T&C),
       pero el pasajero no firmó nada: los dos documentos quedan pendientes de firma. */
    cliente_autorizacion_declarada: true, firma_estado: 'pendiente_envio', tyc_estado: 'pendiente_envio',
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
    viajo_finalmente:       body.viajo_finalmente       || null,
    embarque_presentado:    body.embarque_presentado    || null,
    pasaje_alternativo_monto:  body.pasaje_alternativo_monto  ? parseFloat(body.pasaje_alternativo_monto) || null : null,
    pasaje_alternativo_moneda: body.pasaje_alternativo_moneda || null,
    causa_informada: body.causa_informada || null,
    moneda_gastos:   body.moneda_gastos   || null,
    monto_gastos:    body.monto_gastos   ? parseFloat(body.monto_gastos)  || null : null,
    gastos_detalle:  body.gastos_detalle  || null,
    tipo_caso_equipaje:    body.tipo_caso_equipaje    || null,
    descripcion_equipaje:  body.descripcion_equipaje  || null,
    valor_equipaje:        body.valor_equipaje       ? parseFloat(body.valor_equipaje) || null : null,
    fecha_entrega_equipaje: body.fecha_entrega_equipaje || null,
    equipaje_no_entregado:  body.equipaje_no_entregado === true || body.equipaje_no_entregado === 'true' || false,
    pir_presentado:  body.pir_presentado || null,
    pir_numero:      body.pir_numero || null,
    documentos:      Array.isArray(body.documentos) ? body.documentos : [],
    acompanantes:          Array.isArray(body.acompanantes) ? body.acompanantes : [],
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
/* COMISIÓN                                                            */
/* ------------------------------------------------------------------ */
/**
 * Comisión de UN caso, desglosada por moneda.
 *
 * Monedas distintas NO se suman entre sí: un acuerdo en USD y otro en ARS son
 * dos totales separados. Devuelve {moneda: {estimada, confirmada}}.
 *
 * - estimada:   el caso llegó a acuerdo (instancia 'cobro') o ya cerró con éxito.
 * - confirmada: el caso cerró (con éxito para el criterio por_exito).
 *
 * Nota: `comision_valor_fijo` no tiene moneda propia en la base, se asume ARS.
 */
export function comisionDeCaso(agencia, c) {
  var out = {};
  function sumar(moneda, campo, valor) {
    if (!valor) return;
    if (!out[moneda]) out[moneda] = { estimada: 0, confirmada: 0 };
    out[moneda][campo] += valor;
  }

  var modo = agencia.comision_modo || 'por_exito';
  var pct = Number(agencia.comision_pct) || 0;
  var fijo = Number(agencia.comision_valor_fijo) || 0;

  if (modo === 'por_exito' || modo === 'mixta') {
    var monto = (c.monto_acordado === null || c.monto_acordado === undefined) ? null : Number(c.monto_acordado);
    if (monto !== null && !isNaN(monto)) {
      var moneda = c.monto_acordado_moneda || 'ARS';
      var comision = monto * pct / 100;
      if (c.instancia === 'cobro') sumar(moneda, 'estimada', comision);
      if (c.resultado === 'exito') { sumar(moneda, 'estimada', comision); sumar(moneda, 'confirmada', comision); }
    }
  }

  if (modo === 'por_caso_viable' || modo === 'mixta') {
    var superoEvaluacion = c.instancia && c.instancia !== 'evaluacion'
      && !(c.instancia === 'cerrado' && c.resultado === 'no_apto');
    if (superoEvaluacion && fijo) {
      sumar('ARS', 'estimada', fijo);
      if (c.instancia === 'cerrado') sumar('ARS', 'confirmada', fijo);
    }
  }

  return out;
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
    SB_URL + '/rest/v1/reclamos?agencia_id=eq.' + agencia.id
      + '&deleted_at=is.null&select=instancia,momento,resultado,estado,monto_acordado,monto_acordado_moneda,esperas',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
  );
  var sbText = await sbRes.text();
  if (!sbRes.ok) {
    console.error('[agency/stats] Supabase error:', sbText.substring(0, 300));
    return res.status(500).json({ error: 'Error al consultar estadísticas.' });
  }

  var claims = JSON.parse(sbText) || [];
  var total  = claims.length;
  var modo   = agencia.comision_modo || 'por_exito';

  var por_etapa = {};
  /* Acumulador por moneda: monedas distintas nunca se suman entre sí. */
  var por_moneda = {};

  claims.forEach(function (c) {
    /* Conteo por etapa externa (nunca por estado legacy) */
    var et = etapaExterna(c).etapa;
    por_etapa[et] = (por_etapa[et] || 0) + 1;

    var com = comisionDeCaso(agencia, c);
    Object.keys(com).forEach(function (moneda) {
      if (!por_moneda[moneda]) por_moneda[moneda] = { estimada: 0, confirmada: 0 };
      por_moneda[moneda].estimada   += com[moneda].estimada;
      por_moneda[moneda].confirmada += com[moneda].confirmada;
    });
  });

  /* Sólo monedas con algún importe, ordenadas por total desc para que la
     principal quede primero en el dashboard. */
  var comisiones = Object.keys(por_moneda)
    .filter(function (m) { return por_moneda[m].estimada || por_moneda[m].confirmada; })
    .map(function (m) { return { moneda: m, estimada: por_moneda[m].estimada, confirmada: por_moneda[m].confirmada }; })
    .sort(function (a, b) { return b.estimada - a.estimada; });

  return res.status(200).json({
    success: true,
    total: total,
    por_etapa: por_etapa,
    comision_modo: modo,
    comisiones: comisiones,
  });
}
