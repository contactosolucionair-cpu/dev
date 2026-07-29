import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { appendLegalText } from './legal-pdf.js';
import { loadTycText } from './tyc-text.js';

const C_GREEN  = rgb(0.176, 0.290, 0.243);
const C_GOLD   = rgb(0.773, 0.604, 0.239);
const C_WHITE  = rgb(1, 1, 1);
const C_LIGHT  = rgb(0.918, 0.945, 0.929);
const C_CREAM  = rgb(0.996, 0.980, 0.945);
const C_GRAY   = rgb(0.500, 0.500, 0.500);
const C_DARK   = rgb(0.102, 0.102, 0.102);
const C_MUTED  = rgb(0.780, 0.860, 0.820);
const C_LGRAY  = rgb(0.920, 0.920, 0.920);

/* Membrete. logo-doc-white.png es el mismo recorte que usa el poder
   (src/img/logo-doc.png) pero pintado de blanco, porque acá va sobre la banda
   verde. Logo y bajada forman un bloque: comparten eje vertical y el conjunto
   se ancla al margen izquierdo, así la bajada queda centrada respecto del logo
   sin que ninguno de los dos se salga de la caja. */
const LOGO_PATH = path.join(process.cwd(), 'src', 'img', 'logo-doc-white.png');
const HEAD_H = 112, HEAD_TOP = 22, LOGO_H = 60;
const LEMA = 'Compensaciones por vuelos y equipaje', LEMA_SIZE = 7.5;

/* Las hojas del anexo llevan el membrete del poder —logo verde chico sobre
   blanco— y no la banda de la carátula: son páginas de texto corrido y la banda
   les comía el aire. Mismos valores que legal-pdf.js para que los dos
   documentos que firma el pasajero se vean de la misma familia. */
const LOGO_DOC_PATH = path.join(process.cwd(), 'src', 'img', 'logo-doc.png');
const ANEXO_LOGO_H = 30, ANEXO_LOGO_TOP = 32, ANEXO_LOGO_GAP = 30;

const TEXTO_NO_DISPONIBLE = 'No fue posible reproducir el texto en este documento. '
  + 'La version aceptada se encuentra publicada en solucionair.com.';

export async function generateAcceptancePdf(d) {
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

  function txtC(s, cx, y, { sz = 8, b = false, col = C_DARK } = {}) {
    const font = b ? bold : reg;
    txt(s, cx - font.widthOfTextAtSize(String(s), sz) / 2, y, { sz, b, col });
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
  /* Si el PNG no está, cae al wordmark de texto: un comprobante sin logo sirve
     igual, uno que no se genera no. */
  let logoImg = null;
  try {
    logoImg = await doc.embedPng(fs.readFileSync(LOGO_PATH));
  } catch (e) {
    console.error('[pdf-receipt] no pude embeber el logo:', e.message);
  }

  /* Eje del bloque: lo fija el elemento más ancho, apoyado en el margen; el otro
     se centra sobre él. Con el logo actual manda la bajada, pero no se asume. */
  const logoW = logoImg ? LOGO_H * (logoImg.width / logoImg.height) : 0;
  const lemaW = reg.widthOfTextAtSize(LEMA, LEMA_SIZE);
  const axis  = M + Math.max(logoW, lemaW) / 2;

  rect(0, H - HEAD_H, W, HEAD_H, C_GREEN);
  if (logoImg) {
    page.drawImage(logoImg, {
      x: axis - logoW / 2, y: H - HEAD_TOP - LOGO_H, width: logoW, height: LOGO_H,
    });
  } else {
    txtC('SolucionAir', axis, H - HEAD_TOP - 22, { sz: 18, b: true, col: C_GOLD });
  }
  txtC(LEMA, axis, H - HEAD_TOP - LOGO_H - 16, { sz: LEMA_SIZE, col: C_MUTED });
  txt('ACEPTACION DE T&C  .  FIRMA ELECTRONICA', W - M - 170, H - 32, { sz: 7, b: true, col: C_WHITE });
  txt('Documento generado automaticamente', W - M - 170, H - 44, { sz: 6, col: C_MUTED });
  txt('Caso ' + d.refCode, W - M - 170, H - 56, { sz: 6, col: C_MUTED });

  let y = H - HEAD_H - 16;

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
  txt('Constancia de aceptacion de Terminos y Condiciones', M, y, { sz: 10, b: true, col: C_GREEN });
  y -= 16;

  // ---- SOLICITANTE BOX ----
  const boxH = 50;
  rect(M, y - boxH + 6, W - M * 2, boxH, C_LIGHT, C_GREEN);
  txt('SOLICITANTE', M + 7, y - 3, { sz: 6, b: true, col: C_GREEN });
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

  const DW = W - M * 2;

  // ---- DOCUMENTO ACEPTADO ----
  section('Documento aceptado electronicamente');
  rect(M, y - 24, DW, 28, C_LIGHT, C_GREEN);
  txt('Terminos y Condiciones del Servicio y Politica de Privacidad  -  Version ' + (d.consentVersion || '-'),
    M + 7, y - 3, { sz: 7, b: true, col: C_GREEN });
  txt('Aceptados al cargar el caso. El texto integro se reproduce a partir de la pagina 2 de este documento.',
    M + 7, y - 14, { sz: 6.5, col: C_GRAY, mw: DW - 14 });
  y -= 36;

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
  txt('Conserve esta constancia para sus archivos.', M, y, { sz: 6, col: C_GRAY });
  y -= 14;

  // ---- NOTA LEGAL ----
  const nota = 'La aceptacion electronica prestada constituye firma electronica (arts. 286 y 288 CCyCN, Ley 26.994 y Ley 25.506). '
    + 'La validez del instrumento esta sujeta a la identidad declarada al momento de la presentacion. '
    + 'Esta constancia acredita la aceptacion de los Terminos y Condiciones y la Politica de Privacidad; no confiere por si sola '
    + 'representacion para gestionar el reclamo, que se otorga por poder especial separado. '
    + 'SolucionAir - Juan Pablo Mario Adaniya (DNI 37.806.475) y Tomas Gregorio Dicranian (DNI 37.606.877). '
    + 'Caso: ' + d.refCode + '.';
  txt(nota, M, y, { sz: 6, col: C_GRAY, mw: DW });

  // ---- TEXTO ACEPTADO ----
  /* El documento va entero atrás de la carátula. Si la extracción falla, la
     constancia se emite igual con una nota: sirve como prueba de la firma
     aunque le falte el anexo. */
  let legal = null;
  try {
    legal = loadTycText();
  } catch (e) {
    console.error('[pdf-receipt] no pude leer los T&C:', e.message);
  }

  const anexo = legal
    ? legal.tyc + '\n\n' + legal.privacidad
    : '# Texto aceptado\n\n' + TEXTO_NO_DISPONIBLE;

  let logoDark = null;
  try {
    logoDark = await doc.embedPng(fs.readFileSync(LOGO_DOC_PATH));
  } catch (e) {
    console.error('[pdf-receipt] no pude embeber el logo del anexo:', e.message);
  }

  const anexoPages = appendLegalText(doc, anexo, {
    topY:    H - ANEXO_LOGO_TOP - ANEXO_LOGO_H - ANEXO_LOGO_GAP,
    margin:  M,
    bottomY: 44,
    fonts:   { bold, reg },
  });

  if (logoDark) {
    const dw = ANEXO_LOGO_H * (logoDark.width / logoDark.height);
    for (const p of anexoPages) {
      p.drawImage(logoDark, {
        x: M, y: H - ANEXO_LOGO_TOP - ANEXO_LOGO_H, width: dw, height: ANEXO_LOGO_H,
      });
    }
  }

  // ---- FOOTER ----
  /* Lleva caso, versión y página: es lo que identifica una hoja suelta del
     anexo, ahora que arriba sólo va el logo. */
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: 0, width: W, height: 20, color: C_GREEN });
    p.drawText('SolucionAir  .  contacto@solucionair.com  .  Caso ' + d.refCode
      + '  .  Version ' + (d.consentVersion || '-')
      + '  .  Pagina ' + (i + 1) + '/' + pages.length, { x: M, y: 6, size: 6, font: reg, color: C_MUTED });
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
