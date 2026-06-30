/**
 * abogado-auth.js — Helper compartido para endpoints /api/abogados/*
 *
 * Valida el JWT del header Authorization, verifica que el usuario tenga una
 * fila en `abogados` con estado 'activa', y la devuelve.
 *
 * @returns {Object|null} fila de abogados o null si no autorizado
 */
export async function verifyAbogado(req, SB_URL, SB_KEY) {
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
  var userId = userJson.id;
  if (!userId) return null;

  var agRes = await fetch(
    SB_URL + '/rest/v1/abogados?auth_user_id=eq.' + userId + '&estado=eq.activa&limit=1',
    { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
  );
  if (!agRes.ok) return null;

  var rows;
  try { rows = JSON.parse(await agRes.text()); } catch (e) { return null; }
  return (rows && rows.length) ? rows[0] : null;
}
