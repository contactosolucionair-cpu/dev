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
      /* Soft-delete: marca deleted_at. La posición del caso (instancia/momento)
         no se toca; `deleted_at` es la única señal de papelera. */
      var r = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
      var rText = await r.text();
      console.log('[delete-ticket] soft-delete status:', r.status, 'body:', rText.substring(0, 200));
      if (!r.ok) return res.status(500).json({ error: 'No se pudo eliminar. Verificá las políticas RLS y la columna deleted_at en Supabase.' });

      return res.status(200).json({ success: true, action: 'soft-delete' });
    }

    if (action === 'restore') {
      /* Restaurar: solo limpia deleted_at. La posición del caso la da instancia;
         no se fuerza ningún estado legacy. */
      var r2 = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ deleted_at: null }),
      });
      var r2Text = await r2.text();
      console.log('[delete-ticket] restore status:', r2.status, 'body:', r2Text.substring(0, 200));
      if (!r2.ok) return res.status(500).json({ error: 'No se pudo restaurar.' });

      return res.status(200).json({ success: true, action: 'restore' });
    }

    if (action === 'permanent') {
      /* Antes se borraba sólo la fila y la carpeta <ref_code>/ del bucket quedaba
         huérfana para siempre. Ahora se limpia el Storage primero: si fallara
         después del DELETE, ya no tendríamos el ref_code para encontrarla. */
      var infoRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=ref_code,adjuntos&limit=1', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var infoRows;
      try { infoRows = JSON.parse(await infoRes.text()); } catch (e) { infoRows = []; }
      if (!infoRows || !infoRows.length) return res.status(404).json({ error: 'Reclamo no encontrado.' });

      var archivosBorrados = await borrarStorageDelCaso(SB_URL, SB_KEY, infoRows[0]);

      var r3 = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'DELETE',
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
        },
      });

      var r3Text = await r3.text();
      console.log('[delete-ticket] permanent status:', r3.status, '| archivos borrados:', archivosBorrados, '| body:', r3Text.substring(0, 200));

      if (!r3.ok) return res.status(500).json({ error: 'No se pudo eliminar permanentemente.' });
      return res.status(200).json({ success: true, action: 'permanent', archivos_borrados: archivosBorrados });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });
  } catch (err) {
    console.error('[delete-ticket] Error:', err.message);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
}

/**
 * Borra del Storage todos los archivos del caso: la carpeta <ref_code>/ del
 * bucket y, además, cualquier adjunto cuyo path apunte a otro lado (por si
 * quedaron rutas viejas fuera de esa carpeta).
 *
 * Best-effort: devuelve cuántos borró y nunca tira. Si falla, el peor caso es un
 * archivo huérfano — no queremos abortar el borrado del caso por eso.
 */
async function borrarStorageDelCaso(SB_URL, SB_KEY, claim) {
  var BUCKET = 'reclamos';
  var headers = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  var paths = {};

  try {
    if (claim.ref_code) {
      var listRes = await fetch(SB_URL + '/storage/v1/object/list/' + BUCKET, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ prefix: claim.ref_code + '/', limit: 1000, offset: 0 }),
      });
      if (listRes.ok) {
        var objetos = JSON.parse(await listRes.text());
        if (Array.isArray(objetos)) objetos.forEach(function (o) {
          if (o && o.name) paths[claim.ref_code + '/' + o.name] = true;
        });
      } else {
        console.error('[delete-ticket] list storage error:', (await listRes.text()).substring(0, 200));
      }
    }

    /* Adjuntos registrados en la fila, por si alguno vive fuera de <ref_code>/. */
    (Array.isArray(claim.adjuntos) ? claim.adjuntos : []).forEach(function (a) {
      if (a && a.path && (!a.bucket || a.bucket === BUCKET)) paths[a.path] = true;
    });

    var lista = Object.keys(paths);
    if (!lista.length) return 0;

    var delRes = await fetch(SB_URL + '/storage/v1/object/' + BUCKET, {
      method: 'DELETE',
      headers: headers,
      body: JSON.stringify({ prefixes: lista }),
    });
    if (!delRes.ok) {
      console.error('[delete-ticket] delete storage error:', (await delRes.text()).substring(0, 200));
      return 0;
    }
    return lista.length;
  } catch (e) {
    console.error('[delete-ticket] borrarStorageDelCaso error:', e.message);
    return 0;
  }
}
