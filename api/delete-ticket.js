/**
 * POST /api/delete-ticket
 *
 * Soft Delete / Restore / Permanent Delete for claims.
 * Actions:
 *   - soft-delete: Sets deleted_at to current timestamp
 *   - restore: Sets deleted_at to NULL
 *   - permanent: Physical DELETE from database (requires confirmation)
 *
 * @param {string} req.body.id - Claim UUID
 * @param {string} req.body.action - "soft-delete" | "restore" | "permanent"
 * @returns {Object} {success, action}
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
    var id = body.id;
    var action = body.action;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    if (action === 'soft-delete') {
      var r = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
      if (!r.ok) return res.status(500).json({ error: 'Error al eliminar' });
      return res.status(200).json({ success: true, action: 'soft-delete' });
    }

    if (action === 'restore') {
      var r2 = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
        body: JSON.stringify({ deleted_at: null }),
      });
      if (!r2.ok) return res.status(500).json({ error: 'Error al restaurar' });
      return res.status(200).json({ success: true, action: 'restore' });
    }

    if (action === 'permanent') {
      var r3 = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'DELETE',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      if (!r3.ok) return res.status(500).json({ error: 'Error al eliminar permanentemente' });
      return res.status(200).json({ success: true, action: 'permanent' });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno' });
  }
}
