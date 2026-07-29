import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const C_GREEN = rgb(0.176, 0.290, 0.243);
const C_DARK  = rgb(0.102, 0.102, 0.102);
const C_GRAY  = rgb(0.500, 0.500, 0.500);

const PAGE_W = 595, PAGE_H = 842, MARGIN = 56;
const BODY_SIZE = 9.5, LINE_GAP = 4.5, PARA_GAP = 6;
const TITLE_SIZE = 13;

/* Membrete. src/img/logo-doc.png es el logo ya recortado (el logo.png del sitio
   es 3175x3175 y casi todo aire: embeberlo sumaba ~145 KB por PDF sin verse
   mejor). LOGO_H es la altura impresa; el ancho sale del aspecto real del PNG.
   LOGO_GAP es el aire entre el logo y donde arranca el texto. */
const LOGO_PATH = path.join(process.cwd(), 'src', 'img', 'logo-doc.png');
const LOGO_H = 30, LOGO_GAP = 14;

/**
 * Renders a plain-text legal template (already interpolated) into a paginated
 * A4 PDF. Same pdf-lib pattern as pdf-receipt.js (PDFDocument.create, standard
 * fonts, WinAnsi encoding). Minimal formatting convention:
 *   - blank line separates blocks; each non-blank line within a block wraps
 *     independently (keeps labeled data rows like "Vuelo N°: X" on their own line)
 *   - a line starting with "# " renders as a centered bold title
 *   - "**text**" renders as an inline bold run
 */
export async function renderLegalPdf(text, { refCode, title, logo = false } = {}) {
  const doc  = await PDFDocument.create();
  if (title) doc.setTitle(title);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  /* Se embebe una sola vez y se dibuja en cada página al final (mismo patrón que
     el pie). Si el archivo no está, el documento sale sin membrete en vez de
     fallar: un poder sin logo sirve igual, uno que no se genera no. */
  let logoImg = null;
  if (logo) {
    try {
      logoImg = await doc.embedPng(fs.readFileSync(LOGO_PATH));
    } catch (e) {
      console.error('[legal-pdf] no pude embeber el logo:', e.message);
    }
  }
  /* El texto arranca más abajo sólo si el logo entró: sin esto el membrete se
     superpone con el título. */
  const topY = PAGE_H - MARGIN - (logoImg ? LOGO_H + LOGO_GAP : 0);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = topY;
  const maxW = PAGE_W - MARGIN * 2;

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = topY;
  }
  function ensureSpace(h) {
    if (y - h < MARGIN + 24) newPage();
  }

  function parseInline(line) {
    const parts = line.split('**');
    const runs = [];
    parts.forEach((part, i) => {
      if (part === '') return;
      runs.push({ text: part, bold: i % 2 === 1 });
    });
    return runs;
  }

  function wrapRuns(runs, size) {
    const words = [];
    runs.forEach((r) => {
      r.text.split(/(\s+)/).forEach((tok) => {
        if (tok === '') return;
        words.push({ text: tok, bold: r.bold });
      });
    });
    const lines = [];
    let cur = [], curW = 0;
    words.forEach((w) => {
      const font = w.bold ? bold : reg;
      const ww = font.widthOfTextAtSize(w.text, size);
      if (/^\s+$/.test(w.text)) {
        if (cur.length) { cur.push(w); curW += ww; }
        return;
      }
      if (curW + ww > maxW && cur.length) { lines.push(cur); cur = []; curW = 0; }
      cur.push(w);
      curW += ww;
    });
    if (cur.length) lines.push(cur);
    return lines.map((l) => {
      while (l.length && /^\s+$/.test(l[l.length - 1].text)) l.pop();
      return l;
    });
  }

  /* Agrupa tokens contiguos del mismo estilo (negrita/normal) en un único
     drawText — llamar drawText por cada palabra individual puede perder el
     espacio separador en algunos lectores/extractores de PDF. */
  function drawRunsLine(lineRuns, x, yy, size, color) {
    let cx = x, i = 0;
    while (i < lineRuns.length) {
      const isBold = lineRuns[i].bold;
      const font = isBold ? bold : reg;
      let text = '';
      while (i < lineRuns.length && lineRuns[i].bold === isBold) {
        text += lineRuns[i].text;
        i++;
      }
      page.drawText(text, { x: cx, y: yy, size, font, color });
      /* +0.3pt de margen entre grupos: algunos visores usan una fuente
         sustituta para Helvetica (no embebida) con métricas ligeramente
         distintas para ciertas combinaciones de letras a tamaño chico. */
      cx += font.widthOfTextAtSize(text, size) + 0.3;
    }
  }

  /* Justifica una línea ya wrapeada: dibuja cada palabra por separado,
     repartiendo el espacio sobrante entre los huecos de espacio en blanco
     para que el texto llegue exactamente al margen derecho. */
  function drawJustifiedRunsLine(lineRuns, x, yy, size, color, targetW) {
    let naturalW = 0, gaps = 0;
    lineRuns.forEach((w) => {
      const font = w.bold ? bold : reg;
      naturalW += font.widthOfTextAtSize(w.text, size);
      if (/^\s+$/.test(w.text)) gaps++;
    });
    const extra = gaps > 0 ? Math.max(0, targetW - naturalW) / gaps : 0;
    let cx = x;
    lineRuns.forEach((w) => {
      const font = w.bold ? bold : reg;
      const ww = font.widthOfTextAtSize(w.text, size);
      if (/^\s+$/.test(w.text)) { cx += ww + extra; return; }
      page.drawText(w.text, { x: cx, y: yy, size, font, color });
      cx += ww;
    });
  }

  function drawLine(line) {
    const lines = wrapRuns(parseInline(line), BODY_SIZE);
    lines.forEach((l, li) => {
      ensureSpace(BODY_SIZE + LINE_GAP);
      /* La última línea de cada bloque wrapeado no se justifica (convención tipográfica estándar). */
      if (li === lines.length - 1) drawRunsLine(l, MARGIN, y, BODY_SIZE, C_DARK);
      else drawJustifiedRunsLine(l, MARGIN, y, BODY_SIZE, C_DARK, maxW);
      y -= BODY_SIZE + LINE_GAP;
    });
  }

  function drawTitle(line) {
    const clean = line.replace(/^#\s+/, '');
    const lines = wrapRuns([{ text: clean, bold: true }], TITLE_SIZE);
    lines.forEach((l) => {
      ensureSpace(TITLE_SIZE + 6);
      const lw = l.reduce((s, w) => s + bold.widthOfTextAtSize(w.text, TITLE_SIZE), 0);
      drawRunsLine(l, MARGIN + (maxW - lw) / 2, y, TITLE_SIZE, C_GREEN);
      y -= TITLE_SIZE + 6;
    });
  }

  const blocks = text.split(/\n\s*\n/);
  blocks.forEach((block) => {
    const rawLines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    rawLines.forEach((line) => {
      if (line.startsWith('# ')) drawTitle(line);
      else drawLine(line);
    });
    y -= PARA_GAP;
  });

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (logoImg) {
      const lw = LOGO_H * (logoImg.width / logoImg.height);
      p.drawImage(logoImg, { x: MARGIN, y: PAGE_H - MARGIN - LOGO_H, width: lw, height: LOGO_H });
    }
    p.drawText(
      'SolucionAir' + (refCode ? '  .  Caso ' + refCode : '') + '  .  Pagina ' + (i + 1) + '/' + pages.length,
      { x: MARGIN, y: 24, size: 7, font: reg, color: C_GRAY }
    );
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
