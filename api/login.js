/**
 * POST /api/login
 *
 * Authenticates a user. First attempts Supabase Auth login. If that fails,
 * checks if the email exists in the reclamos table as a fallback (allows
 * users who registered through the claim form to access their panel).
 *
 * @param {string} req.body.email - User email
 * @param {string} req.body.password - User password
 * @returns {Object} {success, email, token} or {error}
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    var body = req.body;
    var email = (body.email || '').trim();
    var password = (body.password || '');

    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });

    /* Try Supabase Auth login first */
    var authRes = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
      },
      body: JSON.stringify({ email: email, password: password }),
    });

    var authText = await authRes.text();
    console.log('[login] Auth status:', authRes.status);

    if (authRes.ok) {
      var authJson = JSON.parse(authText);
      if (authJson.access_token) {
        return res.status(200).json({ success: true, email: email, token: authJson.access_token });
      }
    }

    /* If auth fails, check if user exists in reclamos table by email */
    var checkRes = await fetch(SB_URL + '/rest/v1/reclamos?email=eq.' + encodeURIComponent(email) + '&select=email,nombre,ref_code&limit=1', {
      method: 'GET',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
      },
    });

    var checkText = await checkRes.text();
    console.log('[login] Reclamos check status:', checkRes.status);

    if (checkRes.ok) {
      var rows = JSON.parse(checkText);
      if (rows.length > 0) {
        /* User has a claim on record — allow access with session token */
        return res.status(200).json({ success: true, email: email, token: 'session-' + Date.now().toString(36), nombre: rows[0].nombre });
      }
    }

    return res.status(401).json({ error: 'No encontramos una cuenta con esas credenciales. Verificá tu email y contraseña.' });

  } catch (err) {
    console.error('[login] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
