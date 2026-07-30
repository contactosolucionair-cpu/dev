/**
 * tests/escaneo-superficies.test.js
 *
 * El mismo recorrido de `escaneo.test.js` (ida USH→EZE, vuelta AEP→USH) sobre las OTRAS
 * dos bocas de carga: el modal `nc-*` del backoffice y el formulario del panel de agencias.
 *
 *   node tests/escaneo-superficies.test.js
 *
 * Por qué está separado del de `index.html`: las tres superficies tienen su propia copia de
 * la lógica de consumo del escaneo (deuda conocida, censada en
 * `docs/prompt-claude-code-superficies-scan.md`). El fix del selector de dirección se había
 * aplicado solo en `src/js/app.js`, así que backoffice y agencias seguían con el selector
 * cosmético: renombraban la etiqueta y dejaban abajo los aeropuertos de la ida. Mientras las
 * copias sigan existiendo, cada una necesita su propio e2e.
 *
 * Va contra el flujo real —drop de archivo → `fetch` mockeado → autofill → confirmación de
 * tramo → cambio de dirección— porque el estado del escaneo vive en el closure del script
 * inline de cada página y no se puede pinchar desde afuera.
 *
 * Exit code distinto de 0 si algo falla.
 */
import { cargar, crearChequeador, consultas, ceder } from './lib/dom.js';
import { fetchEscaneo, SEGMENTOS_SOLO_IDA } from './fixtures/escaneo.js';

var chk = crearChequeador();

/**
 * Stub de fetch de las superficies internas: el del escaneo, más una respuesta inofensiva
 * para los endpoints con sesión que estas páginas pegan al arrancar (listados, perfil). Sin
 * eso el arranque explota antes de que haya nada que probar.
 */
function fetchSuperficie(segmentos) {
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

/** Suelta un archivo escaneable en una zona de drop. */
function soltar(window, idZona) {
  var zona = window.document.getElementById(idZona);
  var ev = new window.Event('drop', { bubbles: true });
  ev.dataTransfer = { files: [new window.File(['x'], 'pasaje.jpg', { type: 'image/jpeg' })] };
  zona.dispatchEvent(ev);
}

/* Cada superficie declara dónde está cada cosa; el recorrido de abajo es uno solo. */
var SUPERFICIES = [
  {
    nombre: 'backoffice.html · modal nc-*',
    archivo: 'backoffice.html',
    antes: function (w) { w.localStorage.setItem('sa_admin_pwd', 'test'); },
    zona: 'nc-scan-zone', boton: 'nc-scan-btn',
    rutaBox: 'nc-ruta-box', rutaOk: 'nc-ruta-ok', rutaDescartar: 'nc-ruta-descartar',
    origen: 'nc-origen', destino: 'nc-destino', tipoViaje: 'nc-tipo-viaje', direccion: 'nc-direccion',
    /* Sin labels ni i18n: la pregunta vive en el placeholder. */
    etiquetaOrigen: function (q) { return q.ph('nc-origen'); },
  },
  {
    nombre: 'panel-agencia.html · formulario de alta',
    archivo: 'panel-agencia.html',
    antes: function (w) {
      w.localStorage.setItem('sa_ag_token', 'test');
      w.localStorage.setItem('sa_ag_email', 'test@test.com');
      w.localStorage.setItem('sa_ag_data', JSON.stringify({ nombre: 'Test', estado: 'aprobada' }));
    },
    zona: 'upload-area', boton: 'btn-scan',
    rutaBox: 'ruta-box', rutaOk: 'ruta-ok', rutaDescartar: 'ruta-descartar',
    origen: 'f-origen', destino: 'f-destino', tipoViaje: 'f-tipo-viaje', direccion: 'f-direccion',
    etiquetaOrigen: function (q) { return q.texto('lbl-origen'); },
  },
];

function abrir(sup, segmentos) {
  return cargar(sup.archivo, {
    scripts: ['src/js/airport-select.js'],
    antes: sup.antes,
    fetch: fetchSuperficie(segmentos),
  });
}

/** Drop + click en "Completar con IA", con las cesiones que necesitan FileReader y fetch. */
async function escanear(sup, r) {
  soltar(r.window, sup.zona);
  await ceder(6);
  r.window.document.getElementById(sup.boton).click();
  await ceder(12);
}

(async function () {
  for (var n = 0; n < SUPERFICIES.length; n++) {
    var sup = SUPERFICIES[n];
    console.log('\n\x1b[1m' + sup.nombre + '\x1b[0m');

    /* ---- Recorrido principal: ida y vuelta con dos aeropuertos en la misma ciudad ---- */
    {
      var r = abrir(sup);
      var q = consultas(r.window);
      await escanear(sup, r);

      chk(r.errores.length === 0, r.errores.length ? 'errores: ' + r.errores.map(String).join(' | ') : 'sin errores en el arranque ni en el escaneo');
      chk(q.$(sup.rutaBox).style.display === 'block', 'con dos direcciones aparece la confirmación de tramo');

      q.$(sup.rutaOk).click();
      await ceder();

      console.log('  \x1b[2m-- confirmado sobre la IDA --\x1b[0m');
      chk(q.iata(sup.origen) === 'USH', 'origen data-iata=' + q.iata(sup.origen) + ' ("' + q.val(sup.origen) + '")');
      chk(q.iata(sup.destino) === 'EZE', 'destino data-iata=' + q.iata(sup.destino) + ' ("' + q.val(sup.destino) + '")');
      chk(q.val(sup.tipoViaje) === 'ida_vuelta', 'tipo de viaje deducido = ' + q.val(sup.tipoViaje));
      chk(q.val(sup.direccion) === 'ida', 'select de dirección = ' + q.val(sup.direccion));

      console.log('  \x1b[2m-- cambiar a VUELTA: tiene que alternar EZE↔AEP --\x1b[0m');
      q.cambiar(sup.direccion, 'vuelta');
      await ceder();
      chk(q.iata(sup.origen) === 'AEP', 'origen data-iata=' + q.iata(sup.origen) + ' ("' + q.val(sup.origen) + '")');
      chk(q.iata(sup.destino) === 'USH', 'destino data-iata=' + q.iata(sup.destino) + ' ("' + q.val(sup.destino) + '")');

      console.log('  \x1b[2m-- volver a IDA --\x1b[0m');
      q.cambiar(sup.direccion, 'ida');
      await ceder();
      chk(q.iata(sup.origen) === 'USH', 'origen data-iata=' + q.iata(sup.origen));
      chk(q.iata(sup.destino) === 'EZE', 'destino data-iata=' + q.iata(sup.destino));

      console.log('  \x1b[2m-- toggle repetido --\x1b[0m');
      var coherente = true;
      for (var v = 0; v < 3; v++) {
        var dirs = ['vuelta', 'ida'];
        for (var k = 0; k < dirs.length; k++) {
          q.cambiar(sup.direccion, dirs[k]);
          await ceder();
          var espO = dirs[k] === 'ida' ? 'USH' : 'AEP';
          var espD = dirs[k] === 'ida' ? 'EZE' : 'USH';
          if (q.iata(sup.origen) !== espO || q.iata(sup.destino) !== espD) coherente = false;
          /* El texto visible tiene que llevar la misma IATA que el atributo: un data-iata
             correcto con un label viejo es igual de mentiroso. */
          if (q.val(sup.origen).indexOf(espO) === -1) coherente = false;
        }
      }
      chk(coherente, '3 vueltas completas: valor y data-iata siempre en sincronía');

      console.log('  \x1b[2m-- edición manual pisada (decidido, no bug) --\x1b[0m');
      q.$(sup.destino).value = 'Basura escrita a mano';
      q.cambiar(sup.direccion, 'vuelta');
      await ceder();
      chk(q.iata(sup.destino) === 'USH', 'gana la dirección elegida: "' + q.val(sup.destino) + '"');
    }

    /* ---- Borde: el escaneo trae solo la ida y el operador elige "vuelta" ---- */
    {
      var r2 = abrir(sup, SEGMENTOS_SOLO_IDA);
      var q2 = consultas(r2.window);
      await escanear(sup, r2);
      await ceder();
      var oAntes = q2.val(sup.origen), dAntes = q2.val(sup.destino);
      q2.cambiar(sup.tipoViaje, 'ida_vuelta');
      q2.cambiar(sup.direccion, 'vuelta');
      await ceder();
      chk(q2.val(sup.origen) === oAntes && q2.val(sup.destino) === dAntes,
        'solo-ida + "vuelta": no toca los campos ("' + q2.val(sup.origen) + '" → "' + q2.val(sup.destino) + '")');
      chk(q2.val(sup.origen) !== '', 'y sobre todo NO los vacía');
    }

    /* ---- Borde: ruta descartada → el selector vuelve a ser cosmético ---- */
    {
      var r3 = abrir(sup);
      var q3 = consultas(r3.window);
      await escanear(sup, r3);
      chk(q3.$(sup.rutaBox).style.display === 'block', 'aparece la confirmación antes de descartar');
      q3.$(sup.rutaDescartar).click();
      await ceder();
      q3.$(sup.origen).value = 'Cargado a mano';
      q3.cambiar(sup.tipoViaje, 'ida_vuelta');
      q3.cambiar(sup.direccion, 'vuelta');
      await ceder();
      chk(q3.val(sup.origen) === 'Cargado a mano', 'no resucita lo descartado: "' + q3.val(sup.origen) + '"');
    }

    /* ---- Borde: carga 100 % manual, sin escaneo ---- */
    {
      var r4 = abrir(sup);
      var q4 = consultas(r4.window);
      q4.$(sup.origen).value = 'Escrito a mano';
      q4.cambiar(sup.tipoViaje, 'ida_vuelta');
      q4.cambiar(sup.direccion, 'vuelta');
      await ceder();
      chk(q4.val(sup.origen) === 'Escrito a mano', 'sin escaneo no toca nada: "' + q4.val(sup.origen) + '"');
      chk(sup.etiquetaOrigen(q4).indexOf('vuelta') > -1, 'pero el renombrado sí corre: "' + sup.etiquetaOrigen(q4) + '"');
    }
  }

  console.log('\nResumen');
  console.log('  \x1b[32m' + chk.estado.ok + ' ok\x1b[0m   ' + (chk.estado.fail ? '\x1b[31m' + chk.estado.fail + ' fallan\x1b[0m' : '\x1b[2m0 fallan\x1b[0m') + '\n');
  process.exit(chk.estado.fail ? 1 : 0);
})();
