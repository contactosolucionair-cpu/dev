/**
 * POST /api/update-ticket
 *
 * Two actions:
 * 1. Cancel (action: "cancel"): Updates claim estado to 'cancelado'.
 * 2. Add update (novedad): Appends timestamped text to the novedades column,
 *    concatenating with existing entries separated by '---'.
 *
 * @param {string} req.body.id - Claim UUID (required)
 * @param {string} req.body.action - "cancel" to cancel the claim
 * @param {string} req.body.novedad - Update text to append
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
    if (!id) return res.status(400).json({ error: 'ID de reclamo requerido' });

    /* ---- CANCEL ---- */
    if (body.action === 'cancel') {
      console.log('[update-ticket] Cancel claim:', id);

      var cancelRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({ estado: 'cancelado' }),
      });

      var cancelText = await cancelRes.text();
      console.log('[update-ticket] Cancel status:', cancelRes.status);

      if (!cancelRes.ok) {
        console.error('[update-ticket] Cancel error:', cancelText.substring(0, 300));
        return res.status(500).json({ error: 'Error al cancelar el reclamo' });
      }

      return res.status(200).json({ success: true, action: 'cancel' });
    }

    /* ---- NOVEDAD ---- */
    if (body.novedad) {
      console.log('[update-ticket] Add novedad to:', id);

      var timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      var novedadEntry = '[' + timestamp + '] ' + body.novedad;

      /* Get current novedades */
      var getRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=novedades', {
        method: 'GET',
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
        },
      });

      var getText = await getRes.text();
      var current = '';
      if (getRes.ok) {
        var rows = JSON.parse(getText);
        if (rows.length > 0 && rows[0].novedades) {
          current = rows[0].novedades;
        }
      }

      var updated = current ? current + '\n---\n' + novedadEntry : novedadEntry;

      var patchRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({ novedades: updated }),
      });

      var patchText = await patchRes.text();
      console.log('[update-ticket] Novedad patch status:', patchRes.status);

      if (!patchRes.ok) {
        console.error('[update-ticket] Novedad error:', patchText.substring(0, 300));
        return res.status(500).json({ error: 'Error al guardar la novedad' });
      }

      return res.status(200).json({ success: true, action: 'novedad' });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });

  } catch (err) {
    console.error('[update-ticket] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
