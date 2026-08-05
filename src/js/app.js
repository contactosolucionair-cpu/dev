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

    var nombre = payload.name || '';
    var email  = payload.email || '';

    window.firmaGoogle = {
      sub: payload.sub,
      email_verified: payload.email_verified === true,
      iss: payload.iss,
      /* El wizard prellena con esto. `nombre` se guarda aparte del declarado: el
         reclamo pide el nombre del documento y el de una cuenta de Google casi nunca
         lo es, así que si el pasajero lo corrige la diferencia queda registrada. */
      nombre: nombre,
      email: email
    };

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

    /* Intake v3: verificada la identidad se abre el wizard. `__abrirIntake` lo define
       app.js dentro de su closure; si por lo que sea no está, queda a la vista el bloque
       de contacto estático de `index.html` —que solo se oculta cuando el wizard abre
       bien— y el pasajero puede escribirnos igual. Degradar mostrando de más nunca deja
       a nadie sin poder reclamar: esa es la red que antes cumplía el formulario largo. */
    if (typeof window.__abrirIntake === 'function') window.__abrirIntake();
  } catch (e) { console.error('[SA] Google login error:', e); }
};

window.cerrarSesionGoogle = function () {
  window.firmaGoogle = null;
  if (typeof google !== 'undefined' && google.accounts) google.accounts.id.disableAutoSelect();

  var chipAvatar = document.getElementById('chip-avatar');
  if (chipAvatar) chipAvatar.innerHTML = '';

  var wall    = document.getElementById('google-login-wall');
  var wrapper = document.getElementById('form-content-wrapper');
  if (wall)    wall.style.display    = '';
  if (wrapper) wrapper.style.display = 'none';
};

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  /* `metaTramos` lo llenaba el armador del formulario largo con los metadatos del
     escaneo (fecha y vuelo por tramo). Con el formulario borrado nadie lo escribe, pero
     `tramosDePuntos` lo lee: sin inicializarlo acá, armar los segmentos del wizard tira
     un TypeError y el caso se va sin itinerario. */
  var S = { lang: 'es', lastRef: null, metaTramos: {}, scannedFiles: null, fuenteItinerario: 'declaracion_pasajero' };

  /* ---- DOM ---- */
  var nav = document.querySelector('.nav');
  var langBtns = $$('.lang__btn');
  /* ============ LANGUAGE ============ */
  function setLang(l) {
    S.lang = l;
    document.body.classList.toggle('lang-en', l === 'en');
    langBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-lang-btn') === l); });
  }
  langBtns.forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-lang-btn')); }); });

  /* ============ SCROLL ============ */
  /* Nav is transparent over the hero (lets its gradient show through) and
     turns solid the instant the hero scrolls out from behind it. */
  var heroEl = document.querySelector('.hero');
  function onScroll() {
    if (!nav) return;
    var navH = nav.offsetHeight || 0;
    var threshold = heroEl ? Math.max(heroEl.offsetHeight - navH, 0) : 10;
    nav.classList.toggle('scrolled', window.scrollY > threshold);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();


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
  function tramosDePuntos(pts) {
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var meta = S.metaTramos[pts[i].iata + '-' + pts[i + 1].iata] || {};
      out.push({
        o: pts[i].label || '?', d: pts[i + 1].label || '?',
        oIata: pts[i].iata, dIata: pts[i + 1].iata,
        vuelo: meta.vuelo || '', fecha: meta.fecha || '', carrier: meta.carrier || '', dir: '',
      });
    }
    return out;
  }

  /* ============================================================
     INTAKE v3 — el wizard de micro-pasos
     ------------------------------------------------------------
     Reemplaza al formulario largo de tres pantallas. El componente vive en
     `src/js/intake-wizard.js` y lo comparten B2C, agencias y backoffice; acá
     solo se lo configura y se traduce su payload al contrato de
     `/api/process-ticket`.

     El muro de Google se mantiene tal cual: el wizard se abre DESPUÉS del
     login, con la identidad ya resuelta. El mail viaja bloqueado (es el ancla
     de la verificación y el canal que Google confirmó) y el nombre editable,
     porque el reclamo necesita el nombre del documento y el de una cuenta de
     Google casi nunca lo es — y ese nombre es el que termina en el poder.
     ============================================================ */

  var WZ = null;
  var WZ_FILES = {};   /* nombre de archivo → File real, para subirlo después */

  function wzGuardarArchivo(nombre, file) { WZ_FILES[nombre] = file; }
  function wzOlvidarArchivo(nombre) { delete WZ_FILES[nombre]; }

  /* Abre el selector nativo y devuelve el nombre al componente, que solo maneja
     nombres: el File real queda acá hasta el submit. Si `files` viene (drag & drop
     desde el wizard) no se abre nada y se usan esos. */
  function wzElegirArchivo(clave, listo, files) {
    if (files && files.length) {
      files.forEach(function (f) { wzGuardarArchivo(f.name, f); listo(f.name); });
      return;
    }
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.jpg,.jpeg,.png,.webp';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (!f) { listo(null); return; }
      wzGuardarArchivo(f.name, f);
      listo(f.name);
    });
    inp.click();
  }

  /* Escaneo IA: mismo endpoint y mismo contrato que usaba el paso 1 del form viejo. */
  function wzEscanear(listo, arrastrados) {
    if (arrastrados && arrastrados.length) { wzEscanearFiles(arrastrados, listo); return; }
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.jpg,.jpeg,.png,.webp,.pdf';
    inp.multiple = true;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    /* Cerrar el selector sin elegir nada NO dispara `change`: sin este aviso el
       wizard se queda en "Leyendo tus documentos..." para siempre. */
    inp.addEventListener('cancel', function () {
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      listo(null, null, true);
    });
    inp.addEventListener('change', function () {
      var files = Array.prototype.slice.call(inp.files || []);
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (!files.length) { listo(null, null, true); return; }
      wzEscanearFiles(files, listo);
    });
    inp.click();
  }

  function wzEscanearFiles(files, listo) {
    Promise.all(files.map(readFileAsBase64)).then(function (results) {
      var utiles = results.filter(Boolean);
      utiles.forEach(function (r, i) { if (files[i]) wzGuardarArchivo(files[i].name, files[i]); });
      S.scannedFiles = utiles;
      return fetch('/api/process-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: utiles.map(function (r) { return { base64: r.base64, mimeType: r.mimeType, name: r.name }; }),
          multiFile: true,
          email: (window.firmaGoogle && window.firmaGoogle.email) || '',
        }),
      });
    }).then(function (r) { return r.json(); }).then(function (json) {
      /* Con el flag de extracción apagado no hay datos ni los va a haber: se sigue
         a mano, que es honesto, en vez de anunciar un escaneo exitoso vacío. */
      if (!json || json.flagDisabled || !json.success || !json.data) { listo(null, null); return; }
      var d = json.data;
      listo(null, {
        aerolinea: d.aerolinea, vuelo_nro: d.vuelo_nro,
        origen: d.origen, destino: d.destino,
        fecha_vuelo: d.fecha_vuelo, pnr: d.pnr,
        telefono: d.telefono, documento_numero: d.doc_numero,
        /* El itinerario tramo por tramo: sin esto el wizard no puede reconstruir la
           vuelta cuando el pasajero elige esa dirección, porque los campos sueltos de
           arriba describen una sola (`process-ticket.js:545`). */
        segmentos: d.segmentos, direccion_afectada_sugerida: d.direccion_afectada_sugerida,
      });
    }).catch(function (err) {
      console.error('[SA] wizard scan error:', err);
      listo(err, null);
    });
  }

  /* Los tramos del itinerario, con el mismo helper que usa el form viejo: los puntos
     ya vienen con IATA del combo de aeropuertos. Si la ruta está incompleta devuelve
     lista vacía y mandan los campos sueltos — una columna en null es FALTA_DATO, que
     es honesto, y no una ruta inventada. */
  function wzSegmentos(p) {
    var pts = (p.puntos_ruta || []).filter(function (n) { return n.label || n.iata; });
    if (pts.length < 2) return [];
    var tramos = tramosDePuntos(pts);
    if (!tramos.length) return [];
    if (!tramos.every(function (t) { return t.oIata && t.dIata; })) return [];
    return tramos.map(function (t, i) {
      return {
        orden: i + 1,
        origen_iata: t.oIata,
        destino_iata: t.dIata,
        /* El carrier operante nunca se le pregunta al pasajero: solo viaja si salió
           de un documento escaneado (Tabla A fila 5). */
        carrier_operante: t.carrier || '',
        fecha: t.fecha || (i === 0 ? (p.fecha_vuelo || '') : ''),
        afectado: i === 0,
      };
    });
  }

  function wzEnviar(p, listo) {
    var fg = window.firmaGoogle || {};
    var ahora = new Date().toISOString();

    /* Los gastos van al canónico `gastos_items`. `archivo_original` es de transporte:
       sirve para encontrar el File y renombrarlo, y no viaja a la base. */
    var gastos = (p.gastos_items || []).map(function (g) {
      return { concepto: g.concepto, monto: g.monto, moneda: g.moneda, archivo: g.archivo, fuente: g.fuente };
    });

    /* Todo lo adjuntado, con el comprobante de cada gasto ya renombrado
       `Gasto N - MONEDA MONTO.ext` para que la asociación sobreviva en el bucket. */
    var aSubir = [];
    (p.gastos_items || []).forEach(function (g) {
      var f = WZ_FILES[g.archivo_original];
      if (f) aSubir.push({ file: f, nombre: g.archivo });
    });
    (p.otros_archivos || []).forEach(function (n) {
      if (WZ_FILES[n]) aSubir.push({ file: WZ_FILES[n], nombre: n });
    });

    /* El nombre que trajo Google, si difiere del declarado, va como evidencia con su
       procedencia. Mismo patrón que `tipo_viaje` y `direccion_afectada`: dato
       declarativo sin columna propia, que queda auditable en vez de perderse. */
    var candidatos = [];
    if (fg.nombre && p.nombre && fg.nombre !== p.nombre) {
      candidatos.push({ campo: 'nombre', valor: fg.nombre, fuente: 'google', extraido_en: ahora });
    }
    if (p.tipo_viaje) candidatos.push({ campo: 'tipo_viaje', valor: p.tipo_viaje, fuente: 'declaracion_pasajero', extraido_en: ahora });
    if (p.direccion_afectada) candidatos.push({ campo: 'direccion_afectada', valor: p.direccion_afectada, fuente: 'declaracion_pasajero', extraido_en: ahora });

    Promise.all(aSubir.map(function (a) {
      return readFileAsBase64(a.file).then(function (r) {
        return r ? { base64: r.base64, mimeType: r.mimeType, name: a.nombre } : null;
      });
    })).then(function (subidos) {
      var body = {
        manualSubmit: true,
        tipo_reclamo: p.tipo_reclamo,
        nombre: p.nombre, telefono: p.telefono, email: p.email,
        documento_tipo: p.documento_tipo, documento_numero: p.documento_numero,
        aerolinea: p.aerolinea, vuelo_nro: p.vuelo_nro, fecha_vuelo: p.fecha_vuelo,
        origen: p.origen, destino: p.destino, pnr: p.pnr,
        tipo_viaje: p.tipo_viaje, direccion_afectada: p.direccion_afectada,
        segmentos: wzSegmentos(p),
        itinerario_fuente: S.fuenteItinerario || 'declaracion_pasajero',
        datos_extraidos_extra: candidatos,
        tipo_incidencia: p.tipo_incidencia,
        horas_retraso: p.horas_retraso,
        anticipacion_aviso: p.anticipacion_aviso,
        embarque_presentado: p.embarque_presentado,
        ofrecimiento_aerolinea: p.ofrecimiento_aerolinea,
        viajo_finalmente: p.viajo_finalmente,
        causa_informada: p.causa_informada,
        pasaje_alternativo_monto: p.pasaje_alternativo_monto,
        pasaje_alternativo_moneda: p.pasaje_alternativo_moneda,
        tipo_caso_equipaje: p.tipo_caso_equipaje,
        descripcion_equipaje: p.descripcion_equipaje,
        valor_equipaje: p.valor_equipaje,
        fecha_entrega_equipaje: p.fecha_entrega_equipaje,
        equipaje_no_entregado: p.equipaje_no_entregado,
        pir_presentado: p.pir_presentado,
        pir_numero: p.pir_numero,
        gastos_items: gastos,
        comentarios_pasajero: p.comentarios_pasajero,
        acompanantes: p.acompanantes || [],
        consent_tyc: p.consent_tyc,
        consent_autorizacion: p.consent_autorizacion,
        consent_version: window.CONSENT_VERSION || null,
        firma_fecha: ahora.slice(0, 10),
        firma_ts: p.firma_ts || ahora,
        user_agent: p.user_agent || navigator.userAgent,
        google_sub: fg.sub || null,
        google_email_verified: fg.email_verified || null,
        google_iss: fg.iss || null,
        scanned_files: subidos.filter(Boolean),
      };
      return fetch('/api/process-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (!json || !json.success) {
        listo(new Error((json && json.error) || 'No se pudo enviar el reclamo.'), null);
        return;
      }
      S.lastRef = json.refCode || null;
      listo(null, { ref_code: json.refCode || 'CSA000' });
    }).catch(function (err) {
      console.error('[SA] wizard submit error:', err);
      listo(new Error('Error de conexión. Probá de nuevo.'), null);
    });
  }

  function wzInstancia() {
    if (WZ) return WZ;
    if (!window.IntakeWizard) { console.error('[SA] IntakeWizard no cargó'); return null; }
    WZ = window.IntakeWizard.crear({
      superficie: 'b2c',
      escaner: true,
      datosPersonales: true,
      acompanantes: true,
      firma: true,
      soloLectura: ['email'],
      notas: { email: 'Viene de tu cuenta de Google. Si querés usar otra, cambiá de cuenta arriba.' },
      /* Acá la instancia es única y vive mientras dure la página, así que cerrar no
         pierde nada: el texto lo dice en vez de asustar de más. */
      textos: { cerrarD: 'Podés volver a abrirlo y seguir donde estabas. Tu reclamo todavía no fue enviado.' },
      alEscanear: wzEscanear,
      alElegirArchivo: wzElegirArchivo,
      alQuitarArchivo: function (clave, nombre) { wzOlvidarArchivo(nombre); },
      alMontarCampoAeropuerto: function (n) {
        if (window.AirportSelect && window.AirportSelect.attach) window.AirportSelect.attach(n);
      },
      alEnviar: wzEnviar,
    });
    return WZ;
  }

  /* Deja a la vista solo la tarjeta de entrada: el formulario largo sigue en el DOM
     pero inalcanzable, y se borra en su propia fase para que el diff sea legible y
     revertir siga siendo barato. */
  function wzOcultarFormViejo() {
    /* El bloque de contacto se oculta ANTES del early return de abajo, y el orden no es
       casual: cuando el formulario largo desaparezca, ese `return` va a dispararse
       siempre y el contacto tiene que seguir ocultándose igual. */
    var contacto = document.getElementById('contacto-fallback');
    if (contacto) contacto.style.display = 'none';

    /* Ya no hay formulario largo que ocultar: lo único que queda del wrapper es la
       tarjeta para volver al wizard, y esa se muestra. */
    var launcher = document.getElementById('wz-launcher');
    if (launcher) launcher.style.display = '';
  }

  /* Lo llama `recibirLoginGoogle`, que vive fuera de este closure. */
  window.__abrirIntake = function () {
    var wz = wzInstancia();
    if (!wz) return;
    wzOcultarFormViejo();
    var fg = window.firmaGoogle || {};
    wz.abrir({ nombre: fg.nombre || '', email: fg.email || '' });
  };

  var btnReabrir = document.getElementById('wz-reabrir');
  if (btnReabrir) {
    btnReabrir.addEventListener('click', function () {
      var wz = wzInstancia();
      if (wz) wz.reabrir();
    });
  }

  /* Built-in translations for all data-t keys */
  var DICT = {
    es: {
      /* Nav */
      nav_cases:'Casos', nav_how:'Cómo funciona', nav_why:'Por qué elegirnos', nav_about:'Quiénes somos', nav_faq:'FAQ',
      nav_cta:'Iniciá tu reclamo',
      hero_title:'Plataforma de reclamos aéreos', hero_cta:'Iniciá tu reclamo',
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
      /* Intake v2 · scan-first y dirección afectada */
      scan_t:'Cargá tu reserva o pasaje', scan_d:'La IA lee tus documentos y arma el itinerario completo. Vos solo confirmás en qué tramo tuviste el problema.',
      scan_manual:'Prefiero cargar los datos manualmente',
      ruta_t:'¿En qué tramo tuviste el problema?', ruta_d:'Esto es lo que leímos de tus documentos. Tocá el tramo donde ocurrió el incidente.',
      ruta_ok:'Confirmar tramo', ruta_descartar:'La ruta no es correcta, la cargo a mano',
      ruta_ida:'Ida', ruta_vuelta:'Vuelta', ruta_sin_iata:'Vas a tener que confirmar este aeropuerto',
      lbl_tipoviaje:'¿Tu viaje era solo ida o ida y vuelta?', opt_solo_ida:'Solo ida', opt_ida_vuelta:'Ida y vuelta',
      lbl_direccion:'¿En qué parte del viaje tuviste el problema?', opt_dir_ida:'La ida', opt_dir_vuelta:'La vuelta',
      hint_direccion:'Cargá solo la dirección donde tuviste el problema. Si fue al volver, el origen es tu destino de ida.',
      lbl_escalas:'¿Tuviste escalas en el viaje del problema?', opt_sin_escalas:'No, fue directo', opt_con_escalas:'Sí, tuve escalas',
      lbl_escalas_ida:'¿Tuviste escalas en la ida?', lbl_escalas_vuelta:'¿Tuviste escalas en la vuelta?',
      lbl_origin_ida:'Origen de la ida', lbl_origin_vuelta:'Origen de la vuelta',
      lbl_dest_ida:'Destino de la ida', lbl_dest_vuelta:'Destino de la vuelta',
      arm_t:'Escalas del viaje, en orden', arm_add:'+ Agregar escala', arm_escala:'Escala',
      arm_hint:'Solo las escalas intermedias: el origen y el destino son los de arriba.',
      arm_cual:'¿En qué tramo tuviste el problema?',
      f_flight_t:'Identificación del vuelo', f_flight_sub:'Si subiste tu pasaje con IA, estos campos ya están completos. Revisalos o corregí lo que haga falta.',
      lbl_airline:'Aerolínea', lbl_flight:'Número de vuelo', lbl_origin:'Origen', lbl_dest:'Destino', lbl_date:'Fecha del vuelo', lbl_pnr:'PNR (Código de Reserva)',
      f_incident_t:'Incidente', lbl_incident:'Tipo de incidencia', lbl_delay:'Magnitud del retraso (horas)', lbl_notice:'Anticipación de notificación', lbl_refund:'¿Ofrecieron reembolso?',
      f_cause_t:'Causa informada por la aerolínea',
      f_expenses_t:'Gastos incurridos', f_expenses_sub:'Si tuviste gastos extras por el incidente, detallalos acá.',
      btn_back:'← Volver', btn_next3:'Continuar al Paso 3 →',
      /* Form Step 3 */
      f_sign_t:'Declaración jurada y firma electrónica', f_sign_sub:'Leé atentamente antes de firmar y enviar.',
      btn_back2:'← Volver al Paso 2', btn_submit:'Enviar reclamo', btn_note:'Análisis gratuito e instantáneo · Sin compromiso',
      /* How it works */
      how_title:'Cómo funciona',
      step1_t:'Cargás tu caso', step1_d:'Subís los datos y documentación desde tu PC o celular. Nuestra IA lee tu pasaje automáticamente.',
      step2_t:'Hacemos el reclamo por vos', step2_d:'Te mantenemos informado y cubrimos todos los costos del proceso.',
      step3_t:'Obtenés tu compensación', step3_d:'La aerolínea responde con un acuerdo o derivamos a mediación online profesional.',
      step4_t:'Pagás 25% por el servicio', step4_d:'Si no ganás, no pagás.',
      /* Contingency */
      ctg_title:'¿Sin respuesta de la aerolínea?',
      ctg1_t:'Abogado especializado', ctg1_d:'Un abogado de nuestra Red de Profesionales, especializado en derechos del pasajero.',
      ctg2_t:'Estrategia legal', ctg2_d:'Armamos la mejor estrategia basada en normativa vigente y jurisprudencia.',
      ctg3_t:'Mediación por videollamada', ctg3_d:'Resolución 100% online, sin necesidad de trasladarte a ningún tribunal.',
      ctg4_t:'Pagás 25% por el servicio', ctg4_d:'Si no ganás, no pagás.',
      /* Cases */
      cases_title:'Casos que podés reclamar',
      case1_t:'Vuelo demorado', case1_d:'Si llegaste tarde a destino por culpa de la aerolínea.',
      case2_t:'Vuelo cancelado', case2_d:'Si la aerolínea canceló tu vuelo sin causa de fuerza mayor.',
      case3_t:'Sobreventa', case3_d:'Si te denegaron el embarque por venta de más asientos de los disponibles.',
      case4_t:'Equipaje perdido', case4_d:'Si tu equipaje no llegó y pasaron más de 21 días sin ser localizado.',
      case5_t:'Equipaje dañado', case5_d:'Si tu maleta llegó rota, rajada o con daños visibles causados durante el vuelo.',
      case6_t:'Equipaje entregado tarde', case6_d:'Si tu equipaje llegó días después que vos y tuviste gastos por eso.',
      /* Advantages */
      adv_title:'Por qué elegirnos',
      adv1_t:'Sin costos iniciales', adv1_d:'No pagás nada por adelantado. Nosotros cubrimos todos los gastos del proceso.',
      adv2_t:'Solo cobramos si ganás', adv2_d:'Nuestros honorarios se aplican únicamente si conseguimos tu compensación.',
      adv3_t:'No tenés que pelearte con la aerolínea', adv3_d:'Nos encargamos de todo el proceso. Vos solo nos contás qué pasó y nosotros nos ocupamos del resto.',
      adv4_t:'Te mantenemos informado', adv4_d:'Recibís actualizaciones en cada etapa del proceso.',
      adv5_t:'Revisamos tu caso antes de avanzar', adv5_d:'Analizamos la viabilidad antes de iniciar. Si el reclamo no tiene posibilidades reales, te lo decimos sin vueltas.',
      adv6_t:'Equipo especializado', adv6_d:'Conocemos las normativas de cada aerolínea y jurisdicción. Tu reclamo está en manos de quienes saben cómo avanzar.',
      /* Testimonials */
      test_title:'Lo que dicen nuestros clientes',
      test1_q:'"Pensé que era difícil reclamar, pero SolucionAir se encargó de todo. En pocas semanas tenía mi compensación acreditada."',
      test1_m:'Buenos Aires · Vuelo demorado · USD 600 recuperados',
      test2_q:'"Me fueron avisando en cada paso, sin que yo tuviera que preguntar nada. Tardó un par de meses pero cobré."',
      test2_m:'Córdoba · Vuelo cancelado · USD 320 recuperados',
      test3_q:'"Fue subir los datos del equipaje y esperar. Me mantuvieron al tanto y terminé cobrando la compensación."',
      test3_m:'Mendoza · Equipaje dañado · USD 450 recuperados',
      /* About */
      about_title:'Quién está detrás de SolucionAir',
      about_p1:'SolucionAir nace para simplificar un proceso que suele ser confuso, lento y frustrante para los pasajeros. Combinamos gestión, análisis de casos y seguimiento personalizado para ayudarte a reclamar lo que te corresponde sin que tengas que ocuparte de todo el trámite.',
      about_p2:'Somos un equipo especializado en gestión de reclamos ante aerolíneas. Cada caso recibe atención directa, con seguimiento real y comunicación clara en cada etapa.',
      about_p3:'¿Tenés alguna consulta? Escribinos a contacto@solucionair.com',
      /* FAQ */
      faq_title:'Preguntas frecuentes',
      faq1_q:'¿Cuánto cuesta usar SolucionAir?', faq1_a:'Nada por adelantado. El servicio inicial es 100% gratuito. Solo cobramos una comisión del 25% sobre la compensación obtenida si el reclamo es exitoso.',
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
      ft_portals:'Portales', ft_agencies:'Portal Agencias', ft_lawyers:'Portal Abogados',
    },
    en: {
      /* Nav */
      nav_cases:'Cases', nav_how:'How it works', nav_why:'Why choose us', nav_about:'About us', nav_faq:'FAQ',
      nav_cta:'Start your claim',
      hero_title:'Flight claims platform', hero_cta:'Start your claim',
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
      /* Intake v2 · scan-first and affected direction */
      scan_t:'Upload your booking or ticket', scan_d:'AI reads your documents and builds the full itinerary. You just confirm which leg had the problem.',
      scan_manual:'I would rather enter the details manually',
      ruta_t:'Which leg had the problem?', ruta_d:'This is what we read from your documents. Tap the leg where the incident happened.',
      ruta_ok:'Confirm leg', ruta_descartar:'The route is wrong, I will enter it manually',
      ruta_ida:'Outbound', ruta_vuelta:'Return', ruta_sin_iata:'You will need to confirm this airport',
      lbl_tipoviaje:'Was your trip one-way or round-trip?', opt_solo_ida:'One-way', opt_ida_vuelta:'Round-trip',
      lbl_direccion:'Which part of the trip had the problem?', opt_dir_ida:'The outbound', opt_dir_vuelta:'The return',
      hint_direccion:'Enter only the direction where you had the problem. If it happened on the way back, the origin is your outbound destination.',
      lbl_escalas:'Did the trip with the problem have connections?', opt_sin_escalas:'No, it was direct', opt_con_escalas:'Yes, it had connections',
      lbl_escalas_ida:'Did the outbound have connections?', lbl_escalas_vuelta:'Did the return have connections?',
      lbl_origin_ida:'Outbound origin', lbl_origin_vuelta:'Return origin',
      lbl_dest_ida:'Outbound destination', lbl_dest_vuelta:'Return destination',
      arm_t:'Connections, in order', arm_add:'+ Add connection', arm_escala:'Connection',
      arm_hint:'Only the intermediate stops: origin and destination are the fields above.',
      arm_cual:'Which leg had the problem?',
      f_flight_t:'Flight identification', f_flight_sub:'If you uploaded your ticket with AI, these fields are already filled. Review or edit as needed.',
      lbl_airline:'Airline', lbl_flight:'Flight Number', lbl_origin:'Origin', lbl_dest:'Destination', lbl_date:'Flight Date', lbl_pnr:'PNR (Booking Code)',
      f_incident_t:'Incident', lbl_incident:'Incident Type', lbl_delay:'Delay duration (hours)', lbl_notice:'Notification advance', lbl_refund:'Was a refund offered?',
      f_cause_t:'Cause reported by the airline',
      f_expenses_t:'Incurred expenses', f_expenses_sub:'If you had extra expenses due to the incident, detail them here.',
      btn_back:'← Back', btn_next3:'Continue to Step 3 →',
      /* Form Step 3 */
      f_sign_t:'Sworn statement and electronic signature', f_sign_sub:'Read carefully before signing and submitting.',
      btn_back2:'← Back to Step 2', btn_submit:'Submit claim', btn_note:'Free and instant analysis · No commitment',
      /* How it works */
      how_title:'How it works',
      step1_t:'Upload your case', step1_d:'Upload your data and documents from your PC or phone. Our AI reads your ticket automatically.',
      step2_t:'We claim for you', step2_d:'We keep you informed and cover all process costs.',
      step3_t:'You get your compensation', step3_d:'The airline responds with an agreement or we refer to professional online mediation.',
      step4_t:'You pay 25% for the service', step4_d:'If you don\'t win, you don\'t pay.',
      /* Contingency */
      ctg_title:'No response from the airline?',
      ctg1_t:'Specialized attorney', ctg1_d:'A lawyer from our Professional Network, specialised in passenger rights.',
      ctg2_t:'Legal strategy', ctg2_d:'We build the best strategy based on current regulations and case law.',
      ctg3_t:'Video call mediation', ctg3_d:'100% online resolution, no need to travel to any court.',
      ctg4_t:'You pay 25% for the service', ctg4_d:'If you don\'t win, you don\'t pay.',
      /* Cases */
      cases_title:'Cases you can claim',
      case1_t:'Delayed flight', case1_d:'If you arrived late at your destination due to the airline\'s fault.',
      case2_t:'Cancelled flight', case2_d:'If the airline cancelled your flight without extraordinary circumstances.',
      case3_t:'Overbooking', case3_d:'If you were denied boarding because the airline oversold the flight.',
      case4_t:'Lost baggage', case4_d:'If your luggage didn\'t arrive and more than 21 days passed without being found.',
      case5_t:'Damaged baggage', case5_d:'If your bag arrived broken, torn or visibly damaged during the flight.',
      case6_t:'Late baggage', case6_d:'If your baggage arrived days after you and you incurred expenses as a result.',
      /* Advantages */
      adv_title:'Why choose us',
      adv1_t:'No upfront costs', adv1_d:'You pay nothing in advance. We cover all process expenses.',
      adv2_t:'We only charge if you win', adv2_d:'Our fees apply only if we secure your compensation.',
      adv3_t:'No fighting with the airline', adv3_d:'We handle the entire process. You just tell us what happened and we take care of the rest.',
      adv4_t:'We keep you informed', adv4_d:'You receive updates at every stage of the process.',
      adv5_t:'We review your case before proceeding', adv5_d:'We assess viability before starting. If the claim has no real chance, we tell you straight.',
      adv6_t:'Specialized team', adv6_d:'We know the regulations of each airline and jurisdiction. Your claim is in the hands of those who know how to move it forward.',
      /* Testimonials */
      test_title:'What our clients say',
      test1_q:'"I thought it was difficult to claim, but SolucionAir handled everything. In a few weeks I had my compensation credited."',
      test1_m:'Buenos Aires · Delayed flight · USD 600 recovered',
      test2_q:'"They kept me posted at every step, I never had to ask. It took a couple of months but I got paid."',
      test2_m:'Córdoba · Cancelled flight · USD 320 recovered',
      test3_q:'"I just uploaded the baggage details and waited. They kept me informed and I ended up getting the compensation."',
      test3_m:'Mendoza · Damaged baggage · USD 450 recovered',
      /* About */
      about_title:'Who is behind SolucionAir',
      about_p1:'SolucionAir was created to simplify a process that is often confusing, slow and frustrating for passengers. We combine case management, case analysis and personalised follow-up to help you claim what you\'re owed without having to handle the entire procedure yourself.',
      about_p2:'We are a team specialised in airline claims management. Each case receives direct attention, with real follow-up and clear communication at every stage.',
      about_p3:'Have a question? Write to us at contacto@solucionair.com',
      /* FAQ */
      faq_title:'Frequently asked questions',
      faq1_q:'How much does SolucionAir cost?', faq1_a:'Nothing upfront. The initial service is 100% free. We only charge a 25% commission on the compensation obtained if the claim is successful.',
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
      ft_portals:'Portals', ft_agencies:'Agency Portal', ft_lawyers:'Lawyer Portal',
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
    /* Antes acá se repintaban las fichas de ruta y las filas del armador del formulario
       largo, que se armaban por JS y applyTexts no veía. Se fueron con él; el wizard se
       arma cada vez que abre y no necesita repintado. */
  };

  /* ============ INIT ============ */
  setLang('es');
});
