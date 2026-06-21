/**
 * GET /api/get-claims
 *
 * Fetches all claims from the Supabase 'reclamos' table ordered by creation
 * date descending (newest first). Used by backoffice.html and perfil.html.
 *
 * @returns {Object} {success, claims: Array<Reclamo>}
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase credentials not configured' });

  try {
    var sbRes = await fetch(
      SB_URL + '/rest/v1/reclamos?select=*&order=creado_en.desc&limit=200',
      {
        method: 'GET',
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
        },
      }
    );

    var sbText = await sbRes.text();

    if (!sbRes.ok) {
      console.error('[get-claims] Supabase error:', sbText.substring(0, 300));
      return res.status(500).json({ error: 'Supabase error' });
    }

    var claims = JSON.parse(sbText);
    return res.status(200).json({ success: true, claims: claims || [] });

  } catch (err) {
    console.error('[get-claims] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
