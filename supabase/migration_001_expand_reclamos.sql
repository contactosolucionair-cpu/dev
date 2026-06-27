-- Migration 001: Expand reclamos table with all structured columns
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)

ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS documento_tipo        TEXT,
  ADD COLUMN IF NOT EXISTS documento_numero      TEXT,
  ADD COLUMN IF NOT EXISTS origen                TEXT,
  ADD COLUMN IF NOT EXISTS destino               TEXT,
  ADD COLUMN IF NOT EXISTS pnr                   TEXT,
  ADD COLUMN IF NOT EXISTS tipo_incidencia       TEXT,
  ADD COLUMN IF NOT EXISTS horas_retraso         INTEGER,
  ADD COLUMN IF NOT EXISTS anticipacion_aviso    TEXT,
  ADD COLUMN IF NOT EXISTS ofrecimiento_aerolinea TEXT,
  ADD COLUMN IF NOT EXISTS causa_informada       TEXT,
  ADD COLUMN IF NOT EXISTS moneda_gastos         TEXT,
  ADD COLUMN IF NOT EXISTS monto_gastos          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS gastos_detalle        TEXT,
  ADD COLUMN IF NOT EXISTS info_extra            TEXT,
  ADD COLUMN IF NOT EXISTS fuente                TEXT DEFAULT 'Web',
  ADD COLUMN IF NOT EXISTS consent_version       TEXT,
  ADD COLUMN IF NOT EXISTS consent_tyc           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_autorizacion  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS firma_fecha           TEXT,
  ADD COLUMN IF NOT EXISTS firma_ts              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_agent            TEXT,
  ADD COLUMN IF NOT EXISTS ip_firmante           TEXT,
  ADD COLUMN IF NOT EXISTS adjuntos              JSONB DEFAULT '[]';

-- Backfill existing rows: move structured fields out of ai_raw into columns
UPDATE reclamos
SET
  origen           = ai_raw->>'origen',
  destino          = ai_raw->>'destino',
  pnr              = ai_raw->>'pnr',
  documento_tipo   = ai_raw->>'doc_tipo',
  documento_numero = ai_raw->>'doc_numero',
  tipo_incidencia  = ai_raw->>'incidencia',
  horas_retraso    = NULLIF(ai_raw->>'delay_hours', '')::INTEGER,
  anticipacion_aviso    = ai_raw->>'notificacion',
  ofrecimiento_aerolinea = ai_raw->>'reembolso',
  causa_informada  = ai_raw->>'causa',
  moneda_gastos    = ai_raw->>'moneda',
  monto_gastos     = NULLIF(ai_raw->>'gastos_monto', '')::NUMERIC,
  gastos_detalle   = ai_raw->>'gastos_detalle'
WHERE ai_raw IS NOT NULL;

-- Clean up ai_raw: keep only porcentaje_exito (and any future AI-specific data)
UPDATE reclamos
SET ai_raw = jsonb_build_object('porcentaje_exito', ai_raw->'porcentaje_exito')
WHERE ai_raw IS NOT NULL;
