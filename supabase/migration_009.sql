-- Migration 009: Formulario por tipo de incidencia + documentos múltiples +
-- vía organismo + monedas de reclamo/acuerdo.
-- Sin migración de datos: los valores viejos de anticipacion_aviso (texto libre
-- del form público; sin_aviso/menos_14/14_a_21/mas_21 de agencias) y de
-- ofrecimiento_aerolinea (si/no; ninguno/voucher/reembolso/reembolso_total de
-- agencias) NO se transforman — el backoffice los muestra con un diccionario de
-- etiquetas que cubre valores viejos y nuevos (fallback: valor crudo).
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query).

ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS documentos              JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS viajo_finalmente        TEXT,   -- reubicado | medios_propios | no_viajo
  ADD COLUMN IF NOT EXISTS embarque_presentado     TEXT,   -- si | no
  ADD COLUMN IF NOT EXISTS pir_presentado          TEXT,   -- si | no | no_sabe
  ADD COLUMN IF NOT EXISTS pir_numero              TEXT,
  ADD COLUMN IF NOT EXISTS equipaje_no_entregado   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pasaje_alternativo_monto  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS pasaje_alternativo_moneda TEXT,
  ADD COLUMN IF NOT EXISTS monto_reclamado_moneda  TEXT,
  ADD COLUMN IF NOT EXISTS monto_acordado_moneda   TEXT,
  ADD COLUMN IF NOT EXISTS via_reclamo             TEXT DEFAULT 'aerolinea',  -- aerolinea | organismo
  ADD COLUMN IF NOT EXISTS organismo               TEXT;
