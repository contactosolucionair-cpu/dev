-- Migration 016: deriva `incidentes` en los casos donde quedó vacío por tipografía.
--
-- Corrido el: ____________  (completar al ejecutar, como en migration_001)
--
-- ---------------------------------------------------------------------------
-- POR QUÉ
-- ---------------------------------------------------------------------------
-- `migration_015` derivó `incidentes` desde `tipo_incidencia` con un CASE por igualdad
-- exacta contra valores en minúscula. La base, en cambio, tiene etiquetas de interfaz:
-- 'Reprogramación', 'Denegación Embarque', 'Cancelación', 'Demora'. Esas filas no
-- matchearon ninguna rama del CASE y quedaron con `incidentes = '[]'`.
--
-- `incidentes` es un campo CRÍTICO del contrato del motor (Tabla A fila 6): vacío se lee
-- como FALTA_DATO, así que el motor no puede clasificar el incidente y el análisis sale
-- degradado. El síntoma es silencioso: nadie se entera hasta que alguien mira.
--
-- Relevamiento del 31-jul-2026: 8 de 19 casos con `tipo_incidencia` cargado estaban así, y
-- ninguno tenía análisis guardado (`analisis_legal IS NULL`), de modo que esta migración no
-- invalida nada — solo habilita lo que nunca se pudo correr.
--
--   AA002   Reprogramación        2025-12-14      AA001   Reprogramación        2026-02-03
--   CSA087  Demora                2026-02-15      AA003   Denegación Embarque   2026-04-10
--   CSA081  Cancelación           2026-06-01      CSA084  Cancelación           2026-06-12
--   CSA086  Demora                2026-06-12      CSA085  Demora                2026-06-22
--
-- El camino de escritura ya quedó tapado en el mismo ciclo: `derivarIncidentes()` de
-- `api/_utils/intake.js` normaliza (minúsculas, sin acentos, espacios colapsados) y tiene
-- unitarios con las variantes reales. Sin eso, este backfill sería una foto.
--
-- Incluye la errata D1 de la v2.2: una reprogramación con `fecha_incidente >= 2024-10-10`
-- deriva al tipo propio `reprogramacion` (Art. 42 del Reglamento Dec. 809/2024); una
-- anterior conserva el mapeo v2.1.1 a `cancelacion`, que es el correcto para su vigencia.
--
-- ---------------------------------------------------------------------------
-- CÓMO CORRERLA
-- ---------------------------------------------------------------------------
-- Todo el bloque va en una sola transacción. Se ejecuta hasta el SELECT de verificación,
-- se comparan los números con los esperados de abajo y recién ahí se descomenta COMMIT.
-- Si no coinciden: ROLLBACK y reportar. Es idempotente: una segunda corrida no encuentra
-- filas vacías y no mueve nada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. CONTROL DE POBLACIÓN — ANTES
-- ---------------------------------------------------------------------------
-- Población entera, no solo las filas que el UPDATE va a tocar. Un conteo dirigido que da
-- cero no distingue "no hay nada que corregir" de "la consulta miró donde no era"; esta
-- vista muestra las dos cosas a la vez.
SELECT COALESCE(tipo_incidencia, '(null)')                       AS tipo_incidencia,
       count(*)                                                  AS filas,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) = '[]'::jsonb) AS vacias,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) <> '[]'::jsonb) AS derivadas
FROM reclamos
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY filas DESC;

-- ---------------------------------------------------------------------------
-- 2. BACKFILL
-- ---------------------------------------------------------------------------
-- Solo filas con el conjunto VACÍO: una edición humana en el drawer nunca se pisa, y de
-- ahí sale la idempotencia. La normalización replica la de `claveDominio()` en JS.
UPDATE reclamos SET incidentes = (
  CASE WHEN COALESCE(lower(trim(tipo_reclamo)), 'vuelo') IN ('vuelo', 'vuelo_equipaje') THEN
    CASE lower(regexp_replace(trim(translate(tipo_incidencia,
           'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g'))
      WHEN 'cancelacion'            THEN '["cancelacion"]'::jsonb
      WHEN 'demora'                 THEN '["demora"]'::jsonb
      WHEN 'overbooking'            THEN '["denegacion_embarque"]'::jsonb
      WHEN 'denegacion'             THEN '["denegacion_embarque"]'::jsonb
      WHEN 'denegacion embarque'    THEN '["denegacion_embarque"]'::jsonb
      WHEN 'denegacion de embarque' THEN '["denegacion_embarque"]'::jsonb
      -- Errata D1: el tipo propio existe desde la entrada en vigor del Dec. 809/2024.
      -- Sin fecha no se decide la vigencia, así que no se deriva nada (ver esperados).
      WHEN 'reprogramacion' THEN
        CASE WHEN fecha_incidente >= DATE '2024-10-10' THEN '["reprogramacion"]'::jsonb
             WHEN fecha_incidente IS NOT NULL          THEN '["cancelacion"]'::jsonb
             ELSE '[]'::jsonb END
      ELSE '[]'::jsonb
    END
  ELSE '[]'::jsonb END
  ||
  CASE WHEN lower(trim(tipo_reclamo)) IN ('equipaje', 'vuelo_equipaje') THEN
    CASE lower(regexp_replace(trim(translate(tipo_caso_equipaje,
           'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g'))
      WHEN 'perdida' THEN '["equipaje_perdida"]'::jsonb
      WHEN 'danio'   THEN '["equipaje_dano"]'::jsonb
      WHEN 'dano'    THEN '["equipaje_dano"]'::jsonb
      WHEN 'demora'  THEN '["equipaje_demora"]'::jsonb
      ELSE '[]'::jsonb
    END
  ELSE '[]'::jsonb END
)
WHERE deleted_at IS NULL
  AND COALESCE(incidentes, '[]'::jsonb) = '[]'::jsonb
  AND (tipo_incidencia IS NOT NULL OR tipo_caso_equipaje IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. CONTROL DE POBLACIÓN — DESPUÉS
-- ---------------------------------------------------------------------------
SELECT COALESCE(tipo_incidencia, '(null)')                       AS tipo_incidencia,
       count(*)                                                  AS filas,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) = '[]'::jsonb) AS vacias,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) <> '[]'::jsonb) AS derivadas
FROM reclamos
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY filas DESC;

-- Y las ocho filas, una por una, para verlas derivadas.
SELECT ref_code, tipo_incidencia, fecha_incidente, incidentes
FROM reclamos
WHERE deleted_at IS NULL
  AND ref_code IN ('AA001','AA002','AA003','CSA081','CSA084','CSA085','CSA086','CSA087')
ORDER BY ref_code;

-- ---------------------------------------------------------------------------
-- 4. NÚMEROS ESPERADOS — comparar antes de commitear
-- ---------------------------------------------------------------------------
--   · El UPDATE tiene que reportar exactamente tantas filas como `vacias` sumaba el
--     control ANTES sobre tipos mapeables. Según el relevamiento del 31-jul-2026: 8.
--   · Control DESPUÉS: `vacias` en 0 para 'Reprogramación', 'Cancelación', 'Demora' y
--     'Denegación Embarque'. Las filas de 'cancelacion', 'demora' y 'overbooking' en
--     minúscula ya estaban derivadas y no se mueven.
--   · `filas` por tipo: IDÉNTICO antes y después. Total 19 invariante. Esta migración no
--     crea, no borra y no reclasifica: solo llena un conjunto vacío.
--   · Las ocho del listado: `incidentes` no vacío. AA001 y AA002 con ["reprogramacion"]
--     —las dos son posteriores al 10-oct-2024—, AA003 con ["denegacion_embarque"],
--     CSA081 y CSA084 con ["cancelacion"], CSA085/086/087 con ["demora"].
--
-- Si algún número no coincide: ROLLBACK. En particular, si el UPDATE mueve MÁS filas que
-- las `vacias` del control ANTES, algo está mal en el WHERE y hay que frenar.

-- COMMIT;
-- ROLLBACK;

-- ---------------------------------------------------------------------------
-- 5. DESPUÉS DEL COMMIT (no es SQL)
-- ---------------------------------------------------------------------------
-- La migración habilita el análisis pero no lo corre: los ocho casos siguen con
-- `analisis_legal IS NULL`. Hay que apretar "Analizar caso" en el backoffice sobre cada
-- uno. Sirve además como verificación funcional del motor sobre casos reales de los dos
-- canales (AA* y CSA*), incluidas las dos reprogramaciones, que son los primeros casos
-- reales que van a ejercitar el Art. 42 del ruleset IV-B.
