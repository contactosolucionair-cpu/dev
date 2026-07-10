-- Migration 005: Requerimiento pendiente de la aerolínea (info complementaria / subsanación)
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query)

ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS requerimiento_tipo TEXT,
  ADD COLUMN IF NOT EXISTS requerimiento_fecha TIMESTAMPTZ;
