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
    if (body.action === 'add-novedad') {
      var texto = (body.texto || '').trim();
      if (!texto) return res.status(400).json({ error: 'El texto no puede estar vacío' });

      var getRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=novedades', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var rows = await getRes.json();
      var novedades = Array.isArray(rows[0]?.novedades) ? rows[0].novedades : [];
      novedades.unshift({ fecha: new Date().toISOString(), texto });

      var patchRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ novedades }),
      });
      if (!patchRes.ok) return res.status(500).json({ error: 'Error al guardar la novedad' });
      return res.status(200).json({ success: true, novedades });
    }

    /* ---- UPDATE ESTADO (con historial de timestamps) ---- */
    if (body.action === 'update-estado') {
      var newEstado = (body.estado || '').trim();
      var validEstados = [
        /* pipeline */
        'pendiente', 'en_revision', 'esperando_info', 'autorizacion_pendiente',
        'reclamado_aerolinea', 'negociacion', 'derivado_mediacion', 'mediacion_notificada',
        'en_mediacion', 'acuerdo', 'cobro_pasajero_pendiente', 'cobro_comision_pendiente', 'cerrado',
        /* salidas */
        'rechazado', 'no_apto', 'cancelado',
        /* legacy (compatibilidad con datos existentes) */
        'en_gestion', 'aprobado', 'resuelto'
      ];
      if (validEstados.indexOf(newEstado) === -1) return res.status(400).json({ error: 'Estado inválido' });

      /* Leer historial actual y appendear el cambio */
      var hgRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=estado_historial', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var hgRows = await hgRes.json();
      var historial = Array.isArray(hgRows[0]?.estado_historial) ? hgRows[0].estado_historial : [];
      historial.push({ estado: newEstado, fecha: new Date().toISOString(), por: body.por || 'admin' });

      var patch = { estado: newEstado, estado_historial: historial };
      if (body.abogado_id) patch.abogado_id = body.abogado_id;

      var updRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!updRes.ok) return res.status(500).json({ error: 'Error al actualizar estado' });
      return res.status(200).json({ success: true, action: 'update-estado', estado: newEstado, estado_historial: historial });
    }

    /* ---- UPDATE FIRMA ESTADO ---- */
    if (body.action === 'update-firma') {
      var newFirma = (body.firma_estado || '').trim();
      var validFirmas = ['no_aplica', 'pendiente_envio', 'enviada', 'firmada', 'rechazada'];
      if (validFirmas.indexOf(newFirma) === -1) return res.status(400).json({ error: 'Estado de firma inválido' });
      var firmaRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ firma_estado: newFirma }),
      });
      if (!firmaRes.ok) return res.status(500).json({ error: 'Error al actualizar autorización' });
      return res.status(200).json({ success: true, action: 'update-firma', firma_estado: newFirma });
    }

    /* ---- UPDATE COMPENSACION ---- */
    if (body.action === 'update-compensacion') {
      var mv = body.monto_compensacion;
      var montoNum = (mv !== null && mv !== undefined && mv !== '') ? parseFloat(mv) : null;
      if (mv !== null && mv !== undefined && mv !== '' && isNaN(montoNum)) return res.status(400).json({ error: 'Monto inválido' });
      var compRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ monto_compensacion: montoNum }),
      });
      if (!compRes.ok) return res.status(500).json({ error: 'Error al actualizar compensación' });
      return res.status(200).json({ success: true, action: 'update-compensacion', monto_compensacion: montoNum });
    }

    /* ---- SET FECHA MEDIACION ---- */
    if (body.action === 'set-fecha-mediacion') {
      var fm = body.fecha_mediacion;
      var fmVal = (fm === null || fm === undefined || fm === '') ? null : new Date(fm).toISOString();
      if (fm && fmVal && isNaN(new Date(fm).getTime())) return res.status(400).json({ error: 'Fecha inválida' });
      var fmRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ fecha_mediacion: fmVal }),
      });
      if (!fmRes.ok) return res.status(500).json({ error: 'Error al guardar la fecha de mediación' });
      return res.status(200).json({ success: true, action: 'set-fecha-mediacion', fecha_mediacion: fmVal });
    }

    /* ---- CONFIRM UPDATE AL CLIENTE (+ bitácora) ---- */
    if (body.action === 'confirm-update-cliente') {
      var nowTs = new Date().toISOString();
      var cuRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=novedades', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var cuRows = await cuRes.json();
      var cuNov = Array.isArray(cuRows[0]?.novedades) ? cuRows[0].novedades : [];
      cuNov.unshift({ fecha: nowTs, texto: '✓ Update enviado al cliente' });
      var cuPatch = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ ultimo_update_cliente: nowTs, novedades: cuNov }),
      });
      if (!cuPatch.ok) return res.status(500).json({ error: 'Error al registrar el update' });
      return res.status(200).json({ success: true, action: 'confirm-update-cliente', ultimo_update_cliente: nowTs, novedades: cuNov });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });

  } catch (err) {
    console.error('[update-ticket] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
