/**
 * notify-agencia.js — Notificación por email a la agencia cuando cambia la
 * etapa de uno de sus casos (B2B).
 *
 * Patrón Resend existente en el repo (envío desde el dominio verificado
 * no-reply@solucionair.com). Es best-effort: si falta RESEND_API_KEY o el caso
 * no es de una agencia, loguea y sigue. El llamador la envuelve en try/catch
 * para que NUNCA rompa la respuesta principal del endpoint.
 *
 * @param {string} SB_URL
 * @param {string} SB_KEY  service role key
 * @param {Object} caso    debe traer agencia_id, ref_code e instancia/momento/resultado
 */
import { etapaExterna } from './instancias.js';

export async function notificarCambioEtapa(SB_URL, SB_KEY, caso) {
  if (!caso || !caso.agencia_id) {
    console.log('[notify-agencia] Caso sin agencia_id: no se notifica.');
    return { sent: false, reason: 'no_agencia' };
  }

  var RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.log('[notify-agencia] RESEND_API_KEY no configurado: se omite el envío.');
    return { sent: false, reason: 'no_resend_key' };
  }

  /* Email de la agencia */
  var agRes = await fetch(SB_URL + '/rest/v1/agencias?id=eq.' + caso.agencia_id + '&select=email,nombre&limit=1', {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
  });
  var agRows;
  try { agRows = JSON.parse(await agRes.text()); } catch (e) { agRows = []; }
  var agencia = (agRows && agRows.length) ? agRows[0] : null;
  if (!agencia || !agencia.email) {
    console.log('[notify-agencia] Agencia sin email: no se notifica.');
    return { sent: false, reason: 'no_email' };
  }

  var etapa = etapaExterna(caso);
  var ref = caso.ref_code || 'tu caso';

  var mailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
    body: JSON.stringify({
      from: 'SolucionAir <no-reply@solucionair.com>',
      to: agencia.email,
      subject: 'SolucionAir — Caso ' + ref + ': ' + etapa.label,
      html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF">'
        + '<div style="background:#2D4A3E;padding:24px 28px;border-radius:8px 8px 0 0">'
        + '<h1 style="color:#D4A853;font-size:20px;margin:0;font-weight:700">SolucionAir</h1>'
        + '<p style="color:#C0D8C8;font-size:12px;margin:5px 0 0">Portal de agencias</p></div>'
        + '<div style="padding:28px;border:1px solid #E0DCD4;border-top:none;border-radius:0 0 8px 8px">'
        + '<p style="color:#3A3A3A;font-size:14px;line-height:1.6;margin:0 0 16px">Hola ' + (agencia.nombre || '') + ',</p>'
        + '<p style="color:#3A3A3A;font-size:14px;line-height:1.6;margin:0 0 16px">Tu caso <strong>' + ref + '</strong> pasó a: <strong style="color:#2D4A3E">' + etapa.label + '</strong>.</p>'
        + '<p style="color:#3A3A3A;font-size:14px;line-height:1.6;margin:0 0 16px">Podés ver el detalle en tu panel de agencia.</p>'
        + '<p style="margin-top:20px;font-size:13px">Saludos,<br/><strong style="color:#2D4A3E">Equipo SolucionAir</strong></p>'
        + '<hr style="margin-top:24px;border:none;border-top:1px solid #E0DCD4"/>'
        + '<p style="color:#999;font-size:11px;margin-top:12px">Correo automático. Referencia: ' + ref + '.</p>'
        + '</div></div>',
    }),
  });
  var ok = mailRes.ok;
  if (!ok) console.error('[notify-agencia] Resend error:', (await mailRes.text()).substring(0, 200));
  return { sent: ok };
}
