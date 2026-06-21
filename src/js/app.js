/**
 * SolucionAir — Frontend Application Controller
 *
 * Orchestrates the claim submission wizard, AI-powered document extraction,
 * real-time form validation, dynamic internationalization (i18n) and
 * runtime configuration from Supabase.
 *
 * Architecture:
 * - 3-step wizard: Document upload → Flight details → Legal signature
 * - Multi-file AI scanner with base64 encoding and consolidated extraction
 * - Real-time validation with visual states (.field-ok, .field-error, .field-ai)
 * - Dynamic i18n via data-t attributes with built-in ES/EN dictionary
 * - Runtime color theming and feature flags from site_config table
 * - Sanitization layer that strips "null"/"undefined" strings from AI responses
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

  /* ============ DYNAMIC CONFIG FROM SUPABASE ============ */
  var siteConfig = null;

  /* Built-in fallback translations for all data-t keys */
  var DICT = {
    es: {
      /* Nav */
      nav_cases:'Casos', nav_how:'Cómo funciona', nav_why:'Por qué elegirnos', nav_about:'Quiénes somos', nav_faq:'FAQ',
      nav_cta:'Iniciá tu reclamo',
      /* Trust cards */
      trust1_t:'Respaldo jurídico real', trust1_d:'Abogados aeronáuticos certificados',
      trust2_t:'Visión IA que lee tu pasaje', trust2_d:'Subí una foto y completamos todo automáticamente',
      trust3_t:'100% gratuito hasta ganar', trust3_d:'Sin costos iniciales ni ocultos',
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
      step2_t:'SolucionAir reclama por vos', step2_d:'Analizamos tu caso, identificamos tus derechos y presentamos el reclamo formal. 100% gratis.',
      step3_t:'Se resuelve tu caso', step3_d:'La aerolínea responde con un acuerdo o derivamos a mediación online profesional.',
      step4_t:'Cobrás tu compensación', step4_d:'Recibís el dinero y recién ahí pagamos nuestros honorarios sobre lo percibido.',
      /* Contingency */
      ctg_title:'¿Sin respuesta de la aerolínea?', ctg_desc:'Derivamos tu caso a nuestra Red de Profesionales: una mediación privada y 100% online, sin necesidad de tribunales.',
      ctg1_t:'Abogado especializado', ctg1_d:'Un profesional en derecho aeronáutico toma tu caso de forma personalizada.',
      ctg2_t:'Estrategia legal', ctg2_d:'Armamos la mejor estrategia basada en normativa vigente y jurisprudencia.',
      ctg3_t:'Mediación por videollamada', ctg3_d:'Resolución 100% online, sin necesidad de trasladarte a ningún tribunal.',
      ctg4_t:'Solo si ganás', ctg4_d:'Comisión del 20% más reintegro de gastos de hasta USD 20. Solo si se gana.',
      ctg_note:'Sin riesgo para vos. Si no hay compensación, no pagás nada.',
      /* Cases */
      cases_ey:'Cobertura', cases_title:'Casos que podés reclamar',
      case1_t:'Vuelo demorado', case1_d:'Demoras mayores a 3 horas dan derecho a compensación económica según la normativa vigente.',
      case2_t:'Vuelo cancelado', case2_d:'Si tu vuelo fue cancelado sin aviso previo de al menos 14 días, podés reclamar.',
      case3_t:'Sobreventa', case3_d:'Si no te dejaron embarcar por overbooking, la aerolínea debe compensarte.',
      case4_t:'Equipaje perdido', case4_d:'Equipaje extraviado o no entregado da derecho a indemnización por los convenios internacionales.',
      case5_t:'Equipaje dañado', case5_d:'Si tu equipaje llegó roto o dañado, la aerolínea es responsable de reparar o compensar.',
      case6_t:'Equipaje entregado tarde', case6_d:'Retrasos en la entrega del equipaje generan derecho a reembolso de gastos de primera necesidad.',
      /* Advantages */
      adv_ey:'Beneficios', adv_title:'Por qué elegirnos',
      adv1_t:'Sin costos iniciales', adv1_d:'No pagás nada por adelantado. Nosotros cubrimos todos los gastos del proceso.',
      adv2_t:'Solo cobramos si ganás', adv2_d:'Nuestros honorarios se aplican únicamente si conseguimos tu compensación.',
      adv3_t:'No te peleás con la aerolínea', adv3_d:'Nosotros nos encargamos de toda la gestión. Vos solo cargás tu caso y esperás.',
      adv4_t:'Te mantenemos informado', adv4_d:'Recibís actualizaciones por email en cada etapa del proceso.',
      adv5_t:'Revisamos viabilidad', adv5_d:'Antes de avanzar, evaluamos si tu caso tiene chances reales con nuestra IA.',
      adv6_t:'Equipo especializado', adv6_d:'Abogados con experiencia en derecho aeronáutico y mediaciones internacionales.',
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
      about_p1:'Somos un equipo especializado en derecho aeronáutico y tecnología, con la misión de simplificar el acceso a la justicia para pasajeros afectados por problemas con aerolíneas.',
      about_p2:'Combinamos inteligencia artificial con experiencia legal real para gestionar reclamos de forma rápida, transparente y sin costos iniciales para el usuario.',
      about_p3:'¿Tenés alguna consulta? Escribinos a contacto@solucionair.com',
      /* FAQ */
      faq_ey:'Ayuda', faq_title:'Preguntas frecuentes',
      faq1_q:'¿Cuánto cuesta usar SolucionAir?', faq1_a:'Nada por adelantado. El servicio inicial es 100% gratuito. Solo cobramos una comisión sobre la compensación obtenida si el reclamo es exitoso.',
      faq2_q:'¿Cuándo cobran sus honorarios?', faq2_a:'Únicamente cuando vos cobrás tu compensación. Si no se consigue nada, no nos debés nada.',
      faq3_q:'¿Qué pasa si mi reclamo no prospera?', faq3_a:'No pagás absolutamente nada. Nosotros asumimos el riesgo y los costos del proceso completo.',
      faq4_q:'¿Cuánto tarda el proceso?', faq4_a:'Depende de la aerolínea y el tipo de reclamo. Los casos simples pueden resolverse en semanas, mientras que los que van a mediación pueden tomar algunos meses.',
      faq5_q:'¿Qué documentación necesito?', faq5_a:'Lo mínimo es tu pasaje, boarding pass o reserva. Si tenés fotos, emails de la aerolínea o recibos de gastos adicionales, también nos sirven. Nuestra IA puede extraer los datos de una captura de pantalla.',
      faq6_q:'¿Mis datos están protegidos?', faq6_a:'Sí. Toda la información que compartís está protegida con encriptación y solo se usa para gestionar tu reclamo. No vendemos ni compartimos tus datos con terceros.',
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
      /* Trust cards */
      trust1_t:'Real Legal Support', trust1_d:'Certified aviation attorneys',
      trust2_t:'AI Vision Ticket Reader', trust2_d:'Upload a photo and we will autofill everything',
      trust3_t:'100% Free Until We Win', trust3_d:'No upfront or hidden fees',
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
      step2_t:'SolucionAir claims for you', step2_d:'We analyze your case, identify your rights and file the formal claim. 100% free.',
      step3_t:'Your case is resolved', step3_d:'The airline responds with an agreement or we refer to professional online mediation.',
      step4_t:'You receive your compensation', step4_d:'You get the money and only then we charge our fee on the amount received.',
      /* Contingency */
      ctg_title:'No response from the airline?', ctg_desc:'We refer your case to our Professional Network: private and 100% online mediation, no courts needed.',
      ctg1_t:'Specialized attorney', ctg1_d:'An aviation law professional takes your case personally.',
      ctg2_t:'Legal strategy', ctg2_d:'We build the best strategy based on current regulations and case law.',
      ctg3_t:'Video call mediation', ctg3_d:'100% online resolution, no need to travel to any court.',
      ctg4_t:'Only if you win', ctg4_d:'20% commission plus expense reimbursement up to USD 20. Only if the case is won.',
      ctg_note:'No risk for you. If there is no compensation, you pay nothing.',
      /* Cases */
      cases_ey:'Coverage', cases_title:'Cases you can claim',
      case1_t:'Delayed flight', case1_d:'Delays over 3 hours entitle you to financial compensation under current regulations.',
      case2_t:'Cancelled flight', case2_d:'If your flight was cancelled without at least 14 days notice, you can claim.',
      case3_t:'Overbooking', case3_d:'If you were denied boarding due to overbooking, the airline must compensate you.',
      case4_t:'Lost baggage', case4_d:'Lost or undelivered baggage entitles you to compensation under international conventions.',
      case5_t:'Damaged baggage', case5_d:'If your baggage arrived broken or damaged, the airline is responsible for repair or compensation.',
      case6_t:'Late baggage', case6_d:'Delays in baggage delivery entitle you to reimbursement of essential expenses.',
      /* Advantages */
      adv_ey:'Benefits', adv_title:'Why choose us',
      adv1_t:'No upfront costs', adv1_d:'You pay nothing in advance. We cover all process expenses.',
      adv2_t:'We only charge if you win', adv2_d:'Our fees apply only if we secure your compensation.',
      adv3_t:'No fighting with the airline', adv3_d:'We handle the entire process. You just upload your case and wait.',
      adv4_t:'We keep you informed', adv4_d:'You receive email updates at every stage of the process.',
      adv5_t:'We assess viability', adv5_d:'Before proceeding, we evaluate if your case has real chances with our AI.',
      adv6_t:'Specialized team', adv6_d:'Attorneys with experience in aviation law and international mediations.',
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
      about_p1:'We are a team specialized in aviation law and technology, with the mission of simplifying access to justice for passengers affected by airline issues.',
      about_p2:'We combine artificial intelligence with real legal expertise to manage claims quickly, transparently and at no upfront cost to the user.',
      about_p3:'Have a question? Write to us at contacto@solucionair.com',
      /* FAQ */
      faq_ey:'Help', faq_title:'Frequently asked questions',
      faq1_q:'How much does SolucionAir cost?', faq1_a:'Nothing upfront. The initial service is 100% free. We only charge a commission on the compensation obtained if the claim is successful.',
      faq2_q:'When do you charge your fees?', faq2_a:'Only when you receive your compensation. If nothing is obtained, you owe us nothing.',
      faq3_q:'What happens if my claim doesn\'t succeed?', faq3_a:'You pay absolutely nothing. We assume the risk and costs of the entire process.',
      faq4_q:'How long does the process take?', faq4_a:'It depends on the airline and type of claim. Simple cases can be resolved in weeks, while those going to mediation may take a few months.',
      faq5_q:'What documentation do I need?', faq5_a:'At minimum, your ticket, boarding pass or booking. If you have photos, airline emails or receipts for additional expenses, those help too. Our AI can extract data from a screenshot.',
      faq6_q:'Is my data protected?', faq6_a:'Yes. All information you share is encrypted and used solely to manage your claim. We do not sell or share your data with third parties.',
      faq7_q:'What cases can be claimed?', faq7_a:'Delayed flights (over 3 hours), cancellations, overbooking, denied boarding, class downgrades, lost, damaged or delayed baggage.',
      /* Login */
      login_title:'Access your panel', login_desc:'Use the email and password you registered your claim with.',
      /* Footer */
      ft_tagline:'Your compensation always takes off.', ft_desc:'AI-powered LegalTech platform for flight claims.',
      ft_contact:'Contact', ft_legal:'Legal', ft_terms:'Terms and Conditions', ft_privacy:'Privacy Policy',
    }
  };

  function applyTexts(lang) {
    /* Apply hero/CTA from Supabase config if available */
    var cfgT = (siteConfig && siteConfig.translations && siteConfig.translations[lang]) || {};
    var cfgFb = (siteConfig && siteConfig.translations && siteConfig.translations.es) || {};

    var heroTitle = cfgT.hero_title || cfgFb.hero_title;
    var heroSub = cfgT.hero_sub || cfgFb.hero_sub;
    var ctaText = cfgT.cta_text || cfgFb.cta_text;
    var formTitle = cfgT.form_title || cfgFb.form_title;

    if (heroTitle) document.querySelectorAll('.hero__h1').forEach(function (el) { el.innerHTML = heroTitle.replace(/\n/g, '<br/>'); });
    if (heroSub) document.querySelectorAll('.hero__sub').forEach(function (el) { el.textContent = heroSub; });
    if (ctaText) document.querySelectorAll('.hero__cta').forEach(function (el) { var svg = el.querySelector('svg'); el.textContent = ctaText + ' '; if (svg) el.appendChild(svg); });
    if (formTitle) document.querySelectorAll('.claim__title').forEach(function (el) { el.textContent = formTitle; });

    /* Apply all data-t elements from built-in dictionary.
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

  function applyColors() {
    if (!siteConfig || !siteConfig.colors) return;
    var c = siteConfig.colors;
    var r = document.documentElement.style;
    if (c.primary) {
      r.setProperty('--au', c.primary);
      r.setProperty('--aul', c.primary);
      r.setProperty('--aud', c.primary);
    }
    if (c.secondary) {
      r.setProperty('--g', c.secondary);
      r.setProperty('--gl', c.secondary);
      r.setProperty('--gd', c.secondary);
    }
    if (c.bg) {
      r.setProperty('--bg', c.bg);
      r.setProperty('--bgd', c.bg);
    }
    if (c.text) {
      r.setProperty('--t1', c.text);
    }
  }

  function applyFlags() {
    if (!siteConfig || !siteConfig.feature_flags) return;
    var ff = siteConfig.feature_flags;
    var aiScan = document.getElementById('ai-scan');
    if (aiScan && ff.ai_extraction === false) {
      aiScan.style.display = 'none';
      var hr = aiScan.nextElementSibling;
      if (hr && hr.tagName === 'HR') hr.style.display = 'none';
    }
  }

  function loadSiteConfig() {
    fetch('/api/get-config').then(function (r) { return r.json(); }).then(function (json) {
      if (!json.success || !json.config) return;
      siteConfig = json.config;
      window.__SA_CONFIG = siteConfig;
      applyColors();
      applyFlags();
      applyTexts(S.lang);
    }).catch(function () { /* Fallback: hardcoded defaults in HTML remain */ });
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
  loadSiteConfig();
});
