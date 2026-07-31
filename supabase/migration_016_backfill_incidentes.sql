-- Migration 016: deriva `incidentes` en los casos donde quedó vacío por tipografía.
--
-- CORRIDA EL 31-jul-2026 sobre producción. 8 filas derivadas, verificadas una por una
-- (bloque 4). Re-ejecutar el ensayo devuelve 0 filas: no queda nada por derivar.
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
-- como FALTA_DATO, así que el motor no podía clasificar el incidente y el análisis salía
-- degradado. El síntoma es silencioso: nadie se entera hasta que alguien mira.
--
-- Relevamiento del 31-jul-2026: 8 de 19 casos con `tipo_incidencia` cargado estaban así, y
-- ninguno tenía análisis guardado (`analisis_legal IS NULL`), de modo que esta migración no
-- invalidó nada — solo habilitó lo que nunca se pudo correr.
--
-- Los dos caminos de escritura quedaron cerrados en el mismo ciclo: `derivarIncidentes()`
-- normaliza en el alta (`api/_utils/intake.js`), y el editor genérico del drawer ya no
-- puede tocar el dominio legal (denylist `CAMPOS_DOMINIO_LEGAL`, ítem 6bis.3 del registro
-- de pendientes). Sin eso, este backfill sería una foto y no una reparación.
--
-- Incluye la errata D1 de la v2.2: una reprogramación con `fecha_incidente >= 2024-10-10`
-- deriva al tipo propio `reprogramacion` (Art. 42 del Reglamento Dec. 809/2024); una
-- anterior conservaría el mapeo v2.1.1 a `cancelacion`, correcto para su vigencia.
--
-- ===========================================================================
-- CÓMO SE CORRIÓ, Y POR QUÉ ASÍ
-- ===========================================================================
-- El protocolo original era BEGIN → UPDATE → verificación → COMMIT/ROLLBACK. No sirve en
-- el SQL Editor de Supabase por dos razones, las dos verificadas en la corrida real:
--
--   1. Una transacción NO sobrevive entre dos ejecuciones: cada "Run" toma una conexión
--      nueva del pool, así que no se puede dejar abierta, mirar los números y commitear
--      después.
--   2. El bloque con control de transacción explícito falló con "Failed to fetch" — error
--      de red del dashboard, no de Postgres.
--
-- El reemplazo es mejor que el original: en vez de ejecutar el UPDATE y deshacerlo, se
-- CALCULA con un SELECT lo que haría, fila por fila (bloque 2). Es una sola sentencia, solo
-- lee, y muestra el antes y el después de cada caso — más informativo que un rollback, y
-- sin depender de que el editor tolere transacciones. Con las filas probadas una por una,
-- el UPDATE va suelto (bloque 3): su WHERE solo alcanza conjuntos vacíos, así que es
-- idempotente y acotado por construcción.
--
--   BLOQUE 1  control de población          · solo lee
--   BLOQUE 2  ensayo: qué haría el UPDATE   · solo lee
--   BLOQUE 3  el UPDATE                     · escribe
--   BLOQUE 4  verificación de las ocho      · solo lee


-- ===========================================================================
-- BLOQUE 1 — CONTROL DE POBLACIÓN  (solo lee)
-- ===========================================================================
-- La población entera, no solo las filas que el UPDATE va a tocar. Un conteo dirigido que
-- da cero no distingue "no hay nada que corregir" de "la consulta miró donde no era" —
-- exactamente lo que pasó con el primer dry-run de la errata D1, que devolvió todo en cero
-- porque buscaba 'reprogramacion' y la base decía 'Reprogramación'.

SELECT COALESCE(tipo_incidencia, '(null)')                                  AS tipo_incidencia,
       count(*)                                                             AS filas,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) =  '[]'::jsonb) AS vacias,
       count(*) FILTER (WHERE COALESCE(incidentes, '[]'::jsonb) <> '[]'::jsonb) AS derivadas
FROM reclamos
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY filas DESC;


-- ===========================================================================
-- BLOQUE 2 — ENSAYO  (solo lee: muestra qué haría el UPDATE, sin tocar nada)
-- ===========================================================================
-- Misma expresión y mismo WHERE que el bloque 3. Correrlo DESPUÉS del UPDATE tiene que
-- devolver 0 filas: es la prueba de idempotencia.

SELECT ref_code, tipo_incidencia, fecha_incidente,
       incidentes AS actual,
       (
         CASE WHEN COALESCE(lower(trim(tipo_reclamo)), 'vuelo') IN ('vuelo', 'vuelo_equipaje') THEN
           CASE lower(regexp_replace(trim(translate(tipo_incidencia,
                  'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g'))
             WHEN 'cancelacion'            THEN '["cancelacion"]'::jsonb
             WHEN 'demora'                 THEN '["demora"]'::jsonb
             WHEN 'overbooking'            THEN '["denegacion_embarque"]'::jsonb
             WHEN 'denegacion'             THEN '["denegacion_embarque"]'::jsonb
             WHEN 'denegacion embarque'    THEN '["denegacion_embarque"]'::jsonb
             WHEN 'denegacion de embarque' THEN '["denegacion_embarque"]'::jsonb
             -- Errata D1: el tipo propio existe desde la entrada en vigor del Dec.
             -- 809/2024. Sin fecha no se puede decidir la vigencia: no se deriva nada.
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
       ) AS quedaria
FROM reclamos
WHERE deleted_at IS NULL
  AND COALESCE(incidentes, '[]'::jsonb) = '[]'::jsonb
  AND (tipo_incidencia IS NOT NULL OR tipo_caso_equipaje IS NOT NULL)
ORDER BY ref_code;

-- Resultado real del 31-jul-2026 — 8 filas, todas con `actual` = []:
--   AA001   Reprogramación        2026-02-03   → ["reprogramacion"]
--   AA002   Reprogramación        2025-12-14   → ["reprogramacion"]
--   AA003   Denegación Embarque   2026-04-10   → ["denegacion_embarque"]
--   CSA081  Cancelación           2026-06-01   → ["cancelacion"]
--   CSA084  Cancelación           2026-06-12   → ["cancelacion"]
--   CSA085  Demora                2026-06-22   → ["demora"]
--   CSA086  Demora                2026-06-12   → ["demora"]
--   CSA087  Demora                2026-02-15   → ["demora"]
--
-- Criterio para pasar al bloque 3: cada fila con `actual` vacío y `quedaria` con el valor
-- que le corresponde por su `tipo_incidencia`. Una sola fila inesperada = frenar.


-- ===========================================================================
-- BLOQUE 3 — EL UPDATE  (escribe; el editor responde "Success. No rows returned")
-- ===========================================================================
-- Sin BEGIN: las filas ya quedaron probadas una por una en el bloque 2. El WHERE solo
-- alcanza conjuntos VACÍOS, así que una edición humana en el drawer nunca se pisa y una
-- segunda corrida no encuentra nada que hacer.

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


-- ===========================================================================
-- BLOQUE 4 — VERIFICACIÓN  (solo lee)
-- ===========================================================================

SELECT ref_code, tipo_incidencia, fecha_incidente, incidentes,
       analisis_legal IS NOT NULL AS tiene_analisis
FROM reclamos
WHERE deleted_at IS NULL
  AND ref_code IN ('AA001','AA002','AA003','CSA081','CSA084','CSA085','CSA086','CSA087')
ORDER BY ref_code;

-- Verificado el 31-jul-2026: las ocho con `incidentes` cargado según el bloque 2, y el
-- ensayo re-ejecutado devolviendo 0 filas. `filas` por tipo del bloque 1 quedó invariante:
-- esta migración no crea, no borra y no reclasifica — solo llena un conjunto vacío.


-- ===========================================================================
-- DESPUÉS DEL COMMIT (no es SQL)
-- ===========================================================================
-- La migración habilita el análisis pero no lo corre: las ocho quedaron con
-- `analisis_legal IS NULL`. Hay que apretar "Analizar caso" en el backoffice sobre cada
-- una. Sirve además como verificación funcional del motor sobre casos reales de los dos
-- canales, incluidas las dos reprogramaciones, que son los primeros casos reales que
-- ejercitan el Art. 42 del ruleset IV-B.
