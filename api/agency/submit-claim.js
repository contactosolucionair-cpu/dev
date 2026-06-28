/**
 * POST /api/agency/submit-claim
 *
 * Carga un nuevo caso B2B en nombre de un cliente.
 * Requiere agencia activa (JWT válido + estado='activa').
 * Genera ref_code, sube adjuntos al bucket y deja firma_estado='pendiente_envio'
 * para que el equipo envíe la autorización por WhatsApp al pasajero.
 *
 * @returns {Object} {success, refCode}
 */
import { verifyAgency } from '../utils/agency-auth.js';

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  try {
    var agencia = await verifyAgency(req, SB_URL, SB_KEY);
    if (!agencia) return res.status(401).json({ error: 'No autorizado.' });

    var body = req.body;
    if (!body) return res.status(400).json({ error: 'Body vacío.' });

    var email  = (body.email  || '').trim().toLowerCase();
    var nombre = (body.nombre || '').trim();
    if (!email || !nombre) return res.status(400).json({ error: 'Nombre y email del pasajero son obligatorios.' });
    if (!body.cliente_autorizacion_declarada) return res.status(400).json({ error: 'Debe declarar la autorización del cliente.' });

    /* Generar ref_code igual que process-ticket.js */
    var caseNum = Date.now() % 100000;
    var refCode = 'CSA' + String(caseNum).padStart(5, '0');

    console.log('[agency/submit-claim] Agencia:', agencia.id, '| ref:', refCode, '| pasajero:', email);

    var row = {
      /* Canal B2B */
      canal:                          'B2B',
      fuente:                         'Agencia',
      agencia_id:                     agencia.id,
      agente_nombre:                  agencia.nombre || null,
      agente_email:                   agencia.email  || null,
      cliente_autorizacion_declarada: true,
      firma_estado:                   'pendiente_envio',
      /* Pasajero */
      nombre:          nombre,
      email:           email,
      telefono:        body.telefono        || null,
      documento_tipo:  body.documento_tipo  || null,
      documento_numero: body.documento_numero || null,
      /* Vuelo */
      aerolinea:       body.aerolinea       || null,
      vuelo_nro:       body.vuelo_nro        || null,
      fecha_vuelo:     body.fecha_vuelo      || null,
      origen:          body.origen           || null,
      destino:         body.destino          || null,
      pnr:             body.pnr              || null,
      /* Incidencia */
      tipo_reclamo:    body.tipo_reclamo     || 'vuelo',
      tipo_incidencia: body.tipo_incidencia  || null,
      horas_retraso:   body.horas_retraso   ? parseInt(body.horas_retraso)   || null : null,
      anticipacion_aviso:    body.anticipacion_aviso    || null,
      ofrecimiento_aerolinea: body.ofrecimiento_aerolinea || null,
      causa_informada: body.causa_informada  || null,
      /* Gastos */
      moneda_gastos:   body.moneda_gastos    || null,
      monto_gastos:    body.monto_gastos    ? parseFloat(body.monto_gastos)   || null : null,
      gastos_detalle:  body.gastos_detalle   || null,
      /* Equipaje */
      tipo_caso_equipaje:    body.tipo_caso_equipaje    || null,
      descripcion_equipaje:  body.descripcion_equipaje  || null,
      valor_equipaje:        body.valor_equipaje       ? parseFloat(body.valor_equipaje) || null : null,
      fecha_entrega_equipaje: body.fecha_entrega_equipaje || null,
      /* Metadata */
      ref_code:    refCode,
      estado:      'pendiente',
      fecha_carga: new Date().toISOString(),
      ip_firmante: (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || null,
    };

    /* 1. Insertar reclamo */
    var insertRes = await fetch(SB_URL + '/rest/v1/reclamos', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(row),
    });

    if (!insertRes.ok) {
      var insertErr = await insertRes.text();
      console.error('[agency/submit-claim] INSERT error:', insertErr.substring(0, 400));
      return res.status(500).json({ error: 'Error al guardar el caso.' });
    }

    /* 2. Subir archivos adjuntos al bucket */
    var scannedDocs = Array.isArray(body.scanned_files) ? body.scanned_files : [];
    var docUrls = [];
    for (var di = 0; di < scannedDocs.length; di++) {
      var sf = scannedDocs[di];
      try {
        var ext   = (sf.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
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
          console.log('[agency/submit-claim] Doc subido:', sfPath);
        } else {
          var sfErr = await sfRes.text();
          console.error('[agency/submit-claim] Doc upload error:', sfRes.status, sfErr.substring(0, 150));
        }
      } catch (sfErr) {
        console.error('[agency/submit-claim] Doc upload exception:', sfErr.message);
      }
    }

    /* 3. Actualizar adjuntos si hay archivos */
    if (docUrls.length) {
      try {
        await fetch(SB_URL + '/rest/v1/reclamos?ref_code=eq.' + refCode, {
          method: 'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        SB_KEY,
            'Authorization': 'Bearer ' + SB_KEY,
          },
          body: JSON.stringify({ adjuntos: docUrls }),
        });
      } catch (patchErr) {
        console.error('[agency/submit-claim] Adjuntos PATCH error:', patchErr.message);
      }
    }

    console.log('[agency/submit-claim] Caso creado:', refCode, '| firma pendiente de envío manual por WhatsApp');
    return res.status(200).json({ success: true, refCode: refCode });

  } catch (err) {
    console.error('[agency/submit-claim] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
