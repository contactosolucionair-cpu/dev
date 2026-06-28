/**
 * POST /api/agency/login
 *
 * Autentica una agencia/agente. Si la cuenta existe pero está 'pendiente'
 * devuelve {success:true, estado:'pendiente'} sin token de operación.
 *
 * @param {string} req.body.email
 * @param {string} req.body.password
 * @returns {Object} {success, token, email, agencia} o {error}
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
    var email    = (body.email    || '').trim().toLowerCase();
    var password = (body.password || '');

    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });

    console.log('[agency/login] Intento de login:', email);

    /* 1. Password grant en Supabase Auth */
    var authRes = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
      },
      body: JSON.stringify({ email: email, password: password }),
    });

    var authText = await authRes.text();
    console.log('[agency/login] Auth status:', authRes.status);

    if (!authRes.ok) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }

    var authJson;
    try { authJson = JSON.parse(authText); } catch (e) { return res.status(500).json({ error: 'Error de autenticación.' }); }

    var token  = authJson.access_token;
    var userId = authJson.user && authJson.user.id;
    if (!token || !userId) return res.status(500).json({ error: 'Error al obtener token.' });

    /* 2. Buscar la fila en agencias */
    var agRes = await fetch(
      SB_URL + '/rest/v1/agencias?auth_user_id=eq.' + userId + '&limit=1',
      {
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
        },
      }
    );

    var agText = await agRes.text();
    var rows;
    try { rows = JSON.parse(agText); } catch (e) { rows = []; }

    if (!rows || !rows.length) {
      return res.status(403).json({ error: 'No existe una cuenta de agencia asociada a este email.' });
    }

    var ag = rows[0];
    console.log('[agency/login] Agencia encontrada, estado:', ag.estado);

    /* Estado pendiente: login correcto pero sin acceso a operaciones */
    if (ag.estado === 'pendiente') {
      return res.status(200).json({
        success: true,
        estado:  'pendiente',
        agencia: { nombre: ag.nombre, estado: ag.estado, tipo: ag.tipo },
      });
    }

    if (ag.estado === 'suspendida') {
      return res.status(403).json({ error: 'Tu cuenta está suspendida. Contactate con SolucionAir.' });
    }

    return res.status(200).json({
      success: true,
      token:   token,
      email:   email,
      agencia: {
        id:           ag.id,
        nombre:       ag.nombre,
        estado:       ag.estado,
        tipo:         ag.tipo,
        comision_pct: ag.comision_pct,
      },
    });

  } catch (err) {
    console.error('[agency/login] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
