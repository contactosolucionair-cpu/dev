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

/* ============ 1. FORMULARIO PÚBLICO ============ */
console.log('\n\x1b[1mindex.html + src/js/app.js\x1b[0m');
{
  var r = cargar('index.html', { scripts: ['src/js/app.js'] });
  var q = consultas(r.window);

  chk(r.errores.length === 0, r.errores.length ? 'errores en el arranque: ' + r.errores.map(String).join(' | ') : 'arranque limpio');
  chk(!q.visible('field-direccion'), 'la pregunta de dirección arranca oculta');
  q.cambiar('f-tipo-viaje', 'solo_ida');
  chk(!q.visible('field-direccion'), 'solo ida → sigue oculta');
  q.cambiar('f-tipo-viaje', 'ida_vuelta');
  chk(q.visible('field-direccion'), 'ida y vuelta → visible');
  q.cambiar('f-direccion', 'vuelta');
  chk(q.lbl('f-origin') === 'Origen de la vuelta', 'origen: "' + q.lbl('f-origin') + '"');
  chk(q.lbl('f-destination') === 'Destino de la vuelta', 'destino: "' + q.lbl('f-destination') + '"');
  chk(q.lbl('f-escalas') === '¿Tuviste escalas en la vuelta?', 'escalas: "' + q.lbl('f-escalas') + '"');
  chk(q.visible('hint-direccion'), 'el hint aparece al elegir dirección');

  /* El renombrado cambia la CLAVE data-t, no el texto: el conmutador de idioma tiene
     que seguir funcionando solo. */
  r.window.document.querySelector('.lang__btn[data-lang-btn="en"]').click();
  chk(q.lbl('f-origin') === 'Return origin', 'en inglés: "' + q.lbl('f-origin') + '"');
  chk(q.lbl('f-escalas') === 'Did the return have connections?', 'escalas en inglés: "' + q.lbl('f-escalas') + '"');
  r.window.document.querySelector('.lang__btn[data-lang-btn="es"]').click();
  chk(q.val('f-direccion') === 'vuelta', 'la dirección elegida sobrevive al cambio de idioma');

  q.cambiar('f-tipo-viaje', 'solo_ida');
  chk(q.val('f-direccion') === '', 'volver a solo ida limpia el valor');
  chk(q.lbl('f-origin') === 'Origen', 'y la etiqueta vuelve a neutra');
}

/* ============ 2. PANEL DE AGENCIAS ============ */
console.log('\n\x1b[1mpanel-agencia.html\x1b[0m');
{
  /* Sin token el panel hace `location.href = '/agencias'` y corta el script antes de
     armar nada: hay que sembrar la sesión en beforeParse. */
  var r2 = cargar('panel-agencia.html', {
    antes: function (w) {
      w.localStorage.setItem('sa_ag_token', 'test');
      w.localStorage.setItem('sa_ag_email', 'test@test.com');
      w.localStorage.setItem('sa_ag_data', JSON.stringify({ nombre: 'Test', estado: 'aprobada' }));
    },
  });
  var q2 = consultas(r2.window);

  chk(r2.errores.length === 0, r2.errores.length ? 'errores en el arranque: ' + r2.errores.map(String).join(' | ') : 'arranque limpio');
  chk(q2.$('f-direccion') !== null, 'el select de dirección existe');
  chk(!q2.visible('field-direccion'), 'arranca oculta');
  q2.cambiar('f-tipo-viaje', 'ida_vuelta');
  chk(q2.visible('field-direccion'), 'ida y vuelta → visible');
  q2.cambiar('f-direccion', 'vuelta');
  chk(q2.texto('lbl-origen') === 'Origen de la vuelta', 'origen: "' + q2.texto('lbl-origen') + '"');
  chk(q2.texto('lbl-escalas') === '¿Hubo escalas en la vuelta?', 'escalas: "' + q2.texto('lbl-escalas') + '"');
  chk(q2.visible('hint-direccion'), 'hint visible');
  q2.cambiar('f-tipo-viaje', 'solo_ida');
  chk(q2.val('f-direccion') === '', 'volver a solo ida limpia el valor');
  chk(q2.texto('lbl-origen') === 'Origen', 'y la etiqueta vuelve a neutra');
}

/* ============ 3. BACKOFFICE ============ */
console.log('\n\x1b[1mbackoffice.html\x1b[0m');
{
  var r3 = cargar('backoffice.html', {
    antes: function (w) { w.localStorage.setItem('sa_admin_pwd', 'test'); },
  });
  var q3 = consultas(r3.window);

  chk(r3.errores.length === 0, r3.errores.length ? 'errores en el arranque: ' + r3.errores.map(String).join(' | ') : 'arranque limpio');

  console.log('  \x1b[2m-- markup del Intake v2 --\x1b[0m');
  ['nc-tipo-viaje', 'nc-direccion', 'nc-escalas', 'nc-armador', 'nc-arm-lista', 'nc-arm-tramos',
    'nc-ruta-box', 'nc-ruta-tramos', 'nc-scan-zone', 'nc-scan-btn', 'nc-hint-direccion']
    .forEach(function (id) { chk(q3.$(id) !== null, 'existe #' + id); });

  console.log('  \x1b[2m-- comportamiento --\x1b[0m');
  chk(!q3.visible('nc-direccion'), 'la pregunta arranca oculta');
  q3.cambiar('nc-tipo-viaje', 'ida_vuelta');
  chk(q3.visible('nc-direccion'), 'ida y vuelta → visible');
  q3.cambiar('nc-direccion', 'vuelta');
  /* Acá no hay labels ni i18n: la pregunta vive en el placeholder y en la primera
     opción del select, así que el renombrado va sobre eso. */
  chk(q3.ph('nc-origen') === 'Origen de la vuelta', 'placeholder origen: "' + q3.ph('nc-origen') + '"');
  chk(q3.ph('nc-destino') === 'Destino de la vuelta', 'placeholder destino: "' + q3.ph('nc-destino') + '"');
  chk(q3.$('nc-escalas').options[0].textContent === '¿Hubo escalas en la vuelta?', 'opción escalas: "' + q3.$('nc-escalas').options[0].textContent + '"');
  chk(q3.visible('nc-hint-direccion'), 'hint visible');

  console.log('  \x1b[2m-- armador de escalas --\x1b[0m');
  chk(!q3.visible('nc-armador'), 'el armador arranca oculto');
  q3.cambiar('nc-escalas', 'si');
  chk(q3.visible('nc-armador'), 'con escalas → visible');
  chk(q3.$('nc-arm-lista').children.length === 1, 'arranca con una fila');
  q3.$('nc-arm-add').click();
  chk(q3.$('nc-arm-lista').children.length === 2, 'el botón agrega otra');
  q3.$('nc-arm-lista').querySelector('.arm-row__rm').click();
  chk(q3.$('nc-arm-lista').children.length === 1, 'la ✕ la quita');
  q3.cambiar('nc-escalas', 'no');
  chk(!q3.visible('nc-armador'), 'sin escalas → oculto');

  console.log('  \x1b[2m-- ventana del motor legal --\x1b[0m');
  /* El contenido lo arma `abrirMotorLegal()` con un caso concreto, así que acá solo se
     verifica el contenedor: que exista, que arranque cerrado y que arranque vacío. Que el
     editor y el análisis se pinten bien adentro se prueba a mano sobre un caso. */
  ['ml-ov', 'ml-body', 'ml-close'].forEach(function (id) { chk(q3.$(id) !== null, 'existe #' + id); });
  chk(!q3.$('ml-ov').classList.contains('open'), 'la ventana arranca cerrada');
  chk(q3.$('ml-body').innerHTML.trim() === '', 'y vacía: el render cuesta ~370 líneas y se paga al abrir, no al mirar el caso');

  console.log('  \x1b[2m-- vuelta a solo ida --\x1b[0m');
  q3.cambiar('nc-tipo-viaje', 'solo_ida');
  chk(q3.val('nc-direccion') === '', 'limpia el valor');
  chk(q3.ph('nc-origen') === 'Origen', 'placeholder vuelve a neutro');
}

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

  console.log('  \x1b[2m-- el formulario largo queda inalcanzable --\x1b[0m');
  var cont4 = q4.$('form-content-wrapper');
  ['.ctype-tabs', '#wizard-steps', '.prog'].forEach(function (sel) {
    var n = cont4.querySelector(sel);
    chk(!!n && n.style.display === 'none', 'oculto: ' + sel);
  });
  var panelesVisibles = Array.prototype.filter.call(
    cont4.querySelectorAll('.wz-panel'), function (n) { return n.style.display !== 'none'; });
  chk(panelesVisibles.length === 0, 'ningún panel viejo queda visible (' + panelesVisibles.length + ')');
  chk(q4.$('wz-1') !== null, 'pero el markup viejo sigue en el DOM: se borra en su propia fase');

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
   Acá el wizard se suma como camino alternativo: el formulario largo sigue
   entero. Sin firma, porque el pasajero no está presente. */
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
  chk(q5.$('f-nombre') !== null && q5.$('f-tipo-reclamo') !== null,
    'el formulario largo sigue entero: se suma, no se reemplaza');
  chk(w5.document.querySelector('.iw-ov') === null, 'el wizard no se monta hasta que se lo pide');

  q5.$('wz-abrir').click();
  var ov5 = w5.document.querySelector('.iw-ov');
  chk(ov5 !== null && ov5.className.indexOf('iw-open') > -1, 'el botón lo abre');
  chk(w5.document.querySelector('.iw-ms[data-ms="scan"]') === null,
    'sin escáner: en agencias el documento lo carga la agencia, no se escanea acá');
  chk(w5.document.getElementById('iw-consent') === null,
    'sin consentimiento: el pasajero no está presente para firmar');
  chk(w5.document.querySelector('.iw-ms[data-ms="firma"]') !== null,
    'pero el paso final existe igual: es desde donde se dispara el envío');
  chk(w5.document.getElementById('iw-nombre') !== null,
    'pide los datos del pasajero completos');
  chk(w5.document.querySelector('.iw-ms[data-ms="acompgate"]') !== null,
    'y los acompañantes');

  console.log('  \x1b[2m-- aislamiento de estilos --\x1b[0m');
  /* La página tiene sus propias .btn, .form-group, .card. El componente no puede
     pisarlas: por eso todo va prefijado. */
  var propias = w5.document.querySelectorAll('.form-wrap .form-group').length;
  chk(propias > 0, 'las clases propias de la página siguen presentes (' + propias + ' .form-group)');
  var sinPrefijo = w5.document.querySelectorAll('.iw-dlg .field, .iw-dlg .card, .iw-dlg .drop').length;
  chk(sinPrefijo === 0, 'el wizard no usa ninguna clase genérica adentro (' + sinPrefijo + ')');

  chk(r5.errores.length === 0, 'sin errores tras abrirlo: ' + (r5.errores.join(' | ') || 'ninguno'));
}

console.log('\nResumen');
console.log('  \x1b[32m' + chk.estado.ok + ' ok\x1b[0m   ' + (chk.estado.fail ? '\x1b[31m' + chk.estado.fail + ' fallan\x1b[0m' : '\x1b[2m0 fallan\x1b[0m') + '\n');
process.exit(chk.estado.fail ? 1 : 0);
