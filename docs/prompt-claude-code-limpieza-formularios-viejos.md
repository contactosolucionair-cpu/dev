# Prompt Claude Code — Limpieza: eliminar los formularios de carga previos al wizard

> Ciclo autocontenido. Precede a los ciclos de reprogramación y downgrade: el censo que produce
> es el mapa de entrada de los dos.

> **ENMIENDA DE ALCANCE (2026-08-04, tras el HALT de la Fase 0).** El ciclo **ya no es solo de
> eliminación**. La Fase 0 probó que los formularios de backoffice y agencias son caminos de
> carga vivos, que el disparador del wizard en backoffice vive dentro del formulario que se
> borra, y que el formulario de B2C es un fallback deliberado (`src/js/app.js:59-62`). Se suman
> al alcance, cada uno con **commit propio**:
>
> - **Recableado (H2):** el botón "Nuevo caso" del backoffice pasa a abrir el wizard directo.
>   Alcance estricto: el disparador. Nada más.
> - **Pieza nueva (H3):** en B2C, donde hoy está el formulario largo va un **bloque de contacto
>   estático**. Reglas en la sección "H3 — Bloque de contacto".
> - **Fase 0-bis obligatoria:** paridad de campos formulario→wizard antes de borrar nada.
>
> Se mantiene: sin refactors oportunistas, sin renombres, sin dependencias nuevas,
> `src/js/intake-wizard.js` con diff cero, y `/api`, `vercel.json`, `perfil.html`,
> `panel-abogado.html`, `supabase/` y `scripts/` intocables.

## FASE 0-bis — Paridad de campos (antes de la Fase 1)

Por cada uno de los tres formularios, una tabla: **campo → ¿lo cubre el wizard? → ¿en qué paso?**

**Toda fila sin equivalente en el wizard es HALT.** Borrar un formulario que pregunta algo que el
wizard no pregunta es perder un dato, no limpiar código.

## H3 — Bloque de contacto (reemplaza al formulario largo de B2C)

- **HTML estático, visible por defecto.** Si el JS se rompe entero, el mensaje se ve igual. Nada
  que dependa de JavaScript para renderizarse.
- **El wizard lo oculta al abrir bien**, con el mismo mecanismo que hoy usa `wzOcultarFormViejo`
  (`src/js/app.js:1642`). No inventar un patrón nuevo: se reemplaza *qué* se oculta.
- **Texto:** aviso breve de que hubo un problema para abrir el formulario, más los canales de
  contacto.
- **Los links salen del pie de la web.** Localizar el bloque del footer y reusar esos valores. Si
  están hardcodeados, copiarlos y dejar `/* TODO: unificar con el footer — dos fuentes para los
  mismos contactos */`. Si salen de una constante o de config, usar esa fuente. **No inventar ni
  tipear direcciones nuevas.**
- **Comentario en el código** explicando por qué es estático y por qué se oculta en vez de
  mostrarse: es la razón que hoy documenta `src/js/app.js:59-62` y no se puede perder.

## H4 — Tests (decidido)

- `tests/formularios.test.js`: recortar las secciones 1, 2 y 3 (formularios viejos). Las del
  wizard quedan.
- `tests/escaneo.test.js`: se borra con su objetivo, pero **antes** reportar qué cobertura se
  pierde y si las secciones de wizard de `formularios.test.js` ya la cubren. Si no la cubren,
  decirlo explícito en el reporte final como **deuda de test**.
- `tests/escaneo-superficies.test.js`: leerla y reportar qué ejercita antes de tocarla. Si es
  ambiguo, HALT.

## `declaracion` — decidido

No se cablea. Queda reportada y pendiente de columna en la base.

---

## INSTRUCCIONES

Sos el ejecutor de un ciclo de limpieza en el repo de SolucionAir (HTML estático + JS vanilla
ES5, funciones serverless en `/api`, sin build step). Trabajás por fases.

**Regla global: si en cualquier fase encontrás una discrepancia entre lo que este prompt asume
y lo que existe en el código, DETENETE, reportá la discrepancia con archivo y línea, y esperá
instrucciones. NO improvises soluciones alternativas ni "arregles de paso" nada que no esté acá.**

### Contexto

El intake de casos se unificó en un componente compartido, `src/js/intake-wizard.js`: un popup
de micro-pasos que las tres superficies montan con configuración distinta (`src/js/app.js` para
B2C, `backoffice.html`, `panel-agencia.html`). Ese componente es hoy el único camino de carga
que el negocio usa.

Antes del wizard, cada superficie tenía **su propio formulario de carga** y **su propia copia de
la lógica de consumo del escaneo de IA** (guardar el payload, aplicar la dirección elegida,
listener del selector de tramo). Dos documentos del repo dejan constancia de esas copias:

- `docs/prompt-claude-code-toggle-superficies.md` las ubica en `backoffice.html` (~línea 4926) y
  `panel-agencia.html` (~línea 1094), además de la de `src/js/app.js`.
- `docs/prompt-claude-code-superficies-scan.md` contiene el censo oficial de superficies de
  escaneo y la regla de que ese censo debe revisarse ante cualquier cambio del contrato del
  extractor.

**Las líneas citadas son de un ciclo anterior y pueden haberse corrido. Verificalas, no las
asumas.**

**Hipótesis de este ciclo (a probar en Fase 0, no a dar por cierta):** los formularios viejos y
sus copias de consumo del escaneo ya no tienen llamadores vivos, porque el wizard los reemplazó
en las tres superficies. Si es así, la deuda declarada de "unificar las tres copias" no necesita
ciclo propio: se resuelve borrando.

**Si la hipótesis se refuta en cualquier superficie, HALT.** No borres parcialmente ni "dejes
preparado" nada.

### Alcance estricto

- **Archivos que se pueden editar:** `index.html`, `backoffice.html`, `panel-agencia.html`,
  `src/js/app.js`, y los archivos de `tests/` que cubran exclusivamente los formularios
  eliminados.
- **Archivos que se pueden borrar:** cualquier `src/js/*.js` que la Fase 0 pruebe sin llamadores
  y exclusivo del formulario viejo.
- **Prohibido tocar:** `src/js/intake-wizard.js`, cualquier archivo de `/api`, `vercel.json`,
  `perfil.html`, `panel-abogado.html`, `supabase/`, `scripts/`.
- Sin refactors oportunistas. Sin renombres. Sin cambios de formato en código que no se borra.
- Sin dependencias nuevas.

### Precondición (verificar antes de la Fase 0)

`npm test` **verde**. Si arranca en rojo, HALT y reportá qué falla: sin línea de base no se puede
atribuir ninguna regresión posterior.

---

## FASE 0 — Censo (sin editar nada)

El objetivo de esta fase no es preparar el borrado: es **probar que el borrado es seguro**. Su
salida es un documento en sí mismo.

### 0a. Mapa del wizard

```bash
grep -n "intake-wizard" index.html backoffice.html panel-agencia.html perfil.html panel-abogado.html src/js/*.js
grep -n "IntakeWizard\|initWizard\|wizard(" src/js/app.js backoffice.html panel-agencia.html
```

Reportar, por superficie: dónde se carga el script, con qué configuración se monta, y qué función
dispara la apertura del wizard.

### 0b. Formularios viejos: ¿siguen en el HTML?

```bash
grep -n 'id="f-' index.html backoffice.html panel-agencia.html
grep -n 'id="drop-\|id="inc-\|id="arm-' index.html backoffice.html panel-agencia.html
grep -n "<form" index.html backoffice.html panel-agencia.html
```

**Distinción crítica:** el wizard genera sus campos dinámicamente y puede reutilizar ids del
formulario viejo. Para cada id encontrado, determinar si está en **HTML estático** o si lo
**genera `intake-wizard.js`**. Un id que el wizard genera NO es residuo y no se toca.

Reportar una tabla: id, archivo, línea, origen (estático / generado por el wizard), y quién lo lee.

### 0c. Bloques muertos: límites exactos

Para cada bloque de formulario viejo que resulte estático y sin lectores, reportar el **rango de
líneas exacto** (apertura y cierre del contenedor) y si tiene un `<script>` inline exclusivo.
No borres nada todavía: el borrado necesita límites verificados, no aproximados.

### 0d. Las tres copias del consumo del escaneo

```bash
grep -n "aiData\|aplicarDireccion\|field-ai\|field-ok" src/js/app.js backoffice.html panel-agencia.html
grep -n "process-ticket" index.html backoffice.html panel-agencia.html src/js/*.js
grep -n "fillAirport\|fillField\|processMultipleWithAI\|readFileAsBase64" src/js/app.js src/js/*.js backoffice.html panel-agencia.html
```

Para cada copia encontrada: ¿la llama alguien vivo, o el wizard hace su propio escaneo? Rastreá
la cadena de llamadas hasta un handler de evento real o hasta la nada.

**Atención a las funciones compartidas.** `readFileAsBase64`, `fillAirport`, `fillField` y
`processMultipleWithAI` pueden ser usadas por el wizard además de por el formulario viejo. Cada
una necesita veredicto propio: exclusiva del viejo (se borra) o compartida (se queda, aunque el
llamador viejo desaparezca).

### 0e. Condiciones de HALT

Si aparece **cualquiera** de estas, detenete y reportá antes de tocar nada:

1. **Un flag, toggle, query param o entrada de `site_config`** que alterne entre formulario viejo
   y wizard. Si existe, el viejo es un rollback vivo y borrarlo te lo saca.
2. **Un modal de carga que no sea el wizard** en el backoffice. El censo de escaneo menciona un
   modal `nc-*` cuya naturaleza quedó sin resolver: resolvela acá.
3. **Un llamador vivo** de cualquier función que este prompt asume muerta.
4. **`perfil.html` o `panel-abogado.html`** referenciando algo del formulario viejo. Nunca
   entraron al inventario del wizard.
5. **Un id del formulario viejo leído desde `/api`** o desde un test que cubra el wizard.

### 0f. Tests

```bash
grep -rn "f-incident\|f-notice\|f-refund\|f-viajo\|f-cause\|drop-flight" tests/
grep -rln "intake-wizard\|wizard" tests/
```

Clasificar cada suite de `tests/`: (a) cubre el formulario viejo exclusivamente, (b) cubre el
wizard, (c) cubre las dos cosas. Reportar la clasificación con archivo y línea. **No modifiques
tests en esta fase.**

### 0g. Rastro documental

```bash
grep -rn "formulario viejo\|f-incident\|aplicarDireccion\|toggle-superficies" docs/ README.md CLAUDE.md
```

Listar todo documento que inventaríe los formularios viejos o sus copias como superficies vivas.

### Entregable de la Fase 0

Una tabla con **una fila por pieza candidata a borrado**:

| Pieza | Archivo:líneas | Tipo | ¿Llamadores vivos? | Veredicto |
|---|---|---|---|---|

Veredictos posibles: `MUERTO` (se borra), `COMPARTIDO` (se queda), `HALT` (bloquea el ciclo).

**Criterio de continuación:** cero filas en `HALT`. Con una sola, el ciclo se detiene y esperás
instrucciones.

---

## REGLAS DE DECISIÓN (ejecutar sin consultar)

Estas situaciones ya están decididas. Aplicalas directo.

- **R1 — Bloque HTML estático de formulario viejo, sin lectores vivos:** borrar completo,
  incluidos su `<script>` inline si es exclusivo y sus estilos si son exclusivos y localizables
  sin ambigüedad. Si el CSS es compartido o dudoso, no lo toques y reportalo.
- **R2 — Función JS exclusiva del formulario viejo, sin llamadores:** borrar completa, con su
  comentario de sección encabezante.
- **R3 — Función usada por el wizard además del formulario viejo:** **NO borrar.** Se queda tal
  cual. Reportarla en la tabla como `COMPARTIDO`.
- **R4 — Copia de la lógica de consumo del escaneo sin llamadores:** borrar. Al borrar la última,
  eliminar también los `/* TODO: unificar consumo de escaneo entre superficies */` que hayan
  quedado: la deuda se resolvió por eliminación, y un TODO que ya no aplica desorienta al próximo
  censo.
- **R5 — Test que ejercita exclusivamente un formulario borrado:** borrar en el **mismo commit**
  que su objetivo. Un test que apunta a un id inexistente pasa en verde sin probar nada, que es
  peor que no tenerlo.
- **R6 — Test que cubre las dos cosas:** **NO tocar.** Reportar y esperar instrucciones. Migrarlo
  al wizard no es limpieza, es trabajo nuevo.
- **R7 — Documento que inventaría una pieza borrada como viva:** actualizar en la Fase 2. Los
  prompts de ciclos ya ejecutados **no se reescriben** (son registro histórico): se les agrega
  una nota al pie, igual que se hizo en `ruta-metro.md` con `analyze-document`.

---

## FASE 1 — Borrado

Aplicar R1–R5 según la tabla de la Fase 0.

**Un commit por superficie**, más uno para tests:

```
chore(b2c): eliminar formulario de carga previo al wizard
chore(backoffice): eliminar formulario de carga previo al wizard
chore(agencias): eliminar formulario de carga previo al wizard
test: eliminar suites de los formularios borrados
```

**Criterios de aceptación F1:**

- Chequeo de sintaxis de `src/js/app.js` y de los scripts inline de las tres páginas tocadas.
- Los greps de la Fase 0b y 0d vuelven vacíos para todo lo marcado `MUERTO`.
- Todo lo marcado `COMPARTIDO` sigue presente y sin modificar.
- `src/js/intake-wizard.js` con diff cero.
- `npm test` verde.

---

## FASE 2 — Documentación

Sin esto, el próximo censo vuelve a listar lo borrado. Es exactamente el error que ya se cometió
una vez con `analyze-document`.

1. `docs/prompt-claude-code-superficies-scan.md` — actualizar el **censo oficial de superficies de
   escaneo**. Si las copias de backoffice y agencias desaparecieron, el censo pasa a tener una
   sola fila viva (el wizard). Ajustar el conteo si el documento lo tiene.
2. `docs/prompt-claude-code-toggle-superficies.md` — **no reescribir el cuerpo**. Nota al pie:

   > **Nota posterior:** las tres copias de la lógica de consumo del escaneo que este ciclo
   > alineó fueron eliminadas en el ciclo `limpieza-formularios-viejos`, junto con los
   > formularios de carga previos al wizard. El consumo del escaneo vive hoy en
   > `src/js/intake-wizard.js`, en un solo lugar.

3. `README.md` y `CLAUDE.md` — si describen los formularios viejos como superficies vivas,
   corregir. Si `CLAUDE.md` declara la unificación de las tres copias como deuda técnica
   pendiente, **sacar esa entrada**: se resolvió por eliminación.
4. Cualquier otro documento que la Fase 0g haya listado.

Commit: `docs: sacar los formularios viejos del inventario de superficies`

---

## FASE 3 — Verificación final

1. Chequeo de sintaxis de todos los `.js` de `src/` y de los scripts inline de los siete HTML.
2. `npm test` verde completo.
3. `git diff --stat` acotado a los archivos declarados en el alcance. Cualquier otro = HALT.
4. Grep final de las piezas borradas en todo el repo, `docs/` incluido: el único hit esperado es
   la nota al pie de la Fase 2.

### Reporte final

Entregar:

- **La tabla completa de la Fase 0.** Es el censo oficial y el mapa de entrada de los dos ciclos
  siguientes (reprogramación y downgrade). Que quede legible y completa importa tanto como el
  borrado.
- Qué regla se aplicó a cada fila.
- Qué quedó marcado `COMPARTIDO` y por qué.
- **Qué NO se pudo verificar leyendo código.** Decilo como pendiente, no como hecho.

### Punto de decisión para Juan (reportar, no actuar)

La opción `declaracion` de `intake-wizard.js` genera una casilla obligatoria de "quien carga
declara tener autorización del cliente", que viaja al payload como `declaracion_aceptada` +
`declaracion_texto`. **Ninguna de las tres superficies la pasa hoy** — ni agencias, que es para
quien se agregó.

Reportar el estado exacto: dónde está definida, qué genera, y qué haría falta para cablearla en
`panel-agencia.html`. **No la cablees.** Es decisión de producto pendiente.

---

## Aceptación manual (la hace Juan en preview, no vos)

Sin funcionalidad nueva, la prueba es puramente de no regresión. **Cualquier diferencia respecto
de la línea de base es una regresión.**

### Antes del ciclo — línea de base

Juan carga un caso completo por cada superficie en staging tal como está hoy, y **anota**:

- Qué campos autocompletó el escaneo de IA
- Qué pasos apareció el wizard, en qué orden
- Qué número de caso (`ref_code`) salió

"Anda bien" no sirve: la comparación necesita especificidad.

### Después del ciclo — misma lista

Mismo recorrido en el preview del ciclo, comparado ítem por ítem contra lo anotado:

1. **B2C** (`index.html`): escaneo, wizard completo, envío, `ref_code`.
2. **Backoffice**: escaneo, wizard completo, caso guardado.
3. **Panel de agencias**: escaneo, wizard completo, caso guardado.

Además: que ninguna de las tres páginas tire error de consola al cargar, y que no haya quedado
ningún resto visual del formulario borrado (un bloque vacío, un título huérfano, un separador).
