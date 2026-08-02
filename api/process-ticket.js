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
 *   Intake v2: devuelve además el itinerario tramo por tramo en `segmentos`
 *   (con `direccion: ida|vuelta`) y `direccion_afectada_sugerida`. Las claves
 *   viejas siguen todas, con el mismo nombre y formato; su semántica pasa a ser
 *   "de la dirección afectada sugerida, o de la ida si no hay sugerencia".
 *
 * Mode 2 — Claim Submission:
 *   Receives validated form data, persists the claim in Supabase, generates
 *   the signed authorization PDF (SHA-256 fingerprinted) and dispatches
 *   notification emails via Resend.
 *
 * The ai_extraction feature flag is read from site_config table at runtime.
 *
 * @param {Object[]} req.body.images - Array of {base64, mimeType} for multi-file scan
 * @param {boolean} req.body.manualSubmit - Activates claim submission mode
 * @param {string} req.body.email - Client email (required for submission)
 * @returns {Object} {success, data, refCode}
 */

import { computeClaimHash } from './_utils/signing.js';
/* Helpers puros del intake, compartidos con `api/agency.js`. `iata3` sanea sin
   bloquear: si no es un código de 3 letras devuelve null y el alta sigue igual — la
   columna en null es exactamente lo que el motor legal lee como FALTA_DATO. */
import {
  limpiarTexto, iata3, sanearSegmentosIa, normalizarDireccionSugerida,
  sanearSegmentosCanonicos, extremosDireccionAfectada, derivarIncidentes,
  candidatosItinerario,
} from './_utils/intake.js';
import {
  sanitizeRuta, sanitizeSegmentos, seguirSugerencia, segmentosCanonicosAmbiguos,
} from './_utils/itinerario.js';
import { leerFlagsPublicos } from './_utils/config-publica.js';
import { aplicarGastos } from './_utils/gastos.js';

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

    /* Feature flags desde site_config (default: prendido). Mismo lector que sirve
       /api/public-config al navegador, así el front y este backstop nunca discrepan. */
    var flagAi = (await leerFlagsPublicos(SB_URL, SB_KEY)).ai_extraction;

    var email = (body.email || '').trim();

    /* ---- Manual submit (no image, form data only) ---- */
    if (body.manualSubmit) {
      if (!email) return res.status(400).json({ error: 'Email is required for final submission.' });

      console.log('[process-ticket] Manual submit, email:', email);

      /* Generate correlative CSA code */
      var caseNum = Date.now() % 100000;
      var refCode = 'CSA' + String(caseNum).padStart(5, '0');
      var nombre = body.nombre || 'Sin nombre';

      /* ---- Step 1: Insert reclamo ---- */
      var ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || null;

      /* ---- Intake v2: columnas del contrato del motor legal (Capa 1) ----
         `segmentos` viene con la dirección afectada ya resuelta por el formulario y el
         tramo del incidente marcado. De ahí salen `origen_iata`/`destino_iata`, que
         son los extremos de ESA dirección (enmienda legal v2.1.2), no los del billete.
         Si el formulario no pudo armar la ruta, la lista queda vacía y mandan los
         campos sueltos de siempre: una columna en null es FALTA_DATO, que es honesto. */
      var segmentosAlta = sanearSegmentosCanonicos(body.segmentos);
      var extremos = extremosDireccionAfectada(segmentosAlta);
      /* Campo CRÍTICO (Tabla A fila 6): sin esto todo caso nuevo nacía con `[]` y el
         motor lo leía como FALTA_DATO. Se deriva de lo que eligió el pasajero. */
      var incidentesAlta = derivarIncidentes(body.tipo_reclamo, body.tipo_incidencia, body.tipo_caso_equipaje);
      var ahoraIso = new Date().toISOString();
      var candidatosAlta = candidatosItinerario(segmentosAlta, body.itinerario_fuente, ahoraIso);
      /* `tipo_viaje` no tiene columna y este ciclo no toca el schema, así que viaja como
         evidencia declarativa: le dice al backoffice si el billete era redondo, que es
         justo lo que hay que saber para dudar del par origen/destino. */
      if (body.tipo_viaje === 'solo_ida' || body.tipo_viaje === 'ida_vuelta') {
        candidatosAlta.push({ campo: 'tipo_viaje', valor: body.tipo_viaje, fuente: 'declaracion_pasajero', extraido_en: ahoraIso });
      }
      /* Cuál de las dos direcciones del billete redondo describen `segmentos`. Sin esto,
         `tipo_viaje: 'ida_vuelta'` deja al backoffice sabiendo que falta una dirección
         pero no cuál está mirando. Mismo tratamiento que arriba: evidencia declarativa,
         sin columna propia hasta que un ciclo toque el schema. */
      if (body.direccion_afectada === 'ida' || body.direccion_afectada === 'vuelta') {
        candidatosAlta.push({ campo: 'direccion_afectada', valor: body.direccion_afectada, fuente: 'declaracion_pasajero', extraido_en: ahoraIso });
      }
      /* Los tramos canónicos describen UNA dirección, la afectada. Si acá se detecta un
         corte, llegó un itinerario que no debería: se persiste igual (no se inventa ni
         se borra nada) pero queda el rastro, porque lo que manda el cliente es editable
         y la base no puede depender de que el front se porte bien. Solo se escribe
         cuando hay anomalía: un `false` en cada caso sano ensuciaría el JSONB. */
      if (segmentosCanonicosAmbiguos(segmentosAlta)) {
        candidatosAlta.push({ campo: 'segmentos_ambiguos', valor: true, fuente: body.itinerario_fuente === 'adjunto' ? 'adjunto' : 'declaracion_pasajero', extraido_en: ahoraIso });
      }
      /* Candidatos que arma el formulario y no tienen columna propia. Hoy lo usa el
         wizard para dejar el nombre que trajo Google cuando difiere del declarado: el
         poder se emite con el nombre del documento, y la discrepancia queda auditable
         en la capa de evidencia en vez de perderse. Se sanea acá porque viene del
         cliente: solo se aceptan las cuatro claves del contrato, con campo y fuente
         obligatorios. */
      if (Array.isArray(body.datos_extraidos_extra)) {
        body.datos_extraidos_extra.forEach(function (c) {
          if (!c || typeof c !== 'object') return;
          var campo = limpiarTexto(c.campo);
          var fuente = limpiarTexto(c.fuente);
          if (!campo || !fuente) return;
          candidatosAlta.push({
            campo: campo,
            valor: typeof c.valor === 'string' ? limpiarTexto(c.valor) : c.valor,
            fuente: fuente,
            extraido_en: ahoraIso,
          });
        });
      }

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
        /* `origen`/`destino` siguen siendo el label de display, sin cambios de escritura.
           Su semántica, eso sí, pasa a ser la de los extremos de la DIRECCIÓN AFECTADA:
           el formulario ahora pregunta por el viaje donde ocurrió el problema.
           `origen_iata`/`destino_iata` son el dato canónico que consume el motor legal
           (Tabla A filas 1 y 2), con esa misma semántica. */
        origen_iata:           extremos.origen_iata || iata3(body.origen_iata),
        destino_iata:          extremos.destino_iata || iata3(body.destino_iata),
        /* Contrato §1.3: los tramos de la dirección afectada, con `afectado` en el del
           incidente. Sin ruta completa queda `[]`, igual que hasta ahora. */
        segmentos:             segmentosAlta,
        incidentes:            incidentesAlta,
        /* Candidatos con procedencia (§1.1). `verificado: false` siempre: la marca del
           tramo afectado es declarativa y los campos críticos no se autoverifican desde
           una sola fuente declarativa. El motor va a poder analizar el caso, pero lo
           va a marcar provisional — que es exactamente lo que corresponde. */
        datos_extraidos:       candidatosAlta,
        campos_meta:           incidentesAlta.length
                                 ? { incidentes: { verificado: false, fuente: 'formulario', conflicto: false } }
                                 : {},
        pnr:                   body.pnr || null,
        /* Incident */
        tipo_reclamo:          body.tipo_reclamo || 'vuelo',
        tipo_incidencia:       body.tipo_incidencia || null,
        horas_retraso:         body.horas_retraso ? parseInt(body.horas_retraso) || null : null,
        anticipacion_aviso:    body.anticipacion_aviso || null,
        ofrecimiento_aerolinea: body.ofrecimiento_aerolinea || null,
        causa_informada:       body.causa_informada || null,
        /* Expenses (vuelo) — `moneda_gastos`/`monto_gastos` NO se setean acá: son un
           espejo derivado y los escribe `aplicarGastos()` más abajo, junto al canónico
           `gastos_items`. `gastos_detalle` es texto libre sin rol funcional: no alimenta
           ningún cálculo, existe para lectura humana o de una IA que revise el caso.
           Como todo texto libre del pasajero, nunca entra en una plantilla contractual. */
        gastos_detalle:        body.gastos_detalle || null,
        comentarios_pasajero:  body.comentarios_pasajero || null,
        /* Baggage fields (equipaje claim, or combined vuelo+equipaje) */
        tipo_caso_equipaje:    body.tipo_caso_equipaje    || null,
        descripcion_equipaje:  body.descripcion_equipaje  || null,
        valor_equipaje:        body.valor_equipaje ? parseFloat(body.valor_equipaje) || null : null,
        fecha_entrega_equipaje: body.fecha_entrega_equipaje || null,
        /* Acompañantes (pasajeros adicionales) */
        acompanantes:          Array.isArray(body.acompanantes) ? body.acompanantes : [],
        /* Documentos múltiples del titular (principal primero) */
        documentos:            Array.isArray(body.documentos) ? body.documentos : [],
        /* Incidencia: campos condicionales por tipo */
        viajo_finalmente:      body.viajo_finalmente || null,
        embarque_presentado:   body.embarque_presentado || null,
        pasaje_alternativo_monto:  body.pasaje_alternativo_monto ? parseFloat(body.pasaje_alternativo_monto) || null : null,
        pasaje_alternativo_moneda: body.pasaje_alternativo_moneda || null,
        /* Equipaje: PIR + no entregado */
        pir_presentado:        body.pir_presentado || null,
        pir_numero:            body.pir_numero || null,
        equipaje_no_entregado: body.equipaje_no_entregado === true || body.equipaje_no_entregado === 'true' || false,
        /* Google identity */
        google_sub:            body.google_sub            || null,
        google_email_verified: body.google_email_verified || null,
        google_iss:            body.google_iss            || null,
        /* Metadata */
        fecha_carga:           new Date().toISOString(),
        fuente:                'Web',
        estado:                'pendiente',
        instancia:             'evaluacion',
        momento:               null,
        instancia_historial:   [{ instancia: 'evaluacion', momento: null, fecha: new Date().toISOString(), por: 'sistema' }],
        ref_code:              refCode,
        /* Consent / electronic signature */
        consent_version:       body.consent_version || null,
        consent_tyc:           body.consent_tyc === true || body.consent_tyc === 'true' || false,
        consent_autorizacion:  body.consent_autorizacion === true || body.consent_autorizacion === 'true' || false,
        /* Este es el único camino de alta donde el pasajero firma los T&C en el acto
           (tilda la aceptación y abajo se genera el PDF de constancia). El poder, en
           cambio, siempre queda pendiente: el consentimiento del form no lo reemplaza. */
        tyc_estado:            (body.consent_tyc === true || body.consent_tyc === 'true') ? 'firmada' : 'pendiente_envio',
        firma_estado:          'pendiente_envio',
        firma_fecha:           body.firma_fecha || null,
        firma_ts:              body.firma_ts || null,
        user_agent:            body.user_agent || null,
        ip_firmante:           ip,
      };

      /* Gastos: canónico + espejo en la MISMA fila que se inserta. Antes esta vía
         escribía solo `monto_gastos`/`moneda_gastos` y dejaba `gastos_items` vacío, así
         que el motor evaluaba todos los casos del formulario público como si el pasajero
         no hubiera declarado ningún gasto (cuenta `gastos_items.length` para el nodo de
         suficiencia probatoria). */
      aplicarGastos(row, body.gastos_items, 'declaracion_pasajero');

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

      /* ---- Step 2: SHA-256 fingerprint + PDF authorization ---- */
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
        var { generateAcceptancePdf } = await import('./_utils/pdf-receipt.js');
        pdfBuffer = await generateAcceptancePdf({
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
          var pdfPath = refCode + '/Aceptacion_TyC_' + refCode + '.pdf';
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
            var docEntry = { tipo: 'documento_viaje', url: SB_URL + '/storage/v1/object/public/reclamos/' + sfPath, nombre: sf.name || fname };
            if (sf.categoria) docEntry.categoria = sf.categoria;
            docUrls.push(docEntry);
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
      /* tipo 'aceptacion_tyc': los casos viejos quedan con 'autorizacion'. Ningún
         panel discrimina por `tipo` (se listan por nombre y URL), así que la
         convivencia no rompe nada. */
      if (pdfUrl) allAdjuntos.push({ tipo: 'aceptacion_tyc', url: pdfUrl, nombre: 'Aceptacion_TyC_' + refCode + '.pdf' });
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
              ai_raw:   { huella_sha256: claimHash },
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
        var senderFrom = 'SolucionAir <no-reply@solucionair.com>';
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
                + (pdfUrl ? '<p><strong>Aceptacion T&C:</strong> <a href="' + pdfUrl + '">Ver PDF</a></p>' : '')
                + '<hr/><p style="color:#888;font-size:12px">Enviado automaticamente por SolucionAir</p>',
              attachments: pdfBuffer ? [{ filename: 'Aceptacion_TyC_' + refCode + '.pdf', content: pdfBuffer.toString('base64') }] : undefined,
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
              + '<p style="margin:0;font-size:13px;color:#2D4A3E"><strong>Constancia adjunta.</strong> Se adjunta a este correo la constancia de aceptacion de los Terminos y Condiciones, firmada electronicamente. Guardala para tus registros.</p>'
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
              + '<p style="color:#3A3A3A;font-size:14px;line-height:1.6;margin:0 0 16px">Recibimos tu reclamo y ya esta siendo revisado por nuestro equipo. A continuacion encontras el detalle y la constancia de aceptacion de los Terminos y Condiciones que firmaste electronicamente.</p>'
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
              filename: 'Aceptacion_TyC_SolucionAir_' + refCode + '.pdf',
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
        + 'CONTEXTO: Los documentos pueden contener un itinerario con MULTIPLES TRAMOS DE VUELO (ej: EZE→ATL→TUL ida, TUL→ATL→EZE vuelta). Tu trabajo es reconstruir el ITINERARIO COMPLETO tramo por tramo.\n\n'
        + 'SEGMENTOS (lo mas importante): devuelve el array "segmentos" con TODOS los tramos de TODOS los documentos, en orden cronologico, uno por vuelo.\n'
        + '- Un tramo por cada vuelo individual. EZE→ATL→TUL son DOS tramos (EZE→ATL y ATL→TUL), no uno.\n'
        + '- orden: 1, 2, 3... cronologico sobre el itinerario entero (la vuelta sigue numerando desde donde termino la ida).\n'
        + '- direccion: "ida" para los tramos que alejan del punto de partida del viaje; "vuelta" para los del regreso. Si el viaje es solo de ida, TODOS son "ida".\n'
        + '- CIUDADES CON VARIOS AEROPUERTOS: una misma ciudad puede tener varios aeropuertos (Buenos Aires = EZE y AEP; San Pablo = GRU y CGH; Rio de Janeiro = GIG y SDU; Nueva York = JFK, LGA y EWR; Londres = LHR, LGW, STN y LTN; Paris = CDG y ORY; Tokio = NRT y HND). Si un tramo llega a un aeropuerto y el siguiente sale de OTRO aeropuerto de la MISMA CIUDAD, el siguiente tramo inicia la direccion "vuelta", NUNCA es continuacion de la ida. Ejemplo: USH→EZE y despues AEP→USH son IDA (USH→EZE) y VUELTA (AEP→USH), no un viaje con escalas.\n'
        + '- CORTE TEMPORAL: si entre la llegada de un tramo y la salida del siguiente pasan mas de 24 horas, ese punto marca el fin de la ida y el comienzo de la vuelta u otro viaje. NUNCA lo trates como escala.\n'
        + '- origen y destino: formato "EZE - Buenos Aires" (codigo IATA, guion, ciudad).\n'
        + '- vuelo_nro: UN SOLO numero por tramo, el de ese vuelo. Ej: "DL 110".\n'
        + '- aerolinea_operadora: la que OPERA ese tramo. Si el documento dice "operado por" otra aerolinea, poné esa, no la que vendio el billete.\n'
        + '- fecha: la de ese tramo, formato YYYY-MM-DD.\n'
        + '- Si un dato de un tramo no esta visible, devuelve "" en ese dato (NO inventes). Si no se ve ningun itinerario, devuelve "segmentos": [].\n\n'
        + 'DIRECCION AFECTADA: "direccion_afectada_sugerida" es "ida" o "vuelta" SOLO si algun documento muestra explicitamente la incidencia (cancelacion, demora, reprogramacion) en un tramo concreto y podes decir a que direccion pertenece. Si no lo muestra, devuelve "". Es una sugerencia que el pasajero va a confirmar: NUNCA la adivines por probabilidad.\n\n'
        + 'REGLAS DE LOS CAMPOS SUELTOS origen/destino/escalas (compatibilidad):\n'
        + '- Se refieren a UNA SOLA direccion del viaje: la de "direccion_afectada_sugerida" si la determinaste, y si no, la de IDA.\n'
        + '- origen: primer aeropuerto de esa direccion. Formato "EZE - Buenos Aires". Si el boleto dice "Buenos Aires" como ciudad de salida, el codigo IATA es EZE.\n'
        + '- destino: aeropuerto de LLEGADA FINAL de esa direccion. Si la direccion es EZE→ATL→TUL, el destino es "TUL - Tulsa". NUNCA devuelvas el mismo aeropuerto que el origen.\n'
        + '- escalas: aeropuertos intermedios de esa direccion. Ej: "ATL - Atlanta".\n'
        + '- CIUDADES CON VARIOS AEROPUERTOS: una misma ciudad puede tener varios aeropuertos (Buenos Aires = EZE y AEP; San Pablo = GRU y CGH; Rio de Janeiro = GIG y SDU; Nueva York = JFK, LGA y EWR; Londres = LHR, LGW, STN y LTN; Paris = CDG y ORY; Tokio = NRT y HND). Si un tramo LLEGA a un aeropuerto y el tramo siguiente SALE de otro aeropuerto de la MISMA CIUDAD, eso NO es una escala: es el punto de retorno donde termina la ida y comienza la vuelta. Ejemplo: itinerario USH→EZE y luego AEP→USH es IDA (USH→EZE) y VUELTA (AEP→USH); origen = "USH - Ushuaia", destino = "EZE - Buenos Aires", escalas = "".\n'
        + '- CORTE TEMPORAL: si entre la llegada de un tramo y la salida del siguiente pasan mas de 24 horas, ese punto marca el fin de la ida y el comienzo de la vuelta u otro viaje. NUNCA lo trates como escala.\n'
        + '- escalas NUNCA puede incluir un aeropuerto de la misma ciudad que origen o que destino.\n'
        + '- vuelo_nro (suelto): UN SOLO numero de vuelo, el del tramo afectado o el primero de esa direccion. NUNCA concatenes numeros separados por comas. Ejemplo INCORRECTO: "110, 2754, 5164".\n\n'
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
        + '{ "nombre": "", "email": "", "telefono": "", "doc_numero": "", "aerolinea": "", "vuelo_nro": "", "numero_ticket": "", "pnr": "", "origen": "", "destino": "", "escalas": "", "fecha_vuelo": "", "incidencia_detectada": "", "gastos_monto": "", "gastos_moneda": "", '
        + '"direccion_afectada_sugerida": "", "segmentos": [{ "orden": 1, "direccion": "ida", "origen": "", "destino": "", "vuelo_nro": "", "aerolinea_operadora": "", "fecha": "" }] }\n\n'
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
        /* Techo generoso a propósito. El array `segmentos` de Intake v2 es lo más
           largo de la respuesta (un objeto de 7 campos por tramo, y un itinerario
           con conexiones ida y vuelta son 4+), y gemini-2.5-flash razona por
           defecto: en OpenRouter esos tokens de razonamiento salen de este mismo
           presupuesto. Con el 1024 histórico el JSON llegaba cortado a la mitad y
           el parse de abajo tiraba. Se paga por token usado, no por el techo. */
        max_tokens: 8192,
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

    var choice = (aiJson.choices && aiJson.choices[0]) || null;
    var raw = (choice && choice.message && choice.message.content) || '';
    /* 'length' = el modelo se quedó sin presupuesto y cortó la respuesta al medio.
       Se registra aparte porque desde el JSON truncado solo se ve "falta un }". */
    var finishReason = (choice && choice.finish_reason) || '';
    if (!raw) return res.status(502).json({ error: 'Empty AI response', finishReason: finishReason });

    console.log('[process-ticket] AI finish_reason:', finishReason, '| usage:', JSON.stringify(aiJson.usage || {}));
    console.log('[process-ticket] AI raw:', raw.substring(0, 400));

    var parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
    } catch (e) {
      console.error('[process-ticket] AI JSON parse failed. finish_reason:', finishReason, '| chars:', raw.length);
      return res.status(502).json({
        error: finishReason === 'length' ? 'AI response truncated' : 'AI JSON parse failed',
        finishReason: finishReason,
        raw: raw.substring(0, 300),
      });
    }

    /* Sanitize: strip "null"/"undefined" strings, trim whitespace. Una sola definición
       en `_utils/intake.js`, compartida con el saneo de segmentos. */
    var clean = limpiarTexto;

    /* If vuelo_nro has commas (AI concatenated multiple flights), take only the first */
    var rawFlight = clean(parsed.vuelo_nro);
    if (rawFlight.indexOf(',') > -1) rawFlight = rawFlight.split(',')[0].trim();

    /* Ruta de los campos sueltos, saneada por ciudad y no por código: una ida y vuelta
       cuyo regreso sale de otro aeropuerto de la misma ciudad (USH→EZE, AEP→USH) llegaba
       colapsada en un solo viaje con escalas. La comparación legacy por los primeros 3
       caracteres sigue viva como fallback dentro del helper, para cuando no hay IATA. */
    var ruta = sanitizeRuta(clean(parsed.origen), clean(parsed.destino), clean(parsed.escalas));

    /* Itinerario tramo por tramo (Intake v2). El saneo vive en `_utils/intake.js`
       porque el alta de agencias hace exactamente lo mismo con el mismo JSON. */
    var segmentosIa = sanearSegmentosIa(parsed.segmentos);
    /* Y acá se corrige la DIRECCIÓN de cada tramo. Las reglas del prompt piden razonar
       en ciudades, pero un prompt es una petición y no una garantía: cuando el modelo no
       ve el corte, etiqueta el ida y vuelta entero como una sola dirección y el front
       reconstruye origen y destino desde estos tramos, pisando los campos sueltos que sí
       vienen saneados. El resultado era USH→USH con EZE y AEP de escalas. Como esto corre
       antes de armar `data`, arregla de una vez las TRES superficies que consumen el
       escaneo (B2C, agencias y backoffice) sin tocar una línea de front. */
    var corregidos = sanitizeSegmentos(segmentosIa);
    /* Sugerencia, nunca decisión: si el modelo no la vio explícita viaja vacía y la
       resuelve el pasajero con un tap. Sigue al TRAMO donde el modelo vio la incidencia,
       no a la etiqueta vieja: si ese tramo pasó a ser vuelta, la sugerencia también. */
    var dirSugerida = normalizarDireccionSugerida(
      seguirSugerencia(parsed.direccion_afectada_sugerida, segmentosIa, corregidos.segmentos),
      corregidos.segmentos
    );

    var data = {
      nombre: clean(parsed.nombre),
      email: clean(parsed.email).toLowerCase(),
      telefono: clean(parsed.telefono),
      doc_numero: clean(parsed.doc_numero),
      aerolinea: clean(parsed.aerolinea),
      vuelo_nro: rawFlight,
      numero_ticket: clean(parsed.numero_ticket),
      pnr: clean(parsed.pnr),
      origen: ruta.origen,
      destino: ruta.destino,
      escalas: ruta.escalas,
      fecha_vuelo: clean(parsed.fecha_vuelo),
      incidencia_detectada: clean(parsed.incidencia_detectada),
      gastos_monto: clean(parsed.gastos_monto),
      gastos_moneda: clean(parsed.gastos_moneda),
      /* Claves nuevas (Intake v2), aditivas: las viejas siguen todas arriba con el
         mismo nombre y el mismo formato, así que el autofill anterior no se entera. */
      segmentos: corregidos.segmentos,
      direccion_afectada_sugerida: dirSugerida,
    };
    /* Solo cuando hay más de un corte y no se pudo decidir. Aditivo y sin consumidor en
       el front todavía: queda para una UI que le pida al pasajero desambiguar. */
    if (corregidos.ambiguos) data.segmentos_ambiguos = true;

    console.log('[process-ticket] AI scan done (' + images.length + ' files), returning data only');

    return res.status(200).json({ success: true, data: data });

  } catch (err) {
    console.error('[process-ticket] Fatal:', err.message);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
