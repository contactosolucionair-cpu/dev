/* ============================================================
   AIRPORT SELECT — autocompletado + validación estricta de IATA
   Se engancha a cualquier <input data-airport="true">.
   - Sugerencias por ciudad / nombre / código (sin acentos).
   - Guarda el código IATA elegido en el atributo data-iata.
   - Si el texto no corresponde a un aeropuerto real, no valida.
   Expone window.AirportSelect para integrarse con app.js (autofill IA).
   ============================================================ */
(function () {
  'use strict';

  var DATA_URL = 'src/data/airports.json';
  var airports = null;      // array cargado
  var loadPromise = null;   // promesa de carga (una sola vez)
  var byIata = null;        // índice IATA -> aeropuerto

  /* Alias comunes en español para mejorar el match (tokens extra de búsqueda) */
  var ALIASES = {
    EZE: 'ezeiza pistarini buenos aires',
    AEP: 'aeroparque jorge newbery buenos aires',
    COR: 'cordoba pajas blancas',
    BRC: 'bariloche',
    USH: 'ushuaia',
    MDZ: 'mendoza',
    IGR: 'iguazu cataratas',
    SLA: 'salta',
    ROS: 'rosario',
    MVD: 'montevideo',
    SCL: 'santiago de chile',
    GRU: 'san pablo sao paulo guarulhos',
    MAD: 'madrid barajas',
    BCN: 'barcelona',
    JFK: 'nueva york new york',
    MIA: 'miami'
  };

  function norm(s) {
    return (s == null ? '' : String(s))
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca acentos
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lang() {
    var b = document.querySelector('.lang__btn.active');
    return (b && b.getAttribute('data-lang-btn')) === 'en' ? 'en' : 'es';
  }

  function label(a) { return a.city + ' (' + a.iata + ')'; }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function load() {
    if (airports) return Promise.resolve(airports);
    if (loadPromise) return loadPromise;
    loadPromise = fetch(DATA_URL)
      .then(function (r) { if (!r.ok) throw new Error('airports ' + r.status); return r.json(); })
      .then(function (list) {
        byIata = {};
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          a._c = norm(a.city);
          a._n = norm(a.name);
          a._i = a.iata.toLowerCase();
          a._s = a._c + ' ' + a._n + ' ' + a._i +
                 (ALIASES[a.iata] ? ' ' + norm(ALIASES[a.iata]) : '');
          byIata[a.iata] = a;
        }
        airports = list;
        return airports;
      });
    return loadPromise;
  }

  /* Búsqueda rankeada. Requiere que los datos ya estén cargados. */
  function search(q, limit) {
    q = norm(q); limit = limit || 8;
    if (!q || !airports) return [];
    var res = [];
    for (var i = 0; i < airports.length; i++) {
      var a = airports[i], sc = -1;
      if (a._i === q) sc = 0;                 // código exacto
      else if (a._c === q) sc = 1;            // ciudad exacta
      else if (a._c.indexOf(q) === 0) sc = 2; // ciudad empieza con
      else if (a._i.indexOf(q) === 0) sc = 3; // código empieza con
      else if (a._n.indexOf(q) === 0) sc = 4; // nombre empieza con
      else if (a._s.indexOf(q) !== -1) sc = 5;// contiene (incluye alias)
      if (sc >= 0) res.push({ a: a, sc: sc });
    }
    res.sort(function (x, y) { return x.sc - y.sc || x.a._c.length - y.a._c.length; });
    return res.slice(0, limit).map(function (r) { return r.a; });
  }

  /* Resolvedor "confiado" para texto pegado o autocompletado por IA.
     Devuelve el aeropuerto SOLO si el match es inequívoco; si no, null. */
  function resolve(text) {
    if (!text || !airports) return null;
    var t = String(text);
    var m = t.match(/\(([A-Za-z]{3})\)/);                 // "... (EZE)"
    if (m && byIata[m[1].toUpperCase()]) return byIata[m[1].toUpperCase()];
    var codes = t.match(/\b[A-Z]{3}\b/g);                 // "EZE - Buenos Aires" (formato IA)
    if (codes) {
      for (var k = 0; k < codes.length; k++) {
        if (byIata[codes[k]]) return byIata[codes[k]];
      }
    }
    var bare = t.trim().toUpperCase();                    // "eze"
    if (/^[A-Z]{3}$/.test(bare) && byIata[bare]) return byIata[bare];
    var q = norm(t);
    var exact = null, exactCount = 0;
    for (var i = 0; i < airports.length; i++) {
      var a = airports[i];
      if (a._c === q || a._n === q) { exact = a; exactCount++; }
    }
    if (exact && exactCount === 1) return exact;          // ciudad/nombre único
    var hits = search(t, 2);
    if (hits.length === 1) return hits[0];                // única sugerencia
    return null;
  }

  /* Marca visual sobre el .field contenedor */
  function mark(input, state, msgText) {
    var field = input.closest('.field');
    if (!field) return;
    field.classList.remove('field-ok', 'field-error', 'field-ai');
    var msg = field.querySelector('.field__msg');
    if (state === 'ok') { field.classList.add('field-ok'); if (msg) msg.textContent = ''; }
    else if (state === 'error') { field.classList.add('field-error'); if (msg) msg.textContent = msgText || ''; }
    else if (msg) msg.textContent = '';
  }

  function setIata(input, a) {
    input.value = label(a);
    input.setAttribute('data-iata', a.iata);
  }

  /* API pública para app.js: setea un valor desde texto (IA / paste). */
  function setFromText(input, text) {
    return load().then(function () {
      input.removeAttribute('data-iata');
      var a = resolve(text);
      if (a) { setIata(input, a); return a; }
      input.value = text || '';   // deja el texto crudo, sin data-iata (no validará)
      return null;
    });
  }

  /* Construye el combobox sobre un input */
  function attach(input) {
    if (input.__acReady) return;
    input.__acReady = true;

    var wrap = document.createElement('div');
    wrap.className = 'ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var menu = document.createElement('div');
    menu.className = 'ac-menu';
    menu.setAttribute('role', 'listbox');
    wrap.appendChild(menu);

    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    var current = [], active = -1, open = false;

    function close() {
      open = false; active = -1;
      menu.classList.remove('open'); menu.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
    }

    function render(list) {
      current = list; active = -1;
      if (!list.length) { close(); return; }
      var html = '';
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        html += '<div class="ac-opt" role="option" data-idx="' + i + '">' +
                  '<span class="ac-opt__main">' + esc(a.city) +
                    ' <span class="ac-code">' + esc(a.iata) + '</span></span>' +
                  '<span class="ac-opt__sub">' + esc(a.name) +
                    (a.country ? ' · ' + esc(a.country) : '') + '</span>' +
                '</div>';
      }
      menu.innerHTML = html;
      open = true; menu.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    function hi() {
      for (var i = 0; i < menu.children.length; i++) {
        menu.children[i].classList.toggle('active', i === active);
      }
      if (active >= 0 && menu.children[active]) {
        menu.children[active].scrollIntoView({ block: 'nearest' });
      }
    }

    function choose(idx) {
      var a = current[idx]; if (!a) return;
      setIata(input, a);
      close();
      mark(input, 'ok');
      // 'change' (no 'input') para no re-disparar el listener que limpia data-iata
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.addEventListener('focus', function () {
      load().then(function () {
        if (input.value && !input.getAttribute('data-iata')) render(search(input.value, 8));
      });
    });

    input.addEventListener('input', function () {
      input.removeAttribute('data-iata'); // tipear invalida la selección previa
      var v = input.value;
      load().then(function () { render(search(v, 8)); });
    });

    input.addEventListener('keydown', function (e) {
      if (!open) {
        if (e.key === 'ArrowDown') load().then(function () { render(search(input.value || '', 8)); });
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, current.length - 1); hi(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); hi(); }
      else if (e.key === 'Enter') { if (active >= 0) { e.preventDefault(); choose(active); } }
      else if (e.key === 'Escape') { close(); }
    });

    input.addEventListener('blur', function () {
      // pequeño delay para que el mousedown en una opción gane la carrera
      setTimeout(function () {
        close();
        if (!airports) return;
        if (input.value && !input.getAttribute('data-iata')) {
          var a = resolve(input.value);
          if (a) { setIata(input, a); mark(input, 'ok'); }
          else {
            mark(input, 'error', lang() === 'en'
              ? 'Pick an airport from the list'
              : 'Elegí un aeropuerto de la lista');
          }
        }
      }, 150);
    });

    // mousedown (no click) para no perder el foco antes de seleccionar
    menu.addEventListener('mousedown', function (e) {
      var opt = e.target.closest('.ac-opt'); if (!opt) return;
      e.preventDefault();
      choose(parseInt(opt.getAttribute('data-idx'), 10));
    });
  }

  function init() {
    var inputs = document.querySelectorAll('input[data-airport="true"]');
    for (var i = 0; i < inputs.length; i++) attach(inputs[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AirportSelect = {
    load: load,
    search: search,
    resolve: resolve,
    setFromText: setFromText,
    isReady: function () { return !!airports; }
  };
})();
