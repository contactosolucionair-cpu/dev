-- Migration 002: Portal B2B de Agencias
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- ---- Tabla agencias ----
CREATE TABLE IF NOT EXISTS agencias (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    UUID UNIQUE,
  nombre          TEXT,
  tipo            TEXT CHECK (tipo IN ('agencia', 'individual')),
  cuit_dni        TEXT,
  email           TEXT,
  telefono        TEXT,
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activa', 'suspendida')),
  comision_pct    NUMERIC DEFAULT 10,
  aprobada_en     TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ DEFAULT now()
);

-- ---- Nuevas columnas en reclamos ----
ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS canal                        TEXT DEFAULT 'B2C',
  ADD COLUMN IF NOT EXISTS agencia_id                   UUID,
  ADD COLUMN IF NOT EXISTS agente_nombre                TEXT,
  ADD COLUMN IF NOT EXISTS agente_email                 TEXT,
  ADD COLUMN IF NOT EXISTS cliente_autorizacion_declarada BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS firma_estado                 TEXT DEFAULT 'no_aplica'
                             CHECK (firma_estado IN ('no_aplica','pendiente_envio','enviada','firmada','rechazada')),
  ADD COLUMN IF NOT EXISTS monto_compensacion           NUMERIC;

-- ---- Índices ----
CREATE INDEX IF NOT EXISTS idx_reclamos_agencia_id  ON reclamos (agencia_id);
CREATE INDEX IF NOT EXISTS idx_agencias_auth_user   ON agencias (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_agencias_estado      ON agencias (estado);
