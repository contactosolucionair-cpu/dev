/* ============================================================
   INTAKE WIZARD — componente compartido de alta de casos.
   SolucionAir · ES5 estricto (var / function / concatenación).

   Un popup con micro-pasos: una pregunta por pantalla, cada respuesta destapa
   la siguiente. Reemplaza al formulario largo de tres pantallas.

   POR QUÉ ES UN COMPONENTE Y NO UNA CUARTA COPIA
   La lógica de carga de caso está duplicada en B2C, backoffice y panel de
   agencias, con copias divergentes: ya pasó con el selector de dirección de
   tramo y con la detección de escalas. Sumar el formulario nuevo a las tres
   habría creado tres copias más. Acá vive una sola vez y las tres lo llaman.

   AISLAMIENTO
   El wizard construye su propio DOM dentro de un overlay y usa clases `iw-`
   (ver `src/css/intake-wizard.css`). No toca ni depende de los ids de la
   página que lo monta: `f-*` en B2C y agencias, `nc-*` en backoffice siguen
   siendo de ellas. Lo que devuelve es un payload con las claves del contrato
   de la API, no ids de formulario.

   USO
     var wz = IntakeWizard.crear({
       superficie: 'b2c',
       alEnviar: function (payload, listo) { ...; listo(null, {ref_code:'CSA1'}); }
     });
     wz.abrir();

   NO hace fetch por su cuenta: quién envía y a dónde lo decide la superficie.
   Eso mantiene la autenticación donde corresponde —cada portal tiene la suya—
   y deja el componente testeable sin red.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- helpers ---------- */

  /* Todo dato de usuario que se renderiza pasa por acá. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function aNumero(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function trim(v) {
    return String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
  }

  var MONEDAS = [
    ['ARS', 'ARS (Peso argentino)'], ['USD', 'USD (Dólar)'],
    ['EUR', 'EUR (Euro)'], ['BRL', 'BRL (Real)'],
  ];

  function opcionesMoneda() {
    var h = '', i;
    for (i = 0; i < MONEDAS.length; i++) {
      h += '<option value="' + MONEDAS[i][0] + '">' + esc(MONEDAS[i][1]) + '</option>';
    }
    return h;
  }

  function campo(id, etiqueta, control, obligatorio) {
    return '<div class="iw-field" data-field="' + id + '">' +
      (etiqueta ? '<label class="iw-lbl" for="iw-' + id + '">' + etiqueta +
        (obligatorio ? ' <span class="iw-ast">*</span>' : '') + '</label>' : '') +
      control + '<span class="iw-msg"></span></div>';
  }

  function input(id, tipo, ph, req, extra) {
    return '<input class="iw-in" type="' + tipo + '" id="iw-' + id + '"' +
      (ph ? ' placeholder="' + esc(ph) + '"' : '') +
      (req ? ' data-req="1"' : '') + (extra || '') + ' />';
  }

  function select(id, opts, req) {
    return '<select class="iw-in" id="iw-' + id + '"' + (req ? ' data-req="1"' : '') + '>' + opts + '</select>';
  }

  function opt(valor, titulo, sub, icono) {
    return '<button class="iw-opt" type="button" data-val="' + esc(valor) + '">' +
      (icono ? '<span class="iw-opt-ic">' + icono + '</span>' : '') +
      '<span class="iw-opt-b"><span class="iw-opt-t">' + esc(titulo) + '</span>' +
      (sub ? '<span class="iw-opt-s">' + esc(sub) + '</span>' : '') + '</span></button>';
  }

  function opts(destino, lista) {
    var h = '<div class="iw-opts" data-pick="' + destino + '">', i;
    for (i = 0; i < lista.length; i++) {
      h += opt(lista[i][0], lista[i][1], lista[i][2], lista[i][3]);
    }
    return h + '</div>';
  }

  function drop(clave, titulo, meta, max) {
    return '<button class="iw-drop" type="button" data-drop="' + clave + '" data-max="' + (max || 5) + '">' +
      '<span class="iw-drop-t">' + titulo + '</span>' +
      '<span class="iw-drop-m">' + esc(meta) + '</span></button>' +
      '<div data-chips="' + clave + '"></div>';
  }

  function paso(id, pregunta, bajada, cuerpo, extra) {
    return '<section class="iw-ms" data-ms="' + id + '"' + (extra || '') + '>' +
      '<h2 class="iw-q">' + esc(pregunta) + '</h2>' +
      (bajada ? '<p class="iw-d">' + esc(bajada) + '</p>' : '') +
      cuerpo + '</section>';
  }

  /* ---------- textos legales por defecto ---------- */

  var HONORARIOS = '<strong>SolucionAir opera bajo un esquema de honorarios por éxito:</strong> ' +
    'no se cobran costos iniciales y los honorarios equivalen al <strong>25%</strong> de la compensación obtenida.';

  /* Texto contractual: se usa tal cual, nunca reescrito ni abreviado. */
  var DDJJ =
    '<p>Mediante la presente, el/la reclamante declara bajo juramento que toda la información ' +
    'proporcionada en este formulario es verídica, completa y exacta. Autorizo expresamente a ' +
    '<strong>SolucionAir</strong>, representada por <strong>Juan Pablo Mario Adaniya</strong> ' +
    '(DNI 37.806.475) y <strong>Tomás Gregorio Dicranian</strong> (DNI 37.606.877), a:</p>' +
    '<ul>' +
    '<li>Gestionar y presentar reclamos formales ante la aerolínea y/o autoridades competentes en mi nombre.</li>' +
    '<li>Acceder, utilizar y compartir la documentación provista exclusivamente con fines de gestión del presente reclamo.</li>' +
    '<li>Representarme en instancias de mediación privada online, si correspondiera.</li>' +
    '<li>Percibir y cobrar en mi nombre las sumas que resulten del reclamo, acreditándolas en la cuenta bancaria ' +
    'informada en el poder especial, y liquidarme el importe neto de la comisión dentro de los 10 días hábiles ' +
    'de acreditados los fondos.</li>' +
    '<li>Declaro estar autorizado/a a gestionar este reclamo en nombre de los acompañantes que haya incluido, ' +
    'y ser responsable legal o tutor/a de aquellos identificados como menores de edad.</li>' +
    '</ul>' +
    '<p>Entiendo que SolucionAir opera bajo un esquema de honorarios por éxito: <strong>no se cobran costos ' +
    'iniciales</strong> y los honorarios equivalen al 25% de la compensación obtenida, únicamente si el reclamo ' +
    'prospera.</p>' +
    '<p>Esta declaración constituye una firma electrónica válida en los términos de la Ley 25.506 de Firma ' +
    'Digital de la República Argentina.</p>';

  /* ---------- definición de los micro-pasos ----------
     `when` decide si el paso aplica. El % se calcula SOLO sobre los pasos
     aplicables en ese momento, así que responder una pregunta puede cambiar
     cuánto falta — que es honesto. */

  function definirPasos(o) {
    var esVuelo = function (w) { return w.leer('tipo_reclamo') === 'vuelo'; };
    var esEquipaje = function (w) { return w.leer('tipo_reclamo') === 'equipaje'; };
    var esComun = function (w) {
      var x = w.leer('tipo_incidencia');
      return x === 'cancelacion' || x === 'reprogramacion' || x === 'overbooking' || x === 'denegacion';
    };

    var P = [];

    P.push({ id: 'tipo' });
    if (o.escaner) P.push({ id: 'scan' });
    P.push({ id: 'airline' });
    P.push({ id: 'tipoviaje' });
    P.push({ id: 'direccion', when: function (w) { return w.leer('tipo_viaje') === 'ida_vuelta'; } });
    P.push({ id: 'escalas' });
    P.push({ id: 'armador', when: function (w) { return w.leer('escalas') === 'si'; } });
    P.push({ id: 'ruta' });
    P.push({ id: 'fecha' });

    /* rama vuelo — mismo árbol condicional que app.js:240-257 */
    P.push({ id: 'incident', when: esVuelo });
    P.push({ id: 'demora', when: function (w) { return esVuelo(w) && w.leer('tipo_incidencia') === 'demora'; } });
    P.push({ id: 'notice', when: function (w) {
      var x = w.leer('tipo_incidencia');
      return esVuelo(w) && (x === 'cancelacion' || x === 'reprogramacion');
    } });
    P.push({ id: 'embarque', when: function (w) {
      var x = w.leer('tipo_incidencia');
      return esVuelo(w) && (x === 'overbooking' || x === 'denegacion');
    } });
    P.push({ id: 'refund', when: function (w) { return esVuelo(w) && esComun(w); } });
    P.push({ id: 'viajo', when: function (w) { return esVuelo(w) && esComun(w); } });
    P.push({ id: 'viajohoras', when: function (w) {
      var v = w.leer('viajo_finalmente');
      return esVuelo(w) && esComun(w) && (v === 'reubicado' || v === 'medios_propios');
    } });
    P.push({ id: 'pasajealt', when: function (w) {
      return esVuelo(w) && esComun(w) && w.leer('viajo_finalmente') === 'medios_propios';
    } });
    P.push({ id: 'cause', when: esVuelo });

    /* rama equipaje */
    P.push({ id: 'bagtype', when: esEquipaje });
    P.push({ id: 'bagdelivery', when: function (w) { return esEquipaje(w) && w.leer('tipo_caso_equipaje') === 'demora'; } });
    P.push({ id: 'bagvalue', when: esEquipaje });
    P.push({ id: 'bagpir', when: esEquipaje });
    P.push({ id: 'bagpirnum', when: function (w) { return esEquipaje(w) && w.leer('pir_presentado') === 'si'; } });
    P.push({ id: 'bagdesc', when: esEquipaje });

    /* común */
    P.push({ id: 'gastosgate' });
    P.push({ id: 'gastos', when: function (w) { return w.leer('_gastos_gate') === 'si'; } });
    P.push({ id: 'combogate', when: esVuelo });
    P.push({ id: 'combo', when: function (w) { return esVuelo(w) && w.leer('_combo_gate') === 'si'; } });
    if (o.acompanantes) {
      P.push({ id: 'acompgate' });
      P.push({ id: 'acomp', when: function (w) { return w.leer('_acomp_gate') === 'si'; } });
    }
    P.push({ id: 'otrosdocs' });
    P.push({ id: 'comentario' });
    if (o.datosPersonales) {
      P.push({ id: 'pers1' });
      P.push({ id: 'pers2' });
      P.push({ id: 'pers3' });
    }
    /* `firma` va SIEMPRE, con o sin declaración jurada: es el paso desde el que se
       dispara el envío. Cuando estaba condicionado a `o.firma`, las superficies sin
       firma (agencia, backoffice) saltaban de los datos personales directo a la
       pantalla de éxito sin llamar nunca a `alEnviar`: mostraban "caso cargado" sin
       haber guardado nada. Lo que cambia con `o.firma` es el CONTENIDO del paso
       —declaración jurada y consentimiento— no su existencia. */
    P.push({ id: 'firma' });
    P.push({ id: 'done' });

    return P;
  }

  /* ---------- markup de los pasos ---------- */

  function cuerpoPasos(o) {
    var h = '';

    h += paso('tipo', o.textos.tipoQ, o.textos.tipoD,
      '<div class="iw-ctype" data-pick-ctype="1">' +
      '<button class="iw-ctype-b" type="button" data-ctype="vuelo"><span class="iw-ctype-ic">&#9992;&#65039;</span>' +
      '<span class="iw-opt-b"><span class="iw-ctype-t">Reclamo por vuelo</span>' +
      '<span class="iw-ctype-d">Retraso, cancelación, overbooking</span></span></button>' +
      '<button class="iw-ctype-b" type="button" data-ctype="equipaje"><span class="iw-ctype-ic">&#129523;</span>' +
      '<span class="iw-opt-b"><span class="iw-ctype-t">Reclamo por equipaje</span>' +
      '<span class="iw-ctype-d">Pérdida, daño o demora en entrega</span></span></button></div>');

    if (o.escaner) {
      h += paso('scan', 'Cargá tu reserva', 'Es el documento con el itinerario completo de tu viaje.',
        '<div data-scan-idle>' +
        '<button class="iw-scan" type="button" data-scan-go>' +
        '<span class="iw-scan-ic"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/>' +
        '<circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>' +
        '<span class="iw-scan-badge">IA</span></span>' +
        '<span class="iw-scan-t">Arrastrá tu reserva aquí para autocompletar la carga &#9889;</span>' +
        '<span class="iw-scan-m">JPG, PNG, PDF · Máx. 10MB c/u</span></button>' +
        '<div style="text-align:center"><button type="button" class="iw-lnk" data-scan-skip>' +
        'Prefiero cargar los datos manualmente</button></div></div>' +
        '<div class="iw-load" data-scan-load style="display:none"><div class="iw-sp"></div>' +
        '<p style="font-size:.82rem;color:var(--t2,#3A3A3A);font-weight:600;margin:0">Leyendo tus documentos...</p>' +
        '<p class="iw-hint" style="text-align:center">Extrayendo el itinerario completo</p></div>' +
        '<div class="iw-err" data-scan-err></div>');
    }

    h += paso('airline', '¿Con qué vuelo viajabas?', o.textos.airlineD,
      '<div class="iw-g iw-g2">' +
      campo('aerolinea', 'Aerolínea', input('aerolinea', 'text', 'Aerolíneas Argentinas', true), true) +
      campo('vuelo_nro', 'Número de vuelo', input('vuelo_nro', 'text', 'AR1234', true), true) +
      '</div>');

    h += paso('tipoviaje', '¿El viaje era solo ida o ida y vuelta?',
      'Esto define qué parte del itinerario se analiza.',
      opts('tipo_viaje', [['solo_ida', 'Solo ida', '', '&#10142;'], ['ida_vuelta', 'Ida y vuelta', '', '&#8646;']]));

    h += paso('direccion', '¿En qué parte del viaje ocurrió el problema?',
      'Se analiza una sola dirección: aquella donde ocurrió el incidente.',
      opts('direccion_afectada', [['ida', 'La ida', '', '&#9992;&#65039;'], ['vuelta', 'La vuelta', '', '&#128748;']]));

    h += paso('escalas', '¿Hubo escalas en el viaje del problema?',
      'Un vuelo directo y uno con conexiones se analizan distinto.',
      opts('escalas', [['no', 'No, fue directo', '', '&#10132;'], ['si', 'Sí, hubo escalas', '', '&#8631;']]));

    h += paso('armador', '¿Por dónde fueron las escalas?',
      'En orden. Solo las intermedias: el origen y el destino se cargan en el paso siguiente.',
      '<div data-arm-list></div><button type="button" class="iw-add" data-arm-add>+ Agregar escala</button>');

    /* `data-airport` deja que la superficie enganche el combo de aeropuertos: de ahí
       sale el código IATA en `data-iata`, que es el dato canónico que consume el motor
       legal. Sin combo el campo sigue funcionando como texto libre. */
    h += paso('ruta', '¿De dónde a dónde volaba?', '',
      '<div class="iw-g iw-g2">' +
      campo('origen', '<span data-lbl-origen>El viaje despegó en</span>',
        input('origen', 'text', 'Buenos Aires (EZE)', true, ' data-airport="true" autocomplete="off"'), true) +
      campo('destino', '<span data-lbl-destino>El viaje finalizó en</span>',
        input('destino', 'text', 'Madrid (MAD)', true, ' data-airport="true" autocomplete="off"'), true) +
      '</div>');

    h += paso('fecha', '¿Cuándo era ese vuelo?',
      'Necesitamos el código de reserva para poder gestionar el reclamo.',
      '<div class="iw-g iw-g2">' +
      campo('fecha_vuelo', 'Fecha del vuelo', input('fecha_vuelo', 'date', '', true), true) +
      campo('pnr', 'PNR (código de reserva)', input('pnr', 'text', 'ABC123', true), true) +
      '</div>');

    h += paso('incident', '¿Qué pasó con el vuelo?', 'Elegí la situación que mejor lo describe.',
      opts('tipo_incidencia', [
        ['cancelacion', 'Cancelación', 'El vuelo no salió', '&#10060;'],
        ['demora', 'Demora', 'Salió tarde y se llegó tarde', '&#9201;&#65039;'],
        ['overbooking', 'Overbooking', 'Sobreventa: no había lugar', '&#128101;'],
        ['reprogramacion', 'Reprogramación', 'Cambio de día u horario', '&#128197;'],
        ['denegacion', 'Denegación de embarque', 'No lo dejaron subir', '&#128683;'],
      ]));

    h += paso('demora', '¿Cuántas horas más tarde se llegó al destino final?',
      'Lo que importa es la demora en la llegada, no en la salida.',
      '<div class="iw-g iw-g1">' +
      campo('horas_retraso', 'Horas de demora', input('horas_retraso', 'number', '4', true, ' min="1"'), true) + '</div>');

    h += paso('notice', '¿Con cuánta anticipación avisaron?',
      'El plazo del aviso cambia mucho lo que corresponde.',
      opts('anticipacion_aviso', [
        ['mas_14_dias', 'Más de 14 días'], ['7_a_14_dias', 'Entre 7 y 14 días'],
        ['menos_7_dias', 'Menos de 7 días'], ['menos_24h', 'Menos de 24 horas'],
        ['en_aeropuerto', 'En el aeropuerto, sin aviso previo'],
      ]));

    h += paso('embarque', '¿Se presentó al embarque en tiempo y con reserva confirmada?',
      'Es la condición que habilita el reclamo por sobreventa.',
      opts('embarque_presentado', [['si', 'Sí', '', '&#9989;'], ['no', 'No', '', '&#10060;']]));

    h += paso('refund', '¿Qué ofreció la aerolínea?',
      'Aunque se haya aceptado algo, el reclamo puede seguir en pie.',
      opts('ofrecimiento_aerolinea', [
        ['reubicacion', 'Reubicación en otro vuelo'], ['reembolso', 'Reembolso'],
        ['reubicacion_y_reembolso', 'Reubicación y reembolso'],
        ['voucher', 'Voucher / compensación en el momento'], ['nada', 'Nada'],
      ]));

    h += paso('viajo', '¿Finalmente se viajó al destino?', 'Con esto se calcula el perjuicio real.',
      opts('viajo_finalmente', [
        ['reubicado', 'Sí, reubicado por la aerolínea', '', '&#9992;&#65039;'],
        ['medios_propios', 'Sí, por medios propios', 'Se compró otro pasaje', '&#128179;'],
        ['no_viajo', 'No viajó', '', '&#128683;'],
      ]));

    h += paso('viajohoras', '¿Cuántas horas más tarde se llegó?',
      'Respecto del horario de llegada previsto originalmente.',
      '<div class="iw-g iw-g1">' +
      campo('viajo_horas', 'Horas de demora', input('viajo_horas', 'number', '4', true, ' min="0"'), true) + '</div>');

    h += paso('pasajealt', '¿Cuánto costó el pasaje que se compró?', 'Adjuntá el comprobante.',
      '<div class="iw-g iw-g2">' +
      campo('pasaje_alternativo_moneda', 'Moneda', select('pasaje_alternativo_moneda', opcionesMoneda(), true), true) +
      campo('pasaje_alternativo_monto', 'Costo del nuevo pasaje', input('pasaje_alternativo_monto', 'number', '0.00', true, ' min="0" step="0.01"'), true) +
      '</div><div style="margin-top:14px">' +
      drop('pasaje', 'Constancia del nuevo pasaje (ticket / factura) <span class="iw-ast">*</span>',
        'PDF, JPG, PNG · Hasta 5 archivos · 10MB c/u', 5) +
      '<div class="iw-err" data-file-err></div></div>',
      ' data-req-file="pasaje"');

    h += paso('cause', '¿Qué causa informó la aerolínea?',
      'Si no informaron nada, seguí sin completar: es opcional.',
      opts('causa_informada', [
        ['operativa', 'Operativa'], ['tecnica', 'Técnica'], ['climatica', 'Climática'],
        ['atc', 'Control de tráfico aéreo (ATC)'], ['otra', 'Otra'], ['no_informada', 'No informaron'],
      ]));

    h += paso('bagtype', '¿Qué pasó con el equipaje?', 'Elegí la situación que corresponde.',
      opts('tipo_caso_equipaje', [
        ['perdida', 'Pérdida', 'Nunca apareció', '&#10060;'],
        ['danio', 'Daño', 'Llegó roto o forzado', '&#128296;'],
        ['demora', 'Demora en entrega', 'Llegó tarde', '&#9201;&#65039;'],
      ]));

    h += paso('bagdelivery', '¿Cuándo entregaron el equipaje?',
      'Los días sin equipaje son parte del reclamo.',
      '<div class="iw-g iw-g1">' +
      campo('fecha_entrega_equipaje', 'Fecha de entrega', input('fecha_entrega_equipaje', 'date', '')) + '</div>' +
      '<div class="iw-cons" data-cons-noent style="margin-top:12px"><label class="iw-cons-r">' +
      '<input type="checkbox" class="iw-cb" id="iw-equipaje_no_entregado" />' +
      '<span class="iw-cons-t">Todavía no lo entregaron</span></label></div>');

    h += paso('bagvalue', '¿Cuánto valía el equipaje?',
      'Una estimación razonable alcanza. No hace falta que sea exacta.',
      '<div class="iw-g iw-g1">' +
      campo('valor_equipaje', '<span data-lbl-bagvalue>Valor estimado (USD)</span>',
        input('valor_equipaje', 'number', '500', false, ' min="0"')) + '</div>');

    h += paso('bagpir', '¿Se presentó el reporte de equipaje (PIR) en el aeropuerto?',
      'Es el formulario que se completa en el mostrador al notar el problema.',
      opts('pir_presentado', [['si', 'Sí', '', '&#9989;'], ['no', 'No', '', '&#10060;'], ['no_sabe', 'No sé', '', '&#129300;']]));

    h += paso('bagpirnum', '¿Tenés el número de PIR?', 'Figura en el comprobante del aeropuerto.',
      '<div class="iw-g iw-g1">' +
      campo('pir_numero', 'Número de PIR', input('pir_numero', 'text', 'EZEAR12345')) + '</div>');

    h += paso('bagdesc', 'Contanos qué pasó', 'Si hay fotos del daño o el PIR, sumalos.',
      '<div class="iw-g iw-g1">' + campo('descripcion_equipaje', '',
        '<textarea class="iw-in iw-ta" id="iw-descripcion_equipaje" data-req="1" rows="3" ' +
        'placeholder="Ej: La maleta llegó con la rueda rota y la cerradura forzada."></textarea>', false) + '</div>' +
      '<div style="margin-top:12px">' +
      drop('bag', 'Fotos del daño, formulario PIR y comprobantes', 'PDF, JPG, PNG · Hasta 5 archivos · 10MB c/u', 5) +
      '</div>');

    h += paso('gastosgate', '¿Hubo gastos extra por el incidente?',
      'Hotel, comidas, transporte, ropa de reposición.',
      opts('_gastos_gate', [['si', 'Sí, hubo gastos', '', '&#128176;'], ['no', 'No, ninguno', '', '&#8212;']]));

    h += paso('gastos', 'Cargá los gastos uno por uno',
      'Cada gasto necesita su comprobante: es la prueba que respalda el reclamo.',
      '<div data-gastos-list></div>' +
      '<div class="iw-gempty" data-gastos-empty>Todavía no se cargó ningún gasto.</div>' +
      '<div class="iw-gform" data-gform style="display:none">' +
      '<div class="iw-g iw-g1">' + campo('g_desc', 'Descripción del gasto',
        input('g_desc', 'text', 'Ej: Hotel una noche en Madrid'), true) + '</div>' +
      '<div class="iw-g iw-g2" style="margin-top:12px">' +
      campo('g_cur', 'Moneda', select('g_cur', opcionesMoneda()), true) +
      campo('g_amt', 'Monto', input('g_amt', 'number', '0.00', false, ' min="0" step="0.01"'), true) + '</div>' +
      '<div style="margin-top:12px">' +
      drop('gasto_item', 'Ticket / comprobante del gasto <span class="iw-ast">*</span>', 'PDF, JPG, PNG · Máx. 10MB', 1) +
      '</div><div class="iw-err" data-gerr></div>' +
      '<div class="iw-gform-act">' +
      '<button class="iw-btn iw-btn-back" type="button" data-g-cancel>Cancelar</button>' +
      '<button class="iw-btn iw-btn-go" type="button" data-g-save>Agregar gasto</button></div></div>' +
      '<button type="button" class="iw-add" data-gasto-add>+ Agregar gasto</button>' +
      '<div class="iw-gtotal" data-gastos-total style="display:none">' +
      '<span class="iw-gtotal-l" data-gastos-total-l>Total cargado</span>' +
      '<span class="iw-gtotal-v" data-gastos-total-v></span></div>');

    h += paso('combogate', '¿También hubo un problema con el equipaje en este vuelo?',
      'Si es así se suma al mismo reclamo, sin abrir un caso aparte.',
      opts('_combo_gate', [['si', 'Sí, también el equipaje', '', '&#129523;'], ['no', 'No, solo el vuelo', '', '&#8212;']]));

    h += paso('combo', '¿Qué pasó con el equipaje?', 'Lo básico alcanza.',
      '<div class="iw-g iw-g2">' +
      campo('tipo_caso_equipaje', 'Tipo de incidencia', select('tipo_caso_equipaje',
        '<option value="">Seleccionar...</option><option value="perdida">Pérdida</option>' +
        '<option value="danio">Daño</option><option value="demora">Demora en entrega</option>', true), true) +
      campo('pir_presentado', '¿Se presentó el PIR?', select('pir_presentado',
        '<option value="">Seleccionar...</option><option value="si">Sí</option>' +
        '<option value="no">No</option><option value="no_sabe">No sé</option>', true), true) +
      '</div><div class="iw-g iw-g1" style="margin-top:14px">' +
      campo('descripcion_equipaje', 'Descripción',
        '<textarea class="iw-in iw-ta" id="iw-descripcion_equipaje_combo" rows="2" ' +
        'placeholder="Ej: La maleta llegó con la rueda rota."></textarea>') + '</div>');

    if (o.acompanantes) {
      h += paso('acompgate', '¿Viajaba con alguien más afectado?',
        'Se puede reclamar por todos en el mismo caso.',
        opts('_acomp_gate', [['si', 'Sí, viajaba acompañado/a', '', '&#128101;'], ['no', 'No, viajaba solo/a', '', '&#128100;']]));
      h += paso('acomp', '¿Quiénes lo acompañaban?',
        'Nombre y documento de cada persona afectada por el mismo vuelo.',
        '<div data-acomp-list></div><button type="button" class="iw-add" data-acomp-add>+ Agregar pasajero</button>');
    }

    h += paso('otrosdocs', '¿Hay algún otro documento para sumar?',
      'Cualquier cosa que respalde el reclamo: mails con la aerolínea, capturas, certificados. Es opcional.',
      drop('otros', 'Arrastrá acá cualquier otra documentación', 'PDF, JPG, PNG · Hasta 5 archivos · Máx. 10MB c/u', 5));

    h += paso('comentario', o.textos.comentarioQ, o.textos.comentarioD,
      '<div class="iw-g iw-g1">' + campo('comentarios_pasajero', '',
        '<textarea class="iw-in iw-ta" id="iw-comentarios_pasajero" rows="6" maxlength="1500" ' +
        'style="min-height:140px" placeholder="' + esc(o.textos.comentarioPh) + '"></textarea>') + '</div>' +
      '<div class="iw-cnt"><span data-com-cnt>0</span> / 1500</div>');

    if (o.datosPersonales) {
      h += paso('pers1', o.textos.pers1Q, 'Tal como figura en el documento de identidad.',
        '<div class="iw-g iw-g1">' +
        campo('nombre', 'Nombre y apellido', input('nombre', 'text', 'Juan Pablo Martínez', true), true) + '</div>');
      h += paso('pers2', o.textos.pers2Q, 'El seguimiento del caso va principalmente por WhatsApp.',
        '<div class="iw-g iw-g2">' +
        campo('telefono', 'Teléfono', input('telefono', 'tel', '+54 9 11 2557-8402', true), true) +
        campo('email', 'Mail', input('email', 'email', 'juan@email.com', true), true) + '</div>');
      h += paso('pers3', o.textos.pers3Q, 'Necesario para el poder que autoriza la representación.',
        '<div class="iw-g iw-g2">' +
        campo('documento_tipo', 'Tipo', select('documento_tipo',
          '<option value="">Seleccionar...</option><option value="DNI">DNI</option>' +
          '<option value="Pasaporte">Pasaporte</option><option value="ID">ID / Cédula</option>', true), true) +
        campo('documento_numero', 'Número', input('documento_numero', 'text', '37.806.475', true), true) + '</div>');
    }

    if (o.firma) {
      h += paso('firma', 'Declaración jurada y firma', 'Leé antes de firmar. Es el último paso.',
        '<div class="iw-fee"><span class="iw-fee-ic"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 2L3 7v6c0 5 3.5 8 9 9 5.5-1 9-4 9-9V7l-9-5z"/><path d="M9 12l2 2 4-4"/></svg></span>' +
        '<p>' + HONORARIOS + '</p></div>' +
        '<div class="iw-ddjj">' + o.ddjj + '</div>' +
        '<div class="iw-cons" data-cons-box><label class="iw-cons-r">' +
        '<input type="checkbox" class="iw-cb" id="iw-consent" data-req="1" />' +
        '<span class="iw-cons-t">Acepto los <button type="button" class="iw-doclink" data-doc="tyc">Términos y ' +
        'Condiciones</button>, la <button type="button" class="iw-doclink" data-doc="priv">Política de ' +
        'Privacidad</button> y la declaración jurada precedente. Firmo digitalmente este reclamo autorizando a ' +
        'SolucionAir a actuar en mi representación.</span></label></div>' +
        '<div class="iw-err" data-envio-err></div>');
    } else {
      h += paso('firma', 'Revisá antes de guardar', 'Es el último paso.',
        '<div class="iw-fee"><span class="iw-fee-ic">&#9989;</span><p>' + esc(o.textos.sinFirmaNota) + '</p></div>' +
        '<div class="iw-err" data-envio-err></div>');
    }

    h += '<section class="iw-ms" data-ms="done"><div class="iw-done">' +
      '<div class="iw-done-ic"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1B9B5A" ' +
      'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>' +
      '<h2 class="iw-done-t">' + esc(o.textos.doneT) + '</h2>' +
      '<p class="iw-done-d">' + esc(o.textos.doneD) + '</p>' +
      '<div class="iw-done-box"><div class="iw-done-lbl">' + esc(o.textos.doneLbl) + '</div>' +
      '<div class="iw-done-id" data-done-id>—</div></div>' +
      '<p style="font-size:.76rem;color:var(--t3,#6B6B6B);line-height:1.55">' + esc(o.textos.doneNota) + '</p>' +
      '</div></section>';

    return h;
  }

  /* ---------- documentos legales ---------- */

  var DOCS = {
    tyc: {
      t: 'Términos y Condiciones',
      h: '<h4>1. Objeto del servicio</h4><p>SolucionAir gestiona reclamos de compensación frente a aerolíneas ' +
        'en representación del pasajero, en sede administrativa, extrajudicial y de mediación privada online.</p>' +
        '<h4>2. Honorarios</h4><p>El servicio opera bajo esquema de honorarios por éxito. No se cobran costos ' +
        'iniciales. Los honorarios equivalen al <strong>25% de la compensación efectivamente obtenida</strong>, ' +
        'y solo se devengan si el reclamo prospera.</p>' +
        '<h4>3. Obligaciones del reclamante</h4><ul><li>Proporcionar información verídica, completa y exacta.</li>' +
        '<li>Entregar la documentación de respaldo que le sea requerida.</li>' +
        '<li>Informar cualquier contacto o propuesta que reciba de la aerolínea.</li></ul>' +
        '<h4>4. Plazos</h4><p>Los plazos de gestión dependen de la aerolínea y del organismo interviniente. ' +
        'SolucionAir no garantiza un resultado ni un plazo determinado.</p>' +
        '<h4>5. Liquidación</h4><p>Obtenida la compensación, se liquida al reclamante el importe neto de la ' +
        'comisión dentro de los 10 días hábiles de acreditados los fondos.</p>',
    },
    priv: {
      t: 'Política de Privacidad',
      h: '<h4>1. Datos que recolectamos</h4><p>Datos identificatorios (nombre, documento, contacto), datos del ' +
        'viaje (itinerario, reserva, aerolínea) y la documentación de respaldo aportada.</p>' +
        '<h4>2. Finalidad</h4><p>Los datos se usan exclusivamente para gestionar el reclamo: presentarlo ante la ' +
        'aerolínea y/o el organismo competente, y comunicar novedades.</p>' +
        '<h4>3. Con quién se comparten</h4><ul><li>La aerolínea reclamada y sus representantes.</li>' +
        '<li>Organismos de defensa del consumidor y de aviación civil que intervengan.</li>' +
        '<li>Abogados y mediadores intervinientes en el caso.</li></ul>' +
        '<p>No se venden ni ceden datos con fines publicitarios.</p>' +
        '<h4>4. Conservación</h4><p>Los datos se conservan mientras dure la gestión del reclamo y por el plazo ' +
        'legal de prescripción posterior.</p>' +
        '<h4>5. Derechos</h4><p>Se puede solicitar acceso, rectificación o supresión escribiendo a nuestro canal ' +
        'de contacto, conforme a la Ley 25.326 de Protección de Datos Personales.</p>',
    },
  };

  /* ---------- textos por defecto, ajustables por superficie ---------- */

  function textosDe(superficie) {
    var esInterno = superficie === 'backoffice' || superficie === 'agencia';
    return {
      tipoQ: esInterno ? '¿Qué tipo de reclamo es?' : '¿Qué te pasó?',
      tipoD: 'Elegí el tipo de reclamo para empezar.',
      airlineD: 'Si se escaneó la reserva, esto ya está completo. Revisalo.',
      comentarioQ: esInterno ? 'Comentarios del caso' : '¿Querés contarnos algo más?',
      comentarioD: 'Cualquier detalle importante que no se haya preguntado. Es opcional.',
      comentarioPh: esInterno
        ? 'Contexto del caso para quien lo revise después.'
        : 'Ej: Viajaba con mi hija de 3 años y estuvimos 9 horas en el aeropuerto sin asistencia.',
      pers1Q: esInterno ? '¿Cómo se llama el pasajero?' : 'Listo. ¿Cómo te llamás?',
      pers2Q: esInterno ? '¿Dónde se lo contacta?' : '¿Dónde te contactamos?',
      pers3Q: esInterno ? '¿Cuál es su documento?' : '¿Cuál es tu documento?',
      sinFirmaNota: 'El caso se guarda sin firma del pasajero. La autorización queda pendiente de envío.',
      doneT: esInterno ? 'Caso cargado' : '¡Reclamo enviado con éxito!',
      doneD: esInterno
        ? 'El caso quedó registrado y ya aparece en el listado.'
        : 'Tu caso fue registrado correctamente. Nuestro equipo ya está procesando tu reclamo.',
      doneLbl: 'Número de caso',
      doneNota: esInterno
        ? 'Se puede completar el resto de los datos legales desde el detalle del caso.'
        : 'Guardá este código para consultar el estado de tu caso. Te contactamos por WhatsApp con novedades.',
      cerrarT: '¿Cerrar el formulario?',
      cerrarD: 'Se va a perder lo cargado hasta acá. El caso todavía no fue enviado.',
    };
  }

  /* ============================================================
     crear()
     ============================================================ */

  function crear(opciones) {
    var o = opciones || {};
    o.superficie = o.superficie || 'b2c';
    var esB2C = o.superficie === 'b2c';
    if (o.escaner === undefined) o.escaner = true;
    if (o.datosPersonales === undefined) o.datosPersonales = true;
    if (o.acompanantes === undefined) o.acompanantes = true;
    if (o.firma === undefined) o.firma = esB2C;
    o.ddjj = o.ddjj || DDJJ;
    var base = textosDe(o.superficie);
    if (o.textos) {
      for (var k in o.textos) if (o.textos.hasOwnProperty(k)) base[k] = o.textos[k];
    }
    o.textos = base;
    var fuenteGastos = o.superficie === 'b2c' ? 'declaracion_pasajero'
      : o.superficie === 'agencia' ? 'agencia' : 'admin';

    var PASOS = definirPasos(o);

    /* ---- DOM ---- */
    var ov = document.createElement('div');
    ov.className = 'iw-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Carga de reclamo');
    ov.innerHTML =
      '<div class="iw-dlg">' +
      '<div class="iw-head">' +
      '<button class="iw-x" type="button" data-cerrar aria-label="Cerrar">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
      '<div data-prog>' +
      '<div class="iw-prog-top"><span class="iw-prog-step" data-prog-step>Paso 1</span>' +
      '<span class="iw-prog-pct" data-prog-pct>0%</span></div>' +
      '<div class="iw-prog-bar"><div class="iw-prog-fill" data-prog-fill></div></div></div></div>' +
      '<div class="iw-body" data-body>' + cuerpoPasos(o) + '</div>' +
      '<div class="iw-foot" data-foot>' +
      '<button class="iw-btn iw-btn-back" type="button" data-atras>&larr; Atrás</button>' +
      '<button class="iw-btn iw-btn-go" type="button" data-seguir>Continuar</button></div></div>';
    document.body.appendChild(ov);

    var ovDoc = document.createElement('div');
    ovDoc.className = 'iw-ov iw-ov-doc';
    ovDoc.innerHTML =
      '<div class="iw-dlg" style="max-width:600px"><div class="iw-head">' +
      '<span class="iw-ttl" data-doc-title></span>' +
      '<button class="iw-x" type="button" data-doc-close aria-label="Cerrar">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>' +
      '<div class="iw-body"><div class="iw-docbody" data-doc-body></div></div>' +
      '<div class="iw-foot"><button class="iw-btn iw-btn-go" type="button" data-doc-ok>Entendido</button></div></div>';
    document.body.appendChild(ovDoc);

    var ovCfm = document.createElement('div');
    ovCfm.className = 'iw-ov iw-ov-cfm';
    ovCfm.innerHTML =
      '<div class="iw-cfm"><h3 class="iw-cfm-t">' + esc(o.textos.cerrarT) + '</h3>' +
      '<p class="iw-cfm-d">' + esc(o.textos.cerrarD) + '</p><div class="iw-cfm-act">' +
      '<button class="iw-btn iw-btn-back" type="button" data-cfm-no>Seguir cargando</button>' +
      '<button class="iw-btn iw-btn-danger" type="button" data-cfm-si>Cerrar y descartar</button></div></div>';
    document.body.appendChild(ovCfm);

    function q(sel, raiz) { return (raiz || ov).querySelector(sel); }
    function qa(sel, raiz) { return (raiz || ov).querySelectorAll(sel); }
    function el(id) { return q('#iw-' + id); }

    var cuerpo = q('[data-body]');
    var pie = q('[data-foot]');
    var btnSeguir = q('[data-seguir]');
    var btnAtras = q('[data-atras]');

    /* ---- estado ---- */
    var S = { cur: 'tipo', hist: [], dir: 'fwd', enviando: false };
    var OCULTOS = {};        /* respuestas de tarjetas y flags internos */
    var GASTOS = [];
    var ARCHIVOS = {};       /* clave de dropzone → [nombres] */

    var W = {
      leer: function (clave) {
        if (OCULTOS[clave] !== undefined) return OCULTOS[clave];
        var n = el(clave);
        return n ? n.value : '';
      },
    };

    function visibles() {
      var out = [], i;
      for (i = 0; i < PASOS.length; i++) {
        if (!PASOS[i].when || PASOS[i].when(W)) out.push(PASOS[i]);
      }
      return out;
    }

    function idxDe(id) {
      var vis = visibles(), i;
      for (i = 0; i < vis.length; i++) if (vis[i].id === id) return i;
      return 0;
    }

    /* ---- render ---- */
    function pintar() {
      var vis = visibles(), pos = idxDe(S.cur), cur = vis[pos];
      var secs = qa('.iw-ms'), i;
      for (i = 0; i < secs.length; i++) {
        secs[i].className = 'iw-ms';
        if (secs[i].getAttribute('data-ms') === cur.id) {
          secs[i].className = 'iw-ms iw-on ' + (S.dir === 'fwd' ? 'iw-fwd' : 'iw-bwd');
        }
      }
      cuerpo.scrollTop = 0;

      var pct = vis.length > 1 ? Math.round((pos / (vis.length - 1)) * 100) : 0;
      q('[data-prog-fill]').style.width = pct + '%';
      q('[data-prog-pct]').textContent = pct + '%';
      q('[data-prog-step]').textContent = cur.id === 'done' ? 'Completado' : 'Paso ' + (pos + 1);
      q('[data-prog]').style.display = cur.id === 'tipo' ? 'none' : '';

      if (cur.id === 'done') {
        pie.style.display = 'none';
      } else {
        pie.style.display = '';
        btnAtras.style.display = S.hist.length ? '' : 'none';
        var ultimo = cur.id === 'firma';
        btnSeguir.className = 'iw-btn ' + (ultimo ? 'iw-btn-send' : 'iw-btn-go');
        btnSeguir.textContent = ultimo ? (o.firma ? 'Firmar y enviar reclamo' : 'Guardar caso') : 'Continuar';
        btnSeguir.disabled = !!S.enviando;
      }

      if (cur.id === 'ruta') {
        var dir = W.leer('direccion_afectada');
        var suj = dir === 'ida' ? 'El viaje de ida' : dir === 'vuelta' ? 'El viaje de vuelta' : 'El viaje';
        q('[data-lbl-origen]').textContent = suj + ' despegó en';
        q('[data-lbl-destino]').textContent = suj + ' finalizó en';
      }
      if (cur.id === 'bagvalue') {
        var bt = W.leer('tipo_caso_equipaje'), lbl = q('[data-lbl-bagvalue]'), inp = el('valor_equipaje');
        if (bt === 'perdida') {
          lbl.innerHTML = 'Valor estimado del contenido (USD) <span class="iw-ast">*</span>';
          inp.setAttribute('data-req', '1');
        } else if (bt === 'danio') {
          lbl.textContent = 'Costo estimado de reparación/reposición (USD)';
          inp.removeAttribute('data-req');
        } else {
          lbl.textContent = 'Valor estimado del equipaje (USD)';
          inp.removeAttribute('data-req');
        }
      }
    }

    /* ---- validación del paso visible ---- */
    function validar() {
      var sec = q('.iw-ms[data-ms="' + S.cur + '"]');
      if (!sec) return true;
      var bien = true, reqs = qa('[data-req]', sec), i;
      for (i = 0; i < reqs.length; i++) {
        var n = reqs[i];
        var f = n.parentNode;
        while (f && f !== sec && f.className.indexOf('iw-field') === -1) f = f.parentNode;
        var vacio = n.type === 'checkbox' ? !n.checked : !trim(n.value);
        if (vacio) {
          bien = false;
          if (f && f.className.indexOf('iw-field') > -1) {
            f.className = 'iw-field iw-bad';
            var m = q('.iw-msg', f);
            if (m) m.textContent = 'Completá este campo';
          }
          if (n.type === 'checkbox') {
            var cb = q('[data-cons-box]', sec);
            if (cb) cb.style.borderColor = 'var(--err,#C0392B)';
          }
        } else if (f && f.className.indexOf('iw-field') > -1) {
          f.className = 'iw-field';
          var m2 = q('.iw-msg', f);
          if (m2) m2.textContent = '';
        }
      }

      var reqFile = sec.getAttribute('data-req-file');
      if (reqFile && !(ARCHIVOS[reqFile] || []).length) {
        var ef = q('[data-file-err]', sec);
        if (ef) ef.textContent = 'Falta adjuntar el comprobante.';
        bien = false;
      }

      if (S.cur === 'gastos' && !GASTOS.length) {
        var vac = q('[data-gastos-empty]');
        vac.style.borderColor = 'var(--err,#C0392B)';
        vac.style.color = 'var(--err,#C0392B)';
        vac.textContent = 'Agregá al menos un gasto para continuar.';
        return false;
      }

      var pick = q('[data-pick]', sec);
      if (pick && S.cur !== 'cause' && !OCULTOS[pick.getAttribute('data-pick')]) {
        var d = q('.iw-d', sec);
        if (d) {
          d.style.color = 'var(--err,#C0392B)';
          setTimeout(function () { d.style.color = ''; }, 1600);
        }
        bien = false;
      }
      return bien;
    }

    /* ---- navegación ---- */
    function ir(delta) {
      if (delta > 0) {
        if (!validar()) return;
        if (S.cur === 'firma') { enviar(); return; }
        var vis = visibles(), pos = idxDe(S.cur);
        if (pos >= vis.length - 1) return;
        S.hist.push(S.cur);
        S.cur = vis[pos + 1].id;
        S.dir = 'fwd';
      } else {
        if (!S.hist.length) return;
        S.cur = S.hist.pop();
        S.dir = 'bwd';
      }
      pintar();
    }

    btnSeguir.addEventListener('click', function () { ir(1); });
    btnAtras.addEventListener('click', function () { ir(-1); });

    /* ---- tarjetas de opción ---- */
    var grupos = qa('[data-pick]');
    (function () {
      var i;
      for (i = 0; i < grupos.length; i++) {
        (function (grupo) {
          grupo.addEventListener('click', function (e) {
            /* Subir al <button>: el click suele caer en un span interno. */
            var b = e.target;
            while (b && b !== grupo && b.nodeName !== 'BUTTON') b = b.parentNode;
            if (!b || b === grupo) return;
            var os = grupo.querySelectorAll('.iw-opt'), k;
            for (k = 0; k < os.length; k++) os[k].className = 'iw-opt';
            b.className = 'iw-opt iw-sel';
            OCULTOS[grupo.getAttribute('data-pick')] = b.getAttribute('data-val');
            setTimeout(function () { ir(1); }, 180);
          });
        })(grupos[i]);
      }
    })();

    var ctypeBox = q('[data-pick-ctype]');
    ctypeBox.addEventListener('click', function (e) {
      var b = e.target;
      while (b && b !== ctypeBox && b.nodeName !== 'BUTTON') b = b.parentNode;
      if (!b || b === ctypeBox) return;
      var bs = ctypeBox.querySelectorAll('.iw-ctype-b'), k;
      for (k = 0; k < bs.length; k++) bs[k].className = 'iw-ctype-b';
      b.className = 'iw-ctype-b iw-sel';
      OCULTOS.tipo_reclamo = b.getAttribute('data-ctype');
      setTimeout(function () { ir(1); }, 180);
    });

    /* ---- escáner (la superficie provee la implementación) ---- */
    if (o.escaner) {
      q('[data-scan-go]').addEventListener('click', function () {
        if (typeof o.alEscanear !== 'function') { ir(1); return; }
        q('[data-scan-idle]').style.display = 'none';
        q('[data-scan-load]').style.display = '';
        q('[data-scan-err]').textContent = '';
        o.alEscanear(function (err, datos) {
          q('[data-scan-idle]').style.display = '';
          q('[data-scan-load]').style.display = 'none';
          if (err) {
            q('[data-scan-err]').textContent = 'No se pudieron leer los documentos. Cargá los datos a mano.';
            return;
          }
          if (datos) prellenar(datos);
          ir(1);
        });
      });
      q('[data-scan-skip]').addEventListener('click', function () { ir(1); });
    }

    /* Deja que la superficie enganche el combo de aeropuertos, también en los inputs
       que se crean en caliente (las escalas). `AirportSelect.attach` es idempotente. */
    function montarCampo(n) {
      if (n && typeof o.alMontarCampoAeropuerto === 'function') o.alMontarCampoAeropuerto(n);
    }
    montarCampo(el('origen'));
    montarCampo(el('destino'));

    /* Campos que se muestran pero no se editan, con la razón al lado. Se muestran y no
       se saltean a propósito: el usuario tiene que ver qué dato trajo su identidad. */
    (function () {
      var lista = o.soloLectura || [], i;
      for (i = 0; i < lista.length; i++) {
        var n = el(lista[i]);
        if (n) { n.readOnly = true; n.setAttribute('data-ro', '1'); }
      }
      var notas = o.notas || {};
      for (var clave in notas) {
        if (!notas.hasOwnProperty(clave)) continue;
        var f = q('[data-field="' + clave + '"]');
        if (!f) continue;
        var p = document.createElement('p');
        p.className = 'iw-hint';
        p.textContent = notas[clave];
        f.appendChild(p);
      }
    })();

    /* ---- filas dinámicas ---- */
    function fila(cont, ph1, ph2, aeropuerto) {
      var d = document.createElement('div');
      d.className = 'iw-row';
      d.innerHTML = '<input class="iw-in" type="text" placeholder="' + esc(ph1) + '"' +
        (aeropuerto ? ' data-airport="true" autocomplete="off"' : '') + ' />' +
        (ph2 ? '<input class="iw-in" type="text" placeholder="' + esc(ph2) + '" />' : '') +
        '<button type="button" class="iw-row-del" aria-label="Quitar">&times;</button>';
      q('.iw-row-del', d).addEventListener('click', function () { cont.removeChild(d); });
      cont.appendChild(d);
      if (aeropuerto) montarCampo(d.querySelector('.iw-in'));
    }
    var armList = q('[data-arm-list]');
    q('[data-arm-add]').addEventListener('click', function () { fila(armList, 'Ciudad o código de escala (ej: GRU)', '', true); });
    fila(armList, 'Ciudad o código de escala (ej: GRU)', '', true);

    if (o.acompanantes) {
      var acompList = q('[data-acomp-list]');
      q('[data-acomp-add]').addEventListener('click', function () { fila(acompList, 'Nombre y apellido', 'Documento'); });
      fila(acompList, 'Nombre y apellido', 'Documento');
    }

    /* ---- dropzones ----
       El componente NO sube archivos: registra nombres y delega la subida real
       en la superficie, que ya tiene su propio camino autenticado. */
    function limite(btn) { return parseInt(btn.getAttribute('data-max'), 10) || 5; }
    function refrescarDrop(btn, clave) {
      var lista = ARCHIVOS[clave] || [];
      var lleno = lista.length >= limite(btn);
      btn.className = lleno ? 'iw-drop iw-full' : 'iw-drop';
      var meta = q('.iw-drop-m', btn);
      if (!meta) return;
      if (!meta.getAttribute('data-orig')) meta.setAttribute('data-orig', meta.textContent);
      meta.textContent = lleno ? 'Llegaste al máximo de ' + limite(btn) + ' archivos' : meta.getAttribute('data-orig');
    }
    function pintarChips(clave) {
      var cont = q('[data-chips="' + clave + '"]');
      while (cont.firstChild) cont.removeChild(cont.firstChild);
      var lista = ARCHIVOS[clave] || [], i;
      for (i = 0; i < lista.length; i++) {
        (function (nombre, idx) {
          var c = document.createElement('span');
          c.className = 'iw-chip';
          c.appendChild(document.createTextNode(nombre));
          var x = document.createElement('span');
          x.className = 'iw-chip-x';
          x.innerHTML = '&times;';
          x.addEventListener('click', function () {
            ARCHIVOS[clave].splice(idx, 1);
            pintarChips(clave);
            refrescarDrop(q('[data-drop="' + clave + '"]'), clave);
          });
          c.appendChild(x);
          cont.appendChild(c);
        })(lista[i], i);
      }
    }
    function agregarArchivo(clave, nombre) {
      if (!ARCHIVOS[clave]) ARCHIVOS[clave] = [];
      var btn = q('[data-drop="' + clave + '"]');
      if (ARCHIVOS[clave].length >= limite(btn)) return false;
      ARCHIVOS[clave].push(nombre);
      pintarChips(clave);
      refrescarDrop(btn, clave);
      var sec = btn.parentNode;
      while (sec && sec.className.indexOf('iw-ms') === -1) sec = sec.parentNode;
      var ef = sec && q('[data-file-err]', sec);
      if (ef) ef.textContent = '';
      return true;
    }
    var zonas = qa('[data-drop]');
    (function () {
      var i;
      for (i = 0; i < zonas.length; i++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            var clave = btn.getAttribute('data-drop');
            if (typeof o.alElegirArchivo === 'function') {
              o.alElegirArchivo(clave, function (nombre) { if (nombre) agregarArchivo(clave, nombre); });
            }
          });
        })(zonas[i]);
      }
    })();

    /* ---- agregador de gastos ---- */
    function nombreGuardado(g, idx) {
      var punto = g.archivo ? g.archivo.lastIndexOf('.') : -1;
      var ext = punto > -1 ? g.archivo.slice(punto) : '';
      return 'Gasto ' + (idx + 1) + ' - ' + g.moneda + ' ' + g.monto.toFixed(2) + ext;
    }
    function pintarGastos() {
      var cont = q('[data-gastos-list]'), i;
      while (cont.firstChild) cont.removeChild(cont.firstChild);
      for (i = 0; i < GASTOS.length; i++) {
        (function (g, idx) {
          var d = document.createElement('div');
          d.className = 'iw-gitem';
          d.innerHTML = '<span class="iw-gitem-b"><span class="iw-gitem-t"></span>' +
            '<span class="iw-gitem-m"></span>' +
            '<span class="iw-gitem-f">&#128206; <span></span><em class="iw-gitem-orig"></em></span></span>' +
            '<button type="button" class="iw-gitem-del" aria-label="Eliminar">&times;</button>';
          q('.iw-gitem-t', d).textContent = g.concepto;
          q('.iw-gitem-m', d).textContent = g.moneda + ' ' + g.monto.toFixed(2);
          q('.iw-gitem-f span', d).textContent = nombreGuardado(g, idx);
          q('.iw-gitem-orig', d).textContent = g.archivo ? 'subiste ' + g.archivo : '';
          q('.iw-gitem-del', d).addEventListener('click', function () { GASTOS.splice(idx, 1); pintarGastos(); });
          cont.appendChild(d);
        })(GASTOS[i], i);
      }
      var vac = q('[data-gastos-empty]');
      vac.style.display = GASTOS.length ? 'none' : '';
      vac.style.borderColor = '';
      vac.style.color = '';
      vac.textContent = 'Todavía no se cargó ningún gasto.';

      /* Se suma DENTRO de cada moneda y se listan por separado: sumar entre
         monedas distintas sería inventar un tipo de cambio. */
      var tot = {}, k, partes = [];
      for (k = 0; k < GASTOS.length; k++) tot[GASTOS[k].moneda] = (tot[GASTOS[k].moneda] || 0) + GASTOS[k].monto;
      for (k in tot) if (tot.hasOwnProperty(k)) partes.push(k + ' ' + tot[k].toFixed(2));
      var caja = q('[data-gastos-total]'), val = q('[data-gastos-total-v]');
      caja.style.display = GASTOS.length ? '' : 'none';
      caja.className = partes.length > 1 ? 'iw-gtotal iw-multi' : 'iw-gtotal';
      q('[data-gastos-total-l]').textContent = partes.length > 1 ? 'Totales por moneda' : 'Total cargado';
      while (val.firstChild) val.removeChild(val.firstChild);
      for (k = 0; k < partes.length; k++) {
        var s = document.createElement('span');
        s.textContent = partes[k];
        val.appendChild(s);
      }
    }
    function limpiarFormGasto() {
      el('g_desc').value = '';
      el('g_amt').value = '';
      el('g_cur').value = 'ARS';
      q('[data-gerr]').textContent = '';
      ARCHIVOS.gasto_item = [];
      pintarChips('gasto_item');
      refrescarDrop(q('[data-drop="gasto_item"]'), 'gasto_item');
    }
    q('[data-gasto-add]').addEventListener('click', function () {
      q('[data-gform]').style.display = 'block';
      this.style.display = 'none';
    });
    q('[data-g-cancel]').addEventListener('click', function () {
      q('[data-gform]').style.display = 'none';
      q('[data-gasto-add]').style.display = '';
      limpiarFormGasto();
    });
    q('[data-g-save]').addEventListener('click', function () {
      var desc = trim(el('g_desc').value);
      var monto = aNumero(el('g_amt').value);
      var arch = (ARCHIVOS.gasto_item || [])[0] || '';
      var err = q('[data-gerr]');
      if (!desc) { err.textContent = 'Poné una descripción del gasto.'; return; }
      if (monto === null || monto < 0) { err.textContent = 'Poné el monto del gasto.'; return; }
      if (!arch) { err.textContent = 'Falta el ticket o comprobante de este gasto.'; return; }
      GASTOS.push({ concepto: desc, moneda: el('g_cur').value, monto: monto, archivo: arch });
      limpiarFormGasto();
      q('[data-gform]').style.display = 'none';
      q('[data-gasto-add]').style.display = '';
      pintarGastos();
    });
    pintarGastos();

    /* ---- comentario ---- */
    el('comentarios_pasajero').addEventListener('input', function () {
      q('[data-com-cnt]').textContent = String(this.value.length);
    });

    /* ---- documentos legales ---- */
    var docLinks = qa('[data-doc]');
    (function () {
      var i;
      for (i = 0; i < docLinks.length; i++) {
        docLinks[i].addEventListener('click', function (e) {
          /* El botón vive dentro del <label>: sin esto, abrir el documento
             tildaría el consentimiento sin que nadie lo lea. */
          e.preventDefault();
          e.stopPropagation();
          var d = DOCS[this.getAttribute('data-doc')];
          ovDoc.querySelector('[data-doc-title]').textContent = d.t;
          ovDoc.querySelector('[data-doc-body]').innerHTML = d.h;
          ovDoc.className = 'iw-ov iw-ov-doc iw-open';
        });
      }
    })();
    function cerrarDoc() { ovDoc.className = 'iw-ov iw-ov-doc'; }
    ovDoc.querySelector('[data-doc-close]').addEventListener('click', cerrarDoc);
    ovDoc.querySelector('[data-doc-ok]').addEventListener('click', cerrarDoc);
    ovDoc.addEventListener('click', function (e) { if (e.target === ovDoc) cerrarDoc(); });

    if (o.firma) {
      el('consent').addEventListener('change', function () {
        var caja = q('[data-cons-box]');
        caja.className = this.checked ? 'iw-cons iw-sel' : 'iw-cons';
        caja.style.borderColor = '';
      });
    }
    var noEnt = el('equipaje_no_entregado');
    if (noEnt) {
      noEnt.addEventListener('change', function () {
        q('[data-cons-noent]').className = this.checked ? 'iw-cons iw-sel' : 'iw-cons';
        el('fecha_entrega_equipaje').disabled = this.checked;
      });
    }

    /* ---- payload ---- */
    function filasDe(cont, dosCampos) {
      var out = [], rows = cont.querySelectorAll('.iw-row'), i;
      for (i = 0; i < rows.length; i++) {
        var ins = rows[i].querySelectorAll('.iw-in');
        var a = trim(ins[0] ? ins[0].value : '');
        var b = dosCampos ? trim(ins[1] ? ins[1].value : '') : '';
        if (a || b) out.push(dosCampos ? { nombre: a, documento: b } : a);
      }
      return out;
    }

    /* Puntos de la ruta en orden, con el IATA que dejó el combo de aeropuertos.
       El componente NO arma `segmentos`: eso depende de helpers que ya viven en cada
       superficie (metadatos del escaneo, tramo afectado). Acá se entrega la materia
       prima y cada una construye el contrato del motor con lo suyo. */
    function puntosRuta() {
      var nodo = function (n) {
        if (!n) return null;
        return { label: trim(n.value), iata: n.getAttribute('data-iata') || '' };
      };
      var pts = [], o1 = nodo(el('origen'));
      if (o1) pts.push(o1);
      if (OCULTOS.escalas === 'si') {
        var ins = armList.querySelectorAll('.iw-in'), i;
        for (i = 0; i < ins.length; i++) {
          var n = nodo(ins[i]);
          if (n && (n.label || n.iata)) pts.push(n);
        }
      }
      var d1 = nodo(el('destino'));
      if (d1) pts.push(d1);
      return pts;
    }

    function payload() {
      var esVuelo = OCULTOS.tipo_reclamo === 'vuelo';
      /* El nombre del comprobante se calcula ACÁ, sobre la lista ya cerrada.
         Numerar al agregar dejaba los nombres corridos si se borraba un gasto. */
      var items = [], i;
      for (i = 0; i < GASTOS.length; i++) {
        items.push({
          concepto: GASTOS[i].concepto,
          monto: GASTOS[i].monto,
          moneda: GASTOS[i].moneda,
          archivo: nombreGuardado(GASTOS[i], i),
          fuente: fuenteGastos,
        });
      }

      /* Un reclamo de vuelo que ADEMÁS trae equipaje es `vuelo_equipaje`, no `vuelo`.
         `derivarIncidentes()` (api/_utils/intake.js:168,184) decide por este campo qué
         familias de incidente deriva: con `vuelo` a secas, el incidente de equipaje del
         caso combinado no se derivaría nunca e `incidentes` —campo crítico del motor—
         saldría incompleto sin que falle nada a la vista. */
      var combinado = esVuelo && OCULTOS._combo_gate === 'si' && !!el('tipo_caso_equipaje').value;

      var p = {
        tipo_reclamo: combinado ? 'vuelo_equipaje' : (OCULTOS.tipo_reclamo || 'vuelo'),
        aerolinea: trim(el('aerolinea').value) || null,
        vuelo_nro: trim(el('vuelo_nro').value) || null,
        tipo_viaje: OCULTOS.tipo_viaje || null,
        direccion_afectada: OCULTOS.direccion_afectada || null,
        origen: trim(el('origen').value) || null,
        destino: trim(el('destino').value) || null,
        fecha_vuelo: el('fecha_vuelo').value || null,
        pnr: trim(el('pnr').value) || null,
        escalas: filasDe(armList, false),
        puntos_ruta: puntosRuta(),
        gastos_items: items,
        comentarios_pasajero: trim(el('comentarios_pasajero').value) || null,
        otros_archivos: (ARCHIVOS.otros || []).slice(0),
        tipo_incidencia: esVuelo ? (OCULTOS.tipo_incidencia || null) : null,
        horas_retraso: esVuelo ? aNumero(el('horas_retraso').value) : null,
        anticipacion_aviso: esVuelo ? (OCULTOS.anticipacion_aviso || null) : null,
        embarque_presentado: esVuelo ? (OCULTOS.embarque_presentado || null) : null,
        ofrecimiento_aerolinea: esVuelo ? (OCULTOS.ofrecimiento_aerolinea || null) : null,
        viajo_finalmente: esVuelo ? (OCULTOS.viajo_finalmente || null) : null,
        causa_informada: esVuelo ? (OCULTOS.causa_informada || null) : null,
        pasaje_alternativo_monto: null,
        pasaje_alternativo_moneda: null,
        tipo_caso_equipaje: null,
        fecha_entrega_equipaje: null,
        equipaje_no_entregado: false,
        valor_equipaje: null,
        pir_presentado: null,
        pir_numero: null,
        descripcion_equipaje: null,
      };

      if (esVuelo && OCULTOS.viajo_finalmente === 'medios_propios') {
        p.pasaje_alternativo_monto = aNumero(el('pasaje_alternativo_monto').value);
        p.pasaje_alternativo_moneda = el('pasaje_alternativo_moneda').value || null;
      }
      if (esVuelo && (OCULTOS.viajo_finalmente === 'reubicado' || OCULTOS.viajo_finalmente === 'medios_propios')) {
        p.horas_retraso = aNumero(el('viajo_horas').value);
      }

      if (!esVuelo) {
        p.tipo_caso_equipaje = OCULTOS.tipo_caso_equipaje || null;
        p.fecha_entrega_equipaje = el('fecha_entrega_equipaje').value || null;
        p.equipaje_no_entregado = !!(noEnt && noEnt.checked);
        p.valor_equipaje = aNumero(el('valor_equipaje').value);
        p.pir_presentado = OCULTOS.pir_presentado || null;
        p.pir_numero = trim(el('pir_numero').value) || null;
        p.descripcion_equipaje = trim(el('descripcion_equipaje').value) || null;
      } else if (OCULTOS._combo_gate === 'si') {
        /* Equipaje combinado en el mismo vuelo: usa los selects del paso `combo`. */
        p.tipo_caso_equipaje = el('tipo_caso_equipaje').value || null;
        p.pir_presentado = el('pir_presentado').value || null;
        p.descripcion_equipaje = trim(el('descripcion_equipaje_combo').value) || null;
      }

      if (o.acompanantes) p.acompanantes = filasDe(q('[data-acomp-list]'), true);
      if (o.datosPersonales) {
        p.nombre = trim(el('nombre').value) || null;
        p.telefono = trim(el('telefono').value) || null;
        p.email = trim(el('email').value) || null;
        p.documento_tipo = el('documento_tipo').value || null;
        p.documento_numero = trim(el('documento_numero').value) || null;
      }
      if (o.firma) {
        p.consent_tyc = !!el('consent').checked;
        p.consent_autorizacion = !!el('consent').checked;
        p.firma_ts = new Date().toISOString();
        p.user_agent = global.navigator ? global.navigator.userAgent : null;
      }
      return p;
    }

    /* ---- prellenado desde el escáner ---- */
    function prellenar(datos) {
      var mapa = ['aerolinea', 'vuelo_nro', 'origen', 'destino', 'fecha_vuelo', 'pnr',
        'nombre', 'telefono', 'email', 'documento_numero'];
      for (var i = 0; i < mapa.length; i++) {
        var n = el(mapa[i]);
        if (n && datos[mapa[i]]) n.value = datos[mapa[i]];
      }
      if (o.escaner) q('.iw-ms[data-ms="scan"]').setAttribute('data-escaneado', '1');
    }

    /* ---- envío ---- */
    function enviar() {
      if (S.enviando) return;
      var err = q('[data-envio-err]');
      err.textContent = '';
      if (typeof o.alEnviar !== 'function') { err.textContent = 'No hay a dónde enviar el caso.'; return; }
      S.enviando = true;
      btnSeguir.disabled = true;
      btnSeguir.textContent = 'Enviando...';
      o.alEnviar(payload(), function (e, res) {
        S.enviando = false;
        btnSeguir.disabled = false;
        if (e) {
          err.textContent = (e && e.message) ? e.message : 'No se pudo enviar el caso. Probá de nuevo.';
          pintar();
          return;
        }
        q('[data-done-id]').textContent = (res && res.ref_code) ? res.ref_code : '—';
        S.hist.push(S.cur);
        S.cur = 'done';
        S.dir = 'fwd';
        pintar();
      });
    }

    /* ---- abrir / cerrar ---- */
    function cerrarYa() {
      ov.className = 'iw-ov';
      ovCfm.className = 'iw-ov iw-ov-cfm';
      if (typeof o.alCerrar === 'function') o.alCerrar();
    }
    function intentarCerrar() {
      if (S.cur === 'done') { cerrarYa(); return; }
      ovCfm.className = 'iw-ov iw-ov-cfm iw-open';
    }
    q('[data-cerrar]').addEventListener('click', intentarCerrar);
    ov.addEventListener('click', function (e) { if (e.target === ov) intentarCerrar(); });
    ovCfm.querySelector('[data-cfm-no]').addEventListener('click', function () { ovCfm.className = 'iw-ov iw-ov-cfm'; });
    ovCfm.querySelector('[data-cfm-si]').addEventListener('click', cerrarYa);
    ovCfm.addEventListener('click', function (e) { if (e.target === ovCfm) ovCfm.className = 'iw-ov iw-ov-cfm'; });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (ovCfm.className.indexOf('iw-open') > -1) { ovCfm.className = 'iw-ov iw-ov-cfm'; return; }
      if (ovDoc.className.indexOf('iw-open') > -1) { cerrarDoc(); return; }
      if (ov.className.indexOf('iw-open') > -1) intentarCerrar();
    });

    pintar();

    /* ---- API pública ---- */
    return {
      abrir: function (valores) {
        ov.className = 'iw-ov iw-open';
        S.cur = 'tipo'; S.hist = []; S.dir = 'fwd'; S.enviando = false;
        if (valores) prellenar(valores);
        pintar();
      },
      cerrar: cerrarYa,
      payload: payload,
      elemento: ov,
      /* Para que la superficie sume archivos sin pasar por el click del dropzone. */
      agregarArchivo: agregarArchivo,
    };
  }

  global.IntakeWizard = { crear: crear, DDJJ: DDJJ };
})(typeof window !== 'undefined' ? window : this);
