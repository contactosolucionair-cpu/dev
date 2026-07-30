# Motor Capa 1 — Contratos de entrada/salida y migración

**Versión:** 1.1 · **Fecha:** 29-jul-2026 · **Depende de:** `Capa_1_-_Logica_legal_determinista_v2.1.md` (v2.1.1, fuente de verdad legal)

> **Errata v1.1 (cierre del ciclo de implementación).** La v1.0 nombraba tres columnas que
> NO existen en `reclamos`: `gastos_monto`, `gastos_moneda` e `incidencia_detectada`. Las
> tres son claves del JSON que devuelve la extracción con IA, no columnas. Las columnas
> reales son **`monto_gastos`**, **`moneda_gastos`** y **`tipo_incidencia`**
> (`migration_001_expand_reclamos.sql`). Corregido en §1.2 (filas 6 y 14), §3 y §4. El
> `UPDATE` de §3 tal como estaba escrito fallaba con *column "incidencia_detectada" does
> not exist*. Se agrega además el mapeo de `reprogramacion` (enmienda legal v2.1.1) y el
> del equipaje desde `tipo_caso_equipaje`.

Este documento define los dos contratos del motor determinista y la migración de datos necesaria. Es la base del prompt de Claude Code. Convenciones del codebase: columnas escalares para campos consultables, JSONB para listas/estructuras, ES5 en front, ESM en `/api`, sin dependencias nuevas.

---

## 1. Contrato de entrada — el objeto `caso`

### 1.1 Principio: capa canónica + capa de evidencia

- **Capa canónica** = columnas de `reclamos`. Un único valor por campo; es lo único que lee el motor.
- **Capa de evidencia** = `datos_extraidos` (JSONB): candidatos a valor con procedencia. Fuentes: `formulario` | `adjunto` | `declaracion_pasajero` | `api_vuelo` | `admin`.
- **Metadatos por campo** = `campos_meta` (JSONB): `{ "<campo>": { verificado: bool, fuente: str, conflicto: bool } }`.
- **Reglas de resolución:**
  - Coincidencia entre fuentes **independientes** (p. ej. formulario + adjunto) → `verificado: true` automático. Formulario y declaración del pasajero NO son independientes entre sí.
  - Discrepancia → `conflicto: true`; se resuelve solo por decisión humana en backoffice. Mientras tanto, campo crítico en conflicto = `FALTA_DATO` para el motor.
  - Campo hallado solo en adjunto: logísticos se autocompletan con `verificado: false`; **críticos** requieren confirmación humana.
- **Campos críticos** (consecuencia legal directa; nunca se presumen ni se auto-verifican desde una sola fuente declarativa): `demora_salida_min`, `demora_llegada_min`, `antelacion_aviso_dias`, `fecha_incidente`, `protesta`, `checkin_presentacion`, `causa_alegada`, `incidentes`.
- **Jerarquía probatoria** (orden de sugerencia en el diff del backoffice, nunca override silencioso): `api_vuelo` > documento emitido por la aerolínea > pasaje/boarding pass > declaración del pasajero (formulario/comentarios).

### 1.2 Mapeo Tabla A (v2.1) → columnas

| Tabla A | Columna | Tipo | Estado | Lo llena | Crítico |
|---|---|---|---|---|---|
| 1, 2 Origen/Destino | `origen_iata`, `destino_iata` | TEXT(3) | **nueva**. La captura YA valida IATA (`airport-select.js`, `data-iata`) pero hoy solo persiste el label; se persiste el `data-iata` en los submits y `origen`/`destino` quedan como display. Backfill histórico: portar `resolve()` de `airport-select.js` a un script | form (ya validado) + extracción | no |
| 3 Segmentos | `segmentos` | JSONB | **nueva** | admin + extracción | no |
| 4 Billete único | `billete_unico` | BOOLEAN | **nueva** | admin | sí (afecta Test A) |
| 5 Carrier operante | `segmentos[].carrier_operante` + lookup en `api/_data/aerolineas.json` | — | **nueva** | admin + extracción | no |
| 6 Incidentes (conjunto) | `incidentes` | JSONB array | **nueva**. Quedan legacy `tipo_reclamo`, **`tipo_incidencia`** (dominio real: `demora`, `cancelacion`, `reprogramacion`, `overbooking`, `denegacion`) y **`tipo_caso_equipaje`** (`perdida`, `danio`, `demora`), que es de donde se mapea el equipaje. *(v1.1: antes decía `incidencia_detectada`, que no es una columna)* | form + admin + extracción | sí |
| 7a Demora de salida | `demora_salida_min` | INTEGER (minutos) | **nueva** | admin + api_vuelo | sí |
| 7b Demora de llegada | `demora_llegada_min` | INTEGER (minutos; llegada = apertura de puertas, Pin 1) | **nueva** | admin + api_vuelo | sí |
| 8 Antelación aviso | `antelacion_aviso_dias` | NUMERIC (fraccionable) | **nueva** | admin + extracción (email aerolínea) | sí |
| 9 Distancia | derivada: haversine(`origen_iata`→`destino_iata`) | — | requiere lat/lon en `airports.json` | motor | — |
| 10 Reencaminamiento | `reencaminamiento` | JSONB | **nueva** | admin | no |
| 11 Atención ofrecida | `atencion_ofrecida` | JSONB | **nueva** | admin + declaración | no |
| 12 Intl/doméstico | derivada de países de `segmentos`/IATA | — | — | motor | — |
| 13 Fecha del incidente | `fecha_incidente` | DATE (default `fecha_vuelo`; equipaje: entrega o puesta a disposición) | **nueva** | admin | sí |
| 14 Gastos | `gastos_items` (canónico itemizado) | JSONB | **nueva**. **`monto_gastos`/`moneda_gastos`** legacy = **espejo derivado**: se reescriben con la suma de la **moneda dominante** en el mismo PATCH que modifica `gastos_items` (patrón `estado`←`instancia`); la UI actual los sigue leyendo sin cambios. La moneda se normaliza a mayúsculas antes de agrupar. El total que declara el pasajero NO es ítem: es candidato `gastos_total_declarado` en `datos_extraidos` (`fuente: declaracion_pasajero`), contrastable contra la suma de ítems (insumo del EVAL suficiencia probatoria). *(v1.1: antes decía `gastos_monto`/`gastos_moneda`, que no son columnas)* | extracción (tickets) + admin | no |
| 15 Causa alegada | `causa_alegada` | TEXT | **nueva** | admin + extracción + declaración | sí |
| 16 Soporte probatorio | `adjuntos` | JSONB | existe | — | — |
| 17 Protesta | `protesta` | JSONB `{realizada:'si'\|'no'\|'desconocido', fecha, medio:'pir'\|'escrita'}` | **nueva** | admin + declaración | sí |
| 18 Check-in | `checkin_presentacion` | TEXT enum `en_hora\|tarde\|no_presentado\|no_aplica\|desconocido` | **nueva** | admin + declaración | sí |
| — Comentarios | `comentarios_pasajero` | TEXT | **nueva** (en curso, JPA) | form/portal | — |
| — Evidencia | `datos_extraidos` | JSONB array | **nueva** | pipeline de extracción | — |
| — Metadatos | `campos_meta` | JSONB | **nueva** | pipeline + backoffice | — |
| — Salida del motor | `analisis_legal` | JSONB | **nueva** | motor | — |

### 1.3 Estructuras JSONB

```js
// segmentos: uno por tramo, en orden
[{ orden: 1, origen_iata: 'EZE', destino_iata: 'MAD',
   carrier_operante: 'Iberia', fecha: 'YYYY-MM-DD' }]

// incidentes: conjunto (v2.1 Tabla A fila 6)
['demora'] // valores: demora|cancelacion|denegacion_embarque|downgrade|
           // conexion_perdida|equipaje_demora|equipaje_dano|equipaje_perdida|muerte_lesion

// reencaminamiento
{ ofrecido: true, delta_salida_min: -60, delta_llegada_min: 90, aceptado: false }
// deltas vs. horario programado; negativos = antes

// atencion_ofrecida
{ ofrecida: true, items: ['refrigerio','comunicaciones'] }
// items: refrigerio|comida|alojamiento|transporte|comunicaciones

// gastos_items
[{ concepto: 'Hotel', monto: 120, moneda: 'EUR', fecha: 'YYYY-MM-DD',
   archivo: 'doc_3.pdf', fuente: 'adjunto' }]

// datos_extraidos: candidatos con procedencia
[{ campo: 'vuelo_nro', valor: 'AR1236', fuente: 'adjunto',
   archivo: 'doc_1.jpg', extraido_en: 'ISO' }]

// campos_meta
{ demora_llegada_min: { verificado: false, fuente: 'admin', conflicto: false } }
```

### 1.4 Datos auxiliares

- `src/data/airports.json`: **agregar `lat`, `lon`** por aeropuerto (dataset abierto; tarea Claude Code). El país ya existe.
- `api/_data/paises-ue.js`: constante con Estados UE + EEE (IS/NO/LI) + CH, y Estados parte de Montreal (lista larga; puede arrancar con los mercados objetivo + flag `desconocido` → FALTA_DATO).
- `api/_data/aerolineas.json`: `{ nombre, iata, pais_licencia, comunitario }` para las aerolíneas operadas en la práctica; ausente → `comunitario: null` → FALTA_DATO solo si el Test A2 lo necesita.

---

## 2. Contrato de salida — `analisis_legal`

Se guarda en la columna JSONB `analisis_legal` (último análisis) y se apila en `analisis_historial` dentro del mismo objeto si se quiere trazabilidad de re-análisis (decisión simple: `{ actual: {...}, historial: [...] }`).

```js
{
  version_motor: '1.0.0',
  version_ruleset: '2026-06-19',        // seleccionado por fecha_incidente
  fecha_analisis: 'ISO',
  disparado_por: 'manual' | 'auto',
  provisional: bool,                     // true si algún campo crítico usado
                                         // está sin verificar o en conflicto
  normalizacion: {
    internacional: bool, origen: 'EZE', destino_final: 'MAD',
    distancia_km: 10432, banda_eu261: '>3500' | '1500-3500' | '<=1500' | null
  },
  marcos: [{
    marco: 'EU261' | 'RES1532' | 'MONTREAL' | 'DOT' | 'ANAC400',
    aplica: 'si' | 'no' | 'pendiente_analisis_profundo',   // DOT/ANAC400: trigger sin árbol
    activado_por: 'Test A1: salida desde aeropuerto UE (MAD)',
    base_legal: 'EU261 Art. 3(1)(a)',
    punteros: { neb: 'AESA (España)', ley_nacional: 'España' },  // solo EU261
    gates: [{ gate: 'checkin' | 'protesta',
              resultado: 'pasa' | 'pasa_provisional' | 'inadmisible' | 'falta_dato',
              detalle: '', base_legal: '' }],
    categorias: [{
      categoria: 'compensacion_tarifada',
      estado: 'RECLAMABLE' | 'NO_APLICA' | 'FALTA_DATO' | 'REQUIERE_EVALUACION',
      monto: { valor: 600, moneda: 'EUR' }                  // tarifado, o
           // { unidad: 'AO', formula: '2 AO/kg', cantidad_pendiente: true }  // simbólico
      motivo: '',            // si NO_APLICA
      dato_faltante: '',     // si FALTA_DATO (nombre de campo del contrato de entrada)
      eval_nodo: '',         // si REQUIERE_EVALUACION (id del nodo del consolidado v2.1)
      deducible_de: [],      // referencias cruzadas (Art. 12 EU261)
      base_legal: '', nota: ''
    }],
    prescripcion: {
      computable: bool,
      tipo: 'firme' | 'piso_conservador' | 'segun_foro',    // Pin 7
      plazo: '1 año', fecha_limite: 'YYYY-MM-DD' | null, base_legal: ''
    }
  }],
  nodos_eval: [{ nodo: 'circunstancias_extraordinarias', marco: 'EU261',
                 dato_concreto: '', insumo: '' }],           // handoff a Capa 2/3
  faltan_datos: [{ campo: 'demora_llegada_min', para: ['EU261.compensacion_tarifada'],
                   en_conflicto: bool }],
  resumen: { marcos_activos: [], categorias_reclamables: 3, monto_tarifado_total: [] }
}
```

**Reglas de comportamiento del motor** (espejo de los pins v2.1):

1. Función pura: `analizar(caso, ruleset) → analisis_legal`. Sin fetch, sin fechas implícitas (recibe `hoy` como parámetro para prescripción → testeable).
2. Ruleset elegido por `fecha_incidente` (ley al momento del hecho). Estructura preparada para agregar el ruleset de la reforma EU261 (~2027) sin tocar el evaluador.
3. Campo crítico `null`, sin verificar o en conflicto → `FALTA_DATO` en las categorías que lo consumen + flag global `provisional: true` si igual se pudo emitir algo.
4. Gates antes que categorías: check-in (EU261, Pin 3) y protesta (equipaje, Pins 3/5). `pasa_provisional` (solo PIR) emite además el nodo EVAL "suficiencia de la protesta".
5. Nunca resolver nodos EVAL. Nunca elegir marco ganador. Nunca emitir fecha de prescripción `segun_foro` (Pin 7).
6. Cuantificación AO/SDR: siempre simbólica; el quantifier (valor AO en `site_config`, SDR diferido) es un paso separado y posterior.
7. Toda categoría y todo gate llevan `base_legal` no vacía.

---

## 3. Migración SQL (correr en Supabase SQL Editor)

```sql
-- Motor Capa 1: campos del contrato de entrada + salida del análisis
ALTER TABLE reclamos
  ADD COLUMN IF NOT EXISTS origen_iata          TEXT,
  ADD COLUMN IF NOT EXISTS destino_iata         TEXT,
  ADD COLUMN IF NOT EXISTS segmentos            JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS billete_unico        BOOLEAN,
  ADD COLUMN IF NOT EXISTS incidentes           JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS demora_salida_min    INTEGER,
  ADD COLUMN IF NOT EXISTS demora_llegada_min   INTEGER,
  ADD COLUMN IF NOT EXISTS antelacion_aviso_dias NUMERIC,
  ADD COLUMN IF NOT EXISTS reencaminamiento     JSONB,
  ADD COLUMN IF NOT EXISTS atencion_ofrecida    JSONB,
  ADD COLUMN IF NOT EXISTS fecha_incidente      DATE,
  ADD COLUMN IF NOT EXISTS causa_alegada        TEXT,
  ADD COLUMN IF NOT EXISTS protesta             JSONB,
  ADD COLUMN IF NOT EXISTS checkin_presentacion TEXT,
  ADD COLUMN IF NOT EXISTS comentarios_pasajero TEXT,
  ADD COLUMN IF NOT EXISTS gastos_items         JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS datos_extraidos      JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS campos_meta          JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS analisis_legal       JSONB;

-- Backfill mínimo: fecha_incidente = fecha_vuelo donde exista
UPDATE reclamos SET fecha_incidente = fecha_vuelo
  WHERE fecha_incidente IS NULL AND fecha_vuelo IS NOT NULL;

-- incidentes desde el legacy. `incidentes` es un CONJUNTO, así que un caso
-- 'vuelo_equipaje' acumula el incidente de vuelo Y el de equipaje.
-- reprogramacion -> cancelacion: enmienda v2.1.1 del documento legal (decisión JPA).
-- Equipaje: se mapea desde tipo_caso_equipaje (dato fino), NO desde tipo_reclamo. Sin
-- tipo de equipaje queda [] a propósito: presumir 'equipaje_demora' correría el gate de
-- protesta con los plazos equivocados (3/7 días daño vs. 10/21 pérdida).
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
```

Notas: sin índices nuevos por ahora (el motor lee por caso, no filtra por estos campos). `estado`/`monto_gastos` legacy no se tocan. Implementado en `supabase/migration_015_motor_capa1.sql` (se respeta la convención `migration_NNN` del repo).

---

## 4. Piezas de código (inventario para el prompt de Claude Code)

| Pieza | Ubicación | Descripción |
|---|---|---|
| Evaluador | `api/_utils/motor-legal.js` | Función pura `analizar(caso, ruleset, hoy)`. Genérico y estable |
| Rulesets | `api/_utils/rulesets/2026-06-19.js` | Reglas-como-datos: Tests A–E, árboles EU261 y AR, gates, prescripción. Un archivo por vigencia |
| Normalizador | `api/_utils/motor-normalizar.js` | `reclamos` row → objeto `caso` del contrato (deriva intl/doméstico, distancia, banda; aplica reglas de conflicto/verificado) |
| Datos | `api/_data/aerolineas.json`, `api/_data/paises-ue.js`, `src/data/airports.json` (+lat/lon) | Auxiliares |
| Endpoint | `POST /api/admin?action=analizar-caso` | `X-Admin-Password`; corre motor, guarda `analisis_legal`, devuelve el objeto |
| Backoffice | `backoffice.html` | (a) editor de campos del contrato en el drawer, (b) botón "Analizar caso", (c) render de `analisis_legal` (marcos, categorías con estado/color, gates, prescripción, faltantes → link a crear espera `info_pasajero`), (d) diff de conflictos `datos_extraidos` vs. canónico |
| Tests | `tests/motor.test.js` + `tests/casos-dorados.js` | `node tests/motor.test.js`; sin framework. Casos dorados: entrada + salida esperada, escritos por JPA |
| Persistir IATA | `index.html` (submit), `panel-agencia.html` (submit), `api/process-ticket.js`, `api/agency.js` | Enviar el `data-iata` ya resuelto por `airport-select.js` junto al label; escribir `origen_iata`/`destino_iata`. Cambio aditivo: el label sigue viajando y guardándose igual |
| Backfill IATA | `scripts/backfill-iata.mjs` | Porta la lógica de `resolve()` de `airport-select.js`; lee `reclamos` con `origen_iata IS NULL`, resuelve contra `airports.json`, PATCH vía REST. Lo no resuelto queda `null` (→ FALTA_DATO) y se lista en consola |
| Espejo gastos | `api/update-ticket.js` (`set-datos-legales`) | Todo PATCH que modifique `gastos_items` reescribe **`monto_gastos`/`moneda_gastos`** con la suma (por moneda dominante, normalizada a mayúsculas) en el mismo PATCH *(v1.1: antes decía `gastos_monto`/`gastos_moneda`)* |

**Fuera de alcance de este ciclo** (ciclos siguientes, sobre el mismo contrato): pipeline de extracción de adjuntos → `datos_extraidos`; integración api_vuelo → demoras; disparo automático del motor al alta; redacción del reclamo (Capa 3).

---

## 5. Casos dorados — plantilla (completa JPA, mínimo 10)

```js
// tests/casos-dorados.js
export var CASOS = [{
  id: 'CD-01',
  descripcion: 'Doméstico AR, demora salida 5h, causa operativa, sin equipaje',
  caso: { /* objeto caso completo según contrato §1 */ },
  esperado: {
    marcos: { RES1532: 'si', EU261: 'no', MONTREAL: 'no' },
    categorias_clave: { 'RES1532.servicios_incidentales': 'RECLAMABLE',
                        'RES1532.compensacion_tarifada': 'NO_APLICA' },
    nodos_eval_incluye: ['causa_disrupcion'],
    prescripcion: { RES1532: { tipo: 'firme', plazo: '1 año' } }
  }
}];
```

Cobertura mínima sugerida: demora AR doméstica > y < 4 h · cancelación EU261 con aviso <7 días y reencaminamiento en margen (reducción 50 %) · retraso EU261 2h59 vs 3h01 (borde Pin 1) · EZE→MAD (Test D + E + A1 juntos) · equipaje internacional con protesta fuera de plazo (inadmisible) · equipaje solo PIR (pasa provisional) · check-in desconocido (FALTA_DATO) · billete único vía hub UE sin origen/destino UE (nodo borde) · retraso >3500 km 3h30 (€300) · caso con campos en conflicto (provisional).
