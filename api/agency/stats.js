/**
 * GET /api/agency/stats
 *
 * KPIs de la agencia: total de casos, desglose por estado,
 * tasa de éxito y comisión estimada sobre casos con compensación.
 *
 * @returns {Object} {success, total, por_estado, tasa_exito, comision_estimada}
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

    console.log('[agency/stats] Stats para agencia:', agencia.id);

    var sbRes = await fetch(
      SB_URL + '/rest/v1/reclamos?agencia_id=eq.' + agencia.id + '&deleted_at=is.null&select=estado,monto_compensacion',
      {
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
        },
      }
    );

    var sbText = await sbRes.text();
    if (!sbRes.ok) {
      console.error('[agency/stats] Supabase error:', sbText.substring(0, 300));
      return res.status(500).json({ error: 'Error al consultar estadísticas.' });
    }

    var claims = JSON.parse(sbText) || [];
    var total  = claims.length;

    /* Desglose por estado */
    var por_estado = {};
    claims.forEach(function (c) {
      var e = c.estado || 'pendiente';
      por_estado[e] = (por_estado[e] || 0) + 1;
    });

    /* Tasa de éxito: (aprobado + resuelto) / total */
    var exitosos = (por_estado['aprobado'] || 0) + (por_estado['resuelto'] || 0);
    var tasa_exito = total > 0 ? Math.round((exitosos / total) * 100) : null;

    /* Comisión estimada: casos resueltos con monto_compensacion */
    var comision_pct = parseFloat(agencia.comision_pct) || 10;
    var comision_estimada = null;
    claims.forEach(function (c) {
      if ((c.estado === 'aprobado' || c.estado === 'resuelto') && c.monto_compensacion) {
        if (comision_estimada === null) comision_estimada = 0;
        comision_estimada += parseFloat(c.monto_compensacion) * (comision_pct / 100);
      }
    });
    if (comision_estimada !== null) comision_estimada = Math.round(comision_estimada * 100) / 100;

    return res.status(200).json({
      success:           true,
      total:             total,
      por_estado:        por_estado,
      tasa_exito:        tasa_exito,
      comision_estimada: comision_estimada,
    });

  } catch (err) {
    console.error('[agency/stats] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
