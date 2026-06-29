export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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

  var { id, bucket = 'reclamos', filename, tipo = 'documento', nombre } = req.query;
  var contentType = req.headers['content-type'] || 'application/octet-stream';

  if (!id || !filename) return res.status(400).json({ error: 'id y filename son requeridos' });

  // Sanitize filename
  var safeName = filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_');

  try {
    // 1. Get current case
    var caseResp = await fetch(`${SB_URL}/rest/v1/reclamos?id=eq.${id}&select=id,ref_code,adjuntos`, {
      headers: { 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY },
    });
    var cases = await caseResp.json();
    if (!cases.length) return res.status(404).json({ error: 'Caso no encontrado' });
    var claim = cases[0];

    // 2. Upload file to Supabase Storage
    var path = `${claim.ref_code}/${safeName}`;
    var rawBody = await getRawBody(req);

    var uploadResp = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: rawBody,
    });

    if (!uploadResp.ok) {
      var uploadErr = await uploadResp.text();
      return res.status(uploadResp.status).json({ error: uploadErr });
    }

    // 3. Update adjuntos in reclamos
    var adjuntos = Array.isArray(claim.adjuntos) ? claim.adjuntos : [];
    // Remove any existing entry with same path
    adjuntos = adjuntos.filter(a => a.path !== path);
    var newAdj = { tipo, bucket, path, nombre: nombre || safeName };
    adjuntos.push(newAdj);

    var patchResp = await fetch(`${SB_URL}/rest/v1/reclamos?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${SB_KEY}`,
        'apikey': SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ adjuntos }),
    });

    if (!patchResp.ok) {
      var patchErr = await patchResp.text();
      return res.status(patchResp.status).json({ error: patchErr });
    }

    return res.status(200).json({ success: true, adjunto: newAdj, adjuntos });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
