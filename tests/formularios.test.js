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

  console.log('  \x1b[2m-- vuelta a solo ida --\x1b[0m');
  q3.cambiar('nc-tipo-viaje', 'solo_ida');
  chk(q3.val('nc-direccion') === '', 'limpia el valor');
  chk(q3.ph('nc-origen') === 'Origen', 'placeholder vuelve a neutro');
}

console.log('\nResumen');
console.log('  \x1b[32m' + chk.estado.ok + ' ok\x1b[0m   ' + (chk.estado.fail ? '\x1b[31m' + chk.estado.fail + ' fallan\x1b[0m' : '\x1b[2m0 fallan\x1b[0m') + '\n');
process.exit(chk.estado.fail ? 1 : 0);
