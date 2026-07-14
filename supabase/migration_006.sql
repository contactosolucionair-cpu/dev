-- Migration 006: Generación de documentos legales (poder / patrocinio) en PDF
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- ---- Abogados: colegio de matrícula y domicilio (requeridos para el patrocinio) ----
ALTER TABLE abogados
  ADD COLUMN IF NOT EXISTS colegio    TEXT,
  ADD COLUMN IF NOT EXISTS domicilio  TEXT;

-- ---- Reclamos: datos del pasajero para el poder y el convenio de patrocinio ----
-- (documento_tipo/documento_numero y telefono ya existen y se reusan para
--  otorgante_documento y cliente_celular; no se duplican).
ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS cuil                  TEXT,
  ADD COLUMN IF NOT EXISTS fecha_nacimiento       DATE,
  ADD COLUMN IF NOT EXISTS domicilio_real         TEXT,
  ADD COLUMN IF NOT EXISTS pais_emisor            TEXT,
  ADD COLUMN IF NOT EXISTS id_fiscal_extranjero   TEXT;
