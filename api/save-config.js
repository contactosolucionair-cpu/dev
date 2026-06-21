/**
 * POST /api/save-config
 *
 * Upserts system config into Supabase 'site_config' table (id='global').
 * Expects { colors, feature_flags, translations } JSONB structure.
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

    var row = {
      id: 'global',
      colors: body.colors || {},
      feature_flags: body.feature_flags || {},
      translations: body.translations || {},
      updated_at: new Date().toISOString(),
    };

    var sbRes = await fetch(SB_URL + '/rest/v1/site_config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    });

    if (!sbRes.ok) {
      var errText = await sbRes.text();
      console.error('[save-config] Supabase error:', errText.substring(0, 300));
      return res.status(500).json({ error: 'Error al guardar configuración' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[save-config] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
