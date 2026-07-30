# Prompt Claude Code — Portar el cableado del selector de dirección a backoffice y panel-agencia

> Guardar como `docs/prompt-claude-code-toggle-superficies.md` (commit de docs separado).
> Contexto: el fix del ciclo "force-fill-tramo" (cablear el selector de dirección a re-aplicar `aplicarDireccion()` desde el payload guardado del escaneo, commit 0a15ac7) se aplicó solo en `src/js/app.js` (B2C). El censo (`docs/prompt-claude-code-superficies-scan.md`) confirmó que backoffice (:4926) y panel-agencia (:1094) tienen su PROPIA copia de la lógica de consumo del escaneo. Bug reproducido en backoffice: el selector de tramo/dirección no actualiza los campos tras la carga inicial. Hipótesis fuerte: esas copias son del patrón pre-fix (selector solo renombra) y panel-agencia tiene el mismo bug aunque aún no se reprodujo manualmente.

---

## INSTRUCCIONES

Repo SolucionAir (HTML + JS vanilla ES5, sin build). **Regla global: discrepancia con lo asumido → HALT con archivo:línea, sin improvisar.** Las decisiones de diseño del ciclo original siguen vigentes y NO se reabren: cambiar dirección es acción explícita del usuario y pisa ediciones manuales; dirección sin segmentos en el payload → el selector solo renombra, sin vaciar campos; ruta descartada → el payload guardado se anula y el selector vuelve a ser cosmético; carga manual sin escaneo → cosmético.

### Alcance estricto
`backoffice.html` y `panel-agencia.html` (sus bloques de script). `tests/` si se agrega cobertura. **No tocar `src/js/app.js`** (la referencia ya funciona y está validada en preview) ni nada de `/api`.

---

## FASE 0 — Inventario (sin ediciones)

Para CADA una de las dos superficies, responder con líneas:

1. ¿Dónde guarda (o descarta) el payload del escaneo? ¿Existe un equivalente de `S.aiData` o el payload se pierde tras el fill inicial?
2. ¿Cuál es el selector de dirección/tramo y qué hace hoy su listener? Confirmar si es solo renombrado (patrón pre-fix) o si ya re-aplica.
3. ¿Cuál es la función equivalente a `aplicarDireccion()` en esa copia, y qué campos escribe (aeropuertos, fecha, vuelo, escalas)?
4. ¿La copia usa AirportSelect/`data-iata` o inputs de texto planos? (El backoffice y agencias podrían no tener el combobox; el re-aplicado debe escribir con la vía que esa superficie ya usa, no importar AirportSelect.)
5. ¿El harness jsdom puede cargar cada página? (`tests/lib/dom.js` — ver si hay limitación de tamaño o de scripts inline.)

Si en alguna superficie el selector YA re-aplica (hipótesis refutada ahí), HALT y reportar antes de tocarla.

---

## FASE 1 — Portar el patrón (una superficie por commit)

Replicar en cada copia el patrón de 0a15ac7 adaptado a su estado local: guardar el payload del escaneo al recibirlo; al cambiar el selector, si el payload tiene tramos de esa dirección, re-ejecutar la función de aplicación de esa superficie (arrastrando aeropuertos, fecha, vuelo y todo lo que esa copia ya escribe en la carga inicial); anular el payload si la superficie tiene flujo de descartar. Los cuatro casos borde de arriba, idénticos al ciclo original.

**Prohibido**: unificar las tres copias en un módulo compartido (es deuda real y conocida, pero es su propio ciclo — dejar `/* TODO: unificar consumo de escaneo entre superficies */` junto al listener nuevo en cada archivo); cambiar el fill inicial que ya funciona; agregar AirportSelect donde no existe.

**Criterios de aceptación F1:** en cada superficie, el listener del selector lee el payload guardado; el payload se anula en el flujo de descarte si existe; comportamiento de carga manual intacto.

## FASE 2 — Verificación

1. Si el harness puede cargar las páginas (Fase 0.5): agregar un e2e estilo `escaneo.test.js` por superficie — fetch mockeado con los dos segmentos USH→EZE / AEP→USH, toggle ida↔vuelta↔ida tres veces verificando los valores visibles, edición manual pisada, y los bordes. Verificar los tests neutralizando el listener nuevo (deben fallar). Si el harness NO puede cargar alguna página, reportarlo como limitación en el README de tests, sin bloquear el fix.
2. `npm test` verde completo.
3. Diff: solo los archivos declarados. Un commit por superficie + uno de tests.
4. Reporte final: líneas del cableado nuevo en cada superficie, resultado de suites, y si la hipótesis se confirmó también en panel-agencia.

## Aceptación manual (Juan, en preview)
Pasaje real USH→EZE / AEP→USH en backoffice Y panel-agencia: carga inicial correcta, toggle alternando USH→EZE ↔ AEP→USH repetidamente, dirección sin datos escaneados sin romper nada.
