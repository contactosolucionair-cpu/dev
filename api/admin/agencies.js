/**
 * GET  /api/admin/agencies  — Lista todas las agencias con conteo de casos
 * POST /api/admin/agencies  — Aprobar / suspender / reactivar una agencia
 *
 * Protegido con ADMIN_PASSWORD (env var). El frontend envía el header
 * X-Admin-Password en cada request al backoffice.
 *
 * POST body: { id, action }  action: 'aprobar' | 'suspender' | 'reactivar'
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL    = process.env.SUPABASE_URL;
  var SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ADMIN_PWD = process.env.ADMIN_PASSWORD;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  /* Validar password admin */
  if (ADMIN_PWD) {
    var sentPwd = req.headers['x-admin-password'] || '';
    if (sentPwd !== ADMIN_PWD) return res.status(401).json({ error: 'No autorizado.' });
  }

  try {
    if (req.method === 'GET') {
      /* Listar agencias */
      var agRes  = await fetch(
        SB_URL + '/rest/v1/agencias?order=creado_en.desc&select=*',
        { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
      );
      var agText = await agRes.text();
      if (!agRes.ok) {
        console.error('[admin/agencies] Supabase agencias error:', agText.substring(0, 300));
        return res.status(500).json({ error: 'Error al consultar agencias. Verificá que la migración SQL fue ejecutada en Supabase.' });
      }
      var agencias = JSON.parse(agText);
      if (!Array.isArray(agencias)) agencias = [];

      /* Conteo de casos B2B por agencia */
      var conteo = {};
      var countRes = await fetch(
        SB_URL + '/rest/v1/reclamos?canal=eq.B2B&deleted_at=is.null&select=agencia_id',
        { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
      );
      if (countRes.ok) {
        var casosRows = JSON.parse(await countRes.text());
        if (Array.isArray(casosRows)) {
          casosRows.forEach(function (r) {
            if (r.agencia_id) conteo[r.agencia_id] = (conteo[r.agencia_id] || 0) + 1;
          });
        }
      }

      agencias = agencias.map(function (ag) {
        return Object.assign({}, ag, { num_casos: conteo[ag.id] || 0 });
      });

      console.log('[admin/agencies] GET — ', agencias.length, 'agencias');
      return res.status(200).json({ success: true, agencias: agencias });
    }

    /* POST — acción sobre una agencia */
    var body   = req.body;
    var id     = (body.id     || '').trim();
    var action = (body.action || '').trim();

    if (!id || !['aprobar', 'suspender', 'reactivar'].includes(action)) {
      return res.status(400).json({ error: 'id y action son requeridos.' });
    }

    var nuevoEstado = action === 'aprobar' ? 'activa' : action === 'suspender' ? 'suspendida' : 'activa';
    var patch = { estado: nuevoEstado };
    if (action === 'aprobar') patch.aprobada_en = new Date().toISOString();

    var patchRes = await fetch(SB_URL + '/rest/v1/agencias?id=eq.' + id, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(patch),
    });

    if (!patchRes.ok) {
      var patchErr = await patchRes.text();
      console.error('[admin/agencies] PATCH error:', patchErr.substring(0, 300));
      return res.status(500).json({ error: 'Error al actualizar agencia.' });
    }

    console.log('[admin/agencies] Agencia', id, '->', nuevoEstado);
    return res.status(200).json({ success: true, nuevo_estado: nuevoEstado });

  } catch (err) {
    console.error('[admin/agencies] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
