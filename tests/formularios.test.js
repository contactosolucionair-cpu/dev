/**
 * tests/formularios.test.js
 *
 * Los TRES formularios de alta cargados en un DOM real, ejercitando la pregunta de
 * DIRECCIÓN AFECTADA (enmienda legal v2.1.2): en un ida y vuelta se carga UNA dirección
 * —la del problema— y el formulario tiene que decir cuál.
 *
 *   node tests/formularios.test.js
 *
 * Por qué existe: un cambio que llamaba a `applyTexts()` desde la inicialización de
 * `app.js` pasó `node --check` y llegó a staging roto — `var DICT` se asigna cientos de
 * líneas más abajo, así que en el arranque era `undefined` y el TypeError cortaba todo
 * lo que se registraba después. El síntoma era engañoso: el escaneo seguía completando
 * campos (su handler se engancha antes) y el resto del wizard estaba muerto.
 *
 * Exit code distinto de 0 si algo falla.
 */
import { cargar, crearChequeador, consultas } from './lib/dom.js';

var chk = crearChequeador();

/* ============ 4. INTAKE v3 SOBRE EL FORMULARIO PÚBLICO ============
   El wizard no se abre solo: entra después del muro de Google. Acá se carga
   index.html con el componente y app.js juntos y se simula el login, que es el
   único camino real por el que un pasajero llega al formulario. */
console.log('\n\x1b[1mindex.html + intake-wizard.js — arranque tras el login de Google\x1b[0m');
{
  var r4 = cargar('index.html', { scripts: ['src/js/intake-wizard.js', 'src/js/app.js'] });
  var w4 = r4.window, q4 = consultas(w4);

  chk(r4.errores.length === 0, 'carga sin errores: ' + (r4.errores.join(' | ') || 'ninguno'));
  chk(typeof w4.IntakeWizard === 'object' && typeof w4.IntakeWizard.crear === 'function',
    'el componente quedó expuesto en window.IntakeWizard');
  chk(typeof w4.__abrirIntake === 'function',
    'app.js publicó __abrirIntake para que lo llame el login');
  chk(w4.CONSENT_VERSION === 'TYC-SA-v2.4-2026',
    'CONSENT_VERSION quedó accesible fuera de su IIFE: ' + w4.CONSENT_VERSION);
  chk(w4.document.querySelector('.iw-ov') === null,
    'antes del login el wizard todavía no se montó');
  chk(!q4.visible('wz-launcher'), 'y la tarjeta de entrada arranca oculta');

  console.log('  \x1b[2m-- login de Google (token armado a mano) --\x1b[0m');
  /* Un JWT sin firmar: el front solo decodifica el payload, no lo valida. */
  function b64url(o) {
    return Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  var token = b64url({ alg: 'none' }) + '.' + b64url({
    sub: '1234567890', email: 'juanpi89@gmail.com', email_verified: true,
    name: 'Juanpi', iss: 'https://accounts.google.com',
  }) + '.';
  w4.recibirLoginGoogle({ credential: token });

  chk(!q4.visible('google-login-wall'), 'el muro se oculta');
  chk(q4.visible('form-content-wrapper'), 'y aparece el contenido');

  var ov = w4.document.querySelector('.iw-ov');
  chk(ov !== null, 'el wizard se montó');
  chk(!!ov && ov.className.indexOf('iw-open') > -1, 'y se abrió solo tras verificar la identidad');
  chk(q4.visible('wz-launcher'), 'la tarjeta de entrada queda a la vista para volver');

  console.log('  \x1b[2m-- del formulario largo no queda nada --\x1b[0m');
  var cont4 = q4.$('form-content-wrapper');
  ['.ctype-tabs', '#wizard-steps', '.prog', '.wz-panel'].forEach(function (sel) {
    chk(cont4.querySelector(sel) === null, 'borrado del DOM: ' + sel);
  });
  chk(q4.$('wz-1') === null && q4.$('f-origin') === null,
    'ni los paneles ni los campos siguen en el markup');
  /* Lo que sí queda: la tarjeta para volver al wizard y el bloque de contacto, este
     último ya oculto porque el wizard abrió bien. */
  var contacto4 = q4.$('contacto-fallback');
  chk(!!contacto4 && contacto4.style.display === 'none',
    'el bloque de contacto existe y quedó oculto tras abrir el wizard');

  console.log('  \x1b[2m-- identidad prellenada --\x1b[0m');
  var nom = w4.document.getElementById('iw-nombre');
  var mail = w4.document.getElementById('iw-email');
  chk(!!nom && nom.value === 'Juanpi', 'el nombre de Google llega al wizard: ' + (nom && nom.value));
  chk(!!mail && mail.value === 'juanpi89@gmail.com', 'el mail también: ' + (mail && mail.value));
  chk(!!mail && mail.readOnly === true, 'el mail queda bloqueado');
  chk(!!nom && nom.readOnly === false, 'el nombre queda editable: el poder necesita el del documento');
  var nota = w4.document.querySelector('[data-field="email"] .iw-hint');
  chk(!!nota && nota.textContent.indexOf('Google') > -1, 'y el mail explica por qué no se edita');
  chk(w4.firmaGoogle && w4.firmaGoogle.nombre === 'Juanpi',
    'el nombre de Google queda guardado aparte, para detectar la discrepancia después');

  console.log('  \x1b[2m-- cerrar y volver --\x1b[0m');
  w4.document.querySelector('.iw-ov [data-cerrar]').click();
  chk(w4.document.querySelector('.iw-ov-cfm').className.indexOf('iw-open') > -1,
    'cerrar pide confirmación');
  w4.document.querySelector('[data-cfm-si]').click();
  chk(w4.document.querySelector('.iw-ov').className.indexOf('iw-open') === -1, 'y cierra');
  q4.$('wz-reabrir').click();
  chk(w4.document.querySelector('.iw-ov').className.indexOf('iw-open') > -1,
    'la tarjeta lo vuelve a abrir');
  chk(w4.document.getElementById('iw-nombre').value === 'Juanpi',
    'y conserva lo cargado: reabrir no reinicia');

  chk(r4.errores.length === 0, 'sin errores en todo el recorrido: ' + (r4.errores.join(' | ') || 'ninguno'));
}

/* ============ 5. INTAKE v3 EN EL PORTAL DE AGENCIAS ============
   El wizard es hoy el único camino de carga: el formulario largo se retiró.
   Sin firma, porque el pasajero no está presente. */
console.log('\n\x1b[1mpanel-agencia.html + intake-wizard.js\x1b[0m');
{
  var r5 = cargar('panel-agencia.html', {
    scripts: ['src/js/intake-wizard.js'],
    antes: function (w) {
      w.localStorage.setItem('sa_ag_token', 'test');
      w.localStorage.setItem('sa_ag_email', 'test@test.com');
      w.localStorage.setItem('sa_ag_data', JSON.stringify({ nombre: 'Test', estado: 'aprobada' }));
    },
  });
  var w5 = r5.window, q5 = consultas(w5);

  chk(r5.errores.length === 0, 'carga sin errores: ' + (r5.errores.join(' | ') || 'ninguno'));
  chk(q5.$('wz-abrir') !== null, 'existe el botón de carga guiada');
  chk(q5.$('f-nombre') === null && q5.$('f-tipo-reclamo') === null,
    'y el formulario largo ya no está: el wizard es el único camino');
  chk(w5.document.querySelector('.iw-ov') === null, 'el wizard no se monta hasta que se lo pide');

  q5.$('wz-abrir').click();
  var ov5 = w5.document.querySelector('.iw-ov');
  chk(ov5 !== null && ov5.className.indexOf('iw-open') > -1, 'el botón lo abre');
  /* El escáner IA va en las tres superficies: el mismo endpoint y el mismo mapeo
     de campos. Cargar el itinerario a mano acá y no en el sitio público era una
     asimetría sin motivo. */
  chk(w5.document.querySelector('.iw-ms[data-ms="scan"]') !== null,
    'con escáner: el mismo que el sitio público');
  chk(w5.document.querySelector('[data-scan-cancel]') !== null,
    'y con salida del estado "leyendo": cerrar el selector sin elegir no traba el paso');
  chk(w5.document.getElementById('iw-consent') === null,
    'sin consentimiento: el pasajero no está presente para firmar');
  chk(w5.document.querySelector('.iw-ms[data-ms="firma"]') !== null,
    'pero el paso final existe igual: es desde donde se dispara el envío');
  chk(w5.document.getElementById('iw-nombre') !== null,
    'pide los datos del pasajero completos');
  chk(w5.document.querySelector('.iw-ms[data-ms="acompgate"]') !== null,
    'y los acompañantes');

  console.log('  \x1b[2m-- aislamiento de estilos --\x1b[0m');
  /* La página tiene sus propias .btn y .card. El componente no puede pisarlas: por eso
     todo lo suyo va prefijado `iw-`. Antes esto se medía sobre `.form-wrap .form-group`,
     que era del formulario largo; con el formulario retirado se mide sobre lo que quedó. */
  var propias = w5.document.querySelectorAll('.main .btn').length;
  chk(propias > 0, 'las clases propias de la página siguen presentes (' + propias + ' .btn)');
  var sinPrefijo = Array.prototype.filter.call(ov5.querySelectorAll('[class]'), function (n) {
    return (n.getAttribute('class') || '').split(/\s+/).some(function (c) { return c && c.indexOf('iw-') !== 0; });
  }).length;
  chk(sinPrefijo === 0, 'y el wizard no usa ninguna clase sin prefijar (' + sinPrefijo + ')');
  var sinPrefijo = w5.document.querySelectorAll('.iw-dlg .field, .iw-dlg .card, .iw-dlg .drop').length;
  chk(sinPrefijo === 0, 'el wizard no usa ninguna clase genérica adentro (' + sinPrefijo + ')');

  chk(r5.errores.length === 0, 'sin errores tras abrirlo: ' + (r5.errores.join(' | ') || 'ninguno'));
}

/* ============ 6. INTAKE v3 EN EL BACKOFFICE ============
   Se abre desde "Nuevo caso", que es su único disparador. */
console.log('\n\x1b[1mbackoffice.html + intake-wizard.js\x1b[0m');
{
  var r6 = cargar('backoffice.html', {
    scripts: ['src/js/intake-wizard.js'],
    antes: function (w) { w.sessionStorage.setItem('bo_admin_pwd', 'test'); },
  });
  var w6 = r6.window, q6 = consultas(w6);

  chk(r6.errores.length === 0, 'carga sin errores: ' + (r6.errores.join(' | ') || 'ninguno'));
  /* Del formulario largo no queda nada: "Nuevo caso" es hoy el disparador del wizard. */
  chk(q6.$('nc-ov') === null && q6.$('nc-save') === null && q6.$('nc-nombre') === null,
    'el modal de alta manual se borró del DOM');
  chk(q6.$('btn-nuevo-caso') !== null, 'y "Nuevo caso" sigue en su lugar');

  q6.$('btn-nuevo-caso').click();
  var ov6 = w6.document.querySelector('.iw-ov');
  chk(ov6 !== null && ov6.className.indexOf('iw-open') > -1, 'el botón abre el wizard directo');
  chk(w6.document.getElementById('iw-consent') === null, 'sin firma: el pasajero no está presente');
  chk(w6.document.querySelector('.iw-ms[data-ms="scan"]') !== null,
    'con escáner: el mismo que el sitio público');
  chk(w6.document.querySelector('[data-scan-cancel]') !== null,
    'y con salida del estado "leyendo": cerrar el selector sin elegir no traba el paso');

  console.log('  \x1b[2m-- comprobante por ítem en el editor legal --\x1b[0m');
  /* `archivo` estaba en el contrato de gastos_items pero este editor no lo mostraba:
     un gasto cargado por un admin quedaba sin comprobante. */
  var filaGasto = w6.dlGastoRowHtml
    ? w6.dlGastoRowHtml({ concepto: 'Hotel', monto: 120, moneda: 'USD', archivo: 'Gasto 1 - USD 120.00.pdf' })
    : null;
  if (filaGasto === null) {
    /* La función vive dentro del closure: se verifica sobre el markup del editor ya
       renderizado en su lugar. */
    var fuenteBo = w6.document.documentElement.innerHTML;
    chk(fuenteBo.indexOf('dl-g-archivo') > -1, 'la fila de gasto declara el campo de comprobante');
  } else {
    chk(filaGasto.indexOf('dl-g-archivo') > -1, 'la fila de gasto incluye el comprobante');
  }

  console.log('  \x1b[2m-- aislamiento de estilos --\x1b[0m');
  var sinPrefijo6 = w6.document.querySelectorAll('.iw-dlg .field, .iw-dlg .card, .iw-dlg .drop, .iw-dlg .btn').length;
  chk(sinPrefijo6 === 0, 'el wizard no usa clases genéricas adentro (' + sinPrefijo6 + ')');
  chk(w6.document.querySelectorAll('.cm-ov').length > 0, 'los modales propios del backoffice siguen ahí');

  chk(r6.errores.length === 0, 'sin errores tras abrirlo: ' + (r6.errores.join(' | ') || 'ninguno'));
}

console.log('\nResumen');
console.log('  \x1b[32m' + chk.estado.ok + ' ok\x1b[0m   ' + (chk.estado.fail ? '\x1b[31m' + chk.estado.fail + ' fallan\x1b[0m' : '\x1b[2m0 fallan\x1b[0m') + '\n');
process.exit(chk.estado.fail ? 1 : 0);
