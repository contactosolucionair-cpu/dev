# Prompt Claude Code — Limpieza: eliminar el camino muerto de extracción por documento

> Guardar como `docs/prompt-claude-code-limpieza-analyze-document.md`.
> Ciclo autocontenido, solo de eliminación. No introduce comportamiento nuevo.
> Basado en el censo del agente `auditor-superficies` (ver Contexto).

---

## INSTRUCCIONES

Sos el ejecutor de un ciclo de limpieza en el repo de SolucionAir. Trabajás por
fases. **Regla global: si en cualquier fase encontrás una discrepancia entre lo
que este prompt asume y lo que existe en el código, DETENETE, reportá la
discrepancia con archivo y línea, y esperá instrucciones. NO improvises
soluciones alternativas ni "arregles de paso" nada que no esté acá.**

### Contexto

Un censo previo estableció que el camino de extracción por IA de un documento
suelto está muerto:

- `api/analyze-document.js` existe y es funcional, pero **no tiene llamadores**.
  Ninguna superficie del front le hace `fetch`. Backoffice y panel-agencia
  escanean por `/api/process-ticket`.
- `setupDocAnalyzer()` (`src/js/app.js:1142`, llamada en `:1204-1205`) busca los
  ids `f-reserva` y `f-boarding`, que **no existen en ningún HTML del repo** ni se
  generan dinámicamente. La función aborta siempre en `if (!input) return;`
  (`:1144`), dejando todo su cuerpo inalcanzable.
- El endpoint es público, sin auth, con CORS `*`, acepta 10MB y dispara una
  llamada paga a OpenRouter por request. A diferencia de `process-ticket.js`, no
  lee el flag `ai_extraction`, así que apagar la IA por `site_config` no lo apaga.
- No tiene rewrite propio en `vercel.json`: se resuelve por routing de archivo.
  Borrar el archivo alcanza, no hay configuración que limpiar.

Las líneas citadas son del censo y pueden haberse corrido. Verificalas en Fase 0.

---

## FASE 0 — Inventario (sin editar nada)

Corré y reportá el resultado crudo de cada grep, con archivo y línea:

1. `analyze-document` en todo el repo (incluye `docs/`, `vercel.json`, `README.md`)
2. `setupDocAnalyzer` en todo el repo
3. `f-reserva` y `f-boarding` en todo el repo
4. `fetch(` con `analyze-document` en cualquier `.html` y en `src/js/`

**Criterio de continuación:** si (4) devuelve algún llamador vivo, o si (3)
devuelve un `id="f-reserva"` / `id="f-boarding"` en cualquier HTML, **HALT y
reportá**. El resto del ciclo asume cero llamadores y cero ids.

No edites nada en esta fase.

---

## FASE 1 — Eliminar el código

1. Borrar el archivo `api/analyze-document.js` completo.
2. En `src/js/app.js`: borrar la función `setupDocAnalyzer()` completa, incluido
   el comentario de sección que la encabeza, y sus **dos** llamadas
   (`setupDocAnalyzer('f-reserva')` y `setupDocAnalyzer('f-boarding')`).
3. No tocar nada más de `src/js/app.js`. En particular, **no** tocar
   `readFileAsBase64`, `fillAirport`, `fillField` ni `processMultipleWithAI`:
   los usa el escáner multi-archivo, que está vivo.

**Criterio de aceptación F1:**
- Los greps de `analyze-document`, `setupDocAnalyzer`, `f-reserva` y `f-boarding`
  vuelven vacíos en `/api`, en los `.html` y en `src/`.
- `src/js/app.js` pasa el chequeo de sintaxis.
- El escáner multi-archivo de `index.html` sigue intacto: `#ai-file`,
  `processMultipleWithAI` y su `fetch` a `/api/process-ticket` sin cambios.

Commit: `chore: eliminar camino muerto de extracción por documento`

---

## FASE 2 — Corregir los docs que lo inventarían como superficie viva

Dos documentos describen `analyze-document` como una superficie activa. Si
quedan como están, el próximo censo lo vuelve a listar.

1. `docs/prompt-claude-code-superficies-scan.md` (~línea 101): la fila que
   inventaría "B2C por documento → POST /api/analyze-document" describe código
   que ya no existe. **Eliminá la fila** y, si el documento tiene un conteo de
   superficies, ajustalo.
2. `docs/prompt-claude-code-ruta-metro.md` (~líneas 203-222): aplicó
   `sanitizeRuta` a este extractor. **No reescribas el cuerpo del prompt** — es el
   registro de un ciclo ya ejecutado. Agregá una nota al pie al final del archivo:

   > **Nota posterior:** el extractor `api/analyze-document.js` al que esta tarea
   > aplicó `sanitizeRuta` resultó ser código muerto (sin llamadores) y fue
   > eliminado en el ciclo `limpieza-analyze-document`. El fix sigue vigente en
   > `api/process-ticket.js`, que es el único camino vivo.

3. Revisá `README.md`: si lista `/api/analyze-document` en la tabla de endpoints,
   sacá esa fila.

**Criterio de aceptación F2:** el grep de `analyze-document` en `docs/` y
`README.md` solo devuelve la nota al pie de (2), y ninguna referencia que lo
presente como superficie activa.

Commit: `docs: sacar analyze-document del inventario de superficies`

---

## FASE 3 — Verificación final

1. Chequeo de sintaxis de todos los `api/*.js` y de los scripts inline de los
   siete HTML.
2. Grep final de `analyze-document` en todo el repo: único hit esperado, la nota
   al pie de `ruta-metro.md`.
3. Reportá qué quedó pendiente de prueba manual: cargar el formulario B2C y
   verificar que el escáner multi-archivo sigue autocompletando. Eso **no** lo
   podés verificar leyendo código; decilo como pendiente, no como hecho.
