# Motor Capa 1 — Pendientes legales y de verificación

**Estado:** vivo · **Última actualización:** 30-jul-2026 (mini-ciclo Ruleset IV-B) · **Decide:** JPA

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

### 2.1 British Airways `comunitario: false` — **RESUELTO** (30-jul-2026, JPA: ratificado)
*Origen: Fase 2 · `api/_data/aerolineas.js`*

**Decisión:** ratificado. El Reino Unido perdió la condición de Estado miembro y con ella
la licencia de explotación comunitaria: `comunitario: false` se mantiene, con la
consecuencia asumida de que el Test A2 no se activa en vuelos *hacia* la UE operados por BA.

No era regla nueva: es aplicación directa de la definición del documento legal (licencia
de explotación de un Estado miembro) sobre el hecho de que el Reino Unido dejó de serlo.
Se registró porque **la consecuencia es fuerte**: apaga el Test A2 en todo vuelo *hacia* la
UE operado por BA (la llegada a la UE desde un tercer país solo aplica con carrier
comunitario), y el documento no lo dice con esas palabras.

### 2.2 Level sin código IATA — **ABIERTO** · dato operativo, no legal
*Origen: Fase 2 · `api/_data/aerolineas.js`*

Queda `iata: null` (`pais_licencia: 'ES'`, `comunitario: true`). El largo radio vuela bajo
AOC de Iberia con numeración `IB` y el designador propio de LEVEL Europe está
discontinuado. Se prefirió nulo antes que un código dudoso.

### 2.3 JetSMART — una sola fila — **RESUELTO** (30-jul-2026, mini-ciclo Ruleset IV-B)
*Origen: Fase 2 · `api/_data/aerolineas.js`*

Estaba solo la matriz chilena (`JA`/`CL`). Se agregó la filial argentina como
`WJ`/`AR`/`comunitario: false`. A efectos de `comunitario` es indistinto —ninguna de las
dos es comunitaria—, pero importa para el **legitimado pasivo**, para el Test D y, desde
la v2.2, para el bloque de jurisdicción: el domicilio de un transportista de licencia
argentina es uno de los cuatro foros del Art. 33 de Montreal.

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

## 2ter. Alcance de los gates cuando el caso tiene varios incidentes

`incidentes` es un **conjunto** (Tabla A fila 6), así que un caso puede traer una
cancelación y una denegación de embarque a la vez, o una demora de vuelo y un daño de
equipaje. Los dos gates se escribieron pensando en un incidente por vez y el borde no
está resuelto en el v2.1.

### 2ter.1 Check-in: la excepción de la cancelación en un conjunto mixto — **ABIERTO**
*Origen: Fase 4 · `api/_utils/rulesets/2026-06-19.js` → gate `checkin`*

El Art. 3(2) exime de acreditar la presentación al check-in **en cancelación**. Si el
conjunto de incidentes trae cancelación **y además** denegación de embarque, hoy el gate
pasa para todas las categorías del régimen de disrupción, incluida la de la denegación
—donde la presentación sí importa.

**Qué hace el motor mientras tanto:** aplica la regla del documento tal como está escrita
(si hay cancelación en el conjunto, el gate no es exigible). Es la lectura literal, y es
la más favorable al pasajero.

**Qué hay que decidir:** si la exención debe evaluarse **por incidente** en vez de por
caso. Si se decide que sí, el gate pasa a declarar alcance por incidente y no por
categoría; el evaluador ya soporta gates con alcance, no habría que tocarlo.

### 2ter.2 "Torna inadmisible toda acción" (Art. 20 b Res 1532) — **RESUELTO** (30-jul-2026, JPA: ratificado)
*Origen: Fase 4 · `api/_utils/rulesets/2026-06-19.js` → gate `protesta`*

**Decisión:** ratificado `alcance: ['equipaje']`. El gate solo bloquea las categorías de
equipaje; un daño de valija no protestado a tiempo no mata el reclamo por la demora del
vuelo.

**Alcance temporal de esta ratificación:** rige el ruleset **IV-A**. Para los incidentes
desde el 10-oct-2024 el Art. 20 b ya no existe —el Anexo I del Dec. 809/2024 formula el
protesto como carga, sin la sanción expresa de inadmisibilidad— y gobierna la regla **D2**
de la v2.2: internacional fuera de plazo → `inadmisible` por Montreal Art. 31(4);
doméstico fuera de plazo → `pasa_provisional` + nodo EVAL `sancion_caducidad_domestica`.

El Art. 20 b dice que la falta de protesta en plazo "torna inadmisible **toda acción**".
Leído literalmente, un pasajero que no protestó el daño de su valija a tiempo perdería
también el reclamo por la demora del vuelo, que no tiene nada que ver.

**Qué hace el motor mientras tanto:** el gate de protesta declara `alcance: ['equipaje']`
— solo bloquea las categorías de equipaje. El v2.1 ubica el requisito en AR-B6 (equipaje)
y extenderlo al régimen de disrupción mataría reclamos ajenos a la protesta.

**Qué hay que decidir:** ratificar ese alcance, o confirmar que "toda acción" es realmente
todo el reclamo.

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

**Dónde se cargan a mano:** sección "Datos legales del caso" del drawer del backoffice,
campos *Origen (IATA)* y *Destino final (IATA)*. Muestran la ciudad resuelta debajo del
input, para no cargar un código equivocado a ciegas. Alternativa: cargar los segmentos,
que ganan sobre esos dos campos.

### 6.3 Mapeo de `pir_presentado` a candidato de `protesta` — **RESUELTO** (30-jul-2026, JPA: ratificado)
*Origen: Fase 1 · `scripts/backfill-candidatos.mjs`*

Se mapean los tres valores del formulario al dominio del contrato §1.2 fila 17:
`si` → `{realizada:'si', medio:'pir', numero}` · `no` → `{realizada:'no'}` ·
`no_sabe` → `{realizada:'desconocido'}`. Van como **candidatos** en `datos_extraidos`
(fuente `declaracion_pasajero`, `verificado: false`); la columna canónica `protesta` sigue
`NULL`. **Sin fecha a propósito**: el intake nunca la capturó, y el gate de caducidad se
computa con la fecha de la protesta → sigue siendo FALTA_DATO, que es lo correcto.

**Ratificado el 30-jul-2026, incluida la ausencia deliberada de fecha.**

---

### 6.4 `billete_unico`: ¿es campo crítico? — **RESUELTO** (30-jul-2026, JPA: ratificado el criterio conservador)
*Origen: Fase 3 · `api/_utils/motor-normalizar.js` → `CAMPOS_CRITICOS`*

El documento de contratos se contradecía: la enumeración de campos críticos de **§1.1** no
incluía `billete_unico`, pero **§1.2 fila 4** lo marcaba "Crítico: **sí** (afecta Test A)".

**Decisión:** es crítico, que es lo que el motor ya hacía siguiendo §1.2 (la fila
específica del campo). Un caso sin `billete_unico` cargado suma un FALTA_DATO. La
contradicción se cerró agregándolo a la enumeración de §1.1 del contrato (v1.4).

### 6.5 Carrier operante vs. comercializador — **ABIERTO** · calidad del dato, no decisión legal
*Origen: Fase 3 · `api/_utils/motor-normalizar.js`*

Tabla A fila 5 exige el transportista **operante**, no el comercializador. Pero mientras
`segmentos` esté vacío, lo único que hay es la columna legacy `aerolinea`, que es lo que
el pasajero declaró en el formulario y puede ser el comercializador.

**Qué hace el motor mientras tanto:** usa `aerolinea` como respaldo y **deja un aviso
explícito** en `caso.avisos` pidiendo cargar `segmentos` para precisarlo. No lo presenta
como dato verificado. En cuanto hay segmentos cargados, manda el `carrier_operante` de
cada uno.

### 6.6 Falta un campo de intake: "¿la nueva salida es al día siguiente?" — **ABIERTO** · campo faltante
*Origen: Fase 4 · categoría `EU261.atencion`*

El Art. 9(1)(b)(c) concede **alojamiento** cuando la nueva salida es al día siguiente. Ese
dato no existe en la Tabla A ni en ninguna columna: el intake no lo captura.

**Qué hace el motor mientras tanto:** emite la categoría `atencion` como RECLAMABLE con los
umbrales del Art. 6 (que sí puede computar) y deja dicho en la `nota` que el alojamiento
exige además ese dato. No lo presume ni en un sentido ni en el otro.

**Qué hay que decidir:** si se agrega el campo al contrato de entrada (sería una columna
nueva, p. ej. `nueva_salida_dia_siguiente`) o si el alojamiento se resuelve siempre por
suficiencia probatoria de los gastos itemizados.

### 6.7 ¿Un crítico en conflicto que no se usó hace provisional el análisis? — **ABIERTO** · criterio del motor
*Origen: Fase 5 · caso dorado CD-12 en `tests/casos-dorados.js`*

El §2 regla 3 condiciona el flag `provisional` a que el campo dudoso **se haya usado**. Hay
un caso donde eso da un resultado discutible: un crítico está en conflicto entre fuentes, la
categoría que lo consumía queda bloqueada en FALTA_DATO **antes** de evaluarse, y todo el
resto del caso está verificado. Formalmente, nada de lo que el motor emitió se apoya en un
dato dudoso → `provisional: false`.

**Qué hace el motor mientras tanto:** devuelve `false`, aplicando la regla 3 literal. El
conflicto igual queda visible en `faltan_datos` con `en_conflicto: true`, así que no se
pierde: la categoría afectada sale en FALTA_DATO y el backoffice lo va a mostrar.

**Qué hay que decidir:** si un crítico en conflicto debe marcar provisional el caso entero
aunque su categoría haya quedado bloqueada. CD-12 está construido justo para aislar esta
pregunta (todo lo demás verificado a propósito).

---

## 6bis. Resueltos por la v2.2 (Reglamento Dec. 809/2024)

Referencia cruzada al documento legal. **No se reabren acá**: lo que sigue es dónde quedó
cada uno en el código.

| Ítem | Resolución de la v2.2 | Dónde quedó |
|---|---|---|
| Derogación de la Res. 1532/98 | El Dec. 809/2024 la derogó con vigencia 10-oct-2024. La Parte IV se parte en IV-A (hasta el 9-oct-2024, ley al momento del hecho) y IV-B (desde el 10) | `rulesets/2026-06-19.js` + `rulesets/2024-10-10.js`, seleccionados por `fecha_incidente` |
| Ámbito amplio del Test D | El régimen AR aplica a la dirección doméstica argentina **o internacional con origen O destino en AR**: el criterio es el servicio explotado en el país, no la dirección del vuelo | Test D de los **dos** rulesets. Cambió el resultado de dos casos dorados (CD-11 y CD-13): antes daban `no` por no partir de Argentina |
| Reprogramación como tipo propio (D1) | Régimen propio del Art. 42 desde el 10-oct-2024; el mapeo a cancelación de la v2.1.1 queda acotado a los incidentes anteriores | `rulesets/2024-10-10.js`, `_utils/intake.js`, dominio de `incidentes` en sus cuatro copias |
| Caducidad doméstica post-809 (D2) | Regla conservadora: internacional fuera de plazo → `inadmisible` (Montreal Art. 31(4)); doméstico fuera de plazo → `pasa_provisional` + EVAL, porque el Anexo I no reprodujo la sanción expresa del Art. 20 b | Gate `protesto` de `rulesets/2024-10-10.js` |
| Destino contractual en ida y vuelta (D3) | Es el **punto de partida** (línea *Grein v. Imperial Airways*, anclada en el Art. 1(2) de Montreal). Gobierna el foro, no la admisibilidad | `rulesets/_compartido.js` → `jurisdiccion()`; el normalizador expone los hechos del billete |
| Horario nocturno (D4) | La espera que transcurre total o parcialmente entre las 00:00 y las 06:00 activa comidas y refrescos aunque el retraso no llegue a 4 h | `rulesets/2024-10-10.js` → `servicios_incidentales`. **Ver 6bis.1: falta el dato de entrada** |

### 6bis.1 `hora_salida_programada` no existe en el sistema — **ABIERTO** · bloquea D4
*Origen: mini-ciclo Ruleset IV-B · `rulesets/2024-10-10.js` → `servicios_incidentales`*

La regla nocturna del Art. 43 a necesita la **hora programada de partida** para saber si la
espera cayó en la franja 00:00–06:00. Ese dato no existe en ningún lado: `fecha_incidente`
es `DATE`, `segmentos[].fecha` es `YYYY-MM-DD` y ninguno de los tres formularios captura
hora.

**Qué hace el motor mientras tanto** (decisión JPA del 30-jul-2026): en la banda ≤ 4 h de
IV-B emite `FALTA_DATO` en `servicios_incidentales` con `dato_faltante:
'hora_salida_programada'` y la nota que explica el criterio D4. **No** emite `NO_APLICA`:
eso afirmaría una conclusión legal que los datos no sostienen y le negaría en silencio al
pasajero un derecho que quizás tiene. El FALTA_DATO está acotado a esa categoría y a esa
banda: las de > 4 h y > 8 h no dependen de la hora y siguen deterministas.

**Por dónde entra el dato, cuando entre:** *no* por un campo nuevo en el formulario —la
memoria del pasajero es fuente débil— sino por el **lookup de vuelo por número + fecha**
(API tipo AeroDataBox) ya especificado en otro ciclo, que devuelve horarios programados y
reales con procedencia `api_vuelo`, la de mayor jerarquía probatoria del contrato. Cuando
ese ciclo exista, este FALTA_DATO se cierra solo, sin tocar formularios.

---

## 7. Decisiones ya tomadas en este ciclo (rastro)

| Ítem | Decisión | Dónde quedó |
|---|---|---|
| `reprogramacion` sin destino en Tabla A fila 6 | Se caracteriza como **cancelación** del vuelo original. **Acotado por la v2.2 (D1): ese mapeo rige SOLO para incidentes anteriores al 10-oct-2024.** Desde esa fecha la reprogramación es tipo propio (Art. 42 del Reglamento Dec. 809/2024), porque mapearla a cancelación concedía los derechos del Art. 41 —alternativas y reintegro— que el Art. 42 no otorga: riesgo de sobre-reclamo | Enmienda **v2.1.1** (commit `919754e`) + **v2.2 D1** · `rulesets/2024-10-10.js`, `_utils/intake.js` |
| Equipaje sin `tipo_caso_equipaje` | Queda `[]` → FALTA_DATO. **No** se presume `equipaje_demora`: un tipo presumido correría el gate de protesta con los plazos equivocados (3/7 daño vs. 10/21 pérdida) | `migration_015_motor_capa1.sql` |
| Campos críticos declarativos del histórico | No se escriben como canónicos (§1.1); van como candidatos en `datos_extraidos` | `scripts/backfill-candidatos.mjs` |
| Idioma de países del motor | ISO-3166-1 alfa-2, único, en todo el motor | `api/_data/paises-ue.js` + `pais_iso` en `airports.json` |
| Sección 8 de este documento | Se agregó un apartado de pendientes **técnicos**, no legales. Va acá y no en un documento aparte para que haya un solo lugar que revisar | § 8 |
| `desconocido` en campos de dominio cerrado | Es **ausencia de dato**, no un valor: `checkin_presentacion: 'desconocido'` y `protesta.realizada: 'desconocido'` cuentan como FALTA_DATO. v2.1 fila 18 lo dice del check-in y fila 17 usa el mismo vocabulario | `api/_utils/motor-normalizar.js` |
| Alta manual del backoffice también persiste IATA | Se sumó al alcance de Fase 3 (no estaba en la lista): es el tercer camino de alta con captura `data-iata` y dejarlo afuera tiraba el dato | `backoffice.html` + `api/admin.js` (`create-case`) |
| Cancelación con aviso < 14 días y `reencaminamiento` desconocido | **FALTA_DATO**, no RECLAMABLE ni NO_APLICA. Las exoneraciones (ii) y (iii) del Art. 5(1)(c) exigen un reencaminamiento dentro de margen: sin ese dato no se puede confirmar ni descartar la exoneración, y el motor no elige. **RATIFICADO (30-jul-2026)** — la alternativa (conceder la compensación porque la carga de la prueba es del transportista, Art. 5(4)) es defendible pero no está escrita en el documento legal | `rulesets/2026-06-19.js` → `EU261.compensacion_tarifada` |
| Denegación de embarque con `reencaminamiento` desconocido | **RECLAMABLE por el monto pleno**, con nota. A diferencia de la cancelación, acá la compensación corresponde sin umbral (Art. 4(3)) y lo único dudoso es si se reduce 50 %: la reducción del Art. 7(2) es defensa del transportista, igual que las circunstancias extraordinarias. **RATIFICADO (30-jul-2026)** | `rulesets/2026-06-19.js` → `EU261.compensacion_tarifada` |
| Voluntariedad de la denegación de embarque | No es campo de intake. La compensación sale RECLAMABLE (el caso se presenta como involuntario) y la voluntariedad se emite como nodo EVAL, mismo patrón que las circunstancias extraordinarias | `rulesets/2026-06-19.js` |
| Piso conservador de Montreal sobre un caso EU261 | Va como sub-objeto `piso_conservador` dentro de la prescripción de EU261, que sigue siendo `tipo: 'segun_foro'` con `fecha_limite: null`. Así se cumple el Pin 7 (fecha concreta, marcada como piso) sin mal etiquetar el plazo propio de Montreal, que es firme | `rulesets/2026-06-19.js` → `EU261.prescripcion` |
| Cómputo de años en prescripción | 29-feb + 1 año cae el 1-mar (normalización de `Date`). Días corridos, en UTC, para que el huso del servidor no mueva un plazo legal | `motor-legal.js` → `sumarAnios()` |

---

## 8. Pendientes técnicos (no legales)

Nada de esta sección necesita criterio legal: son verificaciones de deploy que solo se
pueden hacer contra un entorno real. Van en este documento y no en otro aparte para que
haya un solo lugar que revisar.

### 8.1 El glob de `includeFiles` con llaves — **A VERIFICAR EN PREVIEW**
*Origen: Fase 6 · `vercel.json`*

El endpoint `analizar-caso` necesita leer en runtime `src/data/airports.json` (~800 KB) y
`api/_data/aerolineas.json`. El proyecto ya resuelve esto con `includeFiles`, y en Fase 6
el glob pasó de `templates/**` a `{templates,src/data,api/_data}/**`.

Localmente funciona (el cargador encuentra los dos archivos), pero **la expansión de
llaves en el bundler de Vercel no se puede probar sin deployar**.

**Cómo se detecta:** el botón "Analizar caso" del backoffice devuelve
`El motor legal no está disponible: No se encontró src/data/airports.json. Rutas
probadas: … Si esto pasa en Vercel, falta el glob en functions.includeFiles de
vercel.json.` El cargador falla con ese mensaje a propósito, en vez de un 500 opaco.

**Arreglo si falla:** reemplazar el glob por entradas sin llaves o por `src/**`.

### 8.2 `src/img/**` no está en `includeFiles` — **A VERIFICAR** · impacto cosmético
*Origen: hallado en Fase 6, preexistente*

`api/_utils/legal-pdf.js` y `api/_utils/pdf-receipt.js` leen los logos con
`path.join(process.cwd(), 'src', 'img', …)`. `src/img` **no está** en el `includeFiles` de
`api/admin.js` (ni antes ni después del cambio de 8.1), y `api/process-ticket.js` no tiene
entrada en `functions` en absoluto.

Las dos lecturas están envueltas en `try/catch`, así que si el archivo no está el PDF sale
**sin logo, en silencio** (queda un `console.error`). Por eso puede llevar mucho tiempo sin
que nadie lo note.

**Cómo se verifica:** abrir un poder o un comprobante de aceptación generado en producción
y mirar si tiene el membrete.

**Arreglo si falla:** cambiar el glob de 8.1 por `{templates,src,api/_data}/**` (agrega
`src/img`, `src/css` y `src/js`, todo chico) y agregar una entrada `functions` para
`api/process-ticket.js`.

### 8.3 `index.html` no está en `includeFiles` y `loadTycText()` no está guardado — **A VERIFICAR** · impacto potencialmente serio
*Origen: hallado en Fase 6, preexistente*

`api/_utils/tyc-text.js` lee **`index.html`** con `process.cwd()` para extraer el texto de
los T&C y la versión del consentimiento. A diferencia de los logos, `loadTycText()` **no
tiene try/catch propio**: si el archivo no está, `readFileSync` lanza.

Quiénes dependen de eso:

- `api/_utils/pdf-receipt.js` → el **PDF de aceptación de T&C** que se genera en el alta
  pública. En `api/process-ticket.js` la generación está envuelta en try/catch, así que un
  fallo acá significa que **el caso se crea sin su PDF de aceptación, en silencio**. Ese
  PDF es la constancia de la firma electrónica, así que el impacto no es cosmético.
- `api/_utils/legal-docs.js` → la generación del documento de T&C desde el backoffice.

**Ojo:** esto puede estar funcionando perfectamente. Vercel podría estar incluyendo los
archivos estáticos de la raíz en el bundle de la función; no se puede saber sin mirar un
deploy real. **No asumir que está roto.**

**Cómo se verifica (rápido):** abrir en el backoffice un caso creado recientemente por el
formulario público y ver si tiene adjunto su `Aceptacion_TyC_CSAxxxxx.pdf`. Si está, 8.3 no
existe. Si no está, revisar los logs de `process-ticket` buscando
`[process-ticket] PDF generation error`.

**Arreglo si falla:** agregar `index.html` al `includeFiles` de las funciones que lo
necesitan (`api/admin.js` y `api/process-ticket.js`).
