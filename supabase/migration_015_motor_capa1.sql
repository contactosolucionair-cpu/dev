-- Migration 015: Motor Legal Capa 1 — campos del contrato de entrada + salida del análisis.
-- Correr en Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- Contexto: el motor determinista (docs/Capa_1_-_Logica_legal_determinista_v2.1.md +
-- docs/motor-capa1-contratos.md) lee una CAPA CANÓNICA de columnas escalares —un solo
-- valor por campo— y una CAPA DE EVIDENCIA (datos_extraidos) con los candidatos y su
-- procedencia. Esta migración crea las dos, más la columna de salida (analisis_legal).
--
-- Todo es ADITIVO: ninguna columna existente se renombra, borra ni cambia de semántica.
-- `estado`, `tipo_reclamo`, `tipo_incidencia`, `origen`, `destino`, `monto_gastos` y
-- `moneda_gastos` siguen escribiéndose y leyéndose exactamente como hoy.
--
-- Espejo derivado: `gastos_items` es el canónico itemizado; `monto_gastos`/`moneda_gastos`
-- pasan a ser un ESPEJO que se reescribe con la suma en el mismo PATCH que toca
-- `gastos_items` (mismo patrón que `estado` ← instanciaAEstadoLegacy). Se conservan
-- porque la UI actual (panel-agencia, backoffice, perfil) los lee sin cambios.
--
-- Nombres de columnas: el documento de contratos §1.2/§3 nombraba `gastos_monto`,
-- `gastos_moneda` e `incidencia_detectada`, que NO son columnas de `reclamos` sino
-- claves del JSON que devuelve la extracción con IA. Las columnas reales son
-- `monto_gastos`, `moneda_gastos` y `tipo_incidencia` (migration_001). Discrepancia
-- reportada y resuelta (D1/D2); los documentos rectores se corrigen en el cierre del ciclo.
--
-- Sin índices nuevos: el motor lee por caso (id), no filtra por estos campos.

ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS origen_iata           TEXT,
  ADD COLUMN IF NOT EXISTS destino_iata          TEXT,
  ADD COLUMN IF NOT EXISTS segmentos             JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS billete_unico         BOOLEAN,
  ADD COLUMN IF NOT EXISTS incidentes            JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS demora_salida_min     INTEGER,
  ADD COLUMN IF NOT EXISTS demora_llegada_min    INTEGER,
  ADD COLUMN IF NOT EXISTS antelacion_aviso_dias NUMERIC,
  ADD COLUMN IF NOT EXISTS reencaminamiento      JSONB,
  ADD COLUMN IF NOT EXISTS atencion_ofrecida     JSONB,
  ADD COLUMN IF NOT EXISTS fecha_incidente       DATE,
  ADD COLUMN IF NOT EXISTS causa_alegada         TEXT,
  ADD COLUMN IF NOT EXISTS protesta              JSONB,
  ADD COLUMN IF NOT EXISTS checkin_presentacion  TEXT,
  ADD COLUMN IF NOT EXISTS comentarios_pasajero  TEXT,
  ADD COLUMN IF NOT EXISTS gastos_items          JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS datos_extraidos       JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS campos_meta           JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS analisis_legal        JSONB;

-- ------------------------------------------------------------------
-- Backfill 1: fecha del incidente
-- ------------------------------------------------------------------
-- Default razonable = fecha del vuelo. OJO: en equipaje la fecha del incidente es la
-- de entrega (daño) o la que debió ponerse a disposición (pérdida/demora) —Tabla A
-- fila 13, v2.1—, no la del vuelo. Esos casos hay que corregirlos a mano en el
-- backoffice; el valor de acá es un punto de partida, no una presunción legal.
UPDATE reclamos SET fecha_incidente = fecha_vuelo
  WHERE fecha_incidente IS NULL AND fecha_vuelo IS NOT NULL;

-- ------------------------------------------------------------------
-- Backfill 2: conjunto de incidentes desde el legacy
-- ------------------------------------------------------------------
-- Fuentes reales del intake (los tres formularios comparten dominio):
--   tipo_reclamo       ∈ vuelo | equipaje | vuelo_equipaje
--   tipo_incidencia    ∈ demora | cancelacion | reprogramacion | overbooking | denegacion
--   tipo_caso_equipaje ∈ perdida | danio | demora
--
-- `incidentes` es un CONJUNTO (Tabla A fila 6), así que un caso 'vuelo_equipaje'
-- acumula el incidente de vuelo Y el de equipaje.
--
-- reprogramacion → cancelacion: enmienda v2.1.1 del documento legal (decisión JPA).
-- No es un tipo propio; las sub-reglas de antelación/reencaminamiento la absorben.
--
-- Equipaje: se mapea desde `tipo_caso_equipaje` (dato fino), NO desde `tipo_reclamo`.
-- Si el tipo de equipaje es NULL el conjunto queda vacío a propósito: presumir
-- 'equipaje_demora' correría el gate de protesta con los plazos equivocados
-- (3/7 días daño vs. 10/21 pérdida/retardo, Res 1532 Art. 20 a) → mejor FALTA_DATO.
--
-- Idempotente: solo pisa filas cuyo conjunto está vacío, así una segunda corrida no
-- borra lo que un humano haya cargado en el backoffice.
UPDATE reclamos SET incidentes = (
  CASE WHEN COALESCE(tipo_reclamo, 'vuelo') IN ('vuelo', 'vuelo_equipaje') THEN
    CASE tipo_incidencia
      WHEN 'cancelacion'    THEN '["cancelacion"]'::jsonb
      WHEN 'reprogramacion' THEN '["cancelacion"]'::jsonb
      WHEN 'demora'         THEN '["demora"]'::jsonb
      WHEN 'overbooking'    THEN '["denegacion_embarque"]'::jsonb
      WHEN 'denegacion'     THEN '["denegacion_embarque"]'::jsonb
      ELSE '[]'::jsonb
    END
  ELSE '[]'::jsonb END
  ||
  CASE WHEN tipo_reclamo IN ('equipaje', 'vuelo_equipaje') THEN
    CASE tipo_caso_equipaje
      WHEN 'perdida' THEN '["equipaje_perdida"]'::jsonb
      WHEN 'danio'   THEN '["equipaje_dano"]'::jsonb
      WHEN 'demora'  THEN '["equipaje_demora"]'::jsonb
      ELSE '[]'::jsonb
    END
  ELSE '[]'::jsonb END
)
WHERE incidentes IS NULL OR incidentes = '[]'::jsonb;
