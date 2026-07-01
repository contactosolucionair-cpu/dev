import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const C_GREEN  = rgb(0.176, 0.290, 0.243);
const C_GOLD   = rgb(0.773, 0.604, 0.239);
const C_WHITE  = rgb(1, 1, 1);
const C_LIGHT  = rgb(0.918, 0.945, 0.929);
const C_CREAM  = rgb(0.996, 0.980, 0.945);
const C_GRAY   = rgb(0.500, 0.500, 0.500);
const C_DARK   = rgb(0.102, 0.102, 0.102);
const C_MUTED  = rgb(0.780, 0.860, 0.820);
const C_LGRAY  = rgb(0.920, 0.920, 0.920);

const MANDATE_LINES = [
  'Mediante la presente, el/la reclamante declara bajo juramento que toda la informacion',
  'proporcionada en este formulario es veridica, completa y exacta. Autoriza expresamente a',
  'SolucionAir, representada por Juan Pablo Mario Adaniya (DNI 37.806.475) y Tomas Gregorio',
  'Dicranian (DNI 37.606.877), a: (1) Gestionar y presentar reclamos formales ante la aerolinea',
  'y/o autoridades competentes en su nombre. (2) Acceder, utilizar y compartir la documentacion',
  'provista exclusivamente con fines de gestion del presente reclamo. (3) Representarlo/a en',
  'instancias de mediacion privada online, si correspondiera.',
  '',
  'SolucionAir opera bajo honorarios por exito: no se cobran costos iniciales; los honorarios',
  'equivalen al 20% de la compensacion obtenida, unicamente si el reclamo prospera.',
  '',
  'La presente declaracion constituye firma electronica valida conforme Ley 25.506 y arts.',
  '286 y 288 del Codigo Civil y Comercial de la Nacion (Ley 26.994).',
];

export async function generateAuthorizationPdf(d) {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const W    = page.getWidth();
  const H    = page.getHeight();
  const M    = 40;

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  function txt(s, x, y, { sz = 8, b = false, col = C_DARK, mw } = {}) {
    const opts = { x, y, size: sz, font: b ? bold : reg, color: col };
    if (mw) opts.maxWidth = mw;
    page.drawText(String(s ?? '-'), opts);
  }

  function rect(x, y, w, h, fill, stroke) {
    const opts = { x, y, width: w, height: h, color: fill };
    if (stroke) { opts.borderColor = stroke; opts.borderWidth = 0.5; }
    page.drawRectangle(opts);
  }

  function hline(y, col = C_GOLD) {
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: col });
  }

  // ---- HEADER ----
  rect(0, H - 64, W, 64, C_GREEN);
  txt('SolucionAir', M, H - 30, { sz: 18, b: true, col: C_GOLD });
  txt('Compensaciones por vuelos y equipaje', M, H - 48, { sz: 7.5, col: C_MUTED });
  txt('AUTORIZACION  .  FIRMA ELECTRONICA', W - M - 170, H - 25, { sz: 7, b: true, col: C_WHITE });
  txt('Documento generado automaticamente', W - M - 170, H - 37, { sz: 6, col: C_MUTED });
  txt('Caso ' + d.refCode, W - M - 170, H - 49, { sz: 6, col: C_MUTED });

  let y = H - 76;

  function section(title) {
    y -= 8;
    hline(y);
    y -= 11;
    txt(title, M, y, { sz: 7, b: true, col: C_GREEN });
    y -= 11;
  }

  function kv(label, value) {
    txt(label, M, y, { sz: 7, col: C_GRAY });
    txt(value || '-', M + 128, y, { sz: 7, mw: W - M - 128 - M });
    y -= 11;
  }

  // ---- TITLE ----
  y -= 3;
  txt('Autorizacion y mandato para gestion de reclamo', M, y, { sz: 10, b: true, col: C_GREEN });
  y -= 16;

  // ---- SOLICITANTE BOX ----
  const boxH = 50;
  rect(M, y - boxH + 6, W - M * 2, boxH, C_LIGHT, C_GREEN);
  txt('SOLICITANTE (PODERDANTE)', M + 7, y - 3, { sz: 6, b: true, col: C_GREEN });
  txt(d.nombre || '-', M + 7, y - 15, { sz: 9, b: true });
  txt((d.docTipo || 'Documento') + ': ' + (d.docNumero || '-'), M + 7, y - 27, { sz: 7.5, col: C_GRAY });
  txt(d.email || '-', M + 7, y - 39, { sz: 7.5, col: C_GRAY });
  y -= boxH + 8;

  // ---- DATOS DEL CASO ----
  section('Datos del caso');
  kv('Referencia SolucionAir:', d.refCode);
  kv('Tipo de reclamo:', d.tipoReclamo === 'equipaje'
    ? 'Reclamo por equipaje (perdida / dano / demora)'
    : 'Reclamo por vuelo (retraso / cancelacion / denegacion)');
  kv('Aerolinea / vuelo:', [d.aerolinea, d.vuelo].filter(Boolean).join('  .  ') || '-');
  kv('Ruta:', [d.origen, d.destino].filter(Boolean).join(' > ') || '-');
  kv('Fecha del vuelo:', d.fechaVuelo || '-');
  if (d.pnr) kv('Codigo de reserva (PNR):', d.pnr);

  // ---- DOCUMENTOS ACEPTADOS ----
  section('Documentos aceptados electronicamente');

  const DW = W - M * 2;

  // Doc 1: TyC reference
  rect(M, y - 24, DW, 28, C_LIGHT, C_GREEN);
  txt('1.  Terminos y Condiciones del Servicio y Politica de Privacidad', M + 7, y - 3, { sz: 7, b: true, col: C_GREEN });
  txt('Version ' + (d.consentVersion || '-') + '  -  Aceptados electronicamente al momento de la presentacion del caso.', M + 7, y - 14, { sz: 6.5, col: C_GRAY, mw: DW - 14 });
  y -= 32;

  // Doc 2: Authorization mandate
  const mandateH = 14 + MANDATE_LINES.length * 8.5 + 8;
  rect(M, y - mandateH + 4, DW, mandateH, C_CREAM, C_GOLD);
  txt('2.  Autorizacion y mandato para la gestion del reclamo  -  Version ' + (d.consentVersion || '-'), M + 7, y - 3, { sz: 7, b: true, col: C_GREEN });
  y -= 14;
  for (const line of MANDATE_LINES) {
    if (line) txt(line, M + 7, y, { sz: 6.8, col: C_DARK, mw: DW - 14 });
    y -= 8.5;
  }
  y -= 6;

  // ---- CONSTANCIA DE FIRMA ----
  section('Constancia de firma electronica - Ley 25.506');
  const sigH = 76;
  rect(M, y - sigH + 8, DW, sigH, C_CREAM, C_GOLD);
  y -= 3;
  const KX = M + 7;
  const VX = M + 136;

  txt('Identidad:', KX, y, { sz: 7, b: true, col: C_GREEN });
  if (d.googleSub) {
    txt('Verificada por Google (OpenID Connect)' + (d.googleEmailVerified === 'true' ? ' - email verificado' : ''), VX, y, { sz: 6.8, mw: W - VX - M - 4 });
  } else {
    txt('Identidad declarada por el firmante', VX, y, { sz: 6.8, col: C_GRAY });
  }
  y -= 12;

  txt('Fecha y hora (ART):', KX, y, { sz: 7, b: true, col: C_GREEN });
  txt(d.firmaFecha || '-', VX, y, { sz: 7 });
  y -= 12;

  txt('IP de origen:', KX, y, { sz: 7, b: true, col: C_GREEN });
  txt(d.ip || '-', VX, y, { sz: 7 });
  y -= 12;

  txt('Dispositivo/navegador:', KX, y, { sz: 7, b: true, col: C_GREEN });
  txt((d.userAgent || '-').substring(0, 75), VX, y, { sz: 6.5, mw: W - VX - M - 4 });
  y -= 12;

  txt('Version del documento:', KX, y, { sz: 7, b: true, col: C_GREEN });
  txt(d.consentVersion || '-', VX, y, { sz: 7 });
  y -= 18;

  // ---- VERIFICACION SHA-256 + QR ----
  section('Verificacion de autenticidad - SHA-256');

  const QR_SIZE = 68;
  const hashW   = DW - QR_SIZE - 10;
  const verifyUrl = 'https://solucionair.com/verificar?ref=' + d.refCode + '&h=' + (d.hash || '').substring(0, 16);

  txt('Huella digital del caso:', M, y, { sz: 7, b: true });
  y -= 11;
  rect(M, y - 5, hashW, 16, C_LGRAY);
  txt((d.hash || '').substring(0, 40).toUpperCase() + '...', M + 6, y, { sz: 6.5 });

  // QR code (best-effort)
  try {
    const qrRes = await fetch('https://quickchart.io/qr?size=140&margin=1&text=' + encodeURIComponent(verifyUrl));
    if (qrRes.ok) {
      const qrBytes = await qrRes.arrayBuffer();
      const qrImg   = await doc.embedPng(Buffer.from(qrBytes));
      page.drawImage(qrImg, { x: W - M - QR_SIZE, y: y - QR_SIZE + 11, width: QR_SIZE, height: QR_SIZE });
    }
  } catch (_) { /* skip if unavailable */ }

  y -= 20;
  txt('Verificacion: ' + verifyUrl, M, y, { sz: 6, col: C_GRAY, mw: hashW });
  y -= 10;
  txt('Esta huella vincula este documento con los registros de SolucionAir. Cualquier alteracion lo invalida.', M, y, { sz: 6, col: C_GRAY, mw: hashW });
  y -= 10;
  txt('Conserve este comprobante para sus archivos.', M, y, { sz: 6, col: C_GRAY });
  y -= 14;

  // ---- NOTA LEGAL ----
  const nota = 'La aceptacion electronica prestada constituye firma electronica (arts. 286 y 288 CCyCN, Ley 26.994 y Ley 25.506). '
    + 'La validez del instrumento esta sujeta a la identidad declarada al momento de la presentacion. '
    + 'SolucionAir - Juan Pablo Mario Adaniya (DNI 37.806.475) y Tomas Gregorio Dicranian (DNI 37.606.877). '
    + 'Caso: ' + d.refCode + '.';
  txt(nota, M, y, { sz: 6, col: C_GRAY, mw: DW });

  // ---- FOOTER ----
  rect(0, 0, W, 20, C_GREEN);
  txt('SolucionAir  .  contacto@solucionair.com  .  Documento generado automaticamente  .  ' + d.refCode, M, 6, { sz: 6, col: C_MUTED });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
