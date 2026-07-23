-- Migration 010: Comisiones parametrizables por agencia.
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- Nota: el prompt original mencionaba "migration_009.sql", pero 009 ya existía
-- (formulario por incidencia, ya ejecutada). Esta migración usa el número 010.
--
-- comision_modo:
--   por_exito       -> comisión = comision_pct % sobre monto_acordado (default).
--   por_caso_viable -> comisión = comision_valor_fijo por cada caso que superó
--                      la evaluación (instancia != evaluacion y, si cerrado,
--                      resultado != no_apto).
--   mixta           -> suma de ambos criterios.

ALTER TABLE agencias
  ADD COLUMN IF NOT EXISTS comision_modo TEXT NOT NULL DEFAULT 'por_exito'
    CHECK (comision_modo IN ('por_exito','por_caso_viable','mixta')),
  ADD COLUMN IF NOT EXISTS comision_valor_fijo NUMERIC DEFAULT 0;
