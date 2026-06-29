export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL    = process.env.SUPABASE_URL;
  var SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ADMIN_PWD = process.env.ADMIN_PASSWORD;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  if (ADMIN_PWD) {
    var sentPwd = req.headers['x-admin-password'] || '';
    if (sentPwd !== ADMIN_PWD) return res.status(401).json({ error: 'No autorizado.' });
  }

  var { bucket, path } = req.body || {};
  if (!bucket || !path) return res.status(400).json({ error: 'bucket y path son requeridos' });

  var resp = await fetch(`${SB_URL}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 3600 }),
  });

  if (!resp.ok) {
    var err = await resp.text();
    return res.status(resp.status).json({ error: err });
  }

  var data = await resp.json();
  return res.status(200).json({ signedURL: `${SB_URL}${data.signedURL}` });
}
