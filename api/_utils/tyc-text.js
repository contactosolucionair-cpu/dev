/* Texto de los T&C y la Política de Privacidad para embeberlos en PDF.
 *
 * La fuente es index.html, no una copia: los dos documentos viven ahí como
 * template literals (TYC_HTML / PRIVACY_HTML) porque el sitio es estático y el
 * modal los inyecta con innerHTML. Mantener una segunda copia en templates/ se
 * desincronizaría al primer cambio de cláusula, y entonces el PDF que firma el
 * pasajero diría algo distinto de lo que leyó en pantalla. Se lee el archivo y
 * se convierte el HTML al formato de texto que entiende legal-pdf.js
 * ("# " título, "**" negrita, línea en blanco = bloque).
 *
 * En Vercel los archivos del repo están disponibles desde process.cwd() (mismo
 * mecanismo que usan templates/*.txt y src/img/logo-doc.png).
 */
import fs from 'fs';
import path from 'path';

const INDEX_PATH = path.join(process.cwd(), 'index.html');

/* cp1252 sabe representar todo el castellano y los signos tipográficos que usa
   el texto legal (— – « » … º). Cualquier cosa fuera de ahí rompería el
   drawText de pdf-lib con WinAnsi, así que se reemplaza en vez de explotar. */
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ'
  + '‘’“”•–—˜™š›œžŸ';
const FALLBACK = { '→': '>', '←': '<', ' ': ' ', '‑': '-', '−': '-' };

export function toWinAnsi(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (Object.prototype.hasOwnProperty.call(FALLBACK, ch)) { out += FALLBACK[ch]; continue; }
    var cp = ch.codePointAt(0);
    if (cp === 9 || cp === 10 || (cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255) || CP1252_EXTRA.indexOf(ch) >= 0) {
      out += ch;
    }
    /* lo que no entra se descarta en silencio: un carácter perdido es mejor
       que un documento que no se genera */
  }
  return out;
}

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

function htmlToText(html) {
  var t = html;
  t = t.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n# $1\n\n');
  t = t.replace(/<\s*(strong|b)\s*>/gi, '**').replace(/<\s*\/\s*(strong|b)\s*>/gi, '**');
  t = t.replace(/<\s*\/?\s*em\s*>/gi, '');
  t = t.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  t = t.replace(/<\s*\/\s*div\s*>/gi, '\n\n');
  t = t.replace(/<[^>]+>/g, '\n');
  t = t.replace(/&[a-z#0-9]+;/gi, function (e) {
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : ' ';
  });
  t = t.split('\n').map(function (l) { return l.trim(); }).join('\n');
  t = t.replace(/\*\*\s*\*\*/g, '');           // negritas que quedaron vacías
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return toWinAnsi(t);
}

/* Los literales no contienen backticks, así que alcanza con cortar entre el
   primero y el siguiente. Si algún día dejan de estar, se lanza: preferible a
   adjuntar un PDF con los T&C en blanco. */
function extractLiteral(src, name) {
  var start = src.indexOf('const ' + name + ' = `');
  if (start < 0) throw new Error('No encontré ' + name + ' en index.html');
  var from = src.indexOf('`', start) + 1;
  var to = src.indexOf('`', from);
  if (to < 0) throw new Error('Literal ' + name + ' sin cerrar en index.html');
  return src.slice(from, to);
}

export function loadTycText() {
  var src = fs.readFileSync(INDEX_PATH, 'utf8');
  var ver = /const CONSENT_VERSION\s*=\s*'([^']+)'/.exec(src);
  return {
    version: ver ? ver[1] : '',
    tyc: htmlToText(extractLiteral(src, 'TYC_HTML')),
    privacidad: htmlToText(extractLiteral(src, 'PRIVACY_HTML')),
  };
}
