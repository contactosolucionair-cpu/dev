/**
 * POST /api/process-ticket — Core Claim Processing Engine
 *
 * Dual-mode serverless function that handles the complete claim lifecycle:
 *
 * Mode 1 — AI Document Extraction:
 *   Receives one or multiple base64-encoded images/PDFs, sends them to
 *   Google Gemini 2.5 Flash for unified data extraction with route-aware
 *   parsing (origin/destination/stopovers), PNR detection and expense
 *   consolidation. Returns structured JSON without database persistence.
 *
 * Mode 2 — Claim Submission:
 *   Receives validated form data, calculates predictive success percentage
 *   based on jurisdiction analysis (ANAC/EU261/DOT), persists the claim
 *   in Supabase, and dispatches notification emails via Resend.
 *
 * Feature flags are read from site_config table at runtime.
 * Success percentage is stored internally and excluded from client response.
 *
 * @param {Object[]} req.body.images - Array of {base64, mimeType} for multi-file scan
 * @param {boolean} req.body.manualSubmit - Activates claim submission mode
 * @param {string} req.body.email - Client email (required for submission)
 * @returns {Object} {success, data, refCode}
 */

import { computeClaimHash } from './_utils/signing.js';

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

    /* Fetch feature flags from site_config table (with fallback to enabled) */
    var flagAi = true;
    var flagPct = true;
    try {
      var cfgRes = await fetch(SB_URL + '/rest/v1/site_config?id=eq.global&select=feature_flags&limit=1', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      if (cfgRes.ok) {
        var cfgRows = JSON.parse(await cfgRes.text());
        if (cfgRows.length && cfgRows[0].feature_flags) {
          var ff = cfgRows[0].feature_flags;
          flagAi = ff.ai_extraction !== false;
          flagPct = ff.ai_success_pct !== false;
        }
      }
    } catch (e) { /* Flags default to true if config unavailable */ }

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
      if (OR_KEY && flagPct) {
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
            + '- Tipo de incidencia: ' + (body.tipo_incidencia || 'No especificado') + '\n'
            + '- Horas de retraso: ' + (body.horas_retraso || 'No especificado') + '\n'
            + '- Causa informada: ' + (body.causa_informada || 'No informada') + '\n'
            + '- Ofrecieron reembolso: ' + (body.ofrecimiento_aerolinea || 'No informado') + '\n\n'
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
      var ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || null;

      var row = {
        /* Identity */
        nombre:                nombre,
        telefono:              body.telefono || null,
        email:                 email,
        documento_tipo:        body.documento_tipo || null,
        documento_numero:      body.documento_numero || null,
        /* Flight */
        aerolinea:             body.aerolinea || null,
        vuelo_nro:             body.vuelo_nro || null,
        fecha_vuelo:           body.fecha_vuelo || null,
        origen:                body.origen || null,
        destino:               body.destino || null,
        pnr:                   body.pnr || null,
        /* Incident */
        tipo_reclamo:          body.tipo_reclamo || 'vuelo',
        tipo_incidencia:       body.tipo_incidencia || null,
        horas_retraso:         body.horas_retraso ? parseInt(body.horas_retraso) || null : null,
        anticipacion_aviso:    body.anticipacion_aviso || null,
        ofrecimiento_aerolinea: body.ofrecimiento_aerolinea || null,
        causa_informada:       body.causa_informada || null,
        /* Expenses (vuelo) */
        moneda_gastos:         body.moneda_gastos || null,
        monto_gastos:          body.monto_gastos ? parseFloat(body.monto_gastos) || null : null,
        gastos_detalle:        body.gastos_detalle || null,
        /* Baggage fields */
        tipo_caso_equipaje:    body.tipo_caso_equipaje    || null,
        descripcion_equipaje:  body.descripcion_equipaje  || null,
        valor_equipaje:        body.valor_equipaje ? parseFloat(body.valor_equipaje) || null : null,
        fecha_entrega_equipaje: body.fecha_entrega_equipaje || null,
        /* Google identity */
        google_sub:            body.google_sub            || null,
        google_email_verified: body.google_email_verified || null,
        google_iss:            body.google_iss            || null,
        /* Metadata */
        fecha_carga:           new Date().toISOString(),
        fuente:                'Web',
        estado:                'pendiente',
        ref_code:              refCode,
        /* Consent / electronic signature */
        consent_version:       body.consent_version || null,
        consent_tyc:           body.consent_tyc === true || body.consent_tyc === 'true' || false,
        consent_autorizacion:  body.consent_autorizacion === true || body.consent_autorizacion === 'true' || false,
        firma_fecha:           body.firma_fecha || null,
        firma_ts:              body.firma_ts || null,
        user_agent:            body.user_agent || null,
        ip_firmante:           ip,
        /* AI analysis — only internal scoring */
        ai_raw: { porcentaje_exito: porcentaje_exito },
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

      /* ---- Step 3: SHA-256 fingerprint + PDF authorization ---- */
      var claimHash = computeClaimHash({
        refCode,
        nombre,
        email,
        docTipo:       body.documento_tipo  || '',
        docNumero:     body.documento_numero || '',
        pnr:           body.pnr             || '',
        aerolinea:     body.aerolinea        || '',
        vuelo:         body.vuelo_nro        || '',
        origen:        body.origen           || '',
        destino:       body.destino          || '',
        fechaVuelo:    body.fecha_vuelo      || '',
        tipoReclamo:   body.tipo_reclamo      || 'vuelo',
        firmaFecha:    body.firma_fecha      || '',
        consentVersion: body.consent_version || '',
      });

      var pdfBuffer = null;
      var pdfUrl    = null;
      try {
        var { generateAuthorizationPdf } = await import('./_utils/pdf-receipt.js');
        pdfBuffer = await generateAuthorizationPdf({
          refCode,
          nombre,
          docTipo:       body.documento_tipo  || '',
          docNumero:     body.documento_numero || '',
          email,
          aerolinea:     body.aerolinea        || '',
          vuelo:         body.vuelo_nro        || '',
          origen:        body.origen           || '',
          destino:       body.destino          || '',
          fechaVuelo:    body.fecha_vuelo      || '',
          pnr:           body.pnr              || '',
          tipoReclamo:   body.tipo_reclamo     || 'vuelo',
          googleSub:     body.google_sub       || null,
          googleEmailVerified: body.google_email_verified || null,
          googleIss:     body.google_iss       || null,
          firmaFecha:    body.firma_fecha      || '',
          consentVersion: body.consent_version || '',
          ip:            ip,
          userAgent:     body.user_agent       || '',
          hash:          claimHash,
        });
      } catch (pdfErr) {
        console.error('[process-ticket] PDF generation error:', pdfErr.message);
      }

      if (pdfBuffer) {
        try {
          var pdfPath = refCode + '/Autorizacion_' + refCode + '.pdf';
          var storageRes = await fetch(SB_URL + '/storage/v1/object/reclamos/' + pdfPath, {
            method: 'POST',
            headers: {
              'apikey':         SB_KEY,
              'Authorization':  'Bearer ' + SB_KEY,
              'Content-Type':   'application/pdf',
              'x-upsert':       'true',
            },
            body: pdfBuffer,
          });
          if (storageRes.ok) {
            pdfUrl = SB_URL + '/storage/v1/object/public/reclamos/' + pdfPath;
            console.log('[process-ticket] PDF stored:', pdfUrl);
          } else {
            var stErr = await storageRes.text();
            console.error('[process-ticket] Storage upload failed:', storageRes.status, stErr.substring(0, 200));
          }
        } catch (storageErr) {
          console.error('[process-ticket] Storage error:', storageErr.message);
        }
      }

      /* ---- Upload scanned travel documents ---- */
      var scannedDocs = Array.isArray(body.scanned_files) ? body.scanned_files : [];
      var docUrls = [];
      for (var di = 0; di < scannedDocs.length; di++) {
        var sf = scannedDocs[di];
        try {
          var ext  = (sf.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
          var fname = 'doc_' + (di + 1) + '.' + ext;
          var sfPath = refCode + '/' + fname;
          var sfRes = await fetch(SB_URL + '/storage/v1/object/reclamos/' + sfPath, {
            method: 'POST',
            headers: {
              'apikey':        SB_KEY,
              'Authorization': 'Bearer ' + SB_KEY,
              'Content-Type':  sf.mimeType || 'image/jpeg',
              'x-upsert':      'true',
            },
            body: Buffer.from(sf.base64, 'base64'),
          });
          if (sfRes.ok) {
            docUrls.push({ tipo: 'documento_viaje', url: SB_URL + '/storage/v1/object/public/reclamos/' + sfPath, nombre: sf.name || fname });
            console.log('[process-ticket] Doc uploaded:', sfPath);
          } else {
            var sfErr = await sfRes.text();
            console.error('[process-ticket] Doc upload failed:', sfRes.status, sfErr.substring(0, 150));
          }
        } catch (sfErr) {
          console.error('[process-ticket] Doc upload error:', sfErr.message);
        }
      }

      /* Persist final adjuntos list and hash in one PATCH */
      var allAdjuntos = [];
      if (pdfUrl) allAdjuntos.push({ tipo: 'autorizacion', url: pdfUrl, nombre: 'Autorizacion_' + refCode + '.pdf' });
      allAdjuntos = allAdjuntos.concat(docUrls);
      if (allAdjuntos.length) {
        try {
          await fetch(SB_URL + '/rest/v1/reclamos?ref_code=eq.' + refCode, {
            method: 'PATCH',
            headers: {
              'Content-Type':  'application/json',
              'apikey':        SB_KEY,
              'Authorization': 'Bearer ' + SB_KEY,
            },
            body: JSON.stringify({
              adjuntos: allAdjuntos,
              ai_raw:   { porcentaje_exito: porcentaje_exito, huella_sha256: claimHash },
            }),
          });
        } catch (patchErr) {
          console.error('[process-ticket] Adjuntos PATCH error:', patchErr.message);
        }
      }

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
              subject: 'Nuevo reclamo ' + refCode + ' - ' + nombre,
              html: '<h2>Nuevo reclamo recibido</h2>'
                + '<p><strong>Referencia:</strong> ' + refCode + '</p>'
                + '<p><strong>Pasajero:</strong> ' + nombre + '</p>'
                + '<p><strong>Email del cliente:</strong> ' + email + '</p>'
                + '<p><strong>Vuelo:</strong> ' + vuelo + ' (' + aerolinea + ')</p>'
                + '<p><strong>Fecha vuelo:</strong> ' + (body.fecha_vuelo || 'N/A') + '</p>'
                + '<p><strong>Tipo:</strong> ' + (body.tipo_incidencia || 'vuelo') + '</p>'
                + (pdfUrl ? '<p><strong>Autorizacion:</strong> <a href="' + pdfUrl + '">Ver PDF</a></p>' : '')
                + '<hr/><p style="color:#888;font-size:12px">Enviado automaticamente por SolucionAir</p>',
              attachments: pdfBuffer ? [{ filename: 'Autorizacion_' + refCode + '.pdf', content: pdfBuffer.toString('base64') }] : undefined,
            }),
          });
          var internalText = await internalRes.text();
          console.log('[process-ticket] Resend internal status:', internalRes.status, internalText.substring(0, 200));
          emailsSent.internal = internalRes.ok;
        } catch (mailErr) {
          console.error('[process-ticket] Resend internal error:', mailErr.message);
        }

        /* 2. Confirmation to the client — with PDF authorization attached */
        try {
          var pdfNotice = pdfUrl
            ? '<div style="background:#E8F0EC;border-left:3px solid #2D4A3E;padding:12px 16px;margin:20px 0;border-radius:0 4px 4px 0">'
              + '<p style="margin:0;font-size:13px;color:#2D4A3E"><strong>Comprobante adjunto.</strong> El documento de autorizacion y firma electronica se adjunta a este correo. Guardalo para tus registros.</p>'
              + '</div>'
            : '';
          var clientPayload = {
            from:    senderFrom,
            to:      email,
            subject: 'SolucionAir — Reclamo ' + refCode + ' recibido',
            html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF">'
              + '<div style="background:#2D4A3E;padding:24px 28px;border-radius:8px 8px 0 0">'
              + '<h1 style="color:#D4A853;font-size:20px;margin:0;font-weight:700">SolucionAir</h1>'
              + '<p style="color:#C0D8C8;font-size:12px;margin:5px 0 0">Compensaciones por vuelos y equipaje</p>'
              + '</div>'
              + '<div style="padding:28px;border:1px solid #E0DCD4;border-top:none;border-radius:0 0 8px 8px">'
              + '<h2 style="color:#2D4A3E;font-size:18px;margin:0 0 12px">Hola ' + nombre + ',</h2>'
              + '<p style="color:#3A3A3A;font-size:14px;line-height:1.6;margin:0 0 16px">Recibimos tu reclamo y ya esta siendo revisado por nuestro equipo. A continuacion encontras el detalle y el comprobante de autorizacion firmado digitalmente.</p>'
              + pdfNotice
              + '<div style="background:#F7F5F0;border-radius:6px;padding:16px;margin:16px 0">'
              + '<p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px">Detalle del reclamo</p>'
              + '<table style="width:100%;border-collapse:collapse">'
              + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Referencia</td><td style="padding:6px 0;font-weight:700;font-size:14px;text-align:right;color:#2D4A3E">' + refCode + '</td></tr>'
              + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Vuelo</td><td style="padding:6px 0;font-size:13px;text-align:right">' + vuelo + '</td></tr>'
              + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Aerolinea</td><td style="padding:6px 0;font-size:13px;text-align:right">' + aerolinea + '</td></tr>'
              + '<tr><td style="padding:6px 0;color:#6B6B6B;font-size:13px">Estado</td><td style="padding:6px 0;font-size:13px;text-align:right;color:#D4A853;font-weight:700">Pendiente de revision</td></tr>'
              + '</table>'
              + '</div>'
              + '<p style="color:#6B6B6B;font-size:13px;line-height:1.7;margin:16px 0">Proximos pasos:<br/>'
              + '<strong>1.</strong> Revision del caso por nuestro equipo (24-48 hs habilies)<br/>'
              + '<strong>2.</strong> Comunicacion formal con la aerolinea<br/>'
              + '<strong>3.</strong> Negociacion y resolucion<br/><br/>'
              + 'Te mantendremos informado/a a este correo sobre cada avance.</p>'
              + '<p style="margin-top:20px;font-size:13px">Saludos,<br/><strong style="color:#2D4A3E">Equipo SolucionAir</strong></p>'
              + '<hr style="margin-top:24px;border:none;border-top:1px solid #E0DCD4"/>'
              + '<p style="color:#999;font-size:11px;margin-top:12px">Correo automatico. Referencia: ' + refCode + '.</p>'
              + '</div>'
              + '</div>',
          };
          if (pdfBuffer) {
            clientPayload.attachments = [{
              filename: 'Autorizacion_SolucionAir_' + refCode + '.pdf',
              content:  pdfBuffer.toString('base64'),
            }];
          }
          var clientRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': 'Bearer ' + RESEND_KEY,
            },
            body: JSON.stringify(clientPayload),
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
    if (!flagAi) return res.status(200).json({ success: true, data: {}, flagDisabled: true });
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
      text: 'Actuas como un extractor de datos de viaje ultra preciso de SolucionAir. Analiza EXHAUSTIVAMENTE cada archivo provisto arriba.\n\n'
        + 'CONTEXTO: Los documentos pueden contener un itinerario con MULTIPLES TRAMOS DE VUELO (ej: EZE→ATL→TUL ida, TUL→ATL→EZE vuelta). Tu trabajo es identificar el VUELO PRINCIPAL AFECTADO y extraer sus datos.\n\n'
        + 'REGLAS DE ITINERARIO MULTI-TRAMO:\n'
        + '- Si hay multiples vuelos, identifica cual tiene la incidencia (cancelacion, demora, etc).\n'
        + '- vuelo_nro: Devuelve UN SOLO numero de vuelo, el del tramo afectado o el primer tramo de ida. NUNCA concatenes multiples numeros separados por comas. Ejemplo correcto: "DL 110". Ejemplo INCORRECTO: "110, 2754, 5164".\n'
        + '- origen: El aeropuerto donde COMIENZA el viaje de ida. Formato: "EZE - Buenos Aires". Si el boleto dice "Buenos Aires" como ciudad de salida, el codigo IATA es EZE.\n'
        + '- destino: El aeropuerto de LLEGADA FINAL del ultimo tramo de ida (NO el de vuelta). Si el viaje es EZE→ATL→TUL, el destino es "TUL - Tulsa". NUNCA devuelvas el mismo aeropuerto que el origen.\n'
        + '- escalas: Aeropuertos intermedios. Ej: "ATL - Atlanta".\n\n'
        + 'NOMBRE: Nombre completo del pasajero con apellidos y sufijos (Sr, Jr).\n\n'
        + 'EMAIL: Busca en TODOS los documentos (confirmaciones, recibos, facturas, itinerarios, headers, datos de cuenta). Devolvelo en minusculas. Si no aparece en ninguna imagen, devuelve "".\n\n'
        + 'TELEFONO: Solo numeros de telefono reales del pasajero visibles en los documentos. Si no hay, devuelve "".\n\n'
        + 'DOCUMENTO: Solo DNI o Pasaporte real. NO Tax ID, CUIT, CUIL, AFIP, frequent flyer ni tarjetas de credito. Si no hay, devuelve "".\n\n'
        + 'PNR: Exactamente 6 caracteres alfanumericos (ej: "GFE6IH"). NO codigos de impuestos. Si no hay, devuelve "".\n\n'
        + 'TICKET: Secuencia de 10-13 digitos precedida por "Ticket" o "eTicket".\n\n'
        + 'GASTOS: Suma importes visibles ("Charges", "Total Fare"). Indica moneda.\n\n'
        + 'INCIDENCIA: Si algun documento muestra "Cancelled", "Delayed", "Overbooked", devuelve el tipo correspondiente: "cancelacion", "demora" o "overbooking".\n\n'
        + 'REGLA ANTI-FABRICACION: NUNCA inventes datos. Si un campo no aparece visiblemente, devuelve "". NUNCA devuelvas "null", "N/A" ni "unknown".\n\n'
        + 'JSON OBLIGATORIO (sin markdown, sin backticks):\n'
        + '{ "nombre": "", "email": "", "telefono": "", "doc_numero": "", "aerolinea": "", "vuelo_nro": "", "numero_ticket": "", "pnr": "", "origen": "", "destino": "", "escalas": "", "fecha_vuelo": "", "incidencia_detectada": "", "gastos_monto": "", "gastos_moneda": "" }\n\n'
        + 'Rellena SOLO campos confirmados visualmente. Responde SOLO el JSON.',
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

    /* If vuelo_nro has commas (AI concatenated multiple flights), take only the first */
    var rawFlight = clean(parsed.vuelo_nro);
    if (rawFlight.indexOf(',') > -1) rawFlight = rawFlight.split(',')[0].trim();

    /* If origen and destino are the same, clear destino so user fills manually */
    var rawOrigen = clean(parsed.origen);
    var rawDestino = clean(parsed.destino);
    if (rawOrigen && rawDestino && rawOrigen.substring(0, 3).toUpperCase() === rawDestino.substring(0, 3).toUpperCase()) rawDestino = '';

    var data = {
      nombre: clean(parsed.nombre),
      email: clean(parsed.email).toLowerCase(),
      telefono: clean(parsed.telefono),
      doc_numero: clean(parsed.doc_numero),
      aerolinea: clean(parsed.aerolinea),
      vuelo_nro: rawFlight,
      numero_ticket: clean(parsed.numero_ticket),
      pnr: clean(parsed.pnr),
      origen: rawOrigen,
      destino: rawDestino,
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
