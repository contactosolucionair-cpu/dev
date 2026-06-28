/**
 * GET /api/agency/claims
 *
 * Devuelve solo los reclamos de la agencia autenticada.
 * Un agente NUNCA puede ver casos de otra agencia.
 *
 * @returns {Object} {success, claims: Array}
 */
import { verifyAgency } from '../utils/agency-auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  try {
    var agencia = await verifyAgency(req, SB_URL, SB_KEY);
    if (!agencia) return res.status(401).json({ error: 'No autorizado.' });

    console.log('[agency/claims] Cargando casos para agencia:', agencia.id);

    var fields = 'id,ref_code,nombre,email,telefono,aerolinea,vuelo_nro,fecha_vuelo,origen,destino,tipo_reclamo,tipo_incidencia,estado,firma_estado,agente_nombre,agente_email,creado_en,novedades,ai_raw';

    var sbRes = await fetch(
      SB_URL + '/rest/v1/reclamos?agencia_id=eq.' + agencia.id
        + '&deleted_at=is.null'
        + '&order=creado_en.desc'
        + '&select=' + fields,
      {
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
        },
      }
    );

    var sbText = await sbRes.text();
    if (!sbRes.ok) {
      console.error('[agency/claims] Supabase error:', sbText.substring(0, 300));
      return res.status(500).json({ error: 'Error al consultar casos.' });
    }

    var claims = JSON.parse(sbText);
    return res.status(200).json({ success: true, claims: claims || [] });

  } catch (err) {
    console.error('[agency/claims] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
