# Motor Capa 1 — Pendientes legales y de verificación

**Estado:** vivo · **Última actualización:** 29-jul-2026 (cierre de Fase 3) · **Decide:** JPA

Registro de lo que el ciclo del motor determinista NO resolvió porque exige decisión
legal o verificación de fuente. Se actualiza al cerrar cada fase.

**Regla de comportamiento mientras un ítem está abierto:** el motor nunca resuelve por
default ni presume. Emite `FALTA_DATO`, `REQUIERE_EVALUACION` o `null` (desconocido), y
el caso queda visible como incompleto. Ningún ítem de esta lista produce silenciosamente
un "no aplica".

Leyenda de estado: **ABIERTO** = falta decisión · **RESUELTO** = ya decidido (queda el
rastro) · **DIFERIDO** = decisión consciente de posponer, con fecha o disparador.

---

## 1. Ámbito territorial de EU261

### 1.1 Territorios dependientes con ISO propio — **ABIERTO** · bloquea precisión del Test A1/A2
*Origen: Fase 2 · `api/_data/paises-ue.js`*

Los territorios dependientes de un Estado miembro tienen **código ISO-2 propio**, así que
no caen dentro del set de los 27. Fort-de-France tiene `pais_iso: 'MQ'`, no `'FR'`.

Sin resolverlo, el Test A1 sobre un vuelo desde Martinica daría **"no aplica"**: falso
negativo sobre lo que con toda probabilidad es territorio cubierto (región
ultraperiférica, TFUE Art. 349). Y al revés, Aruba o Groenlandia son PTU y probablemente
están fuera del ámbito.

**Qué hace el motor mientras tanto:** los 19 códigos están en `TERRITORIOS_AMBIGUOS` y
`enAmbitoEU261()` devuelve `null` para ellos → FALTA_DATO, nunca "no aplica".

**Qué hay que decidir:** clasificar cada código como *dentro* o *fuera* del ámbito de
EU261.

| Grupo | Códigos | Presunción de trabajo (sin validar) |
|---|---|---|
| Francia — regiones ultraperiféricas | GP, MQ, GF, RE, YT | probable **dentro** (TFUE Art. 349) |
| Francia — PTU y colectividades | PF, NC, WF, PM, BL, MF | probable **fuera** |
| Países Bajos — Caribe neerlandés | AW, CW, SX, BQ | probable **fuera** |
| Dinamarca | GL, FO | probable **fuera** |
| Finlandia | AX (Åland) | probable **dentro** |
| Otros | GI (Gibraltar) | **fuera** (post-Brexit) |

### 1.2 Extensión a EEE y Suiza — **ABIERTO** · verificación de fuente
*Origen: v2.1 Test A, marcado `[conocimiento-previo → pendiente reconfirmar]`*

La extensión de EU261 a Islandia, Noruega y Liechtenstein (EEE) y a Suiza (acuerdo
bilateral de transporte aéreo) está en el documento como conocimiento previo, no
verificada contra fuente oficial. Ya está implementada en `EEE_CH` (31 códigos): si la
verificación la desmiente, se corrige ese set y nada más.

### 1.3 Nodo borde hub-UE (*Wegener*) — **ABIERTO por diseño** · no se resuelve por regla
*Origen: v2.1 Pin 4, sello de fuentes `[POR-VERIFICAR]`*

Billete único multi-tramo cuyo origen y destino final están fuera de la UE pero transita
un hub UE. El v2.1 decide explícitamente **no resolverlo por regla** y mandarlo a
verificación caso a caso (línea *Wegener* C-537/17). El motor emite el nodo EVAL
`borde_cobertura_hub`. **No requiere acción**: está así a propósito.

---

## 2. Legitimación pasiva y condición de transportista comunitario

### 2.1 British Airways `comunitario: false` — **ABIERTO** · ratificación
*Origen: Fase 2 · `api/_data/aerolineas.json`*

No es regla nueva: es aplicación directa de la definición del v2.1 (licencia de
explotación de un Estado miembro) sobre el hecho de que el Reino Unido dejó de serlo.
Se marca porque **la consecuencia es fuerte**: apaga el Test A2 en todo vuelo *hacia* la
UE operado por BA (llegada a UE desde tercer país solo aplica con carrier comunitario).
El v2.1 no lo dice explícitamente. Pedido: ratificar.

### 2.2 Level sin código IATA — **ABIERTO** · dato operativo, no legal
*Origen: Fase 2 · `api/_data/aerolineas.json`*

Queda `iata: null` (`pais_licencia: 'ES'`, `comunitario: true`). El largo radio vuela bajo
AOC de Iberia con numeración `IB` y el designador propio de LEVEL Europe está
discontinuado. Se prefirió nulo antes que un código dudoso.

### 2.3 JetSMART — una sola fila — **ABIERTO** · dato operativo
*Origen: Fase 2*

Está la matriz chilena (`JA`/`CL`). La filial argentina opera como `WJ`/`AR`. A efectos de
`comunitario` es indistinto (ninguna es comunitaria), pero **sí importa para el
legitimado pasivo** y para el Test D (internacional que parte de Argentina).

---

## 2bis. Banda del Art. 7(1) — alcance de "intracomunitario"

### 2bis.1 ¿El EEE y Suiza cuentan como intracomunitario? — **ABIERTO** · afecta el monto (€400 vs €600)
*Origen: Fase 3 · `api/_utils/motor-normalizar.js` → `bandaEu261()`*

La tabla del Pin 6 tiene una fila que dice "**Intracomunitarios > 1500 km** y demás
1500–3500 km → €400". Para un vuelo intracomunitario esa fila **no tiene techo**: uno de
4000 km sigue siendo banda de €400, no de €600. Así que decidir si un vuelo es
intracomunitario cambia el monto en €200 por pasajero.

El v2.1 no define si "intracomunitario" abarca solo a los 27 o también al EEE (IS/NO/LI)
y Suiza, que están en el ámbito de aplicación por extensión. Un ES→NO de más de 3500 km
cae justo en la duda.

**Qué hace el motor mientras tanto:** `intracomunitario` es tri-estado — `true` con ambos
extremos en la UE, `false` con al menos uno fuera del ámbito, `null` en el caso mixto
EEE/CH. Y la ambigüedad **solo se propaga por encima de 3500 km**: hasta ahí las dos filas
de la tabla dan €400 igual, así que la banda sale igual. Arriba de 3500 km con extremos
mixtos, `banda_eu261` queda `null` → FALTA_DATO en vez de elegir un monto.

**Qué hay que decidir:** si el EEE/CH cuenta como intracomunitario a efectos del Art. 7(1).

---

## 3. Prescripción

### 3.1 Foro España, 5 años — **ABIERTO** · verificación de fuente
*Origen: v2.1 Prescripción EU261, marcado `[POR-VERIFICAR]`*

Plazo general de acción personal del Art. 1964 CC tras la reforma 2015, con debate
doctrinal sobre los plazos del contrato de transporte.

**Qué hace el motor mientras tanto:** por Pin 7 **no** emite fecha límite para EU261
(`tipo: 'segun_foro'`, no computable). Si además aplica el overlay Montreal, emite el piso
conservador de 2 años (Art. 35) con fecha concreta y marcado como piso. **El motor no se
bloquea por este ítem** — pero tampoco puede dar una fecha de EU261 hasta que se decida
el foro.

---

## 4. Cuantificación (diferida por decisión de negocio)

### 4.1 Cotización del Argentino Oro — **DIFERIDO**
*Origen: v2.1 nodos EVAL Argentina · disparador: activar el quantifier*

Unidad de los límites del transporte interno (2 AO/kg equipaje registrado, 40 AO objetos
en custodia, 1.000 AO muerte/lesión). Cotización trimestral del BCRA.
**Qué hace el motor:** cuantificación **simbólica** — emite `{unidad:'AO', formula:'2 AO/kg'}`
con `cantidad_pendiente: true`, nunca un número en pesos.

### 4.2 Topes SDR de Montreal — **DIFERIDO**
*Origen: v2.1 Principio 3 y Test E (opción B) · disparador: activar el detalle Montreal*

Igual que el anterior: el motor marca la categoría y la unidad, no el monto.

---

## 5. Reglas de fuente jurisprudencial no verificadas contra texto

Las tres están **implementadas** (el v2.1 las da por buenas) y se listan solo para que el
`base_legal` correspondiente quede trazado como derivado de jurisprudencia y no de texto
normativo.

| Regla | Estado en v2.1 | Dónde impacta |
|---|---|---|
| Reducción 50 % aplicada al retraso (solo >3500 km, 3–4 h) | `[CP]` interpretación *Sturgeon/Nelson* del Art. 7(2) | árbol EU261 B3 |
| Conexión perdida en billete único (*Folkerts* C-11/11) | `[CP]` | árbol EU261 B4 |
| Retraso ≥3 h → compensación (*Sturgeon* C-402/07) | `[VA]` vía resumen oficial EUR-Lex | árbol EU261 B3 |

---

## 6. Datos del histórico que exigen revisión humana

No son decisiones legales abstractas: son casos concretos que quedaron con un dato
imperfecto y que el motor va a marcar.

### 6.1 `fecha_incidente` en casos de equipaje — **ABIERTO** · revisión caso por caso
*Origen: Fase 1 · `migration_015_motor_capa1.sql`*

El backfill puso `fecha_incidente = fecha_vuelo` en todo el histórico. En equipaje eso es
**legalmente incorrecto**: la fecha del incidente es la de **entrega** (daño) o la que
**debió ponerse a disposición** (pérdida/demora) — Tabla A fila 13, v2.1. La diferencia
mueve el gate de protesta (3/7/10/21 días) y la prescripción. Hay que corregir a mano los
casos de equipaje en el backoffice.

### 6.2 Casos con IATA sin resolver — **ABIERTO** · carga manual
*Origen: Fase 1 · `scripts/backfill-iata.mjs`*

El resolvedor solo escribe cuando el match es inequívoco. Textos ambiguos ("Córdoba" →
COR/Argentina vs. ODB/España; "Sao Paulo" → CGH vs. GRU) quedan en `null`. El script los
lista al final de cada corrida con ref, id y texto original.

### 6.3 Mapeo de `pir_presentado` a candidato de `protesta` — **RESUELTO** (ratificar)
*Origen: Fase 1 · `scripts/backfill-candidatos.mjs`*

Se mapean los tres valores del formulario al dominio del contrato §1.2 fila 17:
`si` → `{realizada:'si', medio:'pir', numero}` · `no` → `{realizada:'no'}` ·
`no_sabe` → `{realizada:'desconocido'}`. Van como **candidatos** en `datos_extraidos`
(fuente `declaracion_pasajero`, `verificado: false`); la columna canónica `protesta` sigue
`NULL`. **Sin fecha a propósito**: el intake nunca la capturó, y el gate de caducidad se
computa con la fecha de la protesta → sigue siendo FALTA_DATO, que es lo correcto.

---

### 6.4 `billete_unico`: ¿es campo crítico? — **ABIERTO** · discrepancia interna del contrato
*Origen: Fase 3 · `api/_utils/motor-normalizar.js` → `CAMPOS_CRITICOS`*

El documento de contratos se contradice: la enumeración de campos críticos de **§1.1** no
incluye `billete_unico`, pero **§1.2 fila 4** lo marca "Crítico: **sí** (afecta Test A)".

**Qué hace el motor mientras tanto:** lo trata **como crítico**, siguiendo §1.2 (que es la
fila específica del campo). Consecuencia concreta: un caso sin `billete_unico` cargado
suma un FALTA_DATO. Es el criterio conservador; si se decide lo contrario, se saca una
línea de `CAMPOS_CRITICOS`.

### 6.5 Carrier operante vs. comercializador — **ABIERTO** · calidad del dato, no decisión legal
*Origen: Fase 3 · `api/_utils/motor-normalizar.js`*

Tabla A fila 5 exige el transportista **operante**, no el comercializador. Pero mientras
`segmentos` esté vacío, lo único que hay es la columna legacy `aerolinea`, que es lo que
el pasajero declaró en el formulario y puede ser el comercializador.

**Qué hace el motor mientras tanto:** usa `aerolinea` como respaldo y **deja un aviso
explícito** en `caso.avisos` pidiendo cargar `segmentos` para precisarlo. No lo presenta
como dato verificado. En cuanto hay segmentos cargados, manda el `carrier_operante` de
cada uno.

---

## 7. Decisiones ya tomadas en este ciclo (rastro)

| Ítem | Decisión | Dónde quedó |
|---|---|---|
| `reprogramacion` sin destino en Tabla A fila 6 | Se caracteriza como **cancelación** del vuelo original | Enmienda **v2.1.1** al documento legal (commit `919754e`) |
| Equipaje sin `tipo_caso_equipaje` | Queda `[]` → FALTA_DATO. **No** se presume `equipaje_demora`: un tipo presumido correría el gate de protesta con los plazos equivocados (3/7 daño vs. 10/21 pérdida) | `migration_015_motor_capa1.sql` |
| Campos críticos declarativos del histórico | No se escriben como canónicos (§1.1); van como candidatos en `datos_extraidos` | `scripts/backfill-candidatos.mjs` |
| Idioma de países del motor | ISO-3166-1 alfa-2, único, en todo el motor | `api/_data/paises-ue.js` + `pais_iso` en `airports.json` |
| `desconocido` en campos de dominio cerrado | Es **ausencia de dato**, no un valor: `checkin_presentacion: 'desconocido'` y `protesta.realizada: 'desconocido'` cuentan como FALTA_DATO. v2.1 fila 18 lo dice del check-in y fila 17 usa el mismo vocabulario | `api/_utils/motor-normalizar.js` |
| Alta manual del backoffice también persiste IATA | Se sumó al alcance de Fase 3 (no estaba en la lista): es el tercer camino de alta con captura `data-iata` y dejarlo afuera tiraba el dato | `backoffice.html` + `api/admin.js` (`create-case`) |
