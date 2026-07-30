/**
 * tests/escaneo.test.js
 *
 * Escaneo de IA punta a punta sobre `index.html` + `app.js`, con el caso real que
 * motivó el ciclo de ciudades multi-aeropuerto: ida USH→EZE, vuelta AEP→USH.
 *
 *   node tests/escaneo.test.js
 *
 * Va contra el flujo de verdad —drop de archivo → `fetch` mockeado → autofill →
 * confirmación de tramo → cambio de dirección— porque el estado del escaneo
 * (`S.aiData`) vive en el closure de `app.js` y no se puede pinchar desde afuera.
 *
 * Lo que cubre y no cubría nada antes: que al cambiar de dirección los aeropuertos
 * ALTERNEN. Con la etiqueta correcta y el par equivocado, un ida y vuelta simétrico casi
 * no se nota; el que vuelve por otro aeropuerto de la misma ciudad, sí.
 *
 * Exit code distinto de 0 si algo falla.
 */
import { cargar, crearChequeador, consultas, ceder } from './lib/dom.js';
import { fetchEscaneo, SEGMENTOS_SOLO_IDA } from './fixtures/escaneo.js';

var chk = crearChequeador();

function abrir(segmentos) {
  return cargar('index.html', {
    scripts: ['src/js/airport-select.js', 'src/js/app.js'],
    fetch: fetchEscaneo(segmentos),
  });
}

/** Dispara el escaneo soltando un archivo en la zona de drop. */
function escanear(window) {
  var zona = window.document.getElementById('ai-drop');
  var ev = new window.Event('drop', { bubbles: true });
  ev.dataTransfer = { files: [new window.File(['x'], 'pasaje.jpg', { type: 'image/jpeg' })] };
  zona.dispatchEvent(ev);
  return ceder(12);
}

(async function () {
  console.log('\n\x1b[1mEscaneo ida y vuelta USH→EZE / AEP→USH\x1b[0m');
  {
    var r = abrir();
    var q = consultas(r.window);
    await escanear(r.window);
    chk(r.errores.length === 0, r.errores.length ? 'errores: ' + r.errores.map(String).join(' | ') : 'sin errores');
    chk(q.$('ruta-box').style.display === 'block', 'con dos direcciones aparece la confirmación de tramo');

    q.$('ruta-ok').click();
    await ceder();

    console.log('  \x1b[2m-- confirmado sobre la IDA --\x1b[0m');
    chk(q.iata('f-origin') === 'USH', 'origen data-iata=' + q.iata('f-origin') + ' ("' + q.val('f-origin') + '")');
    chk(q.iata('f-destination') === 'EZE', 'destino data-iata=' + q.iata('f-destination') + ' ("' + q.val('f-destination') + '")');
    chk(q.val('f-tipo-viaje') === 'ida_vuelta', 'tipo de viaje deducido = ' + q.val('f-tipo-viaje'));
    chk(q.val('f-direccion') === 'ida', 'select de dirección = ' + q.val('f-direccion'));

    console.log('  \x1b[2m-- cambiar a VUELTA: tiene que alternar EZE↔AEP --\x1b[0m');
    q.cambiar('f-direccion', 'vuelta');
    await ceder();
    chk(q.iata('f-origin') === 'AEP', 'origen data-iata=' + q.iata('f-origin') + ' ("' + q.val('f-origin') + '")');
    chk(q.iata('f-destination') === 'USH', 'destino data-iata=' + q.iata('f-destination') + ' ("' + q.val('f-destination') + '")');

    console.log('  \x1b[2m-- volver a IDA --\x1b[0m');
    q.cambiar('f-direccion', 'ida');
    await ceder();
    chk(q.iata('f-origin') === 'USH', 'origen data-iata=' + q.iata('f-origin'));
    chk(q.iata('f-destination') === 'EZE', 'destino data-iata=' + q.iata('f-destination'));

    console.log('  \x1b[2m-- toggle repetido --\x1b[0m');
    var coherente = true;
    for (var n = 0; n < 3; n++) {
      var dirs = ['vuelta', 'ida'];
      for (var k = 0; k < dirs.length; k++) {
        q.cambiar('f-direccion', dirs[k]);
        await ceder();
        var espO = dirs[k] === 'ida' ? 'USH' : 'AEP';
        var espD = dirs[k] === 'ida' ? 'EZE' : 'USH';
        if (q.iata('f-origin') !== espO || q.iata('f-destination') !== espD) coherente = false;
        /* Y el texto visible tiene que contener la misma IATA que el atributo: un
           data-iata correcto con un label viejo es igual de mentiroso. */
        if (q.val('f-origin').indexOf(espO) === -1) coherente = false;
      }
    }
    chk(coherente, '3 vueltas completas: valor y data-iata siempre en sincronía');

    console.log('  \x1b[2m-- edición manual pisada (decidido, no bug) --\x1b[0m');
    q.$('f-destination').value = 'Basura escrita a mano';
    q.cambiar('f-direccion', 'vuelta');
    await ceder();
    chk(q.iata('f-destination') === 'USH', 'gana la dirección elegida: "' + q.val('f-destination') + '"');
  }

  console.log('\n\x1b[1mBorde: escaneo solo-ida y el usuario elige "vuelta"\x1b[0m');
  {
    var r2 = abrir(SEGMENTOS_SOLO_IDA);
    var q2 = consultas(r2.window);
    await escanear(r2.window);
    await ceder();
    var oAntes = q2.val('f-origin'), dAntes = q2.val('f-destination');
    q2.cambiar('f-tipo-viaje', 'ida_vuelta');
    q2.cambiar('f-direccion', 'vuelta');
    await ceder();
    chk(q2.val('f-origin') === oAntes && q2.val('f-destination') === dAntes,
      'no toca los campos: origen="' + q2.val('f-origin') + '" destino="' + q2.val('f-destination') + '"');
    chk(q2.val('f-origin') !== '', 'y sobre todo NO los vacía');
  }

  console.log('\n\x1b[1mBorde: ruta descartada → el select vuelve a ser cosmético\x1b[0m');
  {
    var r3 = abrir();
    var q3 = consultas(r3.window);
    await escanear(r3.window);
    chk(q3.$('ruta-box').style.display === 'block', 'aparece la confirmación');
    q3.$('ruta-descartar').click();
    await ceder();
    q3.$('f-origin').value = 'Cargado a mano';
    q3.cambiar('f-tipo-viaje', 'ida_vuelta');
    q3.cambiar('f-direccion', 'vuelta');
    await ceder();
    chk(q3.val('f-origin') === 'Cargado a mano', 'no resucita lo descartado: "' + q3.val('f-origin') + '"');
  }

  console.log('\n\x1b[1mBorde: carga manual sin escaneo\x1b[0m');
  {
    var r4 = abrir();
    var q4 = consultas(r4.window);
    q4.$('btn-manual').click();
    await ceder(2);
    q4.$('f-origin').value = 'Escrito a mano';
    q4.cambiar('f-tipo-viaje', 'ida_vuelta');
    q4.cambiar('f-direccion', 'vuelta');
    await ceder();
    chk(q4.val('f-origin') === 'Escrito a mano', 'sin S.aiData no toca nada: "' + q4.val('f-origin') + '"');
    chk(q4.lbl('f-origin').indexOf('vuelta') > -1, 'pero el renombrado sí corre: "' + q4.lbl('f-origin') + '"');
  }

  console.log('\nResumen');
  console.log('  \x1b[32m' + chk.estado.ok + ' ok\x1b[0m   ' + (chk.estado.fail ? '\x1b[31m' + chk.estado.fail + ' fallan\x1b[0m' : '\x1b[2m0 fallan\x1b[0m') + '\n');
  process.exit(chk.estado.fail ? 1 : 0);
})();
