/**
 * GASTOS ITEMIZADOS — normalización y espejo derivado.
 *
 * `gastos_items` es el CANÓNICO: `[{concepto, monto, moneda, fecha, archivo, fuente}]`.
 * `monto_gastos` / `moneda_gastos` son un ESPEJO DERIVADO: no se editan directo, se
 * reescriben con la suma de la moneda dominante en el MISMO write que toca el canónico
 * (mismo patrón que `estado` ← `instanciaAEstadoLegacy()`).
 *
 * Este módulo existe porque el espejo se escribe desde TRES lugares —alta pública
 * (`process-ticket`), alta por agencia (`agency`) y edición de datos legales
 * (`update-ticket`)— y tenerlo triplicado es exactamente la clase de divergencia que
 * ya costó cara en este repo. Una sola implementación, tres llamadas.
 *
 * Contexto de por qué importa: el motor legal cuenta `gastos_items.length` como insumo
 * del nodo de suficiencia probatoria. Escribir solo el espejo deja el canónico vacío y
 * el caso se evalúa como si el pasajero no hubiera declarado ningún gasto.
 */

function aTexto(v) {
  var s = (v === null || v === undefined) ? '' : String(v).trim();
  return s === '' ? null : s;
}

function aNumero(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = parseFloat(v);
  return isFinite(n) && n >= 0 ? n : null;
}

/* La moneda se normaliza a mayúsculas SIEMPRE: el espejo agrupa por este string, y sin
   normalizar 'EUR' y 'eur' contarían como dos monedas y la dominante saldría mal. */
function aMoneda(v) {
  var s = aTexto(v);
  return s ? s.toUpperCase() : null;
}

function aFecha(v) {
  var s = aTexto(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
}

/**
 * Normaliza un array crudo de gastos al contrato de `gastos_items`.
 * Descarta los ítems sin monto: un gasto sin importe no es un gasto.
 *
 * @param {*} raw            lo que llegó en el body
 * @param {string} fuenteDef procedencia por defecto ('admin', 'declaracion_pasajero', 'agencia')
 * @returns {Array}
 */
export function normalizarGastosItems(raw, fuenteDef) {
  return (Array.isArray(raw) ? raw : [])
    .map(function (g) {
      return {
        concepto: aTexto(g && g.concepto),
        monto: aNumero(g && g.monto),
        moneda: aMoneda(g && g.moneda),
        fecha: aFecha(g && g.fecha),
        archivo: aTexto(g && g.archivo),
        fuente: aTexto(g && g.fuente) || fuenteDef || 'admin',
      };
    })
    .filter(function (g) { return g.monto != null; });
}

/**
 * Calcula el espejo derivado a partir de los ítems ya normalizados.
 *
 * Con varias monedas el espejo solo puede reflejar una: se elige la de mayor suma. Eso
 * NO pierde información, porque el detalle completo vive en `gastos_items`.
 *
 * @returns {{monto_gastos: number|null, moneda_gastos: string|null}}
 */
export function espejoDeGastos(items) {
  var porMoneda = {};
  (items || []).forEach(function (g) {
    var m = g.moneda || 'ARS';
    porMoneda[m] = (porMoneda[m] || 0) + g.monto;
  });
  var dominante = null;
  Object.keys(porMoneda).forEach(function (m) {
    if (dominante === null || porMoneda[m] > porMoneda[dominante]) dominante = m;
  });
  return {
    monto_gastos: dominante ? Math.round(porMoneda[dominante] * 100) / 100 : null,
    moneda_gastos: dominante,
  };
}

/**
 * Escribe canónico + espejo sobre `destino`, en el mismo objeto que va a la base.
 * Es la única forma correcta de tocar gastos: nunca setear el espejo por separado.
 *
 * @param {object} destino   fila que se va a insertar o patchear (se muta)
 * @param {*} raw            array crudo de gastos
 * @param {string} fuenteDef procedencia por defecto
 * @returns {Array} los ítems normalizados que quedaron
 */
export function aplicarGastos(destino, raw, fuenteDef) {
  var items = normalizarGastosItems(raw, fuenteDef);
  var espejo = espejoDeGastos(items);
  destino.gastos_items = items;
  destino.monto_gastos = espejo.monto_gastos;
  destino.moneda_gastos = espejo.moneda_gastos;
  return items;
}
