-- Migration 003: Acompañantes, reclamo combinado vuelo+equipaje, historial de estados,
-- datos de mediación y tabla de abogados (portal de abogados).
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- ---- Nuevas columnas en reclamos ----
ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS acompanantes          JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS estado_historial      JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS abogado_id            UUID,
  ADD COLUMN IF NOT EXISTS fecha_mediacion        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultimo_update_cliente  TIMESTAMPTZ;

-- acompanantes: array de objetos
--   { nombre, documento_tipo, documento_numero, es_menor, equipaje }
--   donde equipaje = { tipo, descripcion, valor } (solo en reclamos de equipaje) o null.
-- estado_historial: array de { estado, fecha, por }  (por: 'admin' | 'abogado' | 'sistema').

-- ---- Tabla abogados (portal de abogados, usado en fases 2 y 3) ----
CREATE TABLE IF NOT EXISTS abogados (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID UNIQUE,
  nombre        TEXT,
  matricula     TEXT,
  email         TEXT,
  telefono      TEXT,
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activa', 'suspendida')),
  aprobada_en   TIMESTAMPTZ,
  creado_en     TIMESTAMPTZ DEFAULT now()
);

-- ---- Índices ----
CREATE INDEX IF NOT EXISTS idx_reclamos_abogado_id ON reclamos (abogado_id);
CREATE INDEX IF NOT EXISTS idx_abogados_auth_user  ON abogados (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_abogados_estado     ON abogados (estado);
