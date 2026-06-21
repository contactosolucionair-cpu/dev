/**
 * POST /api/generate-reply
 *
 * Two modes:
 * 1. Generate full reply: Creates a formal SolucionAir email based on claim data.
 * 2. Optimize draft (action: "optimize"): Rewrites an informal draft into a
 *    professional response maintaining the original intent.
 *
 * @param {string} req.body.action - "optimize" for draft optimization mode
 * @param {string} req.body.text - Informal draft text (optimize mode)
 * @param {string} req.body.nombre - Passenger name
 * @param {string} req.body.ref_code - Claim reference code
 * @returns {Object} {success, reply: string}
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

  try {
    var body = req.body;

    /* ---- OPTIMIZE DRAFT ---- */
    if (body.action === 'optimize' && body.text) {
      console.log('[generate-reply] Optimize draft, length:', body.text.length);
      var optimizePrompt = 'Sos un agente de soporte senior de SolucionAir, una plataforma LegalTech de reclamos aereos. '
        + 'El operador escribio el siguiente borrador informal para responderle a un cliente'
        + (body.nombre ? ' llamado ' + body.nombre : '') + (body.ref_code ? ' (reclamo ' + body.ref_code + ')' : '') + ':\n\n'
        + '"""' + body.text + '"""\n\n'
        + 'Reescribi ese borrador como un correo electronico formal, empatico y profesional de SolucionAir. '
        + 'Manten la intencion y los datos del borrador original pero mejora la redaccion, el tono y la estructura. '
        + 'Firma como "Equipo Legal — SolucionAir". Escribe solo el cuerpo del correo, sin asunto.';

      var optRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OR_KEY, 'HTTP-Referer': 'https://solucionair.com', 'X-Title': 'SolucionAir Backoffice' },
        body: JSON.stringify({ model: 'google/gemini-2.5-flash', max_tokens: 800, messages: [{ role: 'user', content: optimizePrompt }] }),
      });
      var optText = await optRes.text();
      if (!optRes.ok) return res.status(502).json({ error: 'AI error' });
      var optJson = JSON.parse(optText);
      var optReply = (optJson.choices && optJson.choices[0] && optJson.choices[0].message) ? optJson.choices[0].message.content || '' : '';
      if (!optReply) return res.status(502).json({ error: 'Empty AI response' });
      console.log('[generate-reply] Optimized, length:', optReply.length);
      return res.status(200).json({ success: true, reply: optReply });
    }

    /* ---- GENERATE FULL REPLY ---- */
    var nombre = body.nombre || 'Pasajero';
    var aerolinea = body.aerolinea || 'la aerolinea';
    var vuelo_nro = body.vuelo_nro || 'N/A';
    var estado = body.estado || 'pendiente';
    var ref_code = body.ref_code || '';

    var estadoTexto = estado === 'aprobado' || estado === 'resuelto'
      ? 'aprobado y en proceso de compensacion'
      : estado === 'rechazado'
        ? 'rechazado por falta de evidencia suficiente'
        : 'en revision por nuestro equipo legal';

    var prompt = 'Actua como un agente de soporte senior de SolucionAir, una plataforma LegalTech de reclamos aereos. '
      + 'Escribe un correo electronico formal, empatico y ultra profesional dirigido al pasajero ' + nombre + ', '
      + 'informandole que su reclamo con referencia ' + ref_code + ' por el vuelo ' + vuelo_nro + ' de ' + aerolinea
      + ' se encuentra actualmente ' + estadoTexto + '. '
      + 'Usa un tono resolutivo y profesional. No inventes datos adicionales. '
      + 'Firma como "Equipo Legal — SolucionAir". '
      + 'Escribe solo el cuerpo del correo, sin asunto.';

    var aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OR_KEY,
        'HTTP-Referer': 'https://solucionair.com',
        'X-Title': 'SolucionAir Backoffice',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content: 'Sos un agente de soporte legal senior de SolucionAir. Escribis correos formales, empaticos y profesionales en espanol.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    var aiText = await aiRes.text();
    console.log('[generate-reply] OpenRouter status:', aiRes.status);

    if (!aiRes.ok) {
      console.error('[generate-reply] OpenRouter error:', aiText.substring(0, 300));
      return res.status(502).json({ error: 'AI service error' });
    }

    var aiJson;
    try { aiJson = JSON.parse(aiText); } catch (e) {
      return res.status(502).json({ error: 'AI non-JSON response' });
    }

    var reply = '';
    if (aiJson.choices && aiJson.choices[0] && aiJson.choices[0].message) {
      reply = aiJson.choices[0].message.content || '';
    }

    if (!reply) {
      return res.status(502).json({ error: 'Empty AI response' });
    }

    console.log('[generate-reply] Generated reply for', ref_code, '- length:', reply.length);

    return res.status(200).json({ success: true, reply: reply });

  } catch (err) {
    console.error('[generate-reply] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
