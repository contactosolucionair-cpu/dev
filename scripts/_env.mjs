/**
 * scripts/_env.mjs
 *
 * Validación del entorno compartida por los scripts que hablan con Supabase.
 *
 * Vive aparte a propósito: si esto estuviera dentro de backfill-iata.mjs, importarlo
 * arrastraría la indexación de los 6071 aeropuertos a scripts que no los necesitan.
 */

/**
 * Valida y normaliza SB_URL antes de la primera request. Sin esto, un typo termina en un
 * "Failed to parse URL" que no le dice a nadie qué corregir.
 * Corta el proceso con un mensaje concreto; devuelve la URL lista para usar.
 *
 * @param {string} url  SB_URL | SUPABASE_URL
 * @param {string} key  SB_KEY | SUPABASE_SERVICE_ROLE_KEY
 * @returns {string} la URL normalizada (sin barra final)
 */
export function validarSbUrl(url, key) {
  var morir = function (msg) { console.error('\n[env] ' + msg + '\n'); process.exit(1); };

  if (!url || !key) {
    morir('Faltan SB_URL / SB_KEY (o SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).\n'
      + '      PowerShell:  $env:SB_URL = "https://TU-REF.supabase.co"\n'
      + '                   $env:SB_KEY = "<service_role>"');
  }

  var u = String(url).trim().replace(/\/+$/, '');   // sin barra final

  if (!/^https?:\/\//i.test(u)) {
    morir('SB_URL sin esquema: "' + u + '".\n'
      + '      Tiene que empezar con https://  →  https://' + u);
  }
  if (/\.supabase\.com/i.test(u)) {
    morir('SB_URL apunta a .supabase.com y el dominio correcto es .supabase.co\n'
      + '      Probá:  ' + u.replace(/\.supabase\.com/i, '.supabase.co'));
  }
  if (/\/rest\/v1/i.test(u)) {
    morir('SB_URL no lleva el path: sacale /rest/v1 (los scripts lo agregan solos).\n'
      + '      Probá:  ' + u.replace(/\/rest\/v1.*$/i, ''));
  }
  return u;
}
