/**
 * POST /api/my-actions
 *
 * Acciones que el cliente (pasajero) puede ejecutar sobre SU propio caso desde
 * perfil.html. Reemplaza las llamadas del cliente a /api/update-ticket, que
 * ahora es admin-only.
 *
 * Auth: header `Authorization: Bearer <token>` (JWT de Supabase). Se valida
 * contra /auth/v1/user; el email autenticado debe coincidir con el email del
 * caso y el caso no debe estar en la papelera (deleted_at is null), si no → 403.
 *
 * Acciones:
 *   cancel   Cancela el caso (transición 'abandonar' del modelo instancia/momento).
 *            Solo si el caso NO está cerrado. Escribe resultado='abandonado',
 *            motivo_cierre='desistimiento_pasajero' y el espejo `estado` legacy.
 *   novedad  {id, texto} → agrega una novedad del cliente al array `novedades`.
 *
 * @returns {Object} {success, action, ...}
 */
import { verifyClienteEmail } from './_utils/cliente-auth.js';
import { getInstancia, validarTransicion, instanciaAEstadoLegacy } from './_utils/instancias.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  try {
    var email = await verifyClienteEmail(req, SB_URL, SB_KEY);
    if (!email) return res.status(401).json({ error: 'No autorizado.' });

    var body = req.body || {};
    var id = (body.id || '').trim();
    var action = (body.action || '').trim();
    if (!id) return res.status(400).json({ error: 'id de caso requerido.' });
    if (['cancel', 'novedad'].indexOf(action) === -1) return res.status(400).json({ error: 'Acción no reconocida.' });

    /* Traer el caso y verificar propiedad + que no esté en papelera */
    var getRes = await fetch(
      SB_URL + '/rest/v1/reclamos?id=eq.' + id
        + '&select=id,email,deleted_at,instancia,momento,resultado,estado,estado_historial,instancia_historial,novedades&limit=1',
      { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
    var rows;
    try { rows = JSON.parse(await getRes.text()); } catch (e) { rows = []; }
    var caso = (rows && rows.length) ? rows[0] : null;
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado.' });
    if (caso.deleted_at) return res.status(403).json({ error: 'No autorizado sobre este caso.' });
    if (String(caso.email || '').trim().toLowerCase() !== email) return res.status(403).json({ error: 'No autorizado sobre este caso.' });

    function patchRow(patch) {
      return fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify(patch),
      });
    }

    var nowIso = new Date().toISOString();

    /* ---- CANCEL (transición 'abandonar') ---- */
    if (action === 'cancel') {
      var pos = getInstancia(caso);
      var check = validarTransicion(pos.instancia, pos.momento, 'abandonar');
      if (!check.ok) return res.status(400).json({ error: check.error });

      var estadoLegacy = instanciaAEstadoLegacy('cerrado', null, 'abandonado');

      var estadoHist = Array.isArray(caso.estado_historial) ? caso.estado_historial : [];
      estadoHist.push({ estado: estadoLegacy, fecha: nowIso, por: 'cliente' });
      var instHist = Array.isArray(caso.instancia_historial) ? caso.instancia_historial : [];
      instHist.push({ instancia: 'cerrado', momento: null, fecha: nowIso, por: 'cliente' });

      var updRes = await patchRow({
        instancia: 'cerrado', momento: null, resultado: 'abandonado',
        motivo_cierre: 'desistimiento_pasajero',
        estado: estadoLegacy, estado_historial: estadoHist, instancia_historial: instHist,
      });
      if (!updRes.ok) {
        console.error('[my-actions/cancel] PATCH error:', (await updRes.text()).substring(0, 300));
        return res.status(500).json({ error: 'Error al cancelar el caso.' });
      }
      return res.status(200).json({ success: true, action: 'cancel', instancia: 'cerrado', resultado: 'abandonado' });
    }

    /* ---- NOVEDAD ---- */
    if (action === 'novedad') {
      var texto = (body.texto || '').trim();
      if (!texto) return res.status(400).json({ error: 'El texto no puede estar vacío.' });
      var novedades = Array.isArray(caso.novedades) ? caso.novedades : [];
      novedades.unshift({ fecha: nowIso, texto: texto, por: 'cliente' });
      var novRes = await patchRow({ novedades: novedades });
      if (!novRes.ok) {
        console.error('[my-actions/novedad] PATCH error:', (await novRes.text()).substring(0, 300));
        return res.status(500).json({ error: 'Error al enviar la novedad.' });
      }
      return res.status(200).json({ success: true, action: 'novedad', novedades: novedades });
    }

    return res.status(400).json({ error: 'Acción no reconocida.' });

  } catch (err) {
    console.error('[my-actions] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
