-- Migration 007: Detalle de requerimiento, montos de reclamo/acuerdo,
-- y rename de estado 'rechazado' -> 'rechazado_aerolinea' (+ nuevo 'sin_exito').
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- ---- Requerimiento de la aerolínea: detalle de qué se pidió ----
ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS requerimiento_detalle TEXT;

-- ---- Montos asociados a cambios de estado ----
ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS monto_reclamado NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS monto_acordado  NUMERIC(12,2);

-- ---- Rename de estado: 'rechazado' -> 'rechazado_aerolinea' ----
-- Actualiza el estado actual de los casos existentes.
UPDATE reclamos SET estado = 'rechazado_aerolinea' WHERE estado = 'rechazado';

-- Actualiza también las entradas históricas dentro de estado_historial
-- (para que la bitácora no muestre el valor viejo).
UPDATE reclamos
SET estado_historial = COALESCE((
  SELECT jsonb_agg(
    CASE WHEN (elem->>'estado') = 'rechazado'
         THEN elem || jsonb_build_object('estado', 'rechazado_aerolinea')
         ELSE elem END
  )
  FROM jsonb_array_elements(estado_historial) AS elem
), '[]'::jsonb)
WHERE estado_historial IS NOT NULL AND estado_historial::text LIKE '%"rechazado"%';
