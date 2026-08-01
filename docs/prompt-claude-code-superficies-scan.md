# Prompt Claude Code — Censo y unificación de superficies de escaneo IA (fix multi-aeropuerto en TODAS las bocas)

> Guardar como `docs/prompt-claude-code-superficies-scan.md` (commit de docs separado del diff del fix).
> Motivación: el fix de ciudades multi-aeropuerto (reglas de prompt + `sanitizeRuta`, ver `docs/prompt-claude-code-ruta-metro.md`) se aplicó a `api/process-ticket.js` y `api/analyze-document.js`, pero el bug se reprodujo en el backoffice y posiblemente en el portal de agencias. Eso indica que existen superficies de escaneo fuera del inventario. Este ciclo las censa TODAS y las alinea.

---

## INSTRUCCIONES

Sos el ejecutor de un ciclo de auditoría + fix en el repo de SolucionAir (HTML estático + JS vanilla ES5, serverless en `/api`, sin build step). **Regla global: ante cualquier hallazgo que no encaje en las reglas de decisión R1–R4 de abajo, DETENETE, reportá archivo y línea, y esperá instrucciones. NO improvises.** Las situaciones previstas en R1–R4 ya están decididas: ejecutalas sin consultar.

### Principio rector (el porqué de este ciclo)

La lógica de ruta (multi-aeropuerto, ida/vuelta, escalas) debe vivir en UN solo lugar: el servidor (`process-ticket` + `_utils/itinerario.js`). Ninguna superficie (B2C, backoffice, agencias) puede tener su propio prompt de extracción ni su propia sanitización de ruta. Las superficies solo difieren en UI y en qué campos muestran.

---

## FASE 0 — Censo exhaustivo de superficies de escaneo (obligatoria, sin ediciones)

```bash
# ¿Quién llama a qué endpoint de extracción?
grep -n "process-ticket" index.html backoffice.html panel-agencia.html perfil.html src/js/*.js
grep -n "analyze-document" index.html backoffice.html panel-agencia.html perfil.html src/js/*.js

# ¿Hay MÁS endpoints que hablen con el modelo de IA? (prompts duplicados)
grep -rln "openrouter" api/
grep -rn "image_url" api/ | cut -d: -f1 | sort -u
grep -rn "REGLAS\|extractor\|Analiza" api/*.js api/**/*.js 2>/dev/null | grep -iv itinerario

# ¿Quién consume la respuesta y cómo?
grep -n "segmentos" index.html backoffice.html panel-agencia.html src/js/app.js api/*.js
grep -n "d.data\|data.origen\|data.destino\|data.escalas" backoffice.html panel-agencia.html

# ¿El escáner del backoffice existe y dónde vive?
grep -n "scan\|Completar con IA\|adjuntar el pasaje\|analizando" backoffice.html
```

Producí una tabla con UNA fila por superficie de escaneo encontrada:

| Superficie | Endpoint que llama | ¿Prompt propio? | Campos que consume | ¿Lee `segmentos`? | ¿Ruta pasa por `sanitizeRuta` server-side? |

Incluí también: (a) todo endpoint en `/api` que construya un prompt de extracción de datos de viaje, aunque ninguna página lo llame (código muerto cuenta y se reporta); (b) si los caminos de persistencia de agencias (`agency/submit-claim`) y backoffice (`admin/create-case`) guardan `segmentos` o solo campos planos — esto NO se arregla en este ciclo, pero va en el reporte como deuda, porque un caso de agencia sin `segmentos` llega distinto al motor legal que uno B2C.

Con la tabla completa, aplicá las reglas de decisión. Si TODA fila cae en R1–R4, continuá. Si alguna no, HALT.

---

## REGLAS DE DECISIÓN (ya decididas — ejecutar sin consultar)

**R1 — La superficie tiene su propio prompt de extracción** (endpoint propio con llamada a OpenRouter, o prompt embebido): eliminarlo y migrar la superficie a llamar `POST /api/process-ticket` en modo scan (`{images: [...]}`), consumiendo el contrato actual de respuesta. El endpoint propio queda eliminado si nadie más lo usa (reportar el borrado). EXCEPCIÓN que gatilla HALT: si la migración exige cambiar más que la llamada fetch y el mapeo de campos (p. ej. la superficie depende de campos que process-ticket no devuelve), frenar y reportar qué falta.

**R2 — La superficie llama a `process-ticket` pero consume solo campos planos** (caso esperado: portal de agencias): verificar campo por campo que los nombres que lee (`data.origen`, etc.) existen en la respuesta actual post-Intake-v2. Corregir todo mapeo roto o desactualizado. NO portar el selector de dirección ida/vuelta ni `segmentos` a esta superficie en este ciclo: los campos planos ya vienen sanitizados del servidor y representan la dirección por defecto. Dejar comentario `/* TODO ciclo C: selector de direccion (segmentos) en esta superficie */` junto al fill.

**R3 — La superficie llama a `analyze-document`**: ya recibe `sanitizeRuta`. Solo verificar el mapeo de campos. Sin cambios salvo mapeo roto.

**R4 — Superficie sin escaneo real** (carga 100% manual, como el modal `nc-*` del backoffice si resulta no tener escáner): sin cambios. Pero si la Fase 0 muestra que el backoffice SÍ tiene escáner (la evidencia de testing dice que sí), esa superficie cae en R1, R2 o R3 según lo encontrado.

**Prohibido en todo escenario:** duplicar reglas de prompt en un endpoint nuevo, agregar sanitización de ruta en el frontend, tocar persistencia (`create-case`, `submit-claim`), tocar `estado`/`instancia`, tocar archivos del ciclo "ivB - FINAL".

---

## FASE 1 — Ejecución por superficie

Aplicar R1–R4 según la tabla. Un commit por superficie modificada, con mensaje `fix(scan): <superficie> unificada a process-ticket / mapeo corregido`.

**Criterios de aceptación F1:**
- `grep -rln "openrouter" api/` devuelve exactamente dos archivos: `process-ticket.js` y `analyze-document.js`. Ni uno más.
- Ninguna página HTML contiene lógica de sanitización de ruta propia (la ruta llega ya sanitizada del servidor).
- Todos los mapeos `respuesta → campos del formulario` de cada superficie corresponden a campos que el endpoint realmente devuelve hoy (verificado contra el código del endpoint, no contra memoria).

---

## FASE 2 — Verificación

### 2a. Alcance del diff
Solo los archivos de las superficies afectadas según la tabla de Fase 0 (+ borrado de endpoints huérfanos si aplicó R1). Cualquier archivo fuera de eso = HALT.

### 2b. Tests
Correr las suites existentes (intake, motor, formularios jsdom). Todo verde. Los 5 tests de `sanitizeRuta` no se tocan.

### 2c. Reporte final
Entregar: la tabla de Fase 0 completa (es el censo oficial de superficies de escaneo — va a servir de checklist para todo cambio futuro del extractor), qué regla se aplicó a cada fila, endpoints eliminados, mapeos corregidos, y la deuda de persistencia de `segmentos` en agencias/backoffice si se confirmó.

### 2d. Prueba de aceptación manual (la hace Juan en preview)
Con el pasaje real USH→EZE / AEP→USH, escanear en LAS TRES superficies:
1. **B2C** (`index.html`): ya validado, re-verificar que sigue: origen USH, destino EZE, sin escalas, segmentos con dirección correcta.
2. **Backoffice**: mismo resultado en campos planos (USH → EZE, sin escala fantasma).
3. **Portal de agencias**: mismo resultado en campos planos.
Si alguna superficie sigue mostrando el colapso después de este ciclo, el problema es del endpoint (no de la superficie) y se reporta como regresión del ciclo anterior — no se parchea en el front.

---

## CENSO OFICIAL DE SUPERFICIES DE ESCANEO (Fase 0, 2026-07-30)

Checklist obligatorio ante cualquier cambio del extractor: si se toca el contrato de
respuesta de un endpoint de IA, hay que revisar estas tres filas.

> **Actualización 2026-08-01 (ciclo `limpieza-analyze-document`):** la fila «B2C por
> documento → `POST /api/analyze-document`» salió del censo. Ese camino era código
> muerto: `setupDocAnalyzer()` buscaba los ids `f-reserva` / `f-boarding`, que no
> existían en ningún HTML, así que nunca llegó a ejecutarse. El endpoint y la función
> fueron eliminados. Toda mención a `analyze-document` más abajo en este documento es
> registro histórico del ciclo original, no una superficie viva.

| # | Superficie | Endpoint | ¿Prompt propio? | Campos que consume | ¿Lee `segmentos`? | ¿`sanitizeRuta` server-side? |
|---|---|---|---|---|---|---|
| 1 | B2C `index.html` + `src/js/app.js:489` (escaneo multi-archivo) | `POST /api/process-ticket` `{images, multiFile}` | No | 15 campos planos | Sí (`app.js:541`) | Sí |
| 2 | Agencias `panel-agencia.html:1067` | `POST /api/process-ticket` `{images}` | No | los mismos 15 | Sí (`:1094`) | Sí |
| 3 | Backoffice modal `nc-*` `backoffice.html:4902` | `POST /api/process-ticket` `{images}` | No | los mismos 15 | Sí (`:4926`) | Sí |

`src/js/app.js:1380` también pega a `process-ticket`, pero es el **alta** del caso, no una
superficie de escaneo.

**Endpoints de IA en `/api`: exactamente uno** — `process-ticket.js`. (En el censo original
eran dos; el segundo resultó ser código muerto y se eliminó, ver la actualización de arriba.)
Verificado por tres vías (`openrouter`, `image_url`, y un barrido de proveedores).
Falsos positivos conocidos del censo:
`_utils/legal-pdf.js:94` ("extractores de PDF" en un comentario) y `backoffice.html:1819`
(`'Analizando...'` del motor legal, no del extractor). `api/utils/` y `api/zoho/` están vacíos.

**Persistencia de `segmentos`:** los tres caminos la escriben — `process-ticket.js:137`,
`agency.js:280`, `admin.js:602`. La deuda que este prompt anticipaba ya estaba cerrada.

### Resultado de las reglas de decisión

R1 (prompt propio) → 0 filas: el criterio F1 ya se cumplía sin tocar nada. R2 (solo campos
planos) → 0 filas: agencias lee `segmentos`. R3 (`analyze-document`) → 1 fila, mapeo
verificado correcto, sin cambios. R4 (sin escaneo) → 0 filas: el backoffice sí tiene escáner.

**La premisa del ciclo era incorrecta.** No había superficies fuera de inventario. La
reproducción del bug venía de que `sanitizeRuta` sanea solo los campos sueltos, y las tres
superficies reconstruyen origen/destino desde `segmentos` al confirmar el tramo. Se cerró
en el ciclo B (`sanitizeSegmentos`), no acá.
