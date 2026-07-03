/* ============ GOOGLE IDENTITY SERVICES (must be global) ============ */
window.firmaGoogle = null;

window.onGoogleLibraryLoad = function () {
  if (typeof google === 'undefined' || !google.accounts) return;
  google.accounts.id.initialize({
    client_id: '883687663702-qu8hq4jlp5lsps77ouonmu2as58clu70.apps.googleusercontent.com',
    callback: window.recibirLoginGoogle,
    auto_select: false,
    cancel_on_tap_outside: true
  });
  google.accounts.id.renderButton(
    document.getElementById('google-btn-container'),
    { theme: 'outline', size: 'large', text: 'signin_with', locale: 'es' }
  );
};

window.recibirLoginGoogle = function (response) {
  try {
    var parts = response.credential.split('.');
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    var pad = b64.length % 4;
    if (pad) b64 += '===='.slice(pad);
    var payload = JSON.parse(atob(b64));

    window.firmaGoogle = {
      sub: payload.sub,
      email_verified: payload.email_verified === true,
      iss: payload.iss
    };

    var nombre = payload.name || '';
    var email  = payload.email || '';

    document.querySelectorAll('#f-name').forEach(function (el) { el.value = nombre; el.readOnly = true; });
    document.querySelectorAll('#f-email').forEach(function (el) { el.value = email;  el.readOnly = true; });

    var chipNombre = document.getElementById('chip-nombre');
    var chipEmail  = document.getElementById('chip-email');
    var chipAvatar = document.getElementById('chip-avatar');
    if (chipNombre) chipNombre.textContent = nombre;
    if (chipEmail)  chipEmail.textContent  = email;
    if (chipAvatar && payload.picture) {
      var img = document.createElement('img');
      img.src = payload.picture; img.alt = nombre;
      chipAvatar.innerHTML = ''; chipAvatar.appendChild(img);
    }

    var wall    = document.getElementById('google-login-wall');
    var wrapper = document.getElementById('form-content-wrapper');
    if (wall)    wall.style.display    = 'none';
    if (wrapper) wrapper.style.display = '';
  } catch (e) { console.error('[SA] Google login error:', e); }
};

window.cerrarSesionGoogle = function () {
  window.firmaGoogle = null;
  if (typeof google !== 'undefined' && google.accounts) google.accounts.id.disableAutoSelect();

  var nameEl  = document.getElementById('f-name');
  var emailEl = document.getElementById('f-email');
  if (nameEl)  { nameEl.value  = ''; nameEl.readOnly  = false; }
  if (emailEl) { emailEl.value = ''; emailEl.readOnly = false; }

  var chipAvatar = document.getElementById('chip-avatar');
  if (chipAvatar) chipAvatar.innerHTML = '';

  var wall    = document.getElementById('google-login-wall');
  var wrapper = document.getElementById('form-content-wrapper');
  if (wall)    wall.style.display    = '';
  if (wrapper) wrapper.style.display = 'none';
};

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var NOTIFY_EMAIL = 'contacto.solucionair@gmail.com';

  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  var S = { lang: 'es', tab: 'flight', claimType: 'vuelo', files: { flight: [], baggage: [] }, lastRef: null };

  /* ---- DOM ---- */
  var nav = document.querySelector('.nav');
  var langBtns = $$('.lang__btn');
  var tabBtns = $$('.tabs__btn');
  var panels = $$('.panel');
  var progFill = document.getElementById('prog-fill');
  var progPct = document.getElementById('prog-pct');
  var progStep = document.getElementById('prog-step');
  var btnV = document.getElementById('btn-verify');
  var ovReg = document.getElementById('ov-register');
  var formReg = document.getElementById('form-register');
  var modalX = document.getElementById('modal-x');
  var ovOk = document.getElementById('ov-success');
  var btnOk = document.getElementById('btn-ok');

  /* ---- AI Scanner elements ---- */
  var aiFileInput = document.getElementById('ai-file');
  var aiIdle = document.getElementById('ai-idle');
  var aiLoading = document.getElementById('ai-loading');
  var aiDone = document.getElementById('ai-done');
  var aiError = document.getElementById('ai-error');
  var aiRetry = document.getElementById('ai-retry');
  var aiRetryErr = document.getElementById('ai-retry-err');
  var aiDrop = document.getElementById('ai-drop');

  /* ---- Form field IDs (verified from index.html) ---- */
  // #ai-file     → file input for AI scan
  // #f-name      → passenger name
  // #f-email     → passenger email
  // #f-flight    → flight number
  // #f-airline   → airline
  // #f-date      → flight date
  // #f-incident  → incident type select
  // #f-desc      → description textarea

  /* ============ LANGUAGE ============ */
  function setLang(l) {
    S.lang = l;
    document.body.classList.toggle('lang-en', l === 'en');
    langBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-lang-btn') === l); });
    tick();
  }
  langBtns.forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-lang-btn')); }); });

  /* ============ SCROLL ============ */
  window.addEventListener('scroll', function () { if (nav) nav.classList.toggle('scrolled', window.scrollY > 10); }, { passive: true });

  /* ============ TABS ============ */
  function setTab(id) {
    S.tab = id;
    tabBtns.forEach(function (b) { var a = b.getAttribute('data-tab') === id; b.classList.toggle('active', a); b.setAttribute('aria-selected', a); });
    panels.forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + id); });
    clearErr(); tick();
  }
  tabBtns.forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });

  /* ============ EXTRA FILE UPLOADS ============ */
  $$('.drop').forEach(function (z) {
    var inp = $('input[type="file"]', z);
    var list = $('.drop__list', z);
    var type = z.id === 'drop-flight' ? 'flight' : 'baggage';
    z.addEventListener('click', function (e) { if (e.target !== inp) inp.click(); });
    z.addEventListener('dragover', function (e) { e.preventDefault(); });
    z.addEventListener('drop', function (e) { e.preventDefault(); addF(e.dataTransfer.files, type, list); });
    inp.addEventListener('change', function () { addF(inp.files, type, list); inp.value = ''; });
  });

  function addF(fl, t, el) {
    for (var i = 0; i < fl.length; i++) { if (S.files[t].length < 5) S.files[t].push(fl[i]); }
    renderF(t, el);
  }

  function renderF(t, el) {
    el.innerHTML = '';
    S.files[t].forEach(function (f, i) {
      var s = document.createElement('span'); s.className = 'drop__tag'; s.textContent = f.name + ' ';
      var x = document.createElement('button'); x.type = 'button'; x.className = 'drop__tag-x'; x.textContent = '\u00D7';
      x.addEventListener('click', function (e) { e.stopPropagation(); S.files[t].splice(i, 1); renderF(t, el); });
      s.appendChild(x); el.appendChild(s);
    });
  }

  /* ============ CLAIM TYPE SWITCHER ============ */
  function switchClaimType(type) {
    S.claimType = type;
    document.querySelectorAll('.ctype-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-ctype') === type);
    });
    document.querySelectorAll('.ctype-sub').forEach(function (s) {
      s.classList.toggle('active', s.id === 'sub-' + type);
    });
  }
  document.querySelectorAll('.ctype-btn').forEach(function (b) {
    b.addEventListener('click', function () { switchClaimType(b.getAttribute('data-ctype')); });
  });

  /* Show/hide delivery date for baggage demora */
  var fbType = document.getElementById('fb-type');
  if (fbType) {
    fbType.addEventListener('change', function () {
      var wrap = document.getElementById('fb-delivery-wrap');
      if (wrap) wrap.style.display = fbType.value === 'demora' ? '' : 'none';
    });
  }

  /* ============ COMBINADO: equipaje en reclamo por vuelo ============ */
  var fvBagToggle = document.getElementById('fv-bag-toggle');
  if (fvBagToggle) {
    fvBagToggle.addEventListener('change', function () {
      var f = document.getElementById('fv-bag-fields');
      if (f) f.style.display = fvBagToggle.checked ? '' : 'none';
    });
  }
  var fvBagType = document.getElementById('fv-bag-type');
  if (fvBagType) {
    fvBagType.addEventListener('change', function () {
      var wrap = document.getElementById('fv-bag-delivery-wrap');
      if (wrap) wrap.style.display = fvBagType.value === 'demora' ? '' : 'none';
    });
  }

  /* ============ ACOMPAÑANTES (pasajeros adicionales) ============ */
  function addAcompRow(type, withBag) {
    var listEl = document.getElementById('acomp-' + type + '-list');
    if (!listEl) return;
    var row = document.createElement('div');
    row.className = 'acomp-row';
    var h = '<div class="g g2">'
      + '<div class="field"><label class="field__lbl">Nombre y apellido</label><input class="field__in acomp-nombre" type="text" placeholder="Nombre del acompañante" /></div>'
      + '<div class="field"><label class="field__lbl">Tipo de documento</label><select class="field__in acomp-doctype"><option value="">Seleccionar...</option><option value="DNI">DNI</option><option value="Pasaporte">Pasaporte</option><option value="ID">ID / Cédula</option></select></div>'
      + '<div class="field"><label class="field__lbl">Número de documento</label><input class="field__in acomp-docnum" type="text" placeholder="Número" /></div>'
      + '<div class="field" style="justify-content:flex-end"><label class="acomp-chk"><input type="checkbox" class="acomp-menor" /> <span>Es menor de edad</span></label></div>'
      + '</div>';
    if (withBag) {
      h += '<div class="g g2" style="margin-top:10px">'
        + '<div class="field"><label class="field__lbl">Equipaje: tipo de incidencia</label><select class="field__in acomp-bag-type"><option value="">Seleccionar...</option><option value="perdida">Pérdida</option><option value="danio">Daño</option><option value="demora">Demora en entrega</option></select></div>'
        + '<div class="field"><label class="field__lbl">Valor estimado (USD)</label><input class="field__in acomp-bag-value" type="number" min="0" placeholder="500" /></div>'
        + '</div>'
        + '<div class="g g1" style="margin-top:10px"><div class="field"><label class="field__lbl">Descripción del incidente</label><textarea class="field__in field__ta acomp-bag-desc" rows="2" placeholder="Qué pasó con el equipaje de esta persona"></textarea></div></div>';
    }
    h += '<div style="text-align:right;margin-top:8px"><button type="button" class="acomp-remove">✕ Quitar pasajero</button></div>';
    row.innerHTML = h;
    var rm = row.querySelector('.acomp-remove');
    if (rm) rm.addEventListener('click', function () { row.parentNode.removeChild(row); });
    listEl.appendChild(row);
  }

  var acompAddV = document.getElementById('acomp-vuelo-add');
  if (acompAddV) acompAddV.addEventListener('click', function () { addAcompRow('vuelo', false); });
  var acompAddE = document.getElementById('acomp-equipaje-add');
  if (acompAddE) acompAddE.addEventListener('click', function () { addAcompRow('equipaje', true); });

  function collectAcompanantes() {
    var type = S.claimType === 'equipaje' ? 'equipaje' : 'vuelo';
    var withBag = type === 'equipaje';
    var listEl = document.getElementById('acomp-' + type + '-list');
    if (!listEl) return [];
    var out = [];
    $$('.acomp-row', listEl).forEach(function (row) {
      var nombre = (($('.acomp-nombre', row) || {}).value || '').trim();
      if (!nombre) return; /* skip empty rows */
      var item = {
        nombre: nombre,
        documento_tipo: ($('.acomp-doctype', row) || {}).value || '',
        documento_numero: (($('.acomp-docnum', row) || {}).value || '').trim(),
        es_menor: !!(($('.acomp-menor', row) || {}).checked),
        equipaje: null
      };
      if (withBag) {
        var bt = ($('.acomp-bag-type', row) || {}).value || '';
        if (bt) item.equipaje = {
          tipo: bt,
          descripcion: (($('.acomp-bag-desc', row) || {}).value || '').trim(),
          valor: ($('.acomp-bag-value', row) || {}).value || ''
        };
      }
      out.push(item);
    });
    return out;
  }

  /* ============ PROGRESS ============ */
  function getReq() {
    var active = document.querySelector('.wz-panel.active');
    if (!active) return [];
    var result = [];
    active.querySelectorAll('[data-required="true"]').forEach(function (f) {
      var sub = f.closest('.ctype-sub');
      if (sub && !sub.classList.contains('active')) return;
      result.push(f);
    });
    return result;
  }

  function tick() {
    var flds = getReq(); if (!flds.length) return;
    var n = 0;
    flds.forEach(function (f) {
      if (f.type === 'checkbox') { if (f.checked) n++; }
      else if (f.tagName === 'SELECT') { if (f.value) n++; }
      else if (f.hasAttribute('data-airport')) { if (f.getAttribute('data-iata')) n++; }
      else { if (f.value.trim()) n++; }
    });
    var pct = Math.round(n / flds.length * 100);
    if (progFill) progFill.style.width = pct + '%';
    if (progPct) progPct.textContent = pct + '%';
    /* Step label is updated by the wizard, not by field count */
  }
  document.addEventListener('input', tick);
  document.addEventListener('change', tick);

  /* ============ AI MULTI-FILE SCANNER ============ */
  var aiFileList = document.getElementById('ai-file-list');

  function showAiState(st) {
    if (aiIdle) aiIdle.className = st === 'idle' ? 'ai-scan__idle' : 'ai-scan__idle hidden';
    if (aiLoading) aiLoading.className = st === 'loading' ? 'ai-scan__loading' : 'ai-scan__loading hidden';
    if (aiDone) aiDone.className = st === 'done' ? 'ai-scan__done' : 'ai-scan__done hidden';
    if (aiError) aiError.className = st === 'error' ? 'ai-scan__error' : 'ai-scan__error hidden';
    if (st === 'idle' && aiFileList) aiFileList.style.display = 'none';
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var idx = reader.result.indexOf(',');
        resolve({ base64: reader.result.substring(idx + 1), mimeType: file.type || 'image/jpeg', name: file.name });
      };
      reader.onerror = function () { reject(new Error('FileReader failed for ' + file.name)); };
      reader.readAsDataURL(file);
    });
  }

  function processMultipleWithAI(files) {
    var fileArray = Array.prototype.slice.call(files);
    /* Processing multiple files for AI extraction */

    /* Show file list */
    if (aiFileList) {
      aiFileList.style.display = 'block';
      aiFileList.textContent = fileArray.length + ' archivo' + (fileArray.length > 1 ? 's' : '') + ' seleccionado' + (fileArray.length > 1 ? 's' : '') + ': ' + fileArray.map(function (f) { return f.name; }).join(', ');
    }

    showAiState('loading');
    if (btnV) { btnV.disabled = true; btnV.style.opacity = '0.5'; }

    /* Convert all files to base64 */
    Promise.all(fileArray.map(readFileAsBase64))
      .then(function (results) {
        S.scannedFiles = results;
        /* All files converted, sending to API */
        return fetch('/api/process-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: results.map(function (r) { return { base64: r.base64, mimeType: r.mimeType, name: r.name }; }),
            multiFile: true,
            email: (document.getElementById('f-email') || {}).value || ''
          })
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        /* AI response received */
        if (!json.success || !json.data) { showAiState('error'); return; }

        var d = json.data;
        /* Paso 1 fields */
        fillField('f-name', d.nombre);
        fillField('f-email', d.email ? d.email.toLowerCase() : null);
        fillField('f-phone', d.telefono);
        fillField('f-docnum', d.doc_numero);
        /* Paso 2 fields */
        fillField('f-airline', d.aerolinea);
        fillField('f-flight', d.vuelo_nro);
        fillAirport('f-origin', d.origen);
        fillAirport('f-destination', d.destino);
        fillField('f-date', d.fecha_vuelo);
        fillField('f-pnr', d.pnr);
        /* Gastos */
        if (d.gastos_monto) fillField('f-expenses-amount', d.gastos_monto);
        if (d.gastos_moneda) {
          var currEl = document.getElementById('f-currency');
          if (currEl) { currEl.value = d.gastos_moneda; currEl.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        /* Incidencia auto-detect */
        if (d.incidencia_detectada) {
          var incMap = { 'cancelacion': 'cancelacion', 'demora': 'demora', 'overbooking': 'overbooking' };
          var incVal = incMap[d.incidencia_detectada];
          if (incVal) {
            var incEl = document.getElementById('f-incident');
            if (incEl && !incEl.value) { incEl.value = incVal; incEl.dispatchEvent(new Event('change', { bubbles: true })); }
          }
        }

        S.aiData = d;
        showAiState('done');
        tick();
      })
      .catch(function (err) {
        console.error('[SA] Multi-file error:', err);
        showAiState('error');
      })
      .finally(function () {
        if (btnV) { btnV.disabled = false; btnV.style.opacity = ''; }
      });
  }

  function fillField(id, value) {
    if (!value || value === 'null' || value === 'undefined' || value === 'N/A' || value === 'unknown') return;
    var el = document.getElementById(id);
    if (!el || el.value) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    var field = el.closest('.field');
    if (field) {
      field.classList.remove('field-ok', 'field-error');
      field.classList.add('field-ai');
      var msg = $('.field__msg', field);
      if (msg) msg.textContent = 'Completado por IA';
      setTimeout(function () { field.classList.remove('field-ai'); field.classList.add('field-ok'); if (msg) msg.textContent = ''; }, 4000);
    }
  }

  /* Autofill para campos de aeropuerto: resuelve el texto de la IA al IATA real. */
  function fillAirport(id, raw) {
    if (!raw || raw === 'null' || raw === 'undefined' || raw === 'N/A') return;
    var el = document.getElementById(id);
    if (!el || el.value) return;
    if (!window.AirportSelect) { fillField(id, raw); return; }
    window.AirportSelect.setFromText(el, raw).then(function (a) {
      /* 'change' (no 'input') para no gatillar el listener del combobox que limpia data-iata */
      el.dispatchEvent(new Event('change', { bubbles: true }));
      var field = el.closest('.field');
      if (field) {
        field.classList.remove('field-ok', 'field-error');
        field.classList.add('field-ai');
        var msg = $('.field__msg', field);
        if (msg) msg.textContent = a ? 'Completado por IA'
          : (S.lang === 'en' ? 'Confirm the airport' : 'Confirmá el aeropuerto');
        setTimeout(function () {
          field.classList.remove('field-ai');
          if (a) { field.classList.add('field-ok'); if (msg) msg.textContent = ''; }
        }, 4000);
      }
      tick();
    });
  }

  /* ---- Wire up #ai-file (multi) ---- */
  if (aiFileInput) {
    aiFileInput.addEventListener('change', function () {
      if (this.files && this.files.length > 0) {
        processMultipleWithAI(this.files);
      }
    });
  }

  /* ---- Drop zone ---- */
  if (aiDrop && aiFileInput) {
    aiDrop.addEventListener('click', function (e) { if (e.target !== aiFileInput) aiFileInput.click(); });
    aiDrop.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); });
    aiDrop.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) processMultipleWithAI(e.dataTransfer.files);
    });
  }

  /* ---- Retry ---- */
  if (aiRetry) aiRetry.addEventListener('click', function () { showAiState('idle'); });
  if (aiRetryErr) aiRetryErr.addEventListener('click', function () { showAiState('idle'); });

  /* ============ DOCUMENT AUTO-FILL (Reserva / Boarding) ============ */
  function setupDocAnalyzer(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('change', function () {
      if (!input.files || !input.files[0]) return;
      var file = input.files[0];
      var field = input.closest('.field');
      var msg = field ? $('.field__msg', field) : null;

      if (msg) { msg.textContent = 'IA analizando tu pasaje... \u26A1'; msg.style.color = '#6366F1'; }

      readFileAsBase64(file).then(function (result) {
        return fetch('/api/analyze-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: result.base64, mimeType: result.mimeType })
        });
      }).then(function (r) { return r.json(); }).then(function (json) {
        if (!json.success || !json.data) {
          if (msg) { msg.textContent = 'No se pudieron extraer datos.'; msg.style.color = '#C0392B'; }
          return;
        }
        var d = json.data;
        var docFields = [
          ['f-airline', d.aerolinea],
          ['f-flight', d.numero_vuelo],
          ['f-origin', d.origen],
          ['f-destination', d.destino],
          ['f-date', d.fecha_vuelo],
          ['f-pnr', d.pnr]
        ];
        var filled = 0;
        docFields.forEach(function (pair) {
          if (!pair[1]) return;
          if (pair[0] === 'f-origin' || pair[0] === 'f-destination') {
            var ael = document.getElementById(pair[0]);
            if (ael && !ael.value) { fillAirport(pair[0], pair[1]); filled++; }
            return;
          }
          var el = document.getElementById(pair[0]);
          if (!el || el.value) return;
          el.value = pair[1];
          el.dispatchEvent(new Event('input', { bubbles: true }));
          filled++;
          var f = el.closest('.field');
          if (f) {
            f.classList.add('field-ai');
            var m = $('.field__msg', f);
            if (m) m.textContent = 'Completado por IA';
            setTimeout(function () { f.classList.remove('field-ai'); f.classList.add('field-ok'); if (m) m.textContent = ''; }, 4000);
          }
        });
        if (msg) { msg.textContent = filled + ' campos completados por IA \u2713'; msg.style.color = '#1B9B5A'; setTimeout(function () { if (msg) msg.textContent = ''; }, 5000); }
        tick();
      }).catch(function (err) {
        console.error('[SA] Doc analyze error:', err);
        if (msg) { msg.textContent = 'Error al analizar. Completá manualmente.'; msg.style.color = '#C0392B'; }
      });
    });
  }

  setupDocAnalyzer('f-reserva');
  setupDocAnalyzer('f-boarding');

  /* ============ VALIDATION ============ */
  function clearErr() {
    $$('.field').forEach(function (f) { f.classList.remove('field-ok', 'field-error', 'field-ai'); var m = $('.field__msg', f); if (m) m.textContent = ''; });
    $$('.consent').forEach(function (c) { c.classList.remove('field-error'); });
  }

  function validate() {
    var flds = getReq(), en = S.lang === 'en', ok = true;
    flds.forEach(function (f) {
      if (f.type === 'checkbox') {
        var w = f.closest('.consent');
        if (!f.checked) { w.classList.add('field-error'); ok = false; } else { w.classList.remove('field-error'); }
        return;
      }
      var g = f.closest('.field'), m = $('.field__msg', g);
      var filled = f.tagName === 'SELECT' ? !!f.value : !!f.value.trim();
      if (!filled) { g.classList.add('field-error'); g.classList.remove('field-ok'); if (m) m.textContent = en ? 'Required' : 'Obligatorio'; ok = false; }
      else if (f.hasAttribute('data-airport') && !f.getAttribute('data-iata')) { g.classList.add('field-error'); g.classList.remove('field-ok'); if (m) m.textContent = en ? 'Pick an airport from the list' : 'Elegí un aeropuerto de la lista'; ok = false; }
      else if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value.trim())) { g.classList.add('field-error'); g.classList.remove('field-ok'); if (m) m.textContent = en ? 'Invalid email' : 'Email invalido'; ok = false; }
      else { g.classList.add('field-ok'); g.classList.remove('field-error'); if (m) m.textContent = ''; }
    });
    return ok;
  }

  /* ============ SUBMIT DIRECTLY FROM STEP 3 ============ */
  if (btnV) btnV.addEventListener('click', function () {
    clearErr();
    if (!validate()) { var e = $('.field-error,.consent.field-error'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    function gv(id) { return (document.getElementById(id) || {}).value || ''; }
    var userEmail = gv('f-email');
    if (!userEmail) { alert('Completá tu mail en el Paso 1.'); return; }

    /* Submitting claim */
    btnV.disabled = true; btnV.textContent = 'Enviando...';

    var cd = window.consentData || {};
    var fg = window.firmaGoogle || {};

    /* Convert drop-zone files (step 2) to base64 and merge with AI-scanned files */
    var dropKey = S.claimType === 'equipaje' ? 'baggage' : 'flight';
    var dropFiles = S.files[dropKey] || [];

    function filesToB64(files) {
      return Promise.all(files.map(function(f) {
        return new Promise(function(resolve) {
          var r = new FileReader();
          r.onload = function() {
            var idx = r.result.indexOf(',');
            resolve({ base64: r.result.substring(idx + 1), mimeType: f.type || 'application/octet-stream', name: f.name });
          };
          r.onerror = function() { resolve(null); };
          r.readAsDataURL(f);
        });
      })).then(function(results) { return results.filter(Boolean); });
    }

    /* Combined flight+baggage: if a flight claim also reports baggage, switch type
       and map the fv-bag-* fields onto the existing baggage columns. */
    var tipoReclamo = S.claimType;
    var bagType = gv('fb-type'), bagDesc = gv('fb-description'), bagValue = gv('fb-value'), bagDelivery = gv('fb-delivery-date');
    if (S.claimType === 'vuelo') {
      var fvT = document.getElementById('fv-bag-toggle');
      if (fvT && fvT.checked && gv('fv-bag-type')) {
        tipoReclamo = 'vuelo_equipaje';
        bagType = gv('fv-bag-type'); bagDesc = gv('fv-bag-desc'); bagValue = gv('fv-bag-value'); bagDelivery = gv('fv-bag-delivery');
      }
    }
    var acompanantes = collectAcompanantes();

    filesToB64(dropFiles).then(function(convertedDrop) {
      var allFiles = (S.scannedFiles || []).concat(convertedDrop);
      return fetch('/api/process-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manualSubmit:           true,
        /* Claim type */
        tipo_reclamo:           tipoReclamo,
        /* Google identity */
        google_sub:             fg.sub             || null,
        google_email_verified:  fg.email_verified  != null ? String(fg.email_verified) : null,
        google_iss:             fg.iss             || null,
        /* Identity */
        email:                  userEmail,
        nombre:                 gv('f-name'),
        telefono:               gv('f-phone'),
        documento_tipo:         gv('f-doctype'),
        documento_numero:       gv('f-docnum'),
        /* Flight */
        aerolinea:              gv('f-airline'),
        vuelo_nro:              gv('f-flight'),
        origen:                 gv('f-origin'),
        destino:                gv('f-destination'),
        fecha_vuelo:            gv('f-date'),
        pnr:                    gv('f-pnr'),
        /* Incident (vuelo) */
        tipo_incidencia:        gv('f-incident'),
        horas_retraso:          gv('f-delay-hours'),
        anticipacion_aviso:     gv('f-notice'),
        ofrecimiento_aerolinea: gv('f-refund'),
        causa_informada:        gv('f-cause'),
        /* Expenses (vuelo) */
        moneda_gastos:          gv('f-currency'),
        monto_gastos:           gv('f-expenses-amount'),
        gastos_detalle:         gv('f-expenses-detail'),
        /* Baggage fields (equipaje claim, or combined vuelo+equipaje) */
        tipo_caso_equipaje:     bagType,
        descripcion_equipaje:   bagDesc,
        valor_equipaje:         bagValue,
        fecha_entrega_equipaje: bagDelivery,
        /* Acompañantes (pasajeros adicionales) */
        acompanantes:           acompanantes,
        /* Consent / electronic signature (from terms modal) */
        consent_version:        cd.consent_version  || null,
        consent_tyc:            cd.consent_tyc      || false,
        consent_autorizacion:   cd.consent_autorizacion || false,
        firma_fecha:            cd.firma_fecha       || null,
        firma_ts:               cd.firma_ts          || null,
        user_agent:             cd.user_agent        || navigator.userAgent,
        /* All uploaded files: AI scan + drop zone */
        scanned_files:          allFiles
      })
    });
    }).then(function (r) { return r.json(); }).then(function (json) {
      /* Submit response received */
      btnV.disabled = false; btnV.textContent = 'Enviar reclamo';

      if (!json.success) {
        alert(json.error || 'Error al enviar el reclamo');
        return;
      }

      /* Show success card with CSA code */
      var caseId = json.refCode || 'CSA000';
      var el = document.getElementById('success-case-id');
      if (el) el.textContent = caseId;

      /* Hide all step panels and wizard, show success */
      document.querySelectorAll('.wz-panel').forEach(function (p) { p.classList.remove('active'); });
      var successPanel = document.getElementById('wz-success');
      if (successPanel) successPanel.classList.add('active');
      var wzSteps = document.getElementById('wizard-steps');
      if (wzSteps) wzSteps.style.display = 'none';
      var progBar = document.querySelector('.prog');
      if (progBar) progBar.style.display = 'none';

      document.getElementById('claim').scrollIntoView({ behavior: 'smooth', block: 'start' });

    }).catch(function (err) {
      console.error('[SA] Submit error:', err);
      btnV.disabled = false; btnV.textContent = 'Enviar reclamo';
      alert('Error de conexión. Intentá de nuevo.');
    });
  });

  /* Built-in translations for all data-t keys */
  var DICT = {
    es: {
      /* Nav */
      nav_cases:'Casos', nav_how:'Cómo funciona', nav_why:'Por qué elegirnos', nav_about:'Quiénes somos', nav_faq:'FAQ',
      nav_cta:'Iniciá tu reclamo',
      hero_title:'Plataforma de reclamos aéreos', hero_cta:'Iniciá gratis tu reclamo',
      badge1:'✓ Solo cobramos si ganás', badge2:'✓ Cubrimos todos los costos', badge3:'✓ Sin riesgo',
      form_title:'Comenzá tu reclamo',
      /* Select options */
      opt_select:'Seleccionar...', opt_dni:'DNI', opt_passport:'Pasaporte', opt_id:'ID / Cédula',
      /* Wizard */
      wz1:'Tus datos', wz2:'Tu caso', wz3:'Enviar',
      form_sub:'Analizamos tu caso sin costo y nos encargamos del proceso. Completá estos datos y revisamos si tu reclamo puede avanzar. Si falta información, te vamos a contactar para orientarte.',
      /* AI Scanner */
      ai_txt:'Subí tus documentos de viaje para autocompletar con IA ⚡', ai_meta:'Seleccioná uno o varios archivos · JPG, PNG, PDF · Máx. 10MB c/u',
      ai_loading:'La IA está analizando tus documentos...', ai_loading_sub:'Extrayendo datos combinados de todos los archivos',
      ai_done:'Datos extraídos correctamente', ai_retry:'Escanear otros', ai_err:'No se pudieron analizar los archivos. Completá los campos manualmente.', ai_retry2:'Reintentar',
      /* Form Step 1 */
      f_personal_t:'Tus datos personales', f_personal_sub:'Tal como figuran en tu documento de identidad.',
      lbl_name:'Nombre y Apellido', lbl_phone:'Teléfono', lbl_email:'Mail', lbl_doctype:'Tipo de documento', lbl_docnum:'Número de documento',
      btn_next2:'Continuar al Paso 2 →',
      /* Form Step 2 */
      f_flight_t:'Identificación del vuelo', f_flight_sub:'Si subiste tu pasaje con IA, estos campos ya están completos. Revisalos o corregí lo que haga falta.',
      lbl_airline:'Aerolínea', lbl_flight:'Número de vuelo', lbl_origin:'Origen', lbl_dest:'Destino', lbl_date:'Fecha del vuelo', lbl_pnr:'Código de reserva (PNR)',
      f_incident_t:'Incidente', lbl_incident:'Tipo de incidencia', lbl_delay:'Magnitud del retraso (horas)', lbl_notice:'Anticipación de notificación', lbl_refund:'¿Ofrecieron reembolso?',
      f_cause_t:'Causa informada por la aerolínea',
      f_expenses_t:'Gastos incurridos', f_expenses_sub:'Si tuviste gastos extras por el incidente, detallalos acá.',
      btn_back:'← Volver', btn_next3:'Continuar al Paso 3 →',
      /* Form Step 3 */
      f_sign_t:'Declaración jurada y firma electrónica', f_sign_sub:'Leé atentamente antes de firmar y enviar.',
      btn_back2:'← Volver al Paso 2', btn_submit:'Enviar reclamo', btn_note:'Análisis gratuito e instantáneo · Sin compromiso',
      /* How it works */
      how_ey:'Proceso', how_title:'Cómo funciona', how_sub:'Cuatro pasos simples para recuperar tu compensación',
      step1_t:'Cargás tu caso', step1_d:'Subís los datos y documentación desde tu PC o celular. Nuestra IA lee tu pasaje automáticamente.',
      step2_t:'Hacemos el reclamo por vos', step2_d:'Te mantenemos informado y cubrimos todos los costos del proceso.',
      step3_t:'Obtenés tu compensación', step3_d:'La aerolínea responde con un acuerdo o derivamos a mediación online profesional.',
      step4_t:'Pagás 20% por el servicio', step4_d:'Si no ganás, no pagás.',
      /* Contingency */
      ctg_title:'¿Sin respuesta de la aerolínea?', ctg_desc:'Derivamos tu caso a nuestra Red de Profesionales: una mediación privada y 100% online, sin necesidad de tribunales.',
      ctg1_t:'Abogado especializado', ctg1_d:'Un abogado de nuestra Red de Profesionales, especializado en derechos del pasajero.',
      ctg2_t:'Estrategia legal', ctg2_d:'Armamos la mejor estrategia basada en normativa vigente y jurisprudencia.',
      ctg3_t:'Mediación por videollamada', ctg3_d:'Resolución 100% online, sin necesidad de trasladarte a ningún tribunal.',
      ctg4_t:'Pagás 20% por el servicio', ctg4_d:'Si no ganás, no pagás.',
      ctg_note:'Sin riesgo para vos. Si no hay compensación, no pagás nada.',
      /* Cases */
      cases_ey:'Cobertura', cases_title:'Casos que podés reclamar',
      case1_t:'Vuelo demorado', case1_d:'Si llegaste tarde a destino por culpa de la aerolínea.',
      case2_t:'Vuelo cancelado', case2_d:'Si la aerolínea canceló tu vuelo sin causa de fuerza mayor.',
      case3_t:'Sobreventa', case3_d:'Si te denegaron el embarque por venta de más asientos de los disponibles.',
      case4_t:'Equipaje perdido', case4_d:'Si tu equipaje no llegó y pasaron más de 21 días sin ser localizado.',
      case5_t:'Equipaje dañado', case5_d:'Si tu maleta llegó rota, rajada o con daños visibles causados durante el vuelo.',
      case6_t:'Equipaje entregado tarde', case6_d:'Si tu equipaje llegó días después que vos y tuviste gastos por eso.',
      /* Advantages */
      adv_ey:'Beneficios', adv_title:'Por qué elegirnos',
      adv1_t:'Sin costos iniciales', adv1_d:'No pagás nada por adelantado. Nosotros cubrimos todos los gastos del proceso.',
      adv2_t:'Solo cobramos si ganás', adv2_d:'Nuestros honorarios se aplican únicamente si conseguimos tu compensación.',
      adv3_t:'No tenés que pelearte con la aerolínea', adv3_d:'Nos encargamos de todo el proceso. Vos solo nos contás qué pasó y nosotros nos ocupamos del resto.',
      adv4_t:'Te mantenemos informado', adv4_d:'Recibís actualizaciones en cada etapa del proceso.',
      adv5_t:'Revisamos tu caso antes de avanzar', adv5_d:'Analizamos la viabilidad antes de iniciar. Si el reclamo no tiene posibilidades reales, te lo decimos sin vueltas.',
      adv6_t:'Equipo especializado', adv6_d:'Conocemos las normativas de cada aerolínea y jurisdicción. Tu reclamo está en manos de quienes saben cómo avanzar.',
      /* Testimonials */
      test_ey:'Testimonios', test_title:'Lo que dicen nuestros clientes',
      test1_q:'"Pensé que era imposible reclamar, pero SolucionAir se encargó de todo. En pocas semanas tenía mi compensación acreditada."',
      test1_m:'Buenos Aires · Vuelo demorado · USD 600 recuperados',
      test2_q:'"Me cancelaron el vuelo y no sabía qué hacer. Subí mi pasaje, la IA completó todo y a los días ya tenía respuesta."',
      test2_m:'Córdoba · Vuelo cancelado · USD 320 recuperados',
      test3_q:'"Mi equipaje llegó destruido. SolucionAir gestionó el reclamo completo, incluyendo la mediación. Excelente servicio."',
      test3_m:'Mendoza · Equipaje dañado · USD 450 recuperados',
      /* About */
      about_ey:'Equipo', about_title:'Quién está detrás de SolucionAir',
      about_p1:'SolucionAir nace para simplificar un proceso que suele ser confuso, lento y frustrante para los pasajeros. Combinamos gestión, análisis de casos y seguimiento personalizado para ayudarte a reclamar lo que te corresponde sin que tengas que ocuparte de todo el trámite.',
      about_p2:'Somos un equipo especializado en gestión de reclamos ante aerolíneas. Cada caso recibe atención directa, con seguimiento real y comunicación clara en cada etapa.',
      about_p3:'¿Tenés alguna consulta? Escribinos a contacto@solucionair.com',
      /* FAQ */
      faq_ey:'Ayuda', faq_title:'Preguntas frecuentes',
      faq1_q:'¿Cuánto cuesta usar SolucionAir?', faq1_a:'Nada por adelantado. El servicio inicial es 100% gratuito. Solo cobramos una comisión del 20% sobre la compensación obtenida si el reclamo es exitoso.',
      faq2_q:'¿Cuándo cobran sus honorarios?', faq2_a:'Únicamente cuando vos cobrás tu compensación. Si no se consigue nada, no nos debés nada.',
      faq3_q:'¿Qué pasa si mi reclamo no prospera?', faq3_a:'No pagás absolutamente nada. Nosotros asumimos el riesgo y los costos del proceso completo.',
      faq4_q:'¿Cuánto tarda el proceso?', faq4_a:'Depende de la aerolínea y el tipo de reclamo. Los casos simples pueden resolverse en semanas, mientras que los que van a mediación pueden tomar algunos meses.',
      faq5_q:'¿Qué documentación necesito?', faq5_a:'Lo mínimo es tu pasaje, boarding pass o reserva. Si tenés fotos, emails de la aerolínea o recibos de gastos adicionales, también nos sirven. Nuestra IA puede extraer los datos de una captura de pantalla.',
      faq6_q:'¿Mis datos están protegidos?', faq6_a:'Sí. Toda la información que compartís está protegida y solo se usa para gestionar tu reclamo. No vendemos ni compartimos tus datos con terceros.',
      faq7_q:'¿Qué casos se pueden reclamar?', faq7_a:'Vuelos demorados (más de 3 horas), cancelaciones, sobreventa (overbooking), denegación de embarque, downgrades de clase, equipaje perdido, dañado o entregado con demora.',
      /* Login */
      login_title:'Ingresá a tu panel', login_desc:'Usá el email y contraseña con los que registraste tu reclamo.',
      /* Footer */
      ft_tagline:'Tu compensación siempre despega.', ft_desc:'Plataforma LegalTech con inteligencia artificial para reclamos aéreos.',
      ft_contact:'Contacto', ft_legal:'Legal', ft_terms:'Términos y Condiciones', ft_privacy:'Política de Privacidad',
    },
    en: {
      /* Nav */
      nav_cases:'Cases', nav_how:'How it works', nav_why:'Why choose us', nav_about:'About us', nav_faq:'FAQ',
      nav_cta:'Start your claim',
      hero_title:'Flight claims platform', hero_cta:'Start your free claim',
      badge1:'✓ No win, no fee', badge2:'✓ We cover all costs', badge3:'✓ No risk',
      form_title:'Start your claim',
      /* Select options */
      opt_select:'Select...', opt_dni:'National ID', opt_passport:'Passport', opt_id:'ID Card',
      /* Wizard */
      wz1:'Your data', wz2:'Your case', wz3:'Submit',
      form_sub:'We analyze your case for free and handle the process. Fill in these details and we\'ll check if your claim can proceed. If information is missing, we\'ll contact you.',
      /* AI Scanner */
      ai_txt:'Upload your travel documents to auto-fill with AI ⚡', ai_meta:'Select one or multiple files · JPG, PNG, PDF · Max 10MB each',
      ai_loading:'AI is analyzing your documents...', ai_loading_sub:'Extracting combined data from all files',
      ai_done:'Data extracted successfully', ai_retry:'Scan others', ai_err:'Could not analyze the files. Please fill in the fields manually.', ai_retry2:'Retry',
      /* Form Step 1 */
      f_personal_t:'Your personal details', f_personal_sub:'As they appear on your ID document.',
      lbl_name:'First & Last Name', lbl_phone:'Phone Number', lbl_email:'Email Address', lbl_doctype:'ID Type', lbl_docnum:'ID Number',
      btn_next2:'Continue to Step 2 →',
      /* Form Step 2 */
      f_flight_t:'Flight identification', f_flight_sub:'If you uploaded your ticket with AI, these fields are already filled. Review or edit as needed.',
      lbl_airline:'Airline', lbl_flight:'Flight Number', lbl_origin:'Origin', lbl_dest:'Destination', lbl_date:'Flight Date', lbl_pnr:'Booking Code (PNR)',
      f_incident_t:'Incident', lbl_incident:'Incident Type', lbl_delay:'Delay duration (hours)', lbl_notice:'Notification advance', lbl_refund:'Was a refund offered?',
      f_cause_t:'Cause reported by the airline',
      f_expenses_t:'Incurred expenses', f_expenses_sub:'If you had extra expenses due to the incident, detail them here.',
      btn_back:'← Back', btn_next3:'Continue to Step 3 →',
      /* Form Step 3 */
      f_sign_t:'Sworn statement and electronic signature', f_sign_sub:'Read carefully before signing and submitting.',
      btn_back2:'← Back to Step 2', btn_submit:'Submit claim', btn_note:'Free and instant analysis · No commitment',
      /* How it works */
      how_ey:'Process', how_title:'How it works', how_sub:'Four simple steps to recover your compensation',
      step1_t:'Upload your case', step1_d:'Upload your data and documents from your PC or phone. Our AI reads your ticket automatically.',
      step2_t:'We claim for you', step2_d:'We keep you informed and cover all process costs.',
      step3_t:'You get your compensation', step3_d:'The airline responds with an agreement or we refer to professional online mediation.',
      step4_t:'You pay 20% for the service', step4_d:'If you don\'t win, you don\'t pay.',
      /* Contingency */
      ctg_title:'No response from the airline?', ctg_desc:'We refer your case to our Professional Network: private and 100% online mediation, no courts needed.',
      ctg1_t:'Specialized attorney', ctg1_d:'A lawyer from our Professional Network, specialised in passenger rights.',
      ctg2_t:'Legal strategy', ctg2_d:'We build the best strategy based on current regulations and case law.',
      ctg3_t:'Video call mediation', ctg3_d:'100% online resolution, no need to travel to any court.',
      ctg4_t:'You pay 20% for the service', ctg4_d:'If you don\'t win, you don\'t pay.',
      ctg_note:'No risk for you. If there is no compensation, you pay nothing.',
      /* Cases */
      cases_ey:'Coverage', cases_title:'Cases you can claim',
      case1_t:'Delayed flight', case1_d:'If you arrived late at your destination due to the airline\'s fault.',
      case2_t:'Cancelled flight', case2_d:'If the airline cancelled your flight without extraordinary circumstances.',
      case3_t:'Overbooking', case3_d:'If you were denied boarding because the airline oversold the flight.',
      case4_t:'Lost baggage', case4_d:'If your luggage didn\'t arrive and more than 21 days passed without being found.',
      case5_t:'Damaged baggage', case5_d:'If your bag arrived broken, torn or visibly damaged during the flight.',
      case6_t:'Late baggage', case6_d:'If your baggage arrived days after you and you incurred expenses as a result.',
      /* Advantages */
      adv_ey:'Benefits', adv_title:'Why choose us',
      adv1_t:'No upfront costs', adv1_d:'You pay nothing in advance. We cover all process expenses.',
      adv2_t:'We only charge if you win', adv2_d:'Our fees apply only if we secure your compensation.',
      adv3_t:'No fighting with the airline', adv3_d:'We handle the entire process. You just tell us what happened and we take care of the rest.',
      adv4_t:'We keep you informed', adv4_d:'You receive updates at every stage of the process.',
      adv5_t:'We review your case before proceeding', adv5_d:'We assess viability before starting. If the claim has no real chance, we tell you straight.',
      adv6_t:'Specialized team', adv6_d:'We know the regulations of each airline and jurisdiction. Your claim is in the hands of those who know how to move it forward.',
      /* Testimonials */
      test_ey:'Testimonials', test_title:'What our clients say',
      test1_q:'"I thought it was impossible to claim, but SolucionAir handled everything. In a few weeks I had my compensation credited."',
      test1_m:'Buenos Aires · Delayed flight · USD 600 recovered',
      test2_q:'"My flight was cancelled and I didn\'t know what to do. I uploaded my ticket, the AI filled everything in, and within days I had an answer."',
      test2_m:'Córdoba · Cancelled flight · USD 320 recovered',
      test3_q:'"My baggage arrived destroyed. SolucionAir managed the entire claim, including mediation. Excellent service."',
      test3_m:'Mendoza · Damaged baggage · USD 450 recovered',
      /* About */
      about_ey:'Team', about_title:'Who is behind SolucionAir',
      about_p1:'SolucionAir was created to simplify a process that is often confusing, slow and frustrating for passengers. We combine case management, case analysis and personalised follow-up to help you claim what you\'re owed without having to handle the entire procedure yourself.',
      about_p2:'We are a team specialised in airline claims management. Each case receives direct attention, with real follow-up and clear communication at every stage.',
      about_p3:'Have a question? Write to us at contacto@solucionair.com',
      /* FAQ */
      faq_ey:'Help', faq_title:'Frequently asked questions',
      faq1_q:'How much does SolucionAir cost?', faq1_a:'Nothing upfront. The initial service is 100% free. We only charge a 20% commission on the compensation obtained if the claim is successful.',
      faq2_q:'When do you charge your fees?', faq2_a:'Only when you receive your compensation. If nothing is obtained, you owe us nothing.',
      faq3_q:'What happens if my claim doesn\'t succeed?', faq3_a:'You pay absolutely nothing. We assume the risk and costs of the entire process.',
      faq4_q:'How long does the process take?', faq4_a:'It depends on the airline and type of claim. Simple cases can be resolved in weeks, while those going to mediation may take a few months.',
      faq5_q:'What documentation do I need?', faq5_a:'At minimum, your ticket, boarding pass or booking. If you have photos, airline emails or receipts for additional expenses, those help too. Our AI can extract data from a screenshot.',
      faq6_q:'Is my data protected?', faq6_a:'Yes. All information you share is protected and used solely to manage your claim. We do not sell or share your data with third parties.',
      faq7_q:'What cases can be claimed?', faq7_a:'Delayed flights (over 3 hours), cancellations, overbooking, denied boarding, class downgrades, lost, damaged or delayed baggage.',
      /* Login */
      login_title:'Access your panel', login_desc:'Use the email and password you registered your claim with.',
      /* Footer */
      ft_tagline:'Your compensation always takes off.', ft_desc:'AI-powered LegalTech platform for flight claims.',
      ft_contact:'Contact', ft_legal:'Legal', ft_terms:'Terms and Conditions', ft_privacy:'Privacy Policy',
    }
  };

  function applyTexts(lang) {
    /* Apply all data-t elements from the built-in dictionary.
       Preserves child elements like <span class="field__ast">*</span> inside labels. */
    var dict = DICT[lang] || DICT.es;
    var fallback = DICT.es;
    document.querySelectorAll('[data-t]').forEach(function (el) {
      var key = el.getAttribute('data-t');
      var text = dict[key] || fallback[key];
      if (!text) return;

      /* Check if element has child elements to preserve (like the * asterisk) */
      var preserved = el.querySelector('.field__ast, svg');
      if (preserved) {
        /* Replace only the text node, keep child elements */
        var clone = preserved.cloneNode(true);
        el.textContent = text.replace(/\s*\*\s*$/, '') + ' ';
        el.appendChild(clone);
      } else {
        el.textContent = text;
      }
    });
  }

  /* Override setLang to also apply translated texts */
  var originalSetLang = setLang;
  setLang = function (l) {
    originalSetLang(l);
    applyTexts(l);
  };

  /* ============ INIT ============ */
  setLang('es');
  setTab('flight');
});
