/**
 * GET /api/my-claims
 *
 * Panel del cliente (perfil.html). Devuelve SOLO los casos del usuario
 * autenticado por su JWT de Supabase.
 *
 * Auth: header `Authorization: Bearer <token>`. Se valida contra
 * `/auth/v1/user` y el email para el filtro sale del token validado,
 * JAMÁS de query params ni del body.
 *
 * Seguridad: select explícito de los campos que el cliente necesita
 * (nunca `select=*`, nunca `ai_raw`, nunca IPs). Se adjunta `etapa` y
 * `etapa_label` (vista externa de 5+3 etapas).
 *
 * @returns {Object} {success, claims: Array}
 */
import { verifyClienteEmail } from './_utils/cliente-auth.js';
import { etapaExterna } from './_utils/instancias.js';

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
    var email = await verifyClienteEmail(req, SB_URL, SB_KEY);
    if (!email) return res.status(401).json({ error: 'No autorizado.' });

    var fields = 'id,ref_code,nombre,aerolinea,vuelo_nro,fecha_vuelo,origen,destino,'
      + 'tipo_reclamo,instancia,momento,resultado,instancia_historial,creado_en,firma_estado';

    var sbRes = await fetch(
      SB_URL + '/rest/v1/reclamos?email=eq.' + encodeURIComponent(email)
        + '&deleted_at=is.null&order=creado_en.desc&select=' + fields,
      { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
    var sbText = await sbRes.text();
    if (!sbRes.ok) {
      console.error('[my-claims] Supabase error:', sbText.substring(0, 300));
      return res.status(500).json({ error: 'Error al consultar casos.' });
    }

    var parsed = JSON.parse(sbText);
    var claims = (Array.isArray(parsed) ? parsed : []).map(function (c) {
      var e = etapaExterna(c);
      return Object.assign({}, c, { etapa: e.etapa, etapa_label: e.label });
    });
    return res.status(200).json({ success: true, claims: claims });

  } catch (err) {
    console.error('[my-claims] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
