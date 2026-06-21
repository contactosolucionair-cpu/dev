/**
 * POST /api/process-ticket
 *
 * Handles two flows:
 * 1. AI Scan (multiFile/image): Receives base64 images, sends to Gemini 2.5 Flash
 *    for unified data extraction. Returns extracted fields without DB insert.
 * 2. Manual Submit (manualSubmit): Receives form data, calculates AI success %,
 *    inserts into Supabase, sends notification emails via Resend.
 *
 * @param {Object} req.body.images - Array of {base64, mimeType} for multi-file scan
 * @param {string} req.body.image - Single base64 image (legacy compat)
 * @param {boolean} req.body.manualSubmit - True for final form submission
 * @param {string} req.body.email - User email (required for manualSubmit)
 * @returns {Object} {success, data, refCode} or error
 *
 * Environment: OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
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
  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!OR_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase credentials not configured' });

  try {
    var body = req.body;
    if (!body) return res.status(400).json({ error: 'No body provided' });

    var email = (body.email || '').trim();

    /* ---- Manual submit (no image, form data only) ---- */
    if (body.manualSubmit) {
      if (!email) return res.status(400).json({ error: 'Email is required for final submission.' });

      console.log('[process-ticket] Manual submit, email:', email);

      /* Generate correlative CSA code */
      var caseNum = Date.now() % 100000;
      var refCode = 'CSA' + String(caseNum).padStart(5, '0');
      var nombre = body.nombre || 'Sin nombre';

      /* ---- Step 1: Calculate AI success percentage (hidden from user) ---- */
      var porcentaje_exito = null;
      var OR_KEY = process.env.OPENROUTER_API_KEY;
      if (OR_KEY) {
        try {
          var aiPrompt = 'Sos un analista legal de SolucionAir especializado en reclamos aereos. '
            + 'Evalua el siguiente caso y devolvé UNICAMENTE un numero entero de 0 a 100 representando el porcentaje de exito estimado. '
            + 'Reglas estrictas de jurisdiccion:\n'
            + '- ARGENTINA (ANAC/Decreto 1476/98): Compensacion por demora se gatilla a partir de 4 horas. Cancelaciones sin aviso y overbooking en vuelos nacionales/regionales: 85-95%. Causa meteorologica comprobable: 0%.\n'
            + '- EUROPA (EU261): Demoras +3hs o cancelaciones en vuelos desde UE o con aerolinea europea: 90-100% por multas automaticas.\n'
            + '- EEUU (DOT): Vuelos internos sin compensacion obligatoria por demora simple (bajo). Overbooking o cancelacion sin reembolso: 60-80%.\n'
            + '- Pondera segun el comportamiento historico de la aerolinea en mediaciones (Aerolineas Argentinas, Flybondi, JetSmart, LATAM, Iberia, etc).\n\n'
            + 'Datos del caso:\n'
            + '- Aerolinea: ' + (body.aerolinea || 'No especificada') + '\n'
            + '- Vuelo: ' + (body.vuelo_nro || 'N/A') + '\n'
            + '- Origen: ' + (body.origen || 'N/A') + '\n'
            + '- Destino: ' + (body.destino || 'N/A') + '\n'
            + '- Tipo de incidencia: ' + (body.tipo_incidente || 'No especificado') + '\n'
            + '- Horas de retraso: ' + (body.delay_hours || 'No especificado') + '\n'
            + '- Causa informada: ' + (body.causa || 'No informada') + '\n'
            + '- Ofrecieron reembolso: ' + (body.reembolso || 'No informado') + '\n\n'
            + 'Responde SOLO el numero (ej: 85). Sin texto, sin %, sin explicacion.';

          var aiCalcRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + OR_KEY,
              'HTTP-Referer': 'https://solucionair.com',
              'X-Title': 'SolucionAir',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              max_tokens: 10,
              messages: [{ role: 'user', content: aiPrompt }],
            }),
          });

          if (aiCalcRes.ok) {
            var aiCalcJson = JSON.parse(await aiCalcRes.text());
            var rawNum = (aiCalcJson.choices && aiCalcJson.choices[0] && aiCalcJson.choices[0].message) ? aiCalcJson.choices[0].message.content.trim() : '';
            var parsed = parseInt(rawNum.replace(/[^0-9]/g, ''));
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
              porcentaje_exito = parsed;
              console.log('[process-ticket] AI success %:', porcentaje_exito);
            }
          }
        } catch (aiErr) {
          console.error('[process-ticket] AI success calc error:', aiErr.message);
        }
      }

      /* Fallback: if AI didn't return a value, default to 50 */
      if (porcentaje_exito === null) {
        porcentaje_exito = 50;
        console.log('[process-ticket] AI % fallback to default:', porcentaje_exito);
      }

      /* ---- Step 2: Insert reclamo ---- */
      /* Core columns (guaranteed to exist in the original schema) */
      var row = {
        nombre: nombre,
        telefono: body.telefono || null,
        email: email,
        aerolinea: body.aerolinea || null,
        vuelo_nro: body.vuelo_nro || null,
        fecha_vuelo: body.fecha_vuelo || null,
        tipo_reclamo: body.tipo_incidente || 'vuelo',
        estado: 'pendiente',
        ref_code: refCode,
        ai_raw: {
          doc_tipo: body.doc_tipo || null,
          doc_numero: body.doc_numero || null,
          origen: body.origen || null,
          destino: body.destino || null,
          pnr: body.pnr || null,
          incidencia: body.tipo_incidente || null,
          delay_hours: body.delay_hours || null,
          notificacion: body.notificacion || null,
          reembolso: body.reembolso || null,
          causa: body.causa || null,
          moneda: body.moneda || null,
          gastos_monto: body.gastos_monto || null,
          gastos_detalle: body.gastos_detalle || null,
          porcentaje_exito: porcentaje_exito,
        },
      };

      console.log('[process-ticket] Inserting row with ref:', refCode, 'email:', email);

      var manualRes = await fetch(SB_URL + '/rest/v1/reclamos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(row),
      });

      var manualText = await manualRes.text();
      console.log('[process-ticket] Supabase status:', manualRes.status);

      if (!manualRes.ok) {
        console.error('[process-ticket] Supabase INSERT FAILED:', manualText.substring(0, 500));
        /* Return success anyway with the data so frontend doesn't hang */
        return res.status(200).json({ success: true, refCode: refCode, dbError: true });
      }

      var manualRecord = null;
      try { var p = JSON.parse(manualText); manualRecord = Array.isArray(p) ? p[0] : p; } catch(e) { console.error('[process-ticket] Parse error:', e.message); }

      /* ---- Send emails via Resend ---- */
      var RESEND_KEY = process.env.RESEND_API_KEY;
      var emailsSent = { internal: false, client: false };

      if (RESEND_KEY) {
        var senderFrom = 'SolucionAir <onboarding@resend.dev>';
        var vuelo = body.vuelo_nro || 'N/A';
        var aerolinea = body.aerolinea || 'N/A';
        var panelUrl = 'https://solucionair-web-seven.vercel.app/backoffice';

        /* 1. Internal alert to contacto.solucionair@gmail.com */
        try {
          var internalRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + RESEND_KEY,
            },
            body: JSON.stringify({
              from: senderFrom,
              to: 'contacto.solucionair@gmail.com',
              subject: 'Nuevo reclamo ' + refCode + ' — ' + nombre,
              html: '<h2>Nuevo reclamo recibido</h2>'
                + '<p><strong>Referencia:</strong> ' + refCode + '</p>'
                + '<p><strong>Pasajero:</strong> ' + nombre + '</p>'
                + '<p><strong>Email del cliente:</strong> ' + email + '</p>'
                + '<p><strong>Vuelo:</strong> ' + vuelo + ' (' + aerolinea + ')</p>'
                + '<p><strong>Fecha vuelo:</strong> ' + (body.fecha_vuelo || 'N/A') + '</p>'
                + '<p><strong>Tipo:</strong> ' + (body.tipo_incidente || 'vuelo') + '</p>'
                + '<hr/><p style="color:#888;font-size:12px">Enviado automaticamente por SolucionAir</p>',
            }),
          });
          var internalText = await internalRes.text();
          console.log('[process-ticket] Resend internal status:', internalRes.status, internalText.substring(0, 200));
          emailsSent.internal = internalRes.ok;
        } catch (mailErr) {
          console.error('[process-ticket] Resend internal error:', mailErr.message);
        }

        /* 2. Confirmation to the client */
        try {
          var clientRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + RESEND_KEY,
            },
            body: JSON.stringify({
              from: senderFrom,
              to: email,
              subject: 'Bienvenido a SolucionAir — Reclamo ' + refCode + ' en proceso',
              html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF">'
                + '<div style="background:#2D4A3E;padding:24px 28px;border-radius:8px 8px 0 0">'
                + '<h1 style="color:#D4A853;font-size:20px;margin:0;font-weight:700">SolucionAir</h1>'
                + '</div>'
                + '<div style="padding:28px;border:1px solid #E0DCD4;border-top:none;border-radius:0 0 8px 8px">'
                + '<h2 style="color:#2D4A3E;font-size:18px;margin:0 0 12px">Hola ' + nombre + ',</h2>'
                + '<p style="color:#3A3A3A;font-size:14px;line-height:1.6;margin:0 0 16px">Tu cuenta fue creada con exito y tu reclamo ya esta siendo procesado por nuestro equipo legal y nuestra IA.</p>'
                + '<div style="background:#F7F5F0;border-radius:6px;padding:16px;margin:16px 0">'
                + '<p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px">Datos de tu cuenta</p>'
                + '<table style="width:100%;border-collapse:collapse">'
                + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Usuario</td><td style="padding:6px 0;font-weight:600;font-size:13px;text-align:right">' + email + '</td></tr>'
                + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Contrasena</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#6B6B6B">La que elegiste al registrarte</td></tr>'
                + '</table>'
                + '</div>'
                + '<div style="background:#F7F5F0;border-radius:6px;padding:16px;margin:16px 0">'
                + '<p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px">Detalle del reclamo</p>'
                + '<table style="width:100%;border-collapse:collapse">'
                + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Referencia</td><td style="padding:6px 0;font-weight:700;font-size:13px;text-align:right;color:#2D4A3E">' + refCode + '</td></tr>'
                + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Vuelo</td><td style="padding:6px 0;font-size:13px;text-align:right">' + vuelo + '</td></tr>'
                + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Aerolinea</td><td style="padding:6px 0;font-size:13px;text-align:right">' + aerolinea + '</td></tr>'
                + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Estado</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#D4A853;font-weight:700">Pendiente de revision</td></tr>'
                + '</table>'
                + '</div>'
                + '<div style="text-align:center;margin:24px 0">'
                + '<a href="' + panelUrl + '" style="display:inline-block;background:#2D4A3E;color:#FFFFFF;padding:12px 28px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none">Ver Estado de mi Reclamo</a>'
                + '</div>'
                + '<p style="color:#6B6B6B;font-size:13px;line-height:1.6;margin:16px 0 0">Te mantendremos informado sobre el progreso de tu caso a este correo.</p>'
                + '<p style="margin-top:20px;font-size:13px">Saludos,<br/><strong style="color:#2D4A3E">Equipo Legal — SolucionAir</strong></p>'
                + '<hr style="margin-top:24px;border:none;border-top:1px solid #E0DCD4"/>'
                + '<p style="color:#999;font-size:11px;margin-top:12px">Este es un correo automatico enviado por SolucionAir.</p>'
                + '</div>'
                + '</div>',
            }),
          });
          var clientText = await clientRes.text();
          console.log('[process-ticket] Resend client status:', clientRes.status, clientText.substring(0, 200));
          emailsSent.client = clientRes.ok;
        } catch (mailErr) {
          console.error('[process-ticket] Resend client error:', mailErr.message);
        }
      } else {
        console.log('[process-ticket] RESEND_API_KEY not set, skipping emails');
      }

      /* porcentaje_exito is intentionally EXCLUDED from the response — internal use only */
      return res.status(200).json({ success: true, refCode: refCode, record: manualRecord ? { id: manualRecord.id, ref_code: manualRecord.ref_code } : null, emailsSent: emailsSent });
    }

    /* ---- AI scan flow (single or multi-file) ---- */
    var images = body.images || [];
    if (body.image) images = [{ base64: body.image, mimeType: body.mimeType || 'image/jpeg' }];
    if (!images.length) return res.status(400).json({ error: 'No images provided' });

    console.log('[process-ticket] AI scan, files:', images.length);

    /* Build content array: ALL images first, then the prompt */
    var contentParts = [];
    images.forEach(function (img) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: 'data:' + (img.mimeType || 'image/jpeg') + ';base64,' + img.base64 },
      });
    });
    contentParts.push({
      type: 'text',
      text: 'Actuas como un extractor de datos de viaje ultra preciso de SolucionAir. Analiza en conjunto TODOS los archivos provistos arriba. Tu objetivo es armar un unico rompecabezas con la informacion dispersa en los distintos documentos.\n\n'
        + 'INSTRUCCIONES ESTRICTAS DE EXTRACCION:\n\n'
        + 'CODIGO DE RESERVA (PNR): Busca combinaciones de exactamente 6 caracteres alfanumericos (letras mayusculas y numeros) tipicos de aerolineas, como "GFE6IH" o "ABC123". NO confundas con codigos de tasas de impuestos (XR, AR, QO, YR) ni con codigos de aeropuerto. Si no encontras un PNR claro, devuelve "".\n\n'
        + 'NUMERO DE TICKET: Busca secuencias numericas largas de 10-13 digitos (ej: "0062433887909"). Suelen estar precedidas por la palabra "Ticket" o "eTicket".\n\n'
        + 'ORIGEN Y DESTINO: Analiza la secuencia completa de vuelos en el itinerario. El ORIGEN es el aeropuerto del PRIMER despegue del viaje (ej: EZE Buenos Aires). El DESTINO es el aeropuerto de LLEGADA FINAL del ultimo tramo (ej: TUL Tulsa). NUNCA repitas el mismo aeropuerto en ambos campos si el boleto muestra una ruta con escalas. Si hay escalas intermedias (ej: ATL Atlanta), ponelas en el campo "escalas".\n\n'
        + 'NUMERO DE DOCUMENTO: Extrae UNICAMENTE el numero de DNI o Pasaporte del pasajero. NO confundas con Tax ID, CUIT, CUIL, datos de AFIP, Tax Address ni numeros fiscales. Si no ves un documento de identidad real, devuelve "".\n\n'
        + 'GASTOS: Suma los importes de "Charges", "Total Fare", tarifas o montos monetarios visibles. Indica la moneda.\n\n'
        + 'INCIDENCIA: Detecta alertas como "Cancelacion", "Flight Cancelled", "Delayed", "Overbooked" para pre-seleccionar el tipo.\n\n'
        + 'EMAIL: Siempre en minusculas. Si no aparece un email real del pasajero, devuelve "".\n\n'
        + 'TELEFONO: Solo si aparece un numero de telefono real del pasajero. Si no, devuelve "".\n\n'
        + 'REGLA ANTI-NULL CRITICA: NUNCA devuelvas la palabra "null" como string. Si un dato no se encuentra, devuelve un string vacio "". Si un campo aparece en una imagen y en otra no, MANTEN el dato y combinalos.\n\n'
        + 'Devuelve OBLIGATORIAMENTE un unico objeto JSON con esta estructura exacta, sin markdown, sin backticks, sin texto extra:\n'
        + '{ "nombre": "...", "email": "", "telefono": "", "doc_numero": "", "aerolinea": "...", "vuelo_nro": "codigo del vuelo del primer tramo", "numero_ticket": "", "pnr": "", "origen": "codigo IATA - ciudad de primer despegue", "destino": "codigo IATA - ciudad de llegada final", "escalas": "", "fecha_vuelo": "YYYY-MM-DD", "incidencia_detectada": "", "gastos_monto": "", "gastos_moneda": "" }\n\n'
        + 'Responde SOLO el JSON.',
    });

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
        max_tokens: 1024,
        messages: [{ role: 'user', content: contentParts }],
      }),
    });

    var aiText = await aiRes.text();
    console.log('[process-ticket] OpenRouter status:', aiRes.status);

    if (!aiRes.ok) {
      console.error('[process-ticket] OpenRouter error:', aiText.substring(0, 400));
      return res.status(502).json({ error: 'AI service error', status: aiRes.status });
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

    console.log('[process-ticket] AI raw:', raw.substring(0, 400));

    var parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
    } catch (e) {
      return res.status(502).json({ error: 'AI JSON parse failed', raw: raw.substring(0, 300) });
    }

    /* Sanitize: strip "null"/"undefined" strings, trim whitespace */
    function clean(v) {
      if (v === null || v === undefined) return '';
      var s = String(v).trim();
      if (s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' || s === 'N/A' || s === 'n/a') return '';
      return s;
    }

    var data = {
      nombre: clean(parsed.nombre),
      email: clean(parsed.email).toLowerCase(),
      telefono: clean(parsed.telefono),
      doc_numero: clean(parsed.doc_numero),
      aerolinea: clean(parsed.aerolinea),
      vuelo_nro: clean(parsed.vuelo_nro),
      numero_ticket: clean(parsed.numero_ticket),
      pnr: clean(parsed.pnr),
      origen: clean(parsed.origen),
      destino: clean(parsed.destino),
      escalas: clean(parsed.escalas),
      fecha_vuelo: clean(parsed.fecha_vuelo),
      incidencia_detectada: clean(parsed.incidencia_detectada),
      gastos_monto: clean(parsed.gastos_monto),
      gastos_moneda: clean(parsed.gastos_moneda),
    };

    console.log('[process-ticket] AI scan done (' + images.length + ' files), returning data only');

    return res.status(200).json({ success: true, data: data });

  } catch (err) {
    console.error('[process-ticket] Fatal:', err.message);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
