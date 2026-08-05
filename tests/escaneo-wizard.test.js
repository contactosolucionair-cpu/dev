/**
 * tests/escaneo-wizard.test.js
 *
 * El mismo recorrido que `escaneo.test.js` y `escaneo-superficies.test.js` —ida USH→EZE,
 * vuelta AEP→USH— pero contra el WIZARD, en las tres superficies:
 *
 *   drop del archivo → fetch mockeado a /api/process-ticket → autofill → confirmar el
 *   tramo → cambiar de dirección
 *
 *   node tests/escaneo-wizard.test.js
 *
 * Por qué existe, y por qué convive con las dos suites viejas: esas cubren el mismo
 * recorrido sobre los formularios largos, que están por retirarse. Mientras el retiro no
 * termine, los dos caminos siguen vivos y cada uno necesita su e2e. Cuando los
 * formularios se borren, se borran ellas y queda esta.
 *
 * Qué cubre que NO cubre `intake-wizard.test.js`: aquel monta el componente suelto y le
 * inyecta el payload del escaneo a mano. Acá se ejercita el EMPALME —que la respuesta del
 * endpoint llegue efectivamente al autofill de cada superficie— que es justo donde vivía
 * el bug de las tres copias truncando `segmentos`.
 *
 * Buenos Aires con dos aeropuertos (EZE a la ida, AEP a la vuelta) es el fixture a
 * propósito: con un ida y vuelta simétrico el error queda tapado.
 *
 * Exit code distinto de 0 si algo falla.
 */
import { cargar, crearChequeador, ceder } from './lib/dom.js';
import { fetchEscaneo, SEGMENTOS_IDA_VUELTA } from './fixtures/escaneo.js';

var chk = crearChequeador();

/* Las tarjetas del wizard avanzan solas a los 180ms. */
var SALTO = 240;
function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * El stub del escaneo, más una respuesta inofensiva para los endpoints con sesión que
 * backoffice y agencias pegan al arrancar. Sin eso el arranque explota antes de que haya
 * nada que probar.
 */
function fetchConSesion(segmentos) {
  var base = fetchEscaneo(segmentos);
  return function (url, opts) {
    var u = String(url);
    if (u.indexOf('/api/admin') > -1 || u.indexOf('/api/agency') > -1 || u.indexOf('/api/abogados') > -1) {
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve({ success: true, reclamos: [], casos: [], agencias: [], stats: {}, agencia: {} }); },
      });
    }
    return base(url, opts);
  };
}

/* Cada superficie declara cómo se carga y cómo se abre su wizard. El recorrido es uno solo. */
var SUPERFICIES = [
  {
    nombre: 'index.html · B2C, tras el login de Google',
    archivo: 'index.html',
    scripts: ['src/js/airport-select.js', 'src/js/intake-wizard.js', 'src/js/app.js'],
    abrir: function (w) {
      /* El único camino real por el que un pasajero llega al wizard. */
      w.firmaGoogle = { nombre: 'Juan Pablo Mario Adaniya', email: 'juan@test.com' };
      w.__abrirIntake();
    },
    verificarAntes: function (w) {
      var c = w.document.getElementById('contacto-fallback');
      chk(!!c && c.style.display !== 'none', 'el bloque de contacto arranca visible, sin depender de JS');
    },
    verificarDespues: function (w) {
      var c = w.document.getElementById('contacto-fallback');
      chk(!!c && c.style.display === 'none', 'y el wizard lo oculta al abrir bien');
    },
  },
  {
    nombre: 'backoffice.html · carga guiada',
    archivo: 'backoffice.html',
    scripts: ['src/js/airport-select.js', 'src/js/intake-wizard.js'],
    antes: function (w) { w.localStorage.setItem('sa_admin_pwd', 'test'); },
    /* El disparador real: "Nuevo caso" abre el wizard directo. Antes abría el formulario
       largo, con la carga guiada colgando de un botón de adentro. */
    abrir: function (w) { w.document.getElementById('btn-nuevo-caso').click(); },
  },
  {
    nombre: 'panel-agencia.html · cargar caso guiado',
    archivo: 'panel-agencia.html',
    scripts: ['src/js/airport-select.js', 'src/js/intake-wizard.js'],
    antes: function (w) {
      w.localStorage.setItem('sa_ag_token', 'test');
      w.localStorage.setItem('sa_ag_email', 'test@test.com');
      w.localStorage.setItem('sa_ag_data', JSON.stringify({ nombre: 'Test', estado: 'aprobada' }));
    },
    abrir: function (w) { w.document.getElementById('wz-abrir').click(); },
  },
];

async function recorrer(s) {
  console.log('\n\x1b[1m' + s.nombre + '\x1b[0m');

  var r = cargar(s.archivo, {
    scripts: s.scripts,
    antes: s.antes,
    fetch: fetchConSesion(SEGMENTOS_IDA_VUELTA),
  });
  var w = r.window;
  await ceder();

  chk(r.errores.length === 0, 'carga sin errores: ' + (r.errores.map(String).join(' | ') || 'ninguno'));
  chk(typeof w.IntakeWizard === 'object' && typeof w.IntakeWizard.crear === 'function',
    'el componente quedó expuesto en window.IntakeWizard');

  if (s.verificarAntes) s.verificarAntes(w);
  s.abrir(w);
  await ceder();
  if (s.verificarDespues) s.verificarDespues(w);

  /* El overlay del wizard, no el de los documentos legales ni el de confirmación. */
  var ov = w.document.querySelector('.iw-ov.iw-open');
  if (!chk(!!ov, 'el wizard abrió')) return;

  function paso() { var n = ov.querySelector('.iw-ms.iw-on'); return n ? n.getAttribute('data-ms') : '(ninguno)'; }
  function val(id) { var n = ov.querySelector('#iw-' + id); return n ? n.value : '(no existe)'; }
  function iata(id) { var n = ov.querySelector('#iw-' + id); return n ? (n.getAttribute('data-iata') || '(sin iata)') : '(no existe)'; }
  function elegida(destino) {
    var n = ov.querySelector('[data-pick="' + destino + '"] .iw-opt.iw-sel');
    return n ? n.getAttribute('data-val') : '(ninguna)';
  }
  function escalas() {
    var ins = ov.querySelectorAll('[data-arm-list] .iw-in'), out = [], i;
    for (i = 0; i < ins.length; i++) if (ins[i].value) out.push(ins[i].value);
    return out;
  }
  function elegir(v) {
    var b = ov.querySelector('.iw-ms.iw-on .iw-opt[data-val="' + v + '"]');
    if (!b) throw new Error('no hay opción "' + v + '" en el paso ' + paso());
    b.click();
  }

  chk(paso() === 'tipo', 'abre en el selector de tipo: ' + paso());
  ov.querySelector('[data-ctype="vuelo"]').click();
  await esperar(SALTO);
  if (!chk(paso() === 'scan', 'el reclamo de vuelo llega al paso de escaneo: ' + paso())) return;

  /* --- drop del archivo sobre la tarjeta del escáner --- */
  var ev = new w.Event('drop', { bubbles: true });
  ev.dataTransfer = { files: [new w.File(['x'], 'pasaje.jpg', { type: 'image/jpeg' })] };
  ov.querySelector('[data-scan-go]').dispatchEvent(ev);
  chk(ov.querySelector('[data-scan-load]').style.display !== 'none', 'el paso pasa a "leyendo tus documentos"');

  /* FileReader + fetch + prellenado: hay que cederle el turno al event loop varias veces. */
  await ceder(30);

  /* --- autofill --- */
  if (!chk(paso() === 'airline', 'terminado el escaneo, avanza solo al paso de aerolínea: ' + paso())) return;
  chk(val('aerolinea') === 'Aerolineas Argentinas', 'aerolínea: "' + val('aerolinea') + '"');
  chk(val('vuelo_nro') === 'AR 1891', 'número de vuelo: "' + val('vuelo_nro') + '"');
  chk(val('origen') === 'USH - Ushuaia', 'origen de la ida: "' + val('origen') + '"');
  chk(val('destino') === 'EZE - Buenos Aires', 'destino de la ida: "' + val('destino') + '"');
  chk(val('fecha_vuelo') === '2026-07-21', 'fecha del tramo: "' + val('fecha_vuelo') + '"');

  /* El IATA es el dato que consume el motor legal, y el combo de aeropuertos solo lo
     escribe al elegir de la lista: si el autofill no lo pone, el caso viaja sin ruta. */
  chk(iata('origen') === 'USH', 'IATA de origen: ' + iata('origen'));
  chk(iata('destino') === 'EZE', 'IATA de destino: ' + iata('destino'));

  /* El itinerario tiene dos direcciones: el wizard lo deduce y lo deja preseleccionado. */
  chk(elegida('tipo_viaje') === 'ida_vuelta', 'tipo de viaje deducido del itinerario: ' + elegida('tipo_viaje'));
  chk(elegida('direccion_afectada') === 'ida', 'dirección preseleccionada: ' + elegida('direccion_afectada'));
  chk(escalas().length === 0, 'la ida es directa: sin escalas cargadas');

  /* --- confirmar el tramo --- */
  ov.querySelector('[data-seguir]').click();
  chk(paso() === 'tipoviaje', 'del escaneo se sigue al tipo de viaje: ' + paso());
  elegir('ida_vuelta');
  await esperar(SALTO);
  if (!chk(paso() === 'direccion', 'y de ahí a la dirección afectada: ' + paso())) return;

  /* --- cambiar de dirección --- */
  elegir('vuelta');
  await esperar(SALTO);
  chk(val('origen') === 'AEP - Buenos Aires',
    'elegir la vuelta trae SU aeropuerto de salida (AEP, no EZE): "' + val('origen') + '"');
  chk(val('destino') === 'USH - Ushuaia', 'y su destino: "' + val('destino') + '"');
  chk(iata('origen') === 'AEP' && iata('destino') === 'USH',
    'con sus IATA: ' + iata('origen') + '→' + iata('destino'));
  chk(val('fecha_vuelo') === '2026-07-28', 'y la fecha del tramo de vuelta: "' + val('fecha_vuelo') + '"');

  /* Volver a la ida tiene que restaurar la ida, no dejar mezclado. */
  ov.querySelector('[data-atras]').click();
  elegir('ida');
  await esperar(SALTO);
  chk(val('origen') === 'USH - Ushuaia' && val('destino') === 'EZE - Buenos Aires',
    'volver a la ida restaura sus aeropuertos: ' + val('origen') + ' → ' + val('destino'));

  chk(r.errores.length === 0, 'sin errores de consola en todo el recorrido: ' +
    (r.errores.map(String).join(' | ') || 'ninguno'));
}

/**
 * La razón de ser del bloque de contacto: cuando el wizard NO puede abrir, el pasajero
 * tiene que seguir viendo cómo comunicarse. Se prueba cargando `index.html` sin el
 * componente, que es la forma honesta de simular "el JS se rompió": `wzInstancia()`
 * devuelve null, `__abrirIntake` corta antes de ocultar nada, y el bloque queda.
 */
async function contactoSobreviveAlFallo() {
  console.log('\n\x1b[1mindex.html · el wizard no puede abrir\x1b[0m');
  var r = cargar('index.html', {
    scripts: ['src/js/airport-select.js', 'src/js/app.js'],   /* SIN intake-wizard.js */
    fetch: fetchConSesion(SEGMENTOS_IDA_VUELTA),
  });
  var w = r.window;
  await ceder();

  chk(typeof w.IntakeWizard === 'undefined', 'el componente no está: el wizard no puede abrir');
  var c = w.document.getElementById('contacto-fallback');
  chk(!!c && c.style.display !== 'none', 'el bloque de contacto está visible antes de intentar');

  w.firmaGoogle = { nombre: 'Juan', email: 'juan@test.com' };
  w.__abrirIntake();
  await ceder();

  chk(w.document.querySelector('.iw-ov.iw-open') === null, 'y efectivamente no abrió ningún wizard');
  chk(c.style.display !== 'none',
    'REGRESIÓN: con el wizard caído el contacto SIGUE visible, que es para lo que está');

  /* Un solo canal, y tiene que ser un link de verdad: si lo armara el JS, no estaría
     justo cuando el JS es lo que falló. */
  var links = c.querySelectorAll('a[href]');
  chk(links.length === 1, 'un único canal de contacto, no una botonera: ' + links.length);
  chk(links.length === 1 && links[0].getAttribute('href').indexOf('wa.me/5491125578402') > -1,
    'y es el WhatsApp del pie: ' + (links.length ? links[0].getAttribute('href') : '(sin link)'));
  chk(c.textContent.indexOf('¿No se abre el formulario?') > -1, 'con el aviso a la vista');
}

(async function () {
  console.log('\n\x1b[1mEscaneo → autofill contra el wizard, por superficie\x1b[0m');
  for (var i = 0; i < SUPERFICIES.length; i++) await recorrer(SUPERFICIES[i]);
  await contactoSobreviveAlFallo();

  console.log('\n\x1b[1mResumen\x1b[0m');
  console.log('  \x1b[32m' + chk.estado.ok + ' ok\x1b[0m   ' +
    (chk.estado.fail ? '\x1b[31m' + chk.estado.fail + ' fallan\x1b[0m' : '0 fallan') + '\n');
  process.exit(chk.estado.fail ? 1 : 0);
})().catch(function (err) {
  console.error('\x1b[31mLA SUITE EXPLOTÓ: \x1b[0m' + (err && err.message ? err.message : String(err)));
  console.error(err && err.stack);
  process.exit(1);
});
