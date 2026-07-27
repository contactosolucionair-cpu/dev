/**
 * cuentas.js — Helpers de alta/baja de cuentas de portal (agencias y abogados).
 *
 * Regla del negocio: un email = una cuenta. Supabase Auth ya impide dos usuarios
 * con el mismo email en todo el proyecto, pero las tablas `agencias` y `abogados`
 * no lo garantizaban por sí solas (ver migration_012.sql) y el alta de agencias
 * usaba /auth/v1/signup, que con "Confirm email" activado responde 200 con un
 * usuario OFUSCADO cuando el email ya existe — y eso generaba una segunda fila
 * con el mismo email. Por eso las altas van siempre por /auth/v1/admin/users,
 * que devuelve 422 limpio ante un duplicado.
 */

/**
 * ¿El email ya tiene una cuenta de portal? Chequea las DOS tablas, para poder
 * dar un mensaje claro ("ya existe una cuenta de abogado con ese email") en vez
 * del error genérico de Auth.
 *
 * @returns {Promise<{enUso: boolean, tabla: string|null}>}
 */
export async function emailEnUso(SB_URL, SB_KEY, email) {
  var headers = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
  var tablas = ['agencias', 'abogados'];

  for (var i = 0; i < tablas.length; i++) {
    var r = await fetch(
      SB_URL + '/rest/v1/' + tablas[i] + '?email=eq.' + encodeURIComponent(email) + '&select=id&limit=1',
      { headers: headers }
    );
    if (!r.ok) {
      console.error('[cuentas/emailEnUso] Error consultando ' + tablas[i] + ':', (await r.text()).substring(0, 200));
      continue; /* No bloqueamos el alta por un fallo de lectura: Auth y el índice UNIQUE siguen cubriendo. */
    }
    var rows;
    try { rows = JSON.parse(await r.text()); } catch (e) { rows = []; }
    if (Array.isArray(rows) && rows.length) return { enUso: true, tabla: tablas[i] };
  }
  return { enUso: false, tabla: null };
}

/** Mensaje de error uniforme según en qué tabla estaba el email. */
export function mensajeEmailEnUso(tabla) {
  if (tabla === 'agencias') return 'Ya existe una cuenta de agencia con ese email.';
  if (tabla === 'abogados') return 'Ya existe una cuenta de abogado con ese email.';
  return 'Ya existe una cuenta con ese email.';
}

/**
 * Crea el usuario en Supabase Auth ya confirmado. Devuelve {ok, id} o
 * {ok:false, duplicado, error}.
 */
export async function crearUsuarioAuth(SB_URL, SB_KEY, email, password) {
  var r = await fetch(SB_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    body: JSON.stringify({ email: email, password: password, email_confirm: true }),
  });
  var text = await r.text();
  var json;
  try { json = JSON.parse(text); } catch (e) { json = {}; }

  if (!r.ok) {
    var low = text.toLowerCase();
    var duplicado = r.status === 422 || low.indexOf('already') > -1 || low.indexOf('exists') > -1 || low.indexOf('registered') > -1;
    return { ok: false, duplicado: duplicado, error: json.msg || json.message || 'Error al crear el usuario.' };
  }

  var id = json.id || (json.user && json.user.id);
  if (!id) return { ok: false, duplicado: false, error: 'No se pudo obtener el ID de usuario.' };
  return { ok: true, id: id };
}

/**
 * Borra un usuario de Auth. Se usa como rollback cuando el INSERT en la tabla
 * de perfil falla después de haber creado el usuario: sin esto queda un usuario
 * huérfano con el email ocupado y ninguna fila que lo represente.
 * Best-effort: nunca rompe la respuesta del llamador.
 */
export async function borrarUsuarioAuth(SB_URL, SB_KEY, authUserId) {
  if (!authUserId) return false;
  try {
    var r = await fetch(SB_URL + '/auth/v1/admin/users/' + authUserId, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    });
    if (!r.ok) console.error('[cuentas/borrarUsuarioAuth] status:', r.status, (await r.text()).substring(0, 200));
    return r.ok;
  } catch (e) {
    console.error('[cuentas/borrarUsuarioAuth] Error:', e.message);
    return false;
  }
}

/** Cambia la contraseña de un usuario de Auth (reset asistido desde el backoffice). */
export async function resetPasswordAuth(SB_URL, SB_KEY, authUserId, password) {
  var r = await fetch(SB_URL + '/auth/v1/admin/users/' + authUserId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    body: JSON.stringify({ password: password }),
  });
  if (!r.ok) {
    console.error('[cuentas/resetPasswordAuth] status:', r.status, (await r.text()).substring(0, 200));
    return { ok: false, error: 'No se pudo actualizar la contraseña.' };
  }
  return { ok: true };
}
