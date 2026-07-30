/**
 * api/_utils/config-publica.js
 *
 * Lectura de `site_config` para el navegador, con WHITELIST.
 *
 * `site_config` es la fila de configuración global del sitio y puede tener adentro
 * cosas que no deben viajar al cliente (reglas de alerta del backoffice, y lo que se
 * agregue mañana). Por eso el front nunca recibe la fila: recibe únicamente las claves
 * enumeradas acá, y el filtro se hace en el servidor.
 *
 * Para publicar un flag nuevo hay que agregarlo a FLAGS_PUBLICOS a propósito. Un flag
 * que no está en la lista simplemente no existe para el navegador.
 */

/**
 * Flags que el front puede conocer.
 *
 *   clave  → nombre en site_config.feature_flags
 *   porDefecto → qué se asume si la fila no existe, no responde, o no trae la clave
 *
 * `ai_extraction` va en true por defecto y eso es deliberado: es el comportamiento
 * histórico del sitio. Si la config no se puede leer, el formulario muestra el scanner
 * como siempre; el backstop real está en `process-ticket.js`, que vuelve a leer el flag
 * del lado del servidor antes de gastar un llamado al modelo. Degradar mostrando de
 * más nunca deja al pasajero sin su paso 1; degradar ocultando, sí.
 */
export var FLAGS_PUBLICOS = [
  { clave: 'ai_extraction', porDefecto: true },
];

/** Los valores por defecto, sin tocar la red. Es lo que se sirve si algo falla. */
export function flagsPorDefecto() {
  var out = {};
  FLAGS_PUBLICOS.forEach(function (f) { out[f.clave] = f.porDefecto; });
  return out;
}

/**
 * Lee `site_config.feature_flags` y devuelve SOLO las claves de la whitelist.
 * Nunca lanza ni rechaza: ante cualquier problema devuelve los valores por defecto.
 *
 * @param {string} sbUrl  SUPABASE_URL
 * @param {string} sbKey  service role key (se usa server-side, nunca viaja)
 * @returns {Promise<Object>} p.ej. { ai_extraction: true }
 */
export async function leerFlagsPublicos(sbUrl, sbKey) {
  var out = flagsPorDefecto();
  if (!sbUrl || !sbKey) return out;
  try {
    var r = await fetch(sbUrl + '/rest/v1/site_config?id=eq.global&select=feature_flags&limit=1', {
      headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey },
    });
    if (!r.ok) return out;
    var filas = JSON.parse(await r.text());
    var ff = (filas && filas.length && filas[0].feature_flags) ? filas[0].feature_flags : null;
    if (!ff || typeof ff !== 'object') return out;
    FLAGS_PUBLICOS.forEach(function (f) {
      /* Solo `false` explícito apaga un flag que por defecto está prendido: un valor
         raro o ausente no debería cambiar el comportamiento del sitio. */
      if (f.porDefecto === true) out[f.clave] = ff[f.clave] !== false;
      else out[f.clave] = ff[f.clave] === true;
    });
    return out;
  } catch (e) {
    return out;
  }
}
