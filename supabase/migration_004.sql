-- Migration 004: Alertas configurables + descarte manual por caso
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- Reglas de alerta (globales), guardadas en la config del sitio
ALTER TABLE site_config
  ADD COLUMN IF NOT EXISTS alertas_reglas JSONB;

-- Alertas descartadas manualmente por caso: array de { regla, fecha }
ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS alertas_descartadas JSONB DEFAULT '[]';
