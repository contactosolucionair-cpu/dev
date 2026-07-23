/**
 * cliente-auth.js — Helper compartido para endpoints del portal del cliente
 * (api/my-claims.js, api/my-actions.js).
 *
 * Valida el JWT del header Authorization contra Supabase Auth y devuelve el
 * email autenticado. El email SIEMPRE sale del token validado, nunca de query
 * params ni del body.
 *
 * @param {Request} req
 * @param {string} SB_URL
 * @param {string} SB_KEY  (service role key — solo como apikey de la validación)
 * @returns {string|null} email en minúsculas, o null si el token es inválido
 */
export async function verifyClienteEmail(req, SB_URL, SB_KEY) {
  var auth = (req.headers['authorization'] || '').trim();
  if (!auth.startsWith('Bearer ')) return null;
  var token = auth.slice(7).trim();
  if (!token) return null;

  var userRes = await fetch(SB_URL + '/auth/v1/user', {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + token },
  });
  if (!userRes.ok) return null;

  var userJson;
  try { userJson = JSON.parse(await userRes.text()); } catch (e) { return null; }
  var email = (userJson && userJson.email) ? String(userJson.email).trim().toLowerCase() : '';
  return email || null;
}
