/**
 * tests/intake-wizard.test.js
 *
 * El componente compartido de alta (`src/js/intake-wizard.js`) corriendo en un DOM real.
 *
 *   node tests/intake-wizard.test.js
 *
 * Por qué jsdom y no `node --check`: el wizard construye su propio DOM, cablea decenas
 * de listeners y navega por un árbol condicional. Los bugs que importan —un paso que no
 * aparece, un botón sin cablear, un payload con la clave equivocada— solo se ven
 * ejecutándolo. Es la misma lección que dejó la suite de formularios.
 *
 * Lo que NO cubre, porque necesita red y base: el envío real contra los endpoints. El
 * componente no hace fetch por su cuenta —quien envía es la superficie— así que acá se
 * verifica el payload que entrega, no lo que pasa después. Eso se prueba en staging.
 *
 * Exit code distinto de 0 si algo falla.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

var RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var FUENTE = fs.readFileSync(path.join(RAIZ, 'src/js/intake-wizard.js'), 'utf8');

var TTY = process.stdout.isTTY;
function c(codigo, s) { return TTY ? '\x1b[' + codigo + 'm' + s + '\x1b[0m' : s; }
var verde = function (s) { return c('32', s); };
var rojo = function (s) { return c('31', s); };
var gris = function (s) { return c('90', s); };

var ok = 0, fail = 0;
function afirmar(etiqueta, cond, detalle) {
  if (cond) { ok++; console.log('  ' + verde('✓ ' + etiqueta)); return; }
  fail++;
  console.log('  ' + rojo('✗ ' + etiqueta) + (detalle ? '\n      ' + detalle : ''));
}
function igual(etiqueta, real, esperado) {
  var r = JSON.stringify(real), e = JSON.stringify(esperado);
  afirmar(etiqueta, r === e, 'esperado ' + e + ', real ' + r);
}
function seccion(t) { console.log('\n' + gris('── ' + t + ' ──')); }

/* ---------- harness ---------- */

function montar(opciones) {
  var dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  var W = dom.window, D = W.document;
  var errores = [];
  W.addEventListener('error', function (e) { errores.push(e.message); });
  var s = D.createElement('script');
  s.textContent = FUENTE;
  D.body.appendChild(s);

  var enviados = [];
  var base = {
    alEnviar: function (p, listo) { enviados.push(p); listo(null, { ref_code: 'CSA00042' }); },
    alElegirArchivo: function (clave, listo) { listo('doc_' + clave + '_' + Date.now() % 1000 + '.pdf'); },
  };
  for (var k in (opciones || {})) if (opciones.hasOwnProperty(k)) base[k] = opciones[k];

  var wz = W.IntakeWizard.crear(base);
  wz.abrir();

  var raiz = wz.elemento;
  function q(sel) { return raiz.querySelector(sel); }
  function paso() { var n = raiz.querySelector('.iw-ms.iw-on'); return n ? n.getAttribute('data-ms') : '(ninguno)'; }
  function seguir() { q('[data-seguir]').click(); }
  function atras() { q('[data-atras]').click(); }
  function elegir(valor) {
    var b = raiz.querySelector('.iw-ms.iw-on .iw-opt[data-val="' + valor + '"]');
    if (!b) throw new Error('no hay opción "' + valor + '" en el paso ' + paso());
    b.click();
  }
  function tipo(t) { raiz.querySelector('[data-ctype="' + t + '"]').click(); }
  function set(id, v) { var n = raiz.querySelector('#iw-' + id); if (!n) throw new Error('sin campo ' + id); n.value = v; }
  function pct() { return q('[data-prog-pct]').textContent; }

  return {
    W: W, D: D, wz: wz, raiz: raiz, errores: errores, enviados: enviados,
    q: q, paso: paso, seguir: seguir, atras: atras, elegir: elegir, tipo: tipo, set: set, pct: pct,
    esperar: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
  };
}

/* Las tarjetas avanzan solas a los 180ms. */
var SALTO = 240;

(async function () {
  console.log('\nIntake wizard — componente compartido en DOM real\n');

  /* ============================================================
     1 · arranque
     ============================================================ */
  seccion('arranque');
  var t = montar({ superficie: 'b2c' });
  afirmar('monta sin errores de consola', t.errores.length === 0, t.errores.join(' | '));
  igual('abre en el selector de tipo', t.paso(), 'tipo');
  afirmar('la barra de progreso está oculta en la primera pantalla',
    t.q('[data-prog]').style.display === 'none');
  afirmar('no hay botón Atrás en la primera pantalla',
    t.q('[data-atras]').style.display === 'none');

  /* ============================================================
     2 · rama vuelo completa
     ============================================================ */
  seccion('rama vuelo · overbooking → medios propios');
  t.tipo('vuelo'); await t.esperar(SALTO);
  igual('tras elegir tipo va al escáner', t.paso(), 'scan');
  afirmar('la barra de progreso aparece', t.q('[data-prog]').style.display !== 'none');

  t.q('[data-scan-skip]').click();
  igual('"cargar a mano" salta a aerolínea', t.paso(), 'airline');

  var antes = t.paso();
  t.seguir();
  igual('sin aerolínea no avanza', t.paso(), antes);
  afirmar('marca el campo en rojo', t.q('[data-field="aerolinea"]').className.indexOf('iw-bad') > -1);

  t.set('aerolinea', 'Aerolíneas Argentinas');
  t.set('vuelo_nro', 'AR1134');
  t.seguir();
  igual('con los dos campos avanza', t.paso(), 'tipoviaje');

  t.elegir('ida_vuelta'); await t.esperar(SALTO);
  igual('ida y vuelta destapa la dirección', t.paso(), 'direccion');
  t.elegir('vuelta'); await t.esperar(SALTO);
  igual('luego escalas', t.paso(), 'escalas');
  t.elegir('si'); await t.esperar(SALTO);
  igual('con escalas destapa el armador', t.paso(), 'armador');
  t.seguir();
  igual('luego la ruta', t.paso(), 'ruta');
  igual('etiqueta contextual de origen',
    t.q('[data-lbl-origen]').textContent, 'El viaje de vuelta despegó en');
  igual('etiqueta contextual de destino',
    t.q('[data-lbl-destino]').textContent, 'El viaje de vuelta finalizó en');

  t.set('origen', 'Madrid (MAD)');
  t.set('destino', 'Buenos Aires (EZE)');
  t.seguir();
  igual('luego la fecha', t.paso(), 'fecha');

  t.set('fecha_vuelo', '2026-06-20');
  var antesPnr = t.paso();
  t.seguir();
  igual('PNR obligatorio: sin PNR no avanza', t.paso(), antesPnr);
  t.set('pnr', 'QK7X2M');
  t.seguir();
  igual('con PNR avanza al incidente', t.paso(), 'incident');

  t.elegir('overbooking'); await t.esperar(SALTO);
  igual('overbooking pregunta por el embarque', t.paso(), 'embarque');
  t.elegir('si'); await t.esperar(SALTO);
  igual('luego qué ofreció', t.paso(), 'refund');
  t.elegir('nada'); await t.esperar(SALTO);
  igual('luego si viajó', t.paso(), 'viajo');
  t.elegir('medios_propios'); await t.esperar(SALTO);
  igual('medios propios pregunta las horas', t.paso(), 'viajohoras');
  t.set('viajo_horas', '9');
  t.seguir();
  igual('y después el pasaje alternativo', t.paso(), 'pasajealt');

  /* comprobante obligatorio */
  t.set('pasaje_alternativo_monto', '850');
  var antesComp = t.paso();
  t.seguir();
  igual('sin comprobante no avanza', t.paso(), antesComp);
  afirmar('avisa qué falta',
    t.q('.iw-ms[data-ms="pasajealt"] [data-file-err]').textContent.indexOf('comprobante') > -1);
  t.q('[data-drop="pasaje"]').click();
  afirmar('el aviso se limpia al adjuntar',
    t.q('.iw-ms[data-ms="pasajealt"] [data-file-err]').textContent === '');
  t.seguir();
  igual('con comprobante avanza a la causa', t.paso(), 'cause');

  /* ============================================================
     3 · el árbol se reconfigura al cambiar una respuesta
     ============================================================ */
  seccion('reconfiguración del árbol');
  t.atras(); t.atras(); t.atras();
  igual('tres pasos atrás vuelve a "si viajó"', t.paso(), 'viajo');
  t.elegir('no_viajo'); await t.esperar(SALTO);
  igual('cambiar a "no viajó" saltea horas y pasaje', t.paso(), 'cause');

  /* ============================================================
     4 · agregador de gastos
     ============================================================ */
  seccion('agregador de gastos');
  t.seguir();
  igual('tras la causa, la compuerta de gastos', t.paso(), 'gastosgate');
  t.elegir('si'); await t.esperar(SALTO);
  igual('"sí" abre el agregador', t.paso(), 'gastos');

  var antesG = t.paso();
  t.seguir();
  igual('con cero gastos no deja avanzar', t.paso(), antesG);

  function agregarGasto(desc, moneda, monto) {
    t.q('[data-gasto-add]').click();
    t.set('g_desc', desc);
    t.set('g_cur', moneda);
    t.set('g_amt', monto);
    t.q('[data-drop="gasto_item"]').click();
    t.q('[data-g-save]').click();
  }

  t.q('[data-gasto-add]').click();
  t.q('[data-g-save]').click();
  afirmar('exige descripción', t.q('[data-gerr]').textContent.indexOf('descripción') > -1);
  t.set('g_desc', 'Hotel una noche');
  t.q('[data-g-save]').click();
  afirmar('exige monto', t.q('[data-gerr]').textContent.indexOf('monto') > -1);
  t.set('g_amt', '120'); t.set('g_cur', 'USD');
  t.q('[data-g-save]').click();
  afirmar('exige comprobante', t.q('[data-gerr]').textContent.indexOf('comprobante') > -1);
  t.q('[data-drop="gasto_item"]').click();
  t.q('[data-g-save]').click();
  igual('queda un gasto cargado', t.raiz.querySelectorAll('.iw-gitem').length, 1);

  agregarGasto('Taxi al hotel', 'USD', '30');
  igual('total de una sola moneda',
    t.q('[data-gastos-total-v]').textContent, 'USD 150.00');
  igual('etiqueta en singular', t.q('[data-gastos-total-l]').textContent, 'Total cargado');

  agregarGasto('Cena en el aeropuerto', 'ARS', '8000');
  agregarGasto('Traslado', 'EUR', '45');
  var totales = Array.prototype.map.call(
    t.q('[data-gastos-total-v]').querySelectorAll('span'), function (n) { return n.textContent; });
  igual('varias monedas quedan LISTADAS, no sumadas entre sí',
    totales, ['USD 150.00', 'ARS 8000.00', 'EUR 45.00']);
  afirmar('la caja pasa a modo multi-moneda',
    t.q('[data-gastos-total]').className.indexOf('iw-multi') > -1);
  igual('etiqueta en plural', t.q('[data-gastos-total-l]').textContent, 'Totales por moneda');

  var nombres = Array.prototype.map.call(
    t.raiz.querySelectorAll('.iw-gitem-f > span'), function (n) { return n.textContent; });
  afirmar('el comprobante se renombra "Gasto N - MONEDA MONTO"',
    /^Gasto 1 - USD 120\.00\./.test(nombres[0]) && /^Gasto 4 - EUR 45\.00\./.test(nombres[3]),
    JSON.stringify(nombres));

  t.raiz.querySelectorAll('.iw-gitem-del')[0].click();
  var nombres2 = Array.prototype.map.call(
    t.raiz.querySelectorAll('.iw-gitem-f > span'), function (n) { return n.textContent; });
  afirmar('borrar el primero renumera los que quedan',
    /^Gasto 1 - USD 30\.00\./.test(nombres2[0]) && nombres2.length === 3, JSON.stringify(nombres2));

  /* ============================================================
     5 · pasos nuevos antes de los datos personales
     ============================================================ */
  seccion('otra documentación y comentarios');
  t.seguir();
  igual('tras gastos, equipaje combinado', t.paso(), 'combogate');
  t.elegir('no'); await t.esperar(SALTO);
  igual('luego acompañantes', t.paso(), 'acompgate');
  t.elegir('no'); await t.esperar(SALTO);
  igual('otra documentación va ANTES de los datos personales', t.paso(), 'otrosdocs');

  var zona = t.q('[data-drop="otros"]');
  for (var i = 0; i < 7; i++) zona.click();
  igual('el tope de 5 archivos se respeta aunque se insista',
    t.raiz.querySelectorAll('[data-chips="otros"] .iw-chip').length, 5);
  afirmar('el dropzone se marca lleno', zona.className.indexOf('iw-full') > -1);
  t.raiz.querySelector('[data-chips="otros"] .iw-chip-x').click();
  afirmar('borrar uno lo reabre',
    t.raiz.querySelectorAll('[data-chips="otros"] .iw-chip').length === 4 &&
    zona.className.indexOf('iw-full') === -1);

  t.seguir();
  igual('luego el comentario libre', t.paso(), 'comentario');
  var ta = t.raiz.querySelector('#iw-comentarios_pasajero');
  igual('tope de 1500 caracteres', ta.getAttribute('maxlength'), '1500');
  ta.value = 'Viajaba con mi hija de 3 años y estuvimos 9 horas sin asistencia.';
  ta.dispatchEvent(new t.W.Event('input'));
  igual('el contador acompaña', t.q('[data-com-cnt]').textContent, String(ta.value.length));
  t.seguir();
  igual('recién ahí los datos personales', t.paso(), 'pers1');

  /* ============================================================
     6 · datos personales, firma y payload
     ============================================================ */
  seccion('firma y payload');
  t.set('nombre', 'Juan Pablo Martínez'); t.seguir();
  t.set('telefono', '+5491125578402'); t.set('email', 'juan@email.com'); t.seguir();
  t.set('documento_tipo', 'DNI'); t.set('documento_numero', '37806475'); t.seguir();
  igual('llega a la firma', t.paso(), 'firma');
  var pctFirma = parseInt(t.pct(), 10);
  afirmar('el progreso está cerca del final pero no en 100%',
    pctFirma >= 90 && pctFirma < 100, 'real ' + t.pct());

  var cbAntes = t.raiz.querySelector('#iw-consent').checked;
  t.raiz.querySelector('[data-doc="tyc"]').click();
  afirmar('T&C abre en popup anidado',
    t.D.querySelector('.iw-ov-doc').className.indexOf('iw-open') > -1);
  afirmar('abrir el documento NO tilda el consentimiento',
    t.raiz.querySelector('#iw-consent').checked === cbAntes);
  t.D.querySelector('[data-doc-ok]').click();

  var antesFirma = t.paso();
  t.seguir();
  igual('sin tildar el consentimiento no envía', t.paso(), antesFirma);

  var cb = t.raiz.querySelector('#iw-consent');
  cb.checked = true;
  cb.dispatchEvent(new t.W.Event('change'));
  t.seguir();
  await t.esperar(30);
  igual('envía y llega al éxito', t.paso(), 'done');
  igual('muestra el número de caso', t.q('[data-done-id]').textContent, 'CSA00042');
  afirmar('el pie desaparece en el éxito', t.q('[data-foot]').style.display === 'none');

  var p = t.enviados[0];
  seccion('claves del payload contra el contrato de la API');
  igual('tipo_reclamo', p.tipo_reclamo, 'vuelo');
  igual('aerolinea', p.aerolinea, 'Aerolíneas Argentinas');
  igual('vuelo_nro', p.vuelo_nro, 'AR1134');
  igual('pnr', p.pnr, 'QK7X2M');
  igual('fecha_vuelo', p.fecha_vuelo, '2026-06-20');
  igual('tipo_viaje', p.tipo_viaje, 'ida_vuelta');
  igual('direccion_afectada', p.direccion_afectada, 'vuelta');
  igual('tipo_incidencia', p.tipo_incidencia, 'overbooking');
  igual('embarque_presentado', p.embarque_presentado, 'si');
  igual('ofrecimiento_aerolinea', p.ofrecimiento_aerolinea, 'nada');
  igual('viajo_finalmente tras el cambio', p.viajo_finalmente, 'no_viajo');
  afirmar('no viajó: el pasaje alternativo NO viaja',
    p.pasaje_alternativo_monto === null && p.pasaje_alternativo_moneda === null);
  igual('comentarios_pasajero llega entero', p.comentarios_pasajero, ta.value);
  igual('otros_archivos', p.otros_archivos.length, 4);
  igual('gastos_items: quedaron 3', p.gastos_items.length, 3);
  igual('cada gasto trae las claves del contrato',
    Object.keys(p.gastos_items[0]).sort(), ['archivo', 'concepto', 'fuente', 'moneda', 'monto']);
  igual('la fuente es la del formulario público', p.gastos_items[0].fuente, 'declaracion_pasajero');
  afirmar('el nombre del comprobante se calcula al enviar, ya renumerado',
    /^Gasto 1 - USD 30\.00\./.test(p.gastos_items[0].archivo), p.gastos_items[0].archivo);
  igual('consent_tyc', p.consent_tyc, true);

  seccion('criterio negativo permanente');
  afirmar('el comentario libre NO aparece en la declaración jurada',
    t.raiz.querySelector('.iw-ddjj').textContent.indexOf('hija de 3 años') === -1);
  afirmar('la DDJJ conserva a los representantes y el bullet de menores',
    t.raiz.querySelector('.iw-ddjj').textContent.indexOf('Juan Pablo Mario Adaniya') > -1 &&
    t.raiz.querySelector('.iw-ddjj').textContent.indexOf('responsable legal o tutor/a') > -1);

  afirmar('sin errores de consola en todo el recorrido', t.errores.length === 0, t.errores.join(' | '));

  /* ============================================================
     7 · rama equipaje
     ============================================================ */
  seccion('rama equipaje');
  var e = montar({ superficie: 'b2c' });
  e.tipo('equipaje'); await e.esperar(SALTO);
  e.q('[data-scan-skip]').click();
  e.set('aerolinea', 'LATAM'); e.set('vuelo_nro', 'LA800'); e.seguir();
  e.elegir('solo_ida'); await e.esperar(SALTO);
  igual('solo ida NO pregunta la dirección', e.paso(), 'escalas');
  e.elegir('no'); await e.esperar(SALTO);
  igual('sin escalas NO muestra el armador', e.paso(), 'ruta');
  igual('etiqueta neutra sin dirección',
    e.q('[data-lbl-origen]').textContent, 'El viaje despegó en');
  e.set('origen', 'EZE'); e.set('destino', 'GRU'); e.seguir();
  e.set('fecha_vuelo', '2026-05-02'); e.set('pnr', 'ZZ11AA'); e.seguir();
  igual('en equipaje no aparece el incidente de vuelo', e.paso(), 'bagtype');
  e.elegir('perdida'); await e.esperar(SALTO);
  igual('pérdida salta la fecha de entrega', e.paso(), 'bagvalue');
  afirmar('en pérdida el valor es obligatorio',
    e.raiz.querySelector('#iw-valor_equipaje').getAttribute('data-req') === '1');
  e.set('valor_equipaje', '800'); e.seguir();
  igual('luego el PIR', e.paso(), 'bagpir');
  e.elegir('si'); await e.esperar(SALTO);
  igual('PIR sí destapa el número', e.paso(), 'bagpirnum');
  e.seguir();
  igual('luego la descripción', e.paso(), 'bagdesc');
  e.set('descripcion_equipaje', 'Nunca apareció la valija'); e.seguir();
  igual('luego gastos', e.paso(), 'gastosgate');
  e.elegir('no'); await e.esperar(SALTO);
  igual('en equipaje NO se pregunta por equipaje combinado', e.paso(), 'acompgate');
  afirmar('sin errores de consola en la rama equipaje', e.errores.length === 0, e.errores.join(' | '));

  /* ============================================================
     8 · variantes por superficie
     ============================================================ */
  seccion('variantes por superficie');
  var bo = montar({ superficie: 'backoffice', firma: false, escaner: false });
  igual('backoffice arranca igual en el tipo', bo.paso(), 'tipo');
  afirmar('sin escáner el paso no existe',
    bo.raiz.querySelector('.iw-ms[data-ms="scan"]') === null);
  afirmar('sin firma no hay checkbox de consentimiento',
    bo.raiz.querySelector('#iw-consent') === null);
  igual('el texto del tipo se adapta a superficie interna',
    bo.raiz.querySelector('.iw-ms[data-ms="tipo"] .iw-q').textContent, '¿Qué tipo de reclamo es?');

  bo.tipo('vuelo'); await bo.esperar(SALTO);
  igual('sin escáner salta directo a aerolínea', bo.paso(), 'airline');

  var ag = montar({ superficie: 'agencia', firma: false });
  ag.tipo('vuelo'); await ag.esperar(SALTO);
  ag.q('[data-scan-skip]').click();
  ag.set('aerolinea', 'IB'); ag.set('vuelo_nro', 'IB6844'); ag.seguir();
  ag.elegir('solo_ida'); await ag.esperar(SALTO);
  ag.elegir('no'); await ag.esperar(SALTO);
  ag.set('origen', 'EZE'); ag.set('destino', 'MAD'); ag.seguir();
  ag.set('fecha_vuelo', '2026-07-01'); ag.set('pnr', 'AG1234'); ag.seguir();
  ag.elegir('demora'); await ag.esperar(SALTO);
  ag.set('horas_retraso', '5'); ag.seguir();
  ag.seguir();                                  /* causa es opcional */
  ag.elegir('no'); await ag.esperar(SALTO);     /* sin gastos */
  ag.elegir('no'); await ag.esperar(SALTO);     /* sin equipaje combinado */
  ag.elegir('no'); await ag.esperar(SALTO);     /* sin acompañantes */
  ag.seguir();                                   /* otra documentación */
  ag.seguir();                                   /* comentario */
  ag.set('nombre', 'Cliente Agencia'); ag.seguir();
  ag.set('telefono', '+5491100000000'); ag.set('email', 'cli@agencia.com'); ag.seguir();
  ag.set('documento_tipo', 'DNI'); ag.set('documento_numero', '30111222'); ag.seguir();
  igual('agencia llega al último paso sin firma', ag.paso(), 'firma');
  ag.seguir();
  await ag.esperar(30);
  igual('agencia envía sin consentimiento', ag.paso(), 'done');
  var pa = ag.enviados[0];
  igual('sin gastos, gastos_items va vacío (no null)', pa.gastos_items, []);
  afirmar('sin firma no viaja consent_tyc', pa.consent_tyc === undefined);
  afirmar('sin errores de consola en agencia', ag.errores.length === 0, ag.errores.join(' | '));

  /* la fuente de gastos cambia por superficie */
  var ag2 = montar({ superficie: 'agencia', firma: false, escaner: false });
  ag2.tipo('vuelo'); await ag2.esperar(SALTO);
  ag2.set('aerolinea', 'IB'); ag2.set('vuelo_nro', 'IB1'); ag2.seguir();
  ag2.elegir('solo_ida'); await ag2.esperar(SALTO);
  ag2.elegir('no'); await ag2.esperar(SALTO);
  ag2.set('origen', 'EZE'); ag2.set('destino', 'MAD'); ag2.seguir();
  ag2.set('fecha_vuelo', '2026-07-01'); ag2.set('pnr', 'AG9'); ag2.seguir();
  ag2.elegir('demora'); await ag2.esperar(SALTO);
  ag2.set('horas_retraso', '3'); ag2.seguir();
  ag2.seguir();
  ag2.elegir('si'); await ag2.esperar(SALTO);
  ag2.q('[data-gasto-add]').click();
  ag2.set('g_desc', 'Hotel'); ag2.set('g_amt', '50'); ag2.set('g_cur', 'USD');
  ag2.q('[data-drop="gasto_item"]').click();
  ag2.q('[data-g-save]').click();
  igual('la fuente del gasto es "agencia"', ag2.wz.payload().gastos_items[0].fuente, 'agencia');

  /* ============================================================
     9 · seguridad y cierre
     ============================================================ */
  seccion('escapado y cierre');
  var x = montar({ superficie: 'b2c' });
  x.tipo('vuelo'); await x.esperar(SALTO);
  x.q('[data-scan-skip]').click();
  x.set('aerolinea', 'A'); x.set('vuelo_nro', 'B'); x.seguir();
  x.elegir('solo_ida'); await x.esperar(SALTO);
  x.elegir('no'); await x.esperar(SALTO);
  x.set('origen', 'EZE'); x.set('destino', 'MAD'); x.seguir();
  x.set('fecha_vuelo', '2026-07-01'); x.set('pnr', 'X1'); x.seguir();
  x.elegir('demora'); await x.esperar(SALTO);
  x.set('horas_retraso', '2'); x.seguir();
  x.seguir();
  x.elegir('si'); await x.esperar(SALTO);
  x.q('[data-gasto-add]').click();
  x.set('g_desc', '<img src=x onerror="window.__hackeado=1">');
  x.set('g_amt', '10');
  x.q('[data-drop="gasto_item"]').click();
  x.q('[data-g-save]').click();
  afirmar('el concepto del gasto no inyecta HTML',
    x.raiz.querySelectorAll('.iw-gitem img').length === 0 && x.W.__hackeado === undefined);
  igual('y se muestra como texto plano',
    x.raiz.querySelector('.iw-gitem-t').textContent, '<img src=x onerror="window.__hackeado=1">');

  x.q('[data-cerrar]').click();
  afirmar('cerrar con carga a medias pide confirmación',
    x.D.querySelector('.iw-ov-cfm').className.indexOf('iw-open') > -1);
  afirmar('el formulario sigue abierto detrás', x.raiz.className.indexOf('iw-open') > -1);
  x.D.querySelector('[data-cfm-no]').click();
  afirmar('"seguir cargando" vuelve al formulario',
    x.D.querySelector('.iw-ov-cfm').className.indexOf('iw-open') === -1 &&
    x.raiz.className.indexOf('iw-open') > -1);
  x.raiz.click();
  afirmar('un click en el fondo también confirma',
    x.D.querySelector('.iw-ov-cfm').className.indexOf('iw-open') > -1);
  x.D.querySelector('[data-cfm-si]').click();
  afirmar('"cerrar y descartar" sí cierra', x.raiz.className.indexOf('iw-open') === -1);
  afirmar('sin errores de consola', x.errores.length === 0, x.errores.join(' | '));

  console.log('\nResumen');
  console.log('  ' + verde(ok + ' ok') + '   ' + (fail ? rojo(fail + ' fallan') : '0 fallan') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.error(rojo('\nLA SUITE EXPLOTÓ: ') + (err && err.message ? err.message : String(err)));
  console.error(err && err.stack);
  process.exit(1);
});
