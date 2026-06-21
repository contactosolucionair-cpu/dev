/**
 * POST /api/analyze-document
 *
 * Receives a single document image in base64, sends to Gemini 2.5 Flash
 * for flight data extraction. Used by the individual file inputs
 * (reserva original / boarding pass) for per-document autocompletion.
 *
 * @param {string} req.body.image - Base64 encoded image
 * @param {string} req.body.mimeType - MIME type (image/jpeg, image/png, etc)
 * @returns {Object} {success, data: {aerolinea, numero_vuelo, origen, destino, fecha_vuelo, pnr}}
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

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
    if (!body || !body.image) return res.status(400).json({ error: 'No image provided' });

    var image = body.image;
    var media = body.mimeType || 'image/jpeg';

    console.log('[analyze-document] Received, length:', image.length, 'mime:', media);

    var aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OR_KEY,
        'HTTP-Referer': 'https://solucionair.com',
        'X-Title': 'SolucionAir',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Actua como un extractor de datos de pasajes y boarding pass de SolucionAir. Analiza el documento provisto y extrae exclusivamente los siguientes campos en un formato JSON limpio: { "aerolinea": "nombre de la aerolinea", "numero_vuelo": "codigo del vuelo ej AR1234", "origen": "ciudad o codigo de aeropuerto de origen", "destino": "ciudad o codigo de aeropuerto de destino", "fecha_vuelo": "fecha en formato YYYY-MM-DD", "pnr": "codigo de reserva PNR" }. Si no encuentras alguno, devolvelo como null. No agregues texto de relleno ni formato markdown. Responde SOLO el JSON.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:' + media + ';base64,' + image,
                },
              },
            ],
          },
        ],
      }),
    });

    var aiText = await aiRes.text();
    console.log('[analyze-document] OpenRouter status:', aiRes.status);

    if (!aiRes.ok) {
      console.error('[analyze-document] OpenRouter error:', aiText.substring(0, 300));
      return res.status(502).json({ error: 'AI service error' });
    }

    var aiJson;
    try { aiJson = JSON.parse(aiText); } catch (e) {
      return res.status(502).json({ error: 'AI non-JSON response' });
    }

    var raw = '';
    if (aiJson.choices && aiJson.choices[0] && aiJson.choices[0].message) {
      raw = aiJson.choices[0].message.content || '';
    }
    if (!raw) return res.status(502).json({ error: 'Empty AI response' });

    console.log('[analyze-document] AI raw:', raw.substring(0, 300));

    var parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
    } catch (e) {
      return res.status(502).json({ error: 'AI JSON parse failed', raw: raw.substring(0, 300) });
    }

    return res.status(200).json({
      success: true,
      data: {
        aerolinea: parsed.aerolinea || null,
        numero_vuelo: parsed.numero_vuelo || null,
        origen: parsed.origen || null,
        destino: parsed.destino || null,
        fecha_vuelo: parsed.fecha_vuelo || null,
        pnr: parsed.pnr || null,
      },
    });

  } catch (err) {
    console.error('[analyze-document] Fatal:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
