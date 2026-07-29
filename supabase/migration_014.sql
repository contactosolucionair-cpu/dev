-- Migration 014: estado de firma de los T&C + autorización pendiente por default.
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- Contexto: los T&C sólo quedaban firmados cuando el caso entraba por el formulario
-- público (index.html), donde el pasajero tilda la aceptación y se genera el PDF de
-- constancia. Los casos cargados por nosotros (backoffice) o por una agencia nunca
-- pasan por ese click: no hay T&C firmados y hasta ahora el sistema no lo sabía.
--
-- `tyc_estado` usa el MISMO vocabulario que `firma_estado` (la autorización/poder) a
-- propósito: son dos documentos que siguen el mismo circuito —generar, mandar a
-- firmar, recibir firmado— y compartir vocabulario deja una sola validación, una
-- sola tabla de labels y una sola regla de alerta parametrizada por columna.
--
-- Backfill: esto aplica sólo a los casos NUEVOS. Las filas que ya existen quedan
-- 'firmada' si el pasajero aceptó online, y 'no_aplica' si no (así no se llena el
-- panel de alertas con casos viejos que ya se gestionaron a mano).

ALTER TABLE reclamos ADD COLUMN IF NOT EXISTS tyc_estado TEXT;

UPDATE reclamos
SET tyc_estado = CASE WHEN consent_tyc IS TRUE THEN 'firmada' ELSE 'no_aplica' END
WHERE tyc_estado IS NULL;

ALTER TABLE reclamos ALTER COLUMN tyc_estado SET DEFAULT 'pendiente_envio';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reclamos_tyc_estado_check') THEN
    ALTER TABLE reclamos ADD CONSTRAINT reclamos_tyc_estado_check
      CHECK (tyc_estado IN ('no_aplica','pendiente_envio','enviada','firmada','rechazada'));
  END IF;
END $$;

-- La autorización pasa a estar pendiente por default: si un caso no la necesita, se
-- marca 'no_aplica' a mano desde el backoffice. Antes era al revés (default
-- 'no_aplica') y un caso cargado por nosotros nunca avisaba que faltaba el poder.
-- Sólo cambia el default: las filas existentes conservan el estado que tengan.
ALTER TABLE reclamos ALTER COLUMN firma_estado SET DEFAULT 'pendiente_envio';
