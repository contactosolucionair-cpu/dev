# Inventario Fase 0 — Formulario B2C v2

Censo por grep, sin editar código. Cubre las zonas que toca el rediseño del
formulario B2C (popup + micro-pasos): gastos itemizados, comentario libre del
pasajero, PNR y adjuntos. Se censan las **tres superficies** porque el bloque de
gastos está duplicado en las tres.

Fecha: 2026-08-01. Rama: `staging`.

---

## D1 — Las columnas que se iban a crear YA EXISTEN

El plan acordado asumía dos migrations nuevas. Ninguna hace falta.

| Se asumía | Realidad | Dónde |
|---|---|---|
| Columna JSONB `gastos` nueva | **`gastos_items`** ya existe | `supabase/migration_015_motor_capa1.sql:42` |
| Columna `comentario_caso` nueva | **`comentarios_pasajero`** ya existe | `supabase/migration_015_motor_capa1.sql:41` |

`gastos_items` es JSONB con la forma **`[{concepto, monto, moneda, fecha,
archivo, fuente}]`** (`README.md:169`). Ya contempla `archivo` para el
comprobante y `fuente` para la procedencia: es exactamente la estructura que se
diseñó en el mockup, incluida la asociación gasto↔archivo.

`comentarios_pasajero` es TEXT, "Texto libre del pasajero" (`README.md:168`).

**Nota sobre el nombre:** el censo previo buscó `comentario_caso` —el nombre que
usa `CLAUDE.md` en la regla de documentos legales— y concluyó que no existía. La
columna real se llama `comentarios_pasajero`. El nombre de `CLAUDE.md` no
corresponde a ninguna columna.

→ **Cero migrations en este ciclo.**

---

## D2 — Ninguna superficie de alta escribe `gastos_items`

El contrato es explícito: `gastos_items` es el **canónico** y
`monto_gastos`/`moneda_gastos` son un **espejo derivado que no se edita
directo**; todo PATCH que toca el canónico reescribe el espejo en el mismo PATCH
(mismo patrón que `estado` ← `instancia`).

Declarado en: `README.md:175-179`, `api/_utils/intake.js:112-114`,
`supabase/migration_015_motor_capa1.sql:13`, `docs/motor-capa1-contratos.md:67`.

Estado real por superficie:

| Superficie | Escribe | Archivo:línea |
|---|---|---|
| B2C público | espejo directo, sin ítems | `src/js/app.js:1292-1294` → `api/process-ticket.js:166-168` |
| Portal agencias | espejo directo, sin ítems | `panel-agencia.html:1490` → `api/agency.js:308-309` |
| Backoffice | **`gastos_items`** + espejo, correcto | `backoffice.html:1410,1550` → `api/update-ticket.js:874-894` |

`CAMPOS_DOMINIO_LEGAL` (`api/_utils/intake.js:107`) hace cumplir la regla, pero
solo se consulta en el path de **update genérico** (`api/update-ticket.js:710`).
Las dos vías de **alta** no pasan por ese guard, así que escriben el espejo sin
que nada las frene.

### Consecuencia medible

El motor legal cuenta `gastos_items.length` como insumo del nodo de
**suficiencia probatoria**:

- `api/_utils/rulesets/2024-10-10.js:366,471,599`
- `api/_utils/rulesets/2026-06-19.js:268,415`
- `api/_utils/rulesets/_compartido.js:517`

Los casos que entran por B2C y por agencia llegan con `gastos_items: []` aunque
el pasajero haya declarado gastos. El motor los evalúa como **cero gastos
itemizados**. Un caso cargado a mano por backoffice y uno idéntico cargado por
el cliente no puntúan igual.

Es un defecto preexistente, silencioso, anterior a este ciclo. El agregador de
gastos del rediseño lo corrige de raíz, porque el formulario pasa a producir
ítems en vez de un total suelto.

---

## D3 — `gastos_detalle` queda sin rol claro

`gastos_detalle` TEXT existe desde `supabase/migration_001_expand_reclamos.sql:17`
y hoy recibe el texto libre donde el pasajero escribe todos sus gastos juntos
("Hotel USD 120, Comida USD 45"). Lo escriben B2C (`src/js/app.js:1294`),
agencias y backoffice (`nc-gastos-detalle`, `backoffice.html:450,471`).

Con el agregador, cada gasto tiene su propio `concepto` dentro de `gastos_items`.
`gastos_detalle` queda duplicando información peor estructurada.

---

## D4 — El total declarado NO es un ítem

`docs/motor-capa1-contratos.md:67` es explícito: el total que declara el
pasajero no se carga como ítem, sino como candidato `gastos_total_declarado` en
`datos_extraidos` con `fuente: declaracion_pasajero`, **contrastable contra la
suma de los ítems** — y ese contraste es insumo del EVAL de suficiencia
probatoria.

Relevante para el diseño: el agregador produce ítems, no un total. El total lo
deriva el front sumando por moneda.

---

## PNR y adjuntos — sin sorpresas

**PNR.** Opcional en las tres superficies, sin `data-required` en ninguna:
`index.html:444`, `backoffice.html:412` (`nc-pnr`), `panel-agencia.html:339`
(alta) y `:422` (edición). Pasarlo a obligatorio es cambio de front en los
cuatro puntos; no hay validación de servidor que lo exija ni que lo impida.

**Adjuntos.** El B2C manda todo junto en `scanned_files`
(`src/js/app.js:1312-1313`), mezclando escaneo IA y dropzones, sin etiqueta de
origen. Decisión ya tomada: se mantiene así.

---

## D5 — El editor itemizado del backoffice no adjunta comprobante

El backoffice tiene **dos** lugares con gastos, y hacen cosas distintas:

| Lugar | Qué permite | Archivo:línea |
|---|---|---|
| **Alta de caso** (`nc-`) | Un total suelto + textarea de detalle. Sin ítems. | `backoffice.html:448-450,469-471` → `:5106` |
| **Detalle legal** (`dl-`) | Ítems reales con `+ Ítem` | `backoffice.html:1500-1503`, recolección en `:1526-1528` |

El editor `dl-` produce `{concepto, monto, moneda, fecha, fuente:'admin'}`:
**sin `archivo`**, aunque la forma de `gastos_items` lo admite y el rediseño
adjunta un comprobante por gasto. Si no se corrige, los gastos cargados por un
admin quedan sin comprobante mientras los del cliente sí lo tienen.

---

## Decisiones tomadas (2026-08-01)

1. **Alcance del arreglo del espejo (D2): las tres superficies.** B2C, agencias
   y backoffice. Todas las ventanas de ingreso de casos cargan gastos con el
   mismo formato: **un gasto por vez, con su comprobante**, renombrado
   `Gasto N - MONEDA MONTO.ext` en el submit.
2. **`gastos_detalle` (D3): se conserva, sin rol funcional.** Queda como texto
   libre con el mismo estatus que `comentarios_pasajero`: no alimenta ningún
   cálculo, no deriva nada, existe para lectura humana o para que una IA tome
   el caso completo. Ambos campos siguen bajo la prohibición de `CLAUDE.md`:
   **nunca entran en una plantilla contractual**.
3. **Alcance del UX (D4): las tres.** El popup con micro-pasos se usa en B2C y
   en agencias, y en el backoffice se agrega un **botón en la ventana de cargar
   caso** que abre el mismo UX para rellenar los campos.

### Consecuencia arquitectónica

El punto 3 obliga a que el wizard sea **un componente compartido**, no tres
copias. Eso ataca de raíz la triplicación que `CLAUDE.md` señala como fuente de
fixes a medias: en vez de sumar una cuarta copia divergente, el ciclo colapsa el
formulario nuevo en un solo lugar. Sin build step y en ES5, eso es un `.js` y un
`.css` compartidos que incluyen las tres páginas.
