/**
 * POST /api/delete-ticket
 *
 * Manages claim lifecycle in the recycle bin:
 *   - soft-delete: Sets deleted_at timestamp (logical deletion)
 *   - restore: Clears deleted_at (returns to active list)
 *   - permanent: Physical DELETE (irreversible)
 *
 * @param {string} req.body.id - Claim UUID
 * @param {string} req.body.action - "soft-delete" | "restore" | "permanent"
 * @returns {Object} {success, action}
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ADMIN_PWD = process.env.ADMIN_PASSWORD;
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase not configured' });
  /* Solo backoffice: exige ADMIN_PASSWORD. Sin la env var, NO queda abierto. */
  if (!ADMIN_PWD) return res.status(500).json({ error: 'ADMIN_PASSWORD no configurado' });
  if ((req.headers['x-admin-password'] || '') !== ADMIN_PWD) return res.status(401).json({ error: 'No autorizado.' });

  try {
    var body = req.body;
    var id = body.id;
    var action = body.action;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    if (action === 'soft-delete') {
      /* Logical deletion: set deleted_at to current timestamp */
      /* First try updating estado to 'eliminado' as fallback if deleted_at column doesn't exist */
      var patchBody = { deleted_at: new Date().toISOString() };

      var r = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(patchBody),
      });

      var rText = await r.text();
      console.log('[delete-ticket] soft-delete status:', r.status, 'body:', rText.substring(0, 200));

      if (!r.ok) {
        /* If deleted_at column doesn't exist, fallback to updating estado */
        console.log('[delete-ticket] PATCH failed, trying estado fallback');
        var r1b = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SB_KEY,
            'Authorization': 'Bearer ' + SB_KEY,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ estado: 'eliminado' }),
        });
        var r1bText = await r1b.text();
        console.log('[delete-ticket] fallback status:', r1b.status, 'body:', r1bText.substring(0, 200));
        if (!r1b.ok) return res.status(500).json({ error: 'No se pudo eliminar. Verificá las políticas RLS y la columna deleted_at en Supabase.' });
      }

      return res.status(200).json({ success: true, action: 'soft-delete' });
    }

    if (action === 'restore') {
      /* Clear deleted_at and restore estado */
      var r2 = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ deleted_at: null, estado: 'pendiente' }),
      });

      var r2Text = await r2.text();
      console.log('[delete-ticket] restore status:', r2.status, 'body:', r2Text.substring(0, 200));

      if (!r2.ok) {
        /* Fallback: just update estado */
        var r2b = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SB_KEY,
            'Authorization': 'Bearer ' + SB_KEY,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ estado: 'pendiente' }),
        });
        if (!r2b.ok) return res.status(500).json({ error: 'No se pudo restaurar.' });
      }

      return res.status(200).json({ success: true, action: 'restore' });
    }

    if (action === 'permanent') {
      var r3 = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'DELETE',
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
        },
      });

      var r3Text = await r3.text();
      console.log('[delete-ticket] permanent status:', r3.status, 'body:', r3Text.substring(0, 200));

      if (!r3.ok) return res.status(500).json({ error: 'No se pudo eliminar permanentemente.' });
      return res.status(200).json({ success: true, action: 'permanent' });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });
  } catch (err) {
    console.error('[delete-ticket] Error:', err.message);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
}
