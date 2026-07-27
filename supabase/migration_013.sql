-- Migration 013: recordatorios ad-hoc por caso.
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- Un recordatorio es una nota con fecha que uno se pone sobre UN caso puntual
-- ("avisame en 4 días que pase a mediación"). No es una regla de alerta (esas son
-- globales, automáticas y sin texto libre) ni una espera: una espera significa
-- "estoy bloqueado esperando a alguien" y desde el fix de la pelota mueve el
-- responsable del caso, cosa que un recordatorio propio NO debe hacer.
--
-- Formato de cada elemento: { id, texto, vence, creado, hecho }
--   id     TEXT   identificador local ('r' + base36)
--   texto  TEXT   qué hay que hacer
--   vence  DATE   cuándo avisar (ISO 'YYYY-MM-DD')
--   creado TIMESTAMPTZ
--   hecho  TIMESTAMPTZ | null   fecha en que se marcó cumplido

ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS recordatorios JSONB DEFAULT '[]';
