/**
 * POST /api/agency/register
 *
 * Registra una nueva agencia / agente individual.
 * Crea el usuario en Supabase Auth e inserta la fila en `agencias`
 * con estado 'pendiente'. El admin debe aprobarla antes de poder operar.
 *
 * @param {string} req.body.nombre
 * @param {string} req.body.tipo       'agencia' | 'individual'
 * @param {string} req.body.cuit_dni
 * @param {string} req.body.email
 * @param {string} req.body.telefono
 * @param {string} req.body.password
 * @returns {Object} {success} o {error}
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  try {
    var body = req.body;
    var nombre   = (body.nombre   || '').trim();
    var tipo     = (body.tipo     || '').trim();
    var cuit_dni = (body.cuit_dni || '').trim();
    var email    = (body.email    || '').trim().toLowerCase();
    var telefono = (body.telefono || '').trim();
    var password = (body.password || '');

    if (!nombre || !tipo || !email || !password) {
      return res.status(400).json({ error: 'Nombre, tipo, email y contraseña son obligatorios.' });
    }
    if (tipo !== 'agencia' && tipo !== 'individual') {
      return res.status(400).json({ error: 'Tipo debe ser "agencia" o "individual".' });
    }

    console.log('[agency/register] Registrando:', email, tipo);

    /* 1. Crear usuario en Supabase Auth */
    var signupRes = await fetch(SB_URL + '/auth/v1/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
      },
      body: JSON.stringify({ email: email, password: password }),
    });

    var signupText = await signupRes.text();
    console.log('[agency/register] Auth signup status:', signupRes.status);

    var signupJson;
    try { signupJson = JSON.parse(signupText); } catch (e) { return res.status(500).json({ error: 'Error al crear usuario.' }); }

    if (!signupRes.ok) {
      /* Email duplicado */
      if (signupText.indexOf('already registered') > -1 || signupText.indexOf('already exists') > -1) {
        return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
      }
      return res.status(400).json({ error: signupJson.msg || signupJson.message || 'Error al registrar usuario.' });
    }

    var authUserId = signupJson.id || (signupJson.user && signupJson.user.id);
    if (!authUserId) return res.status(500).json({ error: 'No se pudo obtener el ID de usuario.' });

    /* 2. Insertar fila en agencias */
    var rowRes = await fetch(SB_URL + '/rest/v1/agencias', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        auth_user_id: authUserId,
        nombre:       nombre,
        tipo:         tipo,
        cuit_dni:     cuit_dni || null,
        email:        email,
        telefono:     telefono || null,
        estado:       'pendiente',
      }),
    });

    if (!rowRes.ok) {
      var rowErr = await rowRes.text();
      console.error('[agency/register] Insert agencia error:', rowErr.substring(0, 300));
      return res.status(500).json({ error: 'Error al guardar datos de agencia.' });
    }

    console.log('[agency/register] Agencia creada (pendiente):', email);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[agency/register] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
