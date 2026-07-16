/**
 * Modelo de 4 dimensiones para el ciclo de vida de un caso (reclamos):
 * instancia + momento + esperas + circuito de cobro.
 *
 * El campo `estado` legacy se mantiene con doble escritura porque
 * panel-agencia.html lo lee crudo y panel-abogado.html lo escribe vía
 * api/abogados.js?action=update-estado. Este módulo centraliza el mapping
 * directo (estado legacy -> instancia/momento) e inverso (instancia/momento
 * -> estado legacy) para que ambos lados queden siempre consistentes.
 */

/* ---- Mapping directo: estado legacy -> {instancia, momento} ---- */
export var ESTADO_A_INSTANCIA = {
  pendiente:                  { instancia: 'evaluacion', momento: null },
  en_revision:                { instancia: 'evaluacion', momento: null },
  esperando_info:             { instancia: 'evaluacion', momento: null },
  autorizacion_pendiente:     { instancia: 'evaluacion', momento: null },
  en_gestion:                 { instancia: 'reclamo_directo', momento: 'preparacion' },
  reclamado_aerolinea:        { instancia: 'reclamo_directo', momento: 'presentado' },
  negociacion:                { instancia: 'reclamo_directo', momento: 'respuesta_recibida' },
  rechazado_aerolinea:        { instancia: 'reclamo_directo', momento: 'respuesta_recibida' },
  rechazado:                  { instancia: 'reclamo_directo', momento: 'respuesta_recibida' },
  derivado_mediacion:         { instancia: 'mediacion', momento: 'preparacion' },
  mediacion_notificada:       { instancia: 'mediacion', momento: 'presentado' },
  en_mediacion:               { instancia: 'mediacion', momento: 'presentado' },
  acuerdo:                    { instancia: 'cobro', momento: null },
  cobro_pasajero_pendiente:   { instancia: 'cobro', momento: null },
  cobro_comision_pendiente:   { instancia: 'cobro', momento: null },
  cerrado:                    { instancia: 'cerrado', momento: null, resultado: 'exito' },
  aprobado:                   { instancia: 'cerrado', momento: null, resultado: 'exito' },
  resuelto:                   { instancia: 'cerrado', momento: null, resultado: 'exito' },
  sin_exito:                  { instancia: 'cerrado', momento: null, resultado: 'sin_exito' },
  no_apto:                    { instancia: 'cerrado', momento: null, resultado: 'no_apto' },
  cancelado:                  { instancia: 'cerrado', momento: null, resultado: 'abandonado' },
};

/**
 * Deriva {instancia, momento} desde un caso. Si el caso ya tiene `instancia`
 * seteada (columna nueva) se usa tal cual; si es null (migración SQL corrida
 * después del deploy del código, o antes de que exista), se deriva del
 * `estado` legacy.
 */
export function getInstancia(c) {
  if (c && c.instancia) return { instancia: c.instancia, momento: c.momento || null };
  var mapped = ESTADO_A_INSTANCIA[(c && c.estado) || 'pendiente'];
  return mapped ? { instancia: mapped.instancia, momento: mapped.momento } : { instancia: 'evaluacion', momento: null };
}

/**
 * Mapping inverso: instancia/momento (+resultado si instancia='cerrado') -> estado legacy.
 */
export function instanciaAEstadoLegacy(instancia, momento, resultado) {
  if (instancia === 'evaluacion') return 'pendiente';
  if (instancia === 'reclamo_directo') {
    if (momento === 'preparacion') return 'en_gestion';
    if (momento === 'presentado') return 'reclamado_aerolinea';
    if (momento === 'respuesta_recibida') return 'negociacion';
    return 'en_gestion';
  }
  if (instancia === 'mediacion') {
    if (momento === 'preparacion') return 'derivado_mediacion';
    if (momento === 'presentado') return 'mediacion_notificada';
    if (momento === 'respuesta_recibida') return 'en_mediacion';
    return 'derivado_mediacion';
  }
  if (instancia === 'cobro') return 'acuerdo';
  if (instancia === 'cerrado') {
    if (resultado === 'sin_exito') return 'sin_exito';
    if (resultado === 'no_apto') return 'no_apto';
    if (resultado === 'abandonado') return 'cancelado';
    return 'cerrado';
  }
  return 'pendiente';
}

/* ---- Tabla de transiciones válidas ---- */
/* Cada transición: { from: {instancia, momento|null}, to: {instancia, momento|null},
   requires: [campos obligatorios en el body], closes: resultado si es un cierre } */
export var TRANSICIONES = {
  evaluacion: {
    iniciar_reclamo: { to: { instancia: 'reclamo_directo', momento: 'preparacion' } },
    no_apto:         { to: { instancia: 'cerrado', momento: null }, closes: 'no_apto', requiresMotivo: true },
    abandonar:       { to: { instancia: 'cerrado', momento: null }, closes: 'abandonado', requiresMotivo: true },
  },
  'reclamo_directo/preparacion': {
    presentar:  { to: { instancia: 'reclamo_directo', momento: 'presentado' } },
    abandonar:  { to: { instancia: 'cerrado', momento: null }, closes: 'abandonado', requiresMotivo: true },
  },
  'reclamo_directo/presentado': {
    respuesta_recibida: { to: { instancia: 'reclamo_directo', momento: 'respuesta_recibida' } },
    vencio_plazo:       { to: { instancia: 'reclamo_directo', momento: 'respuesta_recibida' }, novedad: 'Plazo vencido sin respuesta' },
    acuerdo:             { to: { instancia: 'cobro', momento: null }, requires: ['monto_acordado'] },
    abandonar:           { to: { instancia: 'cerrado', momento: null }, closes: 'abandonado', requiresMotivo: true },
  },
  'reclamo_directo/respuesta_recibida': {
    volver_a_presentar: { to: { instancia: 'reclamo_directo', momento: 'presentado' } },
    escalar_mediacion:  { to: { instancia: 'mediacion', momento: 'preparacion' } },
    acuerdo:             { to: { instancia: 'cobro', momento: null }, requires: ['monto_acordado'] },
    cerrar_sin_exito:    { to: { instancia: 'cerrado', momento: null }, closes: 'sin_exito', requiresMotivo: true },
    abandonar:           { to: { instancia: 'cerrado', momento: null }, closes: 'abandonado', requiresMotivo: true },
  },
  'mediacion/preparacion': {
    presentar:         { to: { instancia: 'mediacion', momento: 'presentado' } },
    cerrar_sin_exito:  { to: { instancia: 'cerrado', momento: null }, closes: 'sin_exito', requiresMotivo: true },
    abandonar:         { to: { instancia: 'cerrado', momento: null }, closes: 'abandonado', requiresMotivo: true },
  },
  'mediacion/presentado': {
    respuesta_recibida: { to: { instancia: 'mediacion', momento: 'respuesta_recibida' } },
    acuerdo:             { to: { instancia: 'cobro', momento: null }, requires: ['monto_acordado'] },
    cerrar_sin_exito:    { to: { instancia: 'cerrado', momento: null }, closes: 'sin_exito', requiresMotivo: true },
    abandonar:           { to: { instancia: 'cerrado', momento: null }, closes: 'abandonado', requiresMotivo: true },
  },
  'mediacion/respuesta_recibida': {
    volver_a_presentar: { to: { instancia: 'mediacion', momento: 'presentado' } },
    acuerdo:             { to: { instancia: 'cobro', momento: null }, requires: ['monto_acordado'] },
    cerrar_sin_exito:    { to: { instancia: 'cerrado', momento: null }, closes: 'sin_exito', requiresMotivo: true },
    abandonar:           { to: { instancia: 'cerrado', momento: null }, closes: 'abandonado', requiresMotivo: true },
  },
  cobro: {
    cerrar_exito:     { to: { instancia: 'cerrado', momento: null }, closes: 'exito' },
    cerrar_sin_exito: { to: { instancia: 'cerrado', momento: null }, closes: 'sin_exito', requiresMotivo: true },
  },
};

/** Clave de lookup en TRANSICIONES para una posición {instancia, momento}. */
export function posicionKey(instancia, momento) {
  if (instancia === 'reclamo_directo' || instancia === 'mediacion') return instancia + '/' + (momento || '');
  return instancia;
}

/**
 * Valida una transición. Devuelve {ok:true, def} o {ok:false, error}.
 * `abandonar` está disponible desde cualquier instancia no cerrada, incluso si
 * no aparece explícitamente en la tabla para esa posición (evaluacion no tiene
 * momento, reclamo_directo/mediacion en cualquier momento).
 */
export function validarTransicion(instanciaActual, momentoActual, transicion) {
  if (instanciaActual === 'cerrado') return { ok: false, error: 'El caso ya está cerrado.' };
  var key = posicionKey(instanciaActual, momentoActual);
  var tabla = TRANSICIONES[key];
  if (!tabla && transicion === 'abandonar') {
    tabla = { abandonar: { to: { instancia: 'cerrado', momento: null }, closes: 'abandonado', requiresMotivo: true } };
  }
  if (!tabla || !tabla[transicion]) {
    return { ok: false, error: 'Transición "' + transicion + '" no válida desde ' + key + '.' };
  }
  return { ok: true, def: tabla[transicion] };
}

export var MOTIVOS_CIERRE = [
  'rechazo_definitivo', 'monto_inviable', 'documentacion_insuficiente', 'no_elegible',
  'prescripto', 'pasajero_no_responde', 'desistimiento_pasajero', 'aerolinea_no_pago', 'otro',
];

export var TIPOS_ESPERA = ['info_pasajero', 'firma_documento', 'requerimiento_aerolinea', 'audiencia', 'accion_interna'];
export var RESPONSABLES_ESPERA = ['solucionair', 'pasajero', 'aerolinea', 'abogado', 'mediador'];

export var INSTANCIAS_VALIDAS = ['evaluacion', 'reclamo_directo', 'mediacion', 'cobro', 'cerrado'];
export var MOMENTOS_VALIDOS = ['preparacion', 'presentado', 'respuesta_recibida'];
export var RESULTADOS_VALIDOS = ['exito', 'sin_exito', 'no_apto', 'abandonado'];
