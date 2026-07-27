-- Migration 012: un email = una cuenta (agencias y abogados).
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- Contexto: `agencias` y `abogados` sólo tenían UNIQUE en auth_user_id, nunca en
-- email. Combinado con el alta de agencias vía /auth/v1/signup (que con "Confirm
-- email" ACTIVADO devuelve 200 con un usuario ofuscado cuando el email ya existe),
-- eso permitía crear dos filas distintas con el mismo email. El código ya no usa
-- signup (ver api/_utils/cuentas.js), y este índice lo garantiza a nivel base.
--
-- ANTES DE CORRER: verificá que no haya duplicados. Si esta consulta devuelve
-- filas, resolvelas primero — el CREATE INDEX de abajo va a fallar (sin efecto).
--
--   SELECT lower(email) AS email, count(*), array_agg(id) AS ids
--   FROM agencias WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1
--   UNION ALL
--   SELECT lower(email), count(*), array_agg(id)
--   FROM abogados WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agencias_email_unico
  ON agencias (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_abogados_email_unico
  ON abogados (lower(email))
  WHERE email IS NOT NULL;
