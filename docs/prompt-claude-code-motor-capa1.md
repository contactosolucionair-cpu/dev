# Prompt Claude Code — Ciclo: Motor Legal Capa 1 (determinista)

> **Errata (cierre del ciclo).** Este prompt nombraba columnas que no existen en
> `reclamos`: `gastos_monto`, `gastos_moneda` (Regla 3) e `incidencia_detectada` (Fase 0).
> Las reales son **`monto_gastos`**, **`moneda_gastos`** y **`tipo_incidencia`**; el equipaje
> se mapea desde **`tipo_caso_equipaje`**. Corregido abajo. `reprogramacion` se caracteriza
> como cancelación (enmienda legal v2.1.1).

**Documentos rectores (leer ANTES de tocar código, están en el repo/proyecto):**
1. `Capa_1_-_Logica_legal_determinista_v2.1.md` — fuente de verdad LEGAL. No inventar reglas que no estén ahí.
2. `motor-capa1-contratos.md` — fuente de verdad de SCHEMAS (entrada `caso`, salida `analisis_legal`, migración, piezas).

**Regla maestra:** si algo del código real contradice estos documentos o este prompt, **DETENERSE y reportar la discrepancia**. No improvisar fixes. No "mejorar de paso" nada fuera del alcance.

**Alcance del ciclo:** migración + datos auxiliares + normalizador + motor + endpoint + UI backoffice + tests.
**Fuera de alcance (NO tocar):** pipeline de extracción de adjuntos, integración api de datos de vuelo, disparo automático del motor al alta, redacción del reclamo, firma, portal cliente (`perfil.html`), portal abogados.

---

## Reglas de NO RUPTURA de la UI actual (aplican a TODAS las fases)

1. **Ningún campo existente se renombra, elimina ni cambia de semántica.** `origen`, `destino`, `tipo_reclamo`, `tipo_incidencia`, `tipo_caso_equipaje`, `monto_gastos`, `moneda_gastos`, `estado` siguen escribiéndose y leyéndose exactamente como hoy.
2. **Todo lo nuevo es aditivo:** columnas nuevas, secciones nuevas en el drawer del backoffice, endpoints nuevos. Nada nuevo se lee desde el flujo público (`index.html` wizard), `panel-agencia.html` (salvo el submit de IATA, aditivo), ni portales existentes.
3. **Espejos derivados en el mismo PATCH:** quien escribe `gastos_items` reescribe `monto_gastos`/`moneda_gastos` (suma, moneda dominante, normalizada a mayúsculas) en el mismo PATCH. Documentar en el código como "espejo derivado — no editar directo" (mismo patrón que `estado` ← `instanciaAEstadoLegacy()`).
4. **El submit de IATA es aditivo:** el label sigue viajando y guardándose en `origen`/`destino` igual que hoy; solo se AGREGA `origen_iata`/`destino_iata` al payload cuando el input tiene `data-iata`. Si no lo tiene, se envía sin esos campos (nunca bloquear un submit que hoy funciona).
5. **Estilo del codebase:** vanilla ES5 en front, ESM en `/api`, comentarios en español, headers de doc en cada `/api/*`, sin dependencias nuevas (permitido: ninguna en este ciclo).
6. **Probar tras cada fase** que el flujo B2C (carga pública), el panel de agencias y el backoffice actual siguen funcionando sin cambios visibles fuera de lo agregado.

---

## Fase 0 — Inventario obligatorio (sin editar nada)

Ejecutar y REPORTAR antes de cualquier cambio:

```
grep -rn "monto_gastos\|moneda_gastos" --include="*.html" --include="*.js" .
grep -rn "tipo_reclamo\|tipo_incidencia\|tipo_caso_equipaje" --include="*.html" --include="*.js" .
grep -rn "origen\b\|destino\b" api/ src/js/ | grep -v airports.json
grep -rn "data-iata\|AirportSelect" --include="*.html" --include="*.js" .
grep -rn "adjuntos\|ai_raw" api/ | head -40
grep -rn "comentarios" --include="*.html" --include="*.js" .
```

Entregable: lista de archivos que leen/escriben cada campo legacy afectado, confirmación de dónde vive el submit del form público y del de agencias, y estado real del campo comentarios (JPA lo está agregando — verificar si ya existe columna/UI y reportar). **Si el inventario contradice el mapeo del documento de contratos (§1.2), detenerse y reportar.**

## Fase 1 — Migración SQL + backfill

- Crear `supabase/NNN_motor_capa1.sql` con el ALTER TABLE y los UPDATE del §3 del documento de contratos (comentario inicial: "Correr en Supabase SQL Editor").
- Crear `scripts/backfill-iata.mjs`: porta la lógica de `resolve()` de `src/js/airport-select.js` (regex de `(XXX)`, códigos sueltos, match único por ciudad/nombre) a Node; lee vía REST los `reclamos` con `origen_iata IS NULL AND deleted_at IS NULL`, resuelve contra `src/data/airports.json`, PATCH por lotes. Al final imprime: resueltos / no resueltos (con id y texto original). Env vars: las mismas `SB_URL`/`SB_KEY` del resto.

**Aceptación:** SQL idempotente (`IF NOT EXISTS`); el script corre en seco con flag `--dry-run` mostrando qué haría; ningún UPDATE toca columnas legacy.

## Fase 2 — Datos auxiliares

- `src/data/airports.json`: agregar `lat`/`lon` a cada aeropuerto. Fuente: dataset abierto OurAirports (dominio público). Escribir un script one-off `scripts/enrich-airports.mjs` que cruce por IATA y reescriba el JSON preservando los campos existentes. **Si no hay acceso de red al dataset, DETENERSE y reportar** (no inventar coordenadas). Reportar cuántos aeropuertos quedaron sin coordenadas.
- `api/_data/paises-ue.js`: export de sets `UE`, `EEE_CH` (UE + IS/NO/LI + CH) y `MONTREAL_PARTES` (arrancar con: toda UE/EEE/CH, AR, US, BR, UY, CL, PY, BO, PE, CO, MX, CA, GB; país no listado → `null` = desconocido, el motor emite FALTA_DATO si lo necesita).
- `api/_data/aerolineas.json`: seed con las aerolíneas operadas en la práctica (Aerolíneas Argentinas, Flybondi, JetSMART, LATAM, Iberia, Air Europa, American, United, Delta, Copa, Avianca, GOL, Azul, Level, British Airways, Air France, KLM, Lufthansa, TAP, Turkish, Emirates, Qatar): `{nombre, iata, pais_licencia, comunitario}`.

**Aceptación:** `airports.json` conserva formato y campos previos (el front lo sigue cargando igual); los tres archivos parsean sin error.

## Fase 3 — Persistir IATA en submits + normalizador

- `index.html`/`src/js/app.js` y `panel-agencia.html`: en el submit, si el input tiene `data-iata`, agregar `origen_iata`/`destino_iata` al payload. Nada más cambia en el form.
- `api/process-ticket.js` y `api/agency.js` (submit-claim): escribir esos campos si vienen. Aditivo, sin validación bloqueante.
- `api/_utils/motor-normalizar.js`: `normalizarCaso(row, airportsIndex, aerolineas, paises)` → objeto `caso` del contrato §1. Deriva: países de origen/destino, flags UE/EEE/CH, internacional/doméstico, distancia ortodrómica (haversine origen→destino final), banda EU261, `comunitario` del carrier. Aplica reglas de campos críticos: `null`, `conflicto: true` en `campos_meta`, o sin verificar → marcar para FALTA_DATO/provisional según §2. Función pura, sin fetch.

**Aceptación:** submit público y de agencia funcionan igual que antes con y sin `data-iata`; `normalizarCaso` es importable y testeable en aislamiento.

## Fase 4 — Motor + ruleset

- `api/_utils/rulesets/2026-06-19.js`: reglas-como-datos. Contiene: Tests A–E (ruteo, incluida la definición de segmento relevante — Pin 4 — y el nodo borde hub-UE), árbol EU261 (B1–B5, tabla de bandas Pin 6, gates check-in), árbol AR (AR-B1–B7, gate protesta con PIR provisional — Pin 3 —, gatillos Pin 2), Montreal como overlay-flag, DOT y ANAC400 como trigger `pendiente_analisis_profundo`, prescripción (AR firme; EU261 `segun_foro` + piso Montreal — Pin 7; días corridos — Pin 5). **Cada regla lleva `base_legal` literal del v2.1.** Todo umbral con consecuencia (3h=180min, 4h=240min, 14/7 días, 2 sem, márgenes 2/3/4h, bandas 1500/3500 km, protesta 3/7/10/21) vive en este archivo, nunca hardcodeado en el evaluador.
- `api/_utils/motor-legal.js`: evaluador genérico `analizar(caso, ruleset, hoy)` → objeto `analisis_legal` del contrato §2. Cumple las 7 reglas de comportamiento del §2. Selección de ruleset por `fecha_incidente` en un helper `seleccionarRuleset(fecha)`.

**Aceptación:** el evaluador no contiene ningún número legal; `analizar` es determinista (misma entrada → misma salida); nunca lanza excepción por datos faltantes (emite FALTA_DATO); toda categoría y gate del output tiene `base_legal` no vacía. **Cualquier ambigüedad legal no cubierta por el v2.1: DETENERSE y reportar, no decidir.**

## Fase 5 — Tests y casos dorados

- `tests/motor.test.js`: runner sin framework (`node tests/motor.test.js`), compara salida real vs. `esperado` por deep-partial-match (solo las claves declaradas en `esperado`), exit code ≠ 0 si falla alguno, resumen legible.
- `tests/casos-dorados.js`: implementar CD-01 (del §5 del contrato) completo como ejemplo + esqueletos `TODO-JPA` para la cobertura mínima del §5 (bordes 179/181 min, solo-PIR, check-in desconocido, protesta fuera de plazo, hub-UE, reducción 50 %, conflicto→provisional). Los `esperado` de los esqueletos quedan vacíos con comentario "completar JPA — criterio legal".
- Tests unitarios mínimos del normalizador: haversine (EZE→MAD ≈ 10.000 km ±2 %), banda, intl/doméstico, campo en conflicto → FALTA_DATO.

**Aceptación:** `node tests/motor.test.js` corre verde con CD-01 y los unitarios; los TODO-JPA se saltean con aviso, no fallan.

## Fase 6 — Endpoint

- En `api/admin.js`: `action=analizar-caso` (POST, `X-Admin-Password`): recibe `{id}`, lee el reclamo, corre normalizador + motor, guarda `analisis_legal = {actual, historial:[...anteriores]}` (historial capado a 10), devuelve el análisis. Errores con mensaje claro, sin 500 por datos incompletos (eso es FALTA_DATO, no error).

**Aceptación:** el endpoint no modifica ningún otro campo del reclamo; dos llamadas seguidas con el caso sin cambios producen el mismo `actual` (salvo `fecha_analisis`).

## Fase 7 — Backoffice (todo dentro del drawer del caso, secciones NUEVAS)

- **Sección "Datos legales del caso"**: editor de los campos del contrato (incidentes como checkboxes, demoras como inputs h:min que guardan minutos, antelación, reencaminamiento, atención, causa, protesta, check-in, fecha_incidente, billete_unico, segmentos como lista simple). Guarda vía `update-ticket` (acción nueva `set-datos-legales` que escribe SOLO estos campos). Editar `gastos_items` (alta/baja de ítems) aplica el espejo (regla 3).
- **Botón "Analizar caso"** → llama al endpoint, muestra spinner, renderiza resultado.
- **Sección "Análisis legal"**: render de `analisis_legal.actual` — marcos con badge (aplica / no / pendiente), gates con estado, categorías coloreadas por estado (RECLAMABLE verde / NO_APLICA gris / FALTA_DATO amarillo / REQUIERE_EVALUACION violeta) con monto y `base_legal`, prescripción por marco (destacar tipo `piso_conservador` y `segun_foro`), nodos EVAL, y lista `faltan_datos` con botón "Crear espera info_pasajero" por ítem (prellena la espera existente con el campo faltante).
- Reusar estilos existentes (`.detail*`, `.badge--*`, `.action-field`); no tocar ninguna sección actual del drawer; no agregar columnas a la tabla principal en este ciclo.

**Aceptación:** con un caso viejo sin datos nuevos, el drawer se ve idéntico a hoy salvo las dos secciones nuevas; analizar ese caso produce un análisis lleno de FALTA_DATO sin errores; el flujo esperas/instancias existente no cambia.

## Cierre del ciclo

- Actualizar `README.md`: columnas nuevas (marcando espejos derivados: `monto_gastos`/`moneda_gastos` "no editar directo"), endpoint nuevo, piezas del motor, cómo correr tests y scripts.
- Reporte final: qué se hizo por fase, discrepancias halladas, aeropuertos sin coordenadas, casos del backfill sin resolver, y lista de TODO-JPA pendientes.

---

## Nota posterior — alcance de la advertencia "origen/destino sin confirmar"

*(agregada al cerrar el ciclo **Intake v2**, 30-jul-2026)*

El mini-ciclo correctivo v2.1.2 agregó al render del análisis legal una advertencia —
**"origen/destino sin confirmar — verificar dirección afectada antes de usar este
análisis"**— que se dispara cuando el caso tiene indicios de conexión o ida y vuelta y
la dirección afectada no está confirmada. Uno de esos indicios era que el caso *pudo*
haberse creado con el scan de IA, porque el prompt de Gemini extraía sistemáticamente la
dirección de **ida** y en un incidente de la vuelta el dato registrado quedaba sesgado.

**Eso ya no aplica a los casos nuevos.** Desde el ciclo Intake v2, el formulario público
y el panel de agencias preguntan explícitamente por el viaje donde ocurrió el problema y
guardan `segmentos` con `afectado` marcado, así que la dirección viene confirmada de
origen. La advertencia queda como lo que corresponde: **una alerta sobre los casos
históricos**, cargados antes de este ciclo.

No hizo falta tocar el código: la advertencia ya se calcula sobre la confirmación real
(`segmentos` con un `afectado`), de modo que un caso del intake nuevo no la dispara y uno
viejo sí. Si algún caso nuevo la muestra, es porque el formulario no pudo resolver los
IATA de la ruta y `segmentos` quedó vacío — que es exactamente cuando corresponde dudar.
