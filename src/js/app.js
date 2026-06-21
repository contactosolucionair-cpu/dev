/**
 * SolucionAir — Frontend Application Logic
 *
 * Manages the 3-step claim wizard:
 *   Step 1: Multi-file AI scanner + personal data fields
 *   Step 2: Flight details (auto-filled by AI) + incident + expenses
 *   Step 3: Legal declaration + digital signature + submit
 *
 * Key features:
 * - Multi-file upload with base64 conversion and POST to /api/process-ticket
 * - Real-time field validation with visual feedback (.field-ok, .field-error, .field-ai)
 * - Wizard step navigation with progress bar (Paso 1-3 de 3)
 * - Anti-null sanitization: rejects "null"/"undefined" strings from AI responses
 * - Email forced to lowercase on both AI extraction and user input
 *
 * DOM dependencies: Expects specific element IDs defined in index.html
 * (ai-file, ai-drop, ai-idle, ai-loading, ai-done, ai-error, f-name,
 * f-email, f-phone, f-flight, f-airline, f-date, f-incident, etc.)
 */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var NOTIFY_EMAIL = 'contacto.solucionair@gmail.com';

  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  var S = { lang: 'es', tab: 'flight', files: { flight: [], baggage: [] }, lastRef: null };

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
    var panel = z.closest('.panel');
    var type = panel && panel.id === 'panel-flight' ? 'flight' : 'baggage';
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

  /* ============ PROGRESS ============ */
  function getReq() {
    var panel = document.getElementById('panel-' + S.tab);
    return panel ? $$('[data-required="true"]', panel) : [];
  }

  function tick() {
    var flds = getReq(); if (!flds.length) return;
    var n = 0;
    flds.forEach(function (f) {
      if (f.type === 'checkbox') { if (f.checked) n++; }
      else if (f.tagName === 'SELECT') { if (f.value) n++; }
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
        fillField('f-origin', d.origen);
        fillField('f-destination', d.destino);
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
    if (!value || value === 'null' || value === 'undefined') return;
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

    fetch('/api/process-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: null,
        manualSubmit: true,
        email: userEmail,
        password: '',
        nombre: gv('f-name'),
        telefono: gv('f-phone'),
        doc_tipo: gv('f-doctype'),
        doc_numero: gv('f-docnum'),
        aerolinea: gv('f-airline'),
        vuelo_nro: gv('f-flight'),
        origen: gv('f-origin'),
        destino: gv('f-destination'),
        fecha_vuelo: gv('f-date'),
        pnr: gv('f-pnr'),
        tipo_incidente: gv('f-incident'),
        delay_hours: gv('f-delay-hours'),
        notificacion: gv('f-notice'),
        reembolso: gv('f-refund'),
        causa: gv('f-cause'),
        moneda: gv('f-currency'),
        gastos_monto: gv('f-expenses-amount'),
        gastos_detalle: gv('f-expenses-detail')
      })
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

  /* ============ INIT ============ */
  setLang('es');
  setTab('flight');
  /* App initialized */
});
