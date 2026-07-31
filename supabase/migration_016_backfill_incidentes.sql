-- Migration 016: deriva `incidentes` en los casos donde quedó vacío por tipografía.
--
-- Corrido el: ____________  (completar al ejecutar, como en migration_001)
--
-- ===========================================================================
-- POR QUÉ
-- ===========================================================================
-- `migration_015` derivó `incidentes` desde `tipo_incidencia` con un CASE por igualdad
-- exacta contra los valores en minúscula. La base, en cambio, tiene etiquetas de interfaz:
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
-- Los dos caminos de escritura ya quedaron cerrados en el mismo ciclo: `derivarIncidentes()`
-- normaliza en el alta (`api/_utils/intake.js`), y el editor genérico del drawer dejó de
-- poder tocar el dominio legal (denylist `CAMPOS_DOMINIO_LEGAL`, ítem 6bis.3 del registro
-- de pendientes). Sin eso, este backfill sería una foto y no una reparación.
--
-- Incluye la errata D1 de la v2.2: una reprogramación con `fecha_incidente >= 2024-10-10`
-- deriva al tipo propio `reprogramacion` (Art. 42 del Reglamento Dec. 809/2024); una
-- anterior conserva el mapeo v2.1.1 a `cancelacion`, que es el correcto para su vigencia.
--
-- ===========================================================================
-- CÓMO CORRERLA — cuatro bloques, cada uno se pega ENTERO y se ejecuta de una
-- ===========================================================================
-- Una transacción NO sobrevive entre dos ejecuciones del SQL Editor: cada "Run" toma una
-- conexión nueva del pool, así que un BEGIN sin COMMIT en la misma tanda se descarta. Por
-- eso el "mirar antes de confirmar" se hace corriendo el UPDATE dos veces: primero con
-- ROLLBACK (ejecuta de verdad y lo deshace) y después idéntico con COMMIT.
--
--   BLOQUE 1  control de población ANTES        · solo lee
--   BLOQUE 2  ensayo: UPDATE + control, ROLLBACK · no deja nada
--   BLOQUE 3  igual al 2 pero con COMMIT         · escribe
--   BLOQUE 4  las ocho filas, ya commiteadas     · solo lee
--
-- Si el editor muestra un solo resultado por corrida, el que importa es el ÚLTIMO SELECT,
-- que es el control de población.


-- ===========================================================================
-- BLOQUE 1 — CONTROL DE POBLACIÓN, ANTES  (solo lee)
-- ===========================================================================
-- La población entera, no solo las filas que el UPDATE va a tocar. Un conteo dirigido que
-- da cero no distingue "no hay nada que corregir" de "la consulta miró donde no era" —
-- exactamente lo que pasó con el primer dry-run de la errata D1.

SELECT COALESCE(tipo_incidencia, '(null)')                                  AS tipo_incidencia,
       count(*)                                                             AS filas,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) =  '[]'::jsonb) AS vacias,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) <> '[]'::jsonb) AS derivadas
FROM reclamos
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY filas DESC;


-- ===========================================================================
-- BLOQUE 2 — ENSAYO  (ejecuta el UPDATE y lo deshace: no deja nada)
-- ===========================================================================
-- Pegar desde BEGIN hasta ROLLBACK inclusive y ejecutar de una sola vez.

BEGIN;

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
      -- Sin fecha no se puede decidir la vigencia, así que no se deriva nada.
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
-- Solo conjuntos VACÍOS: una edición humana en el drawer nunca se pisa, y de ahí sale la
-- idempotencia — una segunda corrida no encuentra nada que hacer.
WHERE deleted_at IS NULL
  AND COALESCE(incidentes, '[]'::jsonb) = '[]'::jsonb
  AND (tipo_incidencia IS NOT NULL OR tipo_caso_equipaje IS NOT NULL);

SELECT COALESCE(tipo_incidencia, '(null)')                                  AS tipo_incidencia,
       count(*)                                                             AS filas,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) =  '[]'::jsonb) AS vacias,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) <> '[]'::jsonb) AS derivadas
FROM reclamos
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY filas DESC;

ROLLBACK;


-- ===========================================================================
-- NÚMEROS ESPERADOS — comparar el bloque 2 contra el bloque 1
-- ===========================================================================
--   · `vacias` pasa a 0 en 'Reprogramación', 'Cancelación', 'Demora' y
--     'Denegación Embarque'. Las de 'cancelacion', 'demora' y 'overbooking' en minúscula
--     ya estaban derivadas y no se mueven.
--   · `filas` por tipo: IDÉNTICO en los dos bloques. Total 19 invariante. Esta migración
--     no crea, no borra y no reclasifica: solo llena un conjunto vacío.
--   · Filas afectadas por el UPDATE = la suma de `vacias` del bloque 1 sobre tipos
--     mapeables. Según el relevamiento del 31-jul-2026: 8.
--
-- Si el UPDATE mueve MÁS filas que esa suma, algo está mal en el WHERE: no correr el
-- bloque 3 y reportar. El bloque 2 ya deshizo todo, así que no hay nada que limpiar.


-- ===========================================================================
-- BLOQUE 3 — DEFINITIVO  (idéntico al 2, pero commitea)
-- ===========================================================================
-- Correr SOLO si los números del bloque 2 coincidieron. Pegar desde BEGIN hasta COMMIT.

BEGIN;

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

SELECT COALESCE(tipo_incidencia, '(null)')                                  AS tipo_incidencia,
       count(*)                                                             AS filas,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) =  '[]'::jsonb) AS vacias,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) <> '[]'::jsonb) AS derivadas
FROM reclamos
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY filas DESC;

COMMIT;


-- ===========================================================================
-- BLOQUE 4 — LAS OCHO FILAS, YA COMMITEADAS  (solo lee)
-- ===========================================================================

SELECT ref_code, tipo_incidencia, fecha_incidente, incidentes,
       analisis_legal IS NOT NULL AS tiene_analisis
FROM reclamos
WHERE deleted_at IS NULL
  AND ref_code IN ('AA001','AA002','AA003','CSA081','CSA084','CSA085','CSA086','CSA087')
ORDER BY ref_code;

-- Esperado: `incidentes` no vacío en las ocho. AA001 y AA002 con ["reprogramacion"] —las
-- dos son posteriores al 10-oct-2024—, AA003 con ["denegacion_embarque"], CSA081 y CSA084
-- con ["cancelacion"], CSA085/086/087 con ["demora"]. `tiene_analisis` sigue en false: eso
-- lo resuelve el paso de abajo, no el SQL.


-- ===========================================================================
-- DESPUÉS DEL COMMIT (no es SQL)
-- ===========================================================================
-- La migración habilita el análisis pero no lo corre. Hay que apretar "Analizar caso" en
-- el backoffice sobre cada uno de los ocho. Sirve además como verificación funcional del
-- motor sobre casos reales de los dos canales, incluidas las dos reprogramaciones, que son
-- los primeros casos reales que van a ejercitar el Art. 42 del ruleset IV-B.
