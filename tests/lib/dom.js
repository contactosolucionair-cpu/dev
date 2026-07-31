/**
 * tests/lib/dom.js
 *
 * Harness de jsdom para los formularios de alta. Existe porque el front no tiene build
 * ni framework: son HTML con JS inline o casi, y los bugs de ORDEN DE EJECUCIÓN no se
 * ven leyendo el código ni con `node --check`. Solo aparecen cargando el archivo entero
 * contra su markup real.
 *
 * Dos trampas del harness, ya resueltas acá:
 *
 *  1. Sembrar `localStorage` (tokens de sesión) va en `beforeParse` y NO después de
 *     construir el JSDOM: con `runScripts: 'dangerously'` los scripts inline corren
 *     durante la construcción, y `panel-agencia.html` hace `location.href='/agencias'`
 *     y corta el script si no encuentra token.
 *  2. `window.fetch` hay que stubearlo siempre, o el arranque explota por otro lado.
 *  3. jsdom no implementa `Element.scrollIntoView`. El wizard lo usa al cambiar de paso
 *     (`goToStep`), así que sin el stub cualquier navegación entre pasos tira un
 *     TypeError que aborta el handler a mitad de camino y deja botones sin cablear. Se
 *     stubea acá y no se guarda en el front: es un hueco del harness, no del producto.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

export var RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function leer(rel) {
  return fs.readFileSync(path.join(RAIZ, rel), 'utf8');
}

/**
 * Carga un HTML del repo con sus scripts inline y los externos que se le pidan.
 *
 * @param {string} archivo         ruta relativa a la raíz del repo
 * @param {string[]} opts.scripts  scripts externos a inyectar, en orden
 * @param {Function} opts.antes    corre en `beforeParse(window)`: stubs y localStorage
 * @param {Function} opts.fetch    stub de fetch; por defecto una promesa que nunca resuelve
 * @returns {{window: Window, errores: Array}}
 */
export function cargar(archivo, opts) {
  opts = opts || {};
  var html = leer(archivo).replace(/<script src=[^>]*><\/script>/g, '');
  var errores = [];
  var dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://staging.solucionair.com/',
    beforeParse: function (window) {
      window.fetch = opts.fetch || function () { return new Promise(function () {}); };
      window.Element.prototype.scrollIntoView = function () {};
      window.addEventListener('error', function (e) { errores.push(e.error || e.message); });
      if (opts.antes) opts.antes(window);
    },
  });
  var window = dom.window;
  (opts.scripts || []).forEach(function (rel) {
    var s = window.document.createElement('script');
    s.textContent = leer(rel);
    window.document.head.appendChild(s);
  });
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  return { window: window, errores: errores };
}

/* Helpers de aserción compartidos. Sin framework, igual que el resto del suite. */
export function crearChequeador() {
  var estado = { ok: 0, fail: 0 };
  function chk(cond, msg) {
    if (cond) { estado.ok++; console.log('  \x1b[32mOK\x1b[0m     ' + msg); }
    else { estado.fail++; console.log('  \x1b[31mFALLA\x1b[0m  ' + msg); }
    return cond;
  }
  chk.estado = estado;
  return chk;
}

/* Azúcar para leer el DOM en las aserciones. */
export function consultas(window) {
  return {
    $: function (id) { return window.document.getElementById(id); },
    val: function (id) { var e = window.document.getElementById(id); return e ? e.value : '(no existe)'; },
    iata: function (id) { var e = window.document.getElementById(id); return e ? e.getAttribute('data-iata') : null; },
    ph: function (id) { var e = window.document.getElementById(id); return e ? e.placeholder : '(no existe)'; },
    visible: function (id) {
      var e = window.document.getElementById(id);
      return !!e && e.style.display !== 'none';
    },
    /* Label de un campo del form público (estructura .field > .field__lbl). */
    lbl: function (id) {
      var e = window.document.getElementById(id);
      var campo = e && e.closest ? e.closest('.field') : null;
      var l = campo ? campo.querySelector('.field__lbl') : null;
      return l ? l.textContent.trim().replace(/\s*\*$/, '') : '(sin label)';
    },
    texto: function (id) { var e = window.document.getElementById(id); return e ? e.textContent.trim() : '(no existe)'; },
    cambiar: function (id, valor) {
      var e = window.document.getElementById(id);
      e.value = valor;
      e.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
  };
}

/* Los callbacks del front encadenan promesas (airport-select resuelve async): hay que
   cederle el turno al event loop varias veces antes de mirar el DOM. */
export function ceder(veces) {
  var n = veces || 8;
  var p = Promise.resolve();
  for (var i = 0; i < n; i++) p = p.then(function () { return new Promise(function (r) { setTimeout(r, 5); }); });
  return p;
}
