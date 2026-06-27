import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const C_GREEN  = rgb(0.176, 0.290, 0.243);
const C_GOLD   = rgb(0.773, 0.604, 0.239);
const C_WHITE  = rgb(1, 1, 1);
const C_LIGHT  = rgb(0.918, 0.945, 0.929);
const C_CREAM  = rgb(0.996, 0.980, 0.945);
const C_GRAY   = rgb(0.500, 0.500, 0.500);
const C_DARK   = rgb(0.102, 0.102, 0.102);
const C_MUTED  = rgb(0.780, 0.860, 0.820);

/**
 * Generates the electronic authorization PDF for a SolucionAir claim.
 * Returns a Buffer containing the PDF bytes.
 *
 * @param {Object} d - claim + signature data
 */
export async function generateAuthorizationPdf(d) {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const W    = page.getWidth();
  const H    = page.getHeight();
  const M    = 44;

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  // ---- helpers ----
  function txt(s, x, y, { sz = 8.5, b = false, col = C_DARK, mw } = {}) {
    const opts = { x, y, size: sz, font: b ? bold : reg, color: col };
    if (mw) opts.maxWidth = mw;
    page.drawText(String(s ?? '-'), opts);
  }

  function rect(x, y, w, h, fill, stroke) {
    const opts = { x, y, width: w, height: h, color: fill };
    if (stroke) { opts.borderColor = stroke; opts.borderWidth = 0.6; }
    page.drawRectangle(opts);
  }

  function hline(y, col = C_GOLD, x1 = M, x2 = W - M) {
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.5, color: col });
  }

  // ---- HEADER ----
  rect(0, H - 68, W, 68, C_GREEN);
  txt('SolucionAir', M, H - 33, { sz: 19, b: true, col: C_GOLD });
  txt('Compensaciones por vuelos y equipaje', M, H - 52, { sz: 8, col: C_MUTED });
  txt('AUTORIZACION  ·  FIRMA ELECTRONICA', W - M - 175, H - 27, { sz: 7.5, b: true, col: C_WHITE });
  txt('Documento generado automaticamente', W - M - 175, H - 40, { sz: 6.5, col: C_MUTED });
  txt('Caso ' + d.refCode, W - M - 175, H - 53, { sz: 6.5, col: C_MUTED });

  let y = H - 82;

  // ---- section helper ----
  function section(title) {
    y -= 10;
    hline(y);
    y -= 13;
    txt(title, M, y, { sz: 7.5, b: true, col: C_GREEN });
    y -= 13;
  }

  // ---- kv row ----
  function kv(label, value) {
    txt(label, M, y, { sz: 7.5, col: C_GRAY });
    txt(value || '-', M + 136, y, { sz: 7.5, mw: W - M - 136 - M });
    y -= 12;
  }

  // ---- TITLE ----
  y -= 4;
  txt('Autorizacion y mandato para gestion de reclamo', M, y, { sz: 11, b: true, col: C_GREEN });
  y -= 20;

  // ---- PASSENGER BOX ----
  const boxH = 54;
  rect(M, y - boxH + 8, W - M * 2, boxH, C_LIGHT, C_GREEN);
  txt('SOLICITANTE (PODERDANTE)', M + 8, y - 4, { sz: 6.5, b: true, col: C_GREEN });
  txt(d.nombre || '-', M + 8, y - 17, { sz: 9.5, b: true });
  txt((d.docTipo || 'Documento') + ': ' + (d.docNumero || '-'), M + 8, y - 30, { sz: 8, col: C_GRAY });
  txt(d.email || '-', M + 8, y - 43, { sz: 8, col: C_GRAY });
  y -= boxH + 10;

  // ---- CASE DATA ----
  section('Datos del caso');
  kv('Referencia SolucionAir:', d.refCode);
  kv('Tipo de reclamo:', 'Reclamo por vuelo');
  kv('Aerolinea / vuelo:', [d.aerolinea, d.vuelo].filter(Boolean).join('  ·  ') || '-');
  kv('Ruta:', [d.origen, d.destino].filter(Boolean).join(' > ') || '-');
  kv('Fecha del vuelo:', d.fechaVuelo || '-');
  if (d.pnr) kv('Codigo de reserva (PNR):', d.pnr);

  // ---- DOCUMENTS ----
  section('Documentos aceptados electronicamente');
  txt('1.  Terminos y Condiciones del Servicio de SolucionAir - Version ' + (d.consentVersion || '-'), M, y, { sz: 7.5 });
  y -= 11;
  txt('2.  Politica de Privacidad - Version ' + (d.consentVersion || '-'), M, y, { sz: 7.5 });
  y -= 11;
  txt('3.  Autorizacion y mandato para la gestion del reclamo - Version ' + (d.consentVersion || '-'), M, y, { sz: 7.5 });
  y -= 11;
  txt('Todos aceptados en un solo acto al momento de la presentacion del caso.', M, y, { sz: 7, col: C_GRAY });
  y -= 14;

  // ---- SIGNATURE RECORD ----
  section('Constancia de firma electronica - Ley 25.506');
  const sigBoxH = 80;
  rect(M, y - sigBoxH + 10, W - M * 2, sigBoxH, C_CREAM, C_GOLD);
  y -= 4;
  const SIG_V = M + 8;
  const SIG_L = M + 130;

  txt('Identidad declarada:',  SIG_V, y, { sz: 7.5, b: true, col: C_GREEN });
  txt([d.nombre, (d.docTipo ? d.docTipo + ' ' + d.docNumero : null), d.email].filter(Boolean).join('  ·  '), SIG_L, y, { sz: 7, mw: W - SIG_L - M - 4 });
  y -= 13;

  txt('Fecha y hora (ART):', SIG_V, y, { sz: 7.5, b: true, col: C_GREEN });
  txt(d.firmaFecha || '-', SIG_L, y, { sz: 7.5 });
  y -= 13;

  txt('Direccion IP de origen:', SIG_V, y, { sz: 7.5, b: true, col: C_GREEN });
  txt(d.ip || '-', SIG_L, y, { sz: 7.5 });
  y -= 13;

  txt('Dispositivo / navegador:', SIG_V, y, { sz: 7.5, b: true, col: C_GREEN });
  txt((d.userAgent || '-').substring(0, 72), SIG_L, y, { sz: 6.5, mw: W - SIG_L - M - 4 });
  y -= 13;

  txt('Version del documento:', SIG_V, y, { sz: 7.5, b: true, col: C_GREEN });
  txt(d.consentVersion || '-', SIG_L, y, { sz: 7.5 });
  y -= 20;

  // ---- HASH ----
  section('Verificacion de autenticidad - SHA-256');
  txt('Huella digital del caso (primeros 32 caracteres):', M, y, { sz: 7.5, b: true });
  y -= 12;
  rect(M, y - 6, W - M * 2, 18, rgb(0.945, 0.945, 0.945));
  txt((d.hash || '').substring(0, 32).toUpperCase() + '...', M + 8, y, { sz: 8 });
  y -= 22;
  txt('Esta huella vincula este documento con los registros de SolucionAir. Cualquier alteracion invalida el comprobante.', M, y, { sz: 7, col: C_GRAY, mw: W - M * 2 });
  y -= 20;

  // ---- LEGAL NOTICE ----
  section('Nota legal');
  const lines = [
    'La aceptacion electronica prestada por el/la Solicitante constituye firma electronica en los terminos de los arts. 286 y 288',
    'del Codigo Civil y Comercial de la Nacion (Ley 26.994) y la Ley 25.506. La validez del presente instrumento esta sujeta a',
    'la identidad declarada por el/la firmante al momento de la presentacion.',
    'SolucionAir - Juan Pablo Mario Adaniya (DNI 37.806.475) y Tomas Gregorio Dicranian (DNI 37.606.877).',
    'Caso referencia: ' + d.refCode + '.',
  ];
  for (const l of lines) { txt(l, M, y, { sz: 7, col: C_GRAY, mw: W - M * 2 }); y -= 10; }

  // ---- FOOTER ----
  rect(0, 0, W, 22, C_GREEN);
  txt('SolucionAir  ·  contacto@solucionair.com  ·  Documento generado automaticamente  ·  ' + d.refCode, M, 7, { sz: 6.5, col: C_MUTED });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
