-- Migration 011: captura la columna deleted_at (soft-delete de reclamos).
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- Contexto: deleted_at se usa desde hace tiempo como señal de papelera, pero
-- había sido creada a mano en prod y NUNCA quedó en un archivo de migración,
-- así que una base reconstruida desde las migraciones (p. ej. staging) no la
-- tenía. El código actual filtra y escribe deleted_at directamente
-- (api/delete-ticket.js, agency/stats, abogados/claims, my-claims, my-actions),
-- por lo que la columna es requerida. Idempotente.

ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
