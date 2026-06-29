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

  var { action, bucket = 'reclamos' } = req.query;

  // --- action=sign: generate signed URL for a private file ---
  if (action === 'sign') {
    var { path } = req.query;
    if (!path) return res.status(400).json({ error: 'path es requerido' });

    var resp = await fetch(`${SB_URL}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    });

    if (!resp.ok) return res.status(resp.status).json({ error: await resp.text() });
    var data = await resp.json();
    return res.status(200).json({ signedURL: `${SB_URL}${data.signedURL}` });
  }

  // --- action=upload: upload file to Supabase Storage and update adjuntos ---
  if (action === 'upload') {
    var { id, filename, tipo = 'documento', nombre } = req.query;
    var contentType = req.headers['content-type'] || 'application/octet-stream';
    if (!id || !filename) return res.status(400).json({ error: 'id y filename son requeridos' });

    var safeName = filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_');

    var caseResp = await fetch(`${SB_URL}/rest/v1/reclamos?id=eq.${id}&select=id,ref_code,adjuntos`, {
      headers: { 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY },
    });
    var cases = await caseResp.json();
    if (!cases.length) return res.status(404).json({ error: 'Caso no encontrado' });
    var claim = cases[0];

    var path = `${claim.ref_code}/${safeName}`;
    var rawBody = await getRawBody(req);

    var uploadResp = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: rawBody,
    });
    if (!uploadResp.ok) return res.status(uploadResp.status).json({ error: await uploadResp.text() });

    var adjuntos = Array.isArray(claim.adjuntos) ? claim.adjuntos : [];
    adjuntos = adjuntos.filter(a => a.path !== path);
    var newAdj = { tipo, bucket, path, nombre: nombre || safeName };
    adjuntos.push(newAdj);

    var patchResp = await fetch(`${SB_URL}/rest/v1/reclamos?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ adjuntos }),
    });
    if (!patchResp.ok) return res.status(patchResp.status).json({ error: await patchResp.text() });

    return res.status(200).json({ success: true, adjunto: newAdj, adjuntos });
  }

  return res.status(400).json({ error: 'action debe ser sign o upload' });
}
