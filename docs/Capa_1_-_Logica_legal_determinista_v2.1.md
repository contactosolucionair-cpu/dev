# **Capa 1 · Lógica legal determinista**

## **Ruteo de jurisdicción \+ Admisibilidad EU261 (piloto)**

**Versión:** v2.1.2 · **Fecha:** 30-jul-2026 · **Estado:** validado JPA (decisiones 1–4 y pins 1–7 confirmados)

---

### **Alcance y frontera**

Documento de lógica legal en papel. No contiene código, esquemas de datos, ni decisiones de plataforma. Cubre la **Capa 1** (regla determinista): identificación de marco(s) aplicable(s) \+ análisis determinista de derecho a reclamo, compensación, reembolso, reencaminamiento y asistencia.

**Principios operativos:**

1. **Jurisdicciones no excluyentes.** Un caso puede activar varios marcos a la vez (p. ej. EU261 \+ Montreal sobre el mismo vuelo). El árbol devuelve **todos** los marcos aplicables y **todas** las categorías reclamables por marco. Nunca elige un "ganador". Es la regla de cuantificación exhaustiva: liquidar todos los derechos, no ganar el punto principal.  
2. **Frontera dura.** La Capa 1 resuelve lo determinable por regla y marca **explícitamente** como \[REQUIERE EVALUACIÓN\] los nodos difusos (circunstancias extraordinarias, suficiencia probatoria, daños no tarifados). No se resuelve lo difuso acá.  
3. **Montreal como overlay.** Capa superpuesta en transporte internacional. El ruteo solo marca que Montreal aplica \+ qué categorías; los topes en SDR se fijan en el detalle de Montreal (diferido), no en este documento.  
4. **Equipaje, tratamiento transversal.** El equipaje (daño/demora/pérdida) **nunca** es categoría del régimen de disrupción de pasajeros. EU261 lo excluye expresamente; cada régimen declara su propio tratamiento en su árbol profundo: en transporte **internacional** rige el overlay Montreal (topes SDR); en **doméstico/intra-UE**, la legislación nacional aplicable del Estado (en AR, Código Aeronáutico \+ Res 1532 en Argentinos Oro; en UE, la ley nacional del Estado correspondiente — ver Componente 2). La admisibilidad puede estar sujeta a plazos de protesta propios de cada régimen.

### **Changelog**

* **v2.1.2 (30-jul-2026):** precisión al Pin 4 — en billetes de ida y vuelta (o multi-destino), cada **dirección** es un itinerario independiente; la unidad de análisis del motor es la **dirección afectada** por el incidente (nota en Test A). Motiva: la regla literal del Pin 4 daba origen \= destino en billetes redondos.
* **v2.1.1 (29-jul-2026):** reprogramación → se caracteriza como cancelación (nota en Tabla A fila 6). Motiva: dominio real del intake (`tipo_incidencia='reprogramacion'`) sin destino en la fila 6.
* **v2.1 (29-jul-2026):** integración de los **pins de implementación 1–7** (validados JPA), cierres necesarios para traducir el documento a motor determinista:
  * **Pin 1** — Medición de la llegada EU261: apertura de puertas (TJUE *Germanwings* C-452/13). Tabla A fila 7 desdoblada en 7a (demora de salida) y 7b (demora de llegada).
  * **Pin 2** — Argentina: servicios incidentales se gatillan por demora de **salida** \> 4 h; daño por demora acreditado se mide contra la **llegada** (AR-B3 / AR-B5).
  * **Pin 3** — Dos campos nuevos en Tabla A: **Protesta** (fila 17; PIR solo → gate pasa provisional \+ \[EVAL: suficiencia de la protesta\]) y **Presentación al check-in** (fila 18; condición de ámbito EU261 Art. 3(2)).
  * **Pin 4** — Definición de "segmento relevante" en el Test A: billete único se evalúa como itinerario completo (Art. 2(h)); billetes separados, por billete; tránsito por hub UE sin origen/destino UE → nodo borde *Wegener*.
  * **Pin 5** — Cómputo de plazos de protesta y prescripción: **días corridos**, vencimiento 24:00 del último día.
  * **Pin 6** — Tabla explícita de bandas Art. 7(1)/(2) (montos plenos y reducidos).
  * **Pin 7** — Comportamiento del motor ante prescripción EU261: `segun_foro (no computable)`; si aplica overlay Montreal, se calcula el piso conservador de 2 años (Art. 35) con fecha límite concreta.
  * Fila 13 precisada: en equipaje, la fecha del incidente es la de entrega (o la fecha en que debió ponerse a disposición), no la del vuelo.
* **v2.0 (19-jun-2026):**  
  * **Tarea 1 (equipaje EU261):** agregado principio transversal de equipaje (Principio 4); fila "Equipaje → NO APLICA EU261" en la matriz del Componente 3 (EU261); nota de ruteo de equipaje en Componente 2\. Componente 1 revisado: sin cambios (equipaje ya en filas 6 y 14).  
  * **Tarea 2 (legislación local UE \+ NEB):** nueva subsección de punteros en Componente 2 — identifica la ley nacional de relleno \+ el NEB competente (Art. 16 EU261). Solo identifica y apunta; el contenido sustantivo queda diferido.  
  * **Tarea 3 (Argentina profundo):** nuevo régimen profundo AR (Parte IV) con la misma estructura que EU261: ramas por incidente, matriz exhaustiva de categorías, nodos \[REQUIERE EVALUACIÓN\] y prescripción. Hallazgo central: **la Res 1532 NO tarifa compensación**. Foro federal civil y comercial; Ley 24.240 supletoria (Art. 63); **daño punitivo NO APLICA contra la aerolínea**.  
  * **Sello de fuentes** renumerado a Parte V; incorporados los ítems AR (verificados contra InfoLEG texto consolidado, argentina.gob.ar y jurisprudencia 2024-25) y los ítems de equipaje/NEB.  
  * Verificado en sesión 19-jun-2026. El árbol EU261 (Parte III) permanece intacto salvo la línea de equipaje.  
* **v1.0 (18-jun-2026):** versión inicial. Componente 1 (hechos \+ salidas) ya validado por el usuario e incorporado. Componente 2 (ruteo) y Componente 3 (EU261 profundo \-\> piloto) construidos. EU261 verificado íntegro contra EUR-Lex. Árboles profundos de US/DOT, Brasil/ANAC 400, Argentina/Res 1532 y detalle Montreal SDR: pendientes (fases siguientes).

---

# **Parte I — Componente 1: Hechos y salidas**

## **Tabla A — Hechos que consume la regla**

Capa 1 \= alimenta la regla determinista. captura→eval \= se captura pero alimenta la capa de evaluación. mixto \= parte determinista, parte evaluación.

| \# | Campo | Dominio | Para qué lo usa la regla | Capa |
| ----- | ----- | ----- | ----- | ----- |
| 1 | Origen | IATA \+ país; ¿UE/EEE/CH? | EU261 (sale de UE); intl/doméstico | 1 |
| 2 | Destino final | IATA \+ país; ¿UE/EEE/CH? | EU261 (llega a UE, cond. carrier comunitario); banda distancia; intl/doméstico | 1 |
| 3 | Conexiones/segmentos | lista (aeropuerto, país, carrier operante) | itinerario; hub UE intermedio (nodo borde); conexión perdida | 1 |
| 4 | ¿Billete único? | sí/no | evaluar como un todo (destino final) vs por tramos | 1 |
| 5 | Carrier operante/segmento | nombre; país licencia; ¿comunitario? | EU261 hacia UE; legitimado pasivo. **Operante, no comercializador** | 1 |
| 6 | Tipo(s) de incidente | **conjunto**: demora / cancelación / denegación embarque / downgrade / conexión perdida / equipaje {demora,daño,pérdida} / muerte-lesión. Nota (v2.1.1): la reprogramación impuesta por el transportador (cambio de fecha/horario del vuelo contratado) no es un tipo propio: se trata como cancelación del vuelo original. Las sub-reglas de antelación y reencaminamiento (EU261 Art. 5(1)(c); AR-B2) absorben los casos de cambio menor con aviso suficiente. [decisión JPA; por-verificar al activar detalle: línea TJUE sobre cambios menores de horario] | activa ramas de categoría | 1 |
| 7a | Demora de salida | horas:minutos vs. hora programada de salida | gatillo atención EU261 (Art. 6: 2/3/4 h por banda) y **servicios incidentales AR** (\> 4 h, Pin 2\) | 1 |
| 7b | Demora de llegada al destino final | horas:minutos; **llegada \= apertura de al menos una puerta** (TJUE *Germanwings* C-452/13, Pin 1). Fuente preferida: registros operativos del vuelo | gatillo compensación EU261 ≥3 h (Sturgeon); reducción 50 %; **daño por demora acreditado AR/Montreal** (Pin 2\) | 1 |
| 8 | Antelación aviso cancelación | días/horas pre-salida programada | régimen cancelación (14/7 días \+ sub-reglas Art. 5(1)(c)) | 1 |
| 9 | Distancia | km, ortodrómica origen→destino final | banda €250/400/600 | 1 |
| 10 | ¿Reencaminamiento ofrecido? \+ tiempos | sí/no; horario alt. vs programado | sub-reglas cancelación; reducción 50 % por arribo en margen | 1 |
| 11 | ¿Atención ofrecida? \+ qué | sí/no; refrigerio/comida/aloj./comunic. | incumplimiento Art. 9 como categoría | 1 |
| 12 | Internacional vs doméstico | derivado de origen/destino país | aplicabilidad Montreal | 1 |
| 13 | Fecha del incidente | fecha. **En equipaje: la fecha de entrega (daño) o la fecha en que debió ponerse a disposición (pérdida/demora), no la del vuelo** (v2.1) | prescripción \+ versión vigente \+ gate de protesta | 1 |
| 14 | Monto reclamado / gastos acreditados | montos \+ comprobantes | cap SDR Montreal (equipaje; demora Art. 19): tope \= Capa 1 | mixto (suficiencia \= eval) |
| 15 | Causa alegada por la aerolínea | texto libre | insumo nodo circunstancias extraordinarias | captura→eval |
| 16 | Soporte probatorio del daño | documentos | insumo evaluación | captura→eval |
| 17 | Protesta (equipaje) | realizada: sí/no/desconocido; fecha; medio {PIR aeropuerto, protesta escrita} | **Gate de caducidad** (Res 1532 Art. 20 / Montreal Art. 31). Se computa con la fecha de cualquier protesta, PIR incluido; si **solo** hay PIR, el gate pasa **provisionalmente** \+ \[REQUIERE EVALUACIÓN: suficiencia de la protesta\] (jurisprudencia dividida sobre equivalencia PIR \= protesta). Pin 3 | 1 |
| 18 | Presentación al check-in | en\_hora / tarde / no\_presentado / no\_aplica (cancelación) / desconocido | Condición de ámbito EU261 (Art. 3(2): presentación en hora, salvo cancelación) y AR (Art. 12 c: no presentado / no reconfirmado excluido). **desconocido \= FALTA\_DATO; nunca se presume.** Pin 3 | 1 |

**Excepciones documentadas (no son campos de intake):**

* **Exclusión EU261 Art. 3(1)(b)** (beneficios/compensación ya recibidos bajo ley de tercer país): quien ya cobró no inicia reclamo → se trata como excepción, no como campo.  
* **Downgrade (Art. 10):** tipo de incidente reconocido (fila 6), pero su cuantificación exige clase pagada/volada, dato que faltará en intake → excepción de análisis manual.  
* **Declaración especial de interés en equipaje (Montreal Art. 22(2)):** excepción, no campo.

## **Tabla B — Salidas que devuelve la regla**

| Salida | Contenido |
| ----- | ----- |
| Marco(s) aplicable(s) | Lista **no excluyente** (EU261 / DOT / ANAC 400 / ANAC 1532 / overlay Montreal), cada uno con la regla que lo activó |
| Matriz de categorías por marco | Por categoría: estado {reclamable / falta dato X / no aplica \+ motivo} \+ monto tarifado si es determinista. Enumeración exhaustiva: compensación tarifada, reembolso, reencaminamiento, asistencia/atención, daño Montreal (equipaje/demora/lesión), daño moral, punitivo |
| Prescripción por marco | Plazo \+ fecha límite calculada desde fecha del incidente |
| Nodos \[REQUIERE EVALUACIÓN\] | Lista, cada uno con la duda/dato concreto |
| Trazabilidad | Por cada estado, artículo/regla que lo fundamenta (auditabilidad) |

---

# **Parte II — Componente 2: Árbol de ruteo de jurisdicción**

Cubre **todas** las jurisdicciones. Función: dado el itinerario \+ carrier \+ tipo de incidente \+ intl/doméstico \+ fecha, devolver el **conjunto** de marcos aplicables. Los marcos se evalúan en paralelo (cada uno con su propio test); un caso puede pasar varios.

## **Paso 0 — Normalización**

1. Descomponer el itinerario en segmentos: (aeropuerto+país origen, aeropuerto+país destino, transportista operante, país de licencia del operante).  
2. Identificar **destino final**: el destino del billete; en vuelos con conexión directa, el destino del último vuelo (definición Art. 2(h) EU261). No se consideran conexiones alternativas si se respeta la hora de llegada inicial.  
3. Marcar si es **billete único**.  
4. Determinar **internacional vs doméstico**: si todos los segmentos quedan dentro de un mismo país → doméstico; si cruza fronteras → internacional.

## **Tests de aplicabilidad (en paralelo)**

### **Test A — EU261/2004**

Aplica si se cumple **A1 o A2** (y no opera una exclusión):

* **A1 — Salida UE:** algún segmento relevante **parte de** un aeropuerto situado en territorio de un Estado miembro → EU261 aplica, **con cualquier transportista** (Art. 3(1)(a)).  
* **A2 — Llegada UE desde tercer país:** algún segmento relevante **parte de un tercer país con destino a** un aeropuerto de un Estado miembro → EU261 aplica **solo si** el transportista operante es **comunitario** (licencia de explotación de un Estado miembro) **y** el pasajero **no** disfrutó de beneficios/compensación/asistencia en ese tercer país (Art. 3(1)(b)).  
* **Extensión territorial:** además de Estados miembros UE, se extiende a Islandia, Noruega y Liechtenstein (EEE) y a Suiza (acuerdo bilateral de transporte aéreo). *\[conocimiento-previo \-\> pendiente reconfirmar\]*

**Definición de "segmento relevante" (Pin 4, v2.1):**

* Con **billete único**, el itinerario se evalúa como un todo: origen \= primer aeropuerto de salida, destino final \= último aeropuerto (Art. 2(h); *Folkerts* C-11/11). Los tests A1/A2 se corren sobre ese par origen→destino final.  
* Si el itinerario **ni parte ni llega** a la UE/EEE/CH pero **transita** un hub UE → **no** se resuelve por regla: cae al nodo borde \[verificación caso a caso\] (línea *Wegener*, abajo).  
* Con **billetes separados**, cada billete es un itinerario independiente: los tests se corren por billete.

*Precisión (v2.1.2): en billetes de **ida y vuelta** (o multi-destino), cada **dirección** constituye un itinerario independiente a efectos de los tests, la distancia y el destino final, aunque compartan billete único. La unidad de análisis del motor es la **dirección afectada** por el incidente: su primer aeropuerto es el origen y su último es el destino final. \[decisión JPA; línea TJUE ida/vuelta como vuelos distintos — por-verificar cita al activar detalle\]*

**Exclusiones:**

* Billete gratuito o de precio reducido **no disponible al público** → EU261 no aplica. Excepción: billetes de programas de fidelización u otros programas comerciales → sí aplica (Art. 3(3)).  
* Solo aviones motorizados de ala fija (Art. 3(4)).  
* **Presentación al check-in (Art. 3(2), Pin 3):** el pasajero debe haberse presentado a facturación en las condiciones y hora indicadas (o, sin hora indicada, con la antelación mínima del Art. 3(2)(a)), **salvo cancelación** (no exigible). Campo 18 de la Tabla A; `desconocido` → FALTA\_DATO.

**Nodo borde \[REQUIERE EVALUACIÓN / verificación caso a caso\]:** billete único multi-tramo donde el origen y/o el destino final están fuera de la UE y solo se transita un hub UE. La cobertura de los tramos no-UE depende de jurisprudencia TJUE (línea *Wegener* C-537/17 y conexas; *Folkerts* C-11/11 para conexión perdida). No resolver por regla; marcar para verificación. *\[conocimiento-previo \-\> pendiente reconfirmar\]*

### **Test B — US / DOT**

Algún segmento **sale de, llega a, o es dentro de** EE.UU. → régimen DOT aplica (refund rule \+ compensación por denied boarding). *\[conocimiento-previo; alcance preciso y montos → fase profunda US\]*

### **Test C — Brasil / ANAC 400/2016**

Algún segmento **sale de, llega a, o es dentro de** Brasil → Resolução ANAC 400/2016 aplica. *\[conocimiento-previo; fase profunda BR\]*

### **Test D — Argentina / Res. ANAC 1532/98**

Vuelo **doméstico argentino**, o **internacional que parte de** Argentina → Res. ANAC 1532/98 aplica (+ Montreal si internacional). *\[verificado-ahora → ver Componente 3 Argentina (Parte IV)\]*.

### **Test E — Convención de Montreal (overlay)**

Transporte **internacional** entre dos Estados parte de Montreal (o un Estado parte con escala pactada en otro) → Montreal aplica como **capa superpuesta**. Categorías que enciende: equipaje (demora/daño/pérdida, Art. 17(2)/19), daño por demora de pasajeros (Art. 19), muerte/lesión (Art. 17(1)).

* Verificar que **ambos** Estados sean parte (la gran mayoría de los mercados objetivo lo son).  
* Topes SDR y prescripción → **detalle Montreal (diferido)**. Prescripción: 2 años desde llegada/llegada prevista (Art. 35). *\[conocimiento-previo \-\> pendiente reconfirmar\]*

## **Tabla de despacho**

| Condición de disparo | Marco que se activa |
| ----- | ----- |
| Parte de aeropuerto UE/EEE/CH (cualquier carrier) | EU261 |
| Llega a aeropuerto UE/EEE/CH desde 3er país, carrier comunitario, no compensado allí | EU261 |
| Toca EE.UU. (sale / llega / dentro) | DOT |
| Toca Brasil (sale / llega / dentro) | ANAC 400/2016 |
| Doméstico AR, o internacional saliendo de AR | Res. ANAC 1532/98 |
| Internacional entre 2 Estados parte de Montreal | Montreal (overlay) |

## **Coexistencia y articulación**

* Devolver **todos** los marcos que pasaron su test. No se elige ganador.  
* **EU261 \+ Montreal** pueden coexistir sobre el mismo vuelo: EU261 da la compensación **tarifada** (a tanto alzado por molestia/pérdida de tiempo); Montreal cubre el **daño acreditado** (gastos, equipaje, lesión). La compensación EU261 **puede deducirse** de la indemnización suplementaria (Art. 12 EU261). **No hay doble recuperación por el mismo daño.**  
* En itinerarios multi-jurisdicción, cada marco se evalúa sobre el/los segmento(s) que le corresponde(n).

## **Ruteo de equipaje (regla transversal)**

Cuando el incidente incluya equipaje (daño/demora/pérdida), enrutar a:

* **Montreal** si el transporte es internacional (topes SDR, diferidos); o  
* el **puntero de legislación nacional aplicable** si es doméstico/intra-UE (en AR, Código Aeronáutico \+ Res 1532; en UE, ver la subsección de punteros locales).

El equipaje **nunca** activa el régimen de disrupción de pasajeros (EU261 lo excluye; cada régimen lo trata en su propio árbol profundo, con sus propios plazos de protesta). Ver Principio 4\.

## **Punteros de legislación nacional y organismo competente (solo casos EU261)**

Para todo vuelo en que EU261 aplique, el ruteo devuelve **además** del marco EU261:

1. **Legislación nacional de relleno (derecho supletorio):** la ley del/los Estado(s) UE/EEE/CH de **salida** y/o **llegada** que rellena lo que EU261 no tarifa — equipaje doméstico/intra-UE, daño moral, compensación suplementaria (Art. 12 EU261), prescripción del foro, derecho del consumidor. *El ruteo IDENTIFICA y APUNTA la jurisdicción; no analiza su contenido (diferido).*  
2. **Organismo nacional competente (NEB, Art. 16 EU261):** el National Enforcement Body del Estado correspondiente. Ejemplo verificado: **AESA** (España) *\[verificado-ahora\]*. Otros Estados tienen su propio NEB (p. ej. LBA en Alemania, DGAC en Francia, ENAC en Italia) *\[conocimiento-previo; ilustrativo\]*; la nómina vinculante la publica la Comisión Europea. *El ruteo identifica el NEB; el procedimiento ante él es diferido.*

**Regla de selección del puntero:** devolver el NEB del Estado de **salida** (caso A1); si el vuelo llega a la UE desde un tercer país en carrier comunitario (caso A2), el NEB del Estado de **llegada**; en multi-tramo intra-UE, los NEB de cada Estado de salida relevante. *\[estructura conforme Art. 16; la asignación país-por-país se verifica caso a caso al activar el detalle\]*

---

# **Parte III — Componente 3:**

# **Admisibilidad EU261 (régimen piloto, profundo)**

Todos los umbrales y montos de esta parte están **verificados contra el texto oficial vigente** (EUR-Lex, Reglamento 261/2004, versión en vigor; ver Parte IV). Donde una regla deriva de jurisprudencia TJUE y no del texto, se indica.

## **Gate de entrada (ámbito)**

Antes de admitir: confirmar que el caso pasó el **Test A** del ruteo. Si no pasó A1 ni A2, EU261 no aplica → devolver "no aplica \+ motivo" y derivar a los marcos que sí pasaron.

## **Ramas por tipo de incidente**

### **B1 — Denegación de embarque (Art. 4\)**

* **Involuntaria:** compensación **Art. 7 íntegra y de inmediato, sin umbral de tiempo** \+ reembolso/reencaminamiento (Art. 8\) \+ atención (Art. 9). Reducción 50 % (Art. 7(2)) si se ofreció reencaminamiento con llegada dentro de margen.  
* **Voluntaria** (renuncia a la reserva a cambio de beneficios): fuera del esquema tarifado → beneficios negociados (Art. 4(1)) \+ asistencia Art. 8\. No determinista.  
* La **voluntariedad** es dato fáctico; si es ambigua → \[REQUIERE EVALUACIÓN\].

### **B2 — Cancelación (Art. 5\)**

* **Siempre** (cualquier antelación): reembolso/reencaminamiento (Art. 8\) \+ atención (Art. 9).  
* **Compensación Art. 7:** corresponde **salvo** alguna de estas tres exoneraciones temporales:  
  * **(i)** aviso con **≥ 2 semanas** de antelación; o  
  * **(ii)** aviso **entre 2 semanas y 7 días** \+ reencaminamiento que permita salir **≤ 2 h antes** y llegar al destino final **\< 4 h después** de lo previsto; o  
  * **(iii)** aviso con **\< 7 días** \+ reencaminamiento que permita salir **≤ 1 h antes** y llegar al destino final **\< 2 h después** de lo previsto.  
* Exoneración adicional: **circunstancias extraordinarias** (Art. 5(3)) → \[REQUIERE EVALUACIÓN\].  
* **Carga de la prueba** del aviso y su momento: recae en el transportista (Art. 5(4)).  
* Monto: banda de distancia (Art. 7(1)). Reducción 50 % (Art. 7(2)) si reencaminamiento dentro de margen.

### **B3 — Retraso (Art. 6 \+ Sturgeon)**

Distinguir dos derechos con gatillos distintos:

* **Atención y reembolso (Art. 6, texto):** según el retraso en la **salida**:  
  * atención Art. 9 (comida/refrescos \+ comunicaciones) si retraso ≥ **2 h** (vuelos ≤ 1500 km) / ≥ **3 h** (intracomunitarios \> 1500 km y demás 1500–3500 km) / ≥ **4 h** (\> 3500 km);  
  * alojamiento (Art. 9(1)(b)(c)) si la nueva salida es al día siguiente;  
  * opción de **reembolso** (Art. 8(1)(a)) si el retraso es de **≥ 5 h**.  
* **Compensación (Art. 7, vía jurisprudencia):** el texto del Art. 6 **no** concede compensación. La compensación por retraso surge de TJUE *Sturgeon* (C-402/07): si el retraso en la **llegada al destino final es ≥ 3 h**, corresponde compensación a tanto alzado como en cancelación, **salvo circunstancias extraordinarias** \[REQUIERE EVALUACIÓN\]. *\[regla TJUE, no del texto; verificada vía resumen oficial EUR-Lex\]*  
* **Medición de la llegada (Pin 1, v2.1):** "hora de llegada" \= momento de **apertura de al menos una puerta** de la aeronave (TJUE *Germanwings* C-452/13). La demora de llegada se computa contra la hora programada de arribo, en horas:minutos. Fuente probatoria preferida: registros operativos del vuelo, no la percepción del pasajero.  
* **Reducción 50 % en retraso (precisión determinista):** dado que el gatillo de compensación (3 h) ya iguala o supera los márgenes de reducción de 2 h y 3 h, la reducción del Art. 7(2) **solo** opera en la práctica para vuelos **\> 3500 km** con retraso de llegada **entre 3 h y 4 h** (→ €300 en lugar de €600). Por encima de 4 h, monto completo. *\[aplicación TJUE Sturgeon/Nelson del Art. 7(2); texto del 7(2) verificado\]*

### **B4 — Conexión perdida (billete único)**

Si el billete es único y la pérdida de conexión genera retraso en la **llegada al destino final ≥ 3 h** → compensación Art. 7 según banda al destino final (TJUE *Folkerts* C-11/11). *\[conocimiento-previo\]*

### **B5 — Downgrade (Art. 10\)**

Reembolso del **30 %** (≤ 1500 km) / **50 %** (intracomunitarios \> 1500 km y demás 1500–3500 km) / **75 %** (\> 3500 km) del precio del billete, en 7 días.

**Cuantificación \= excepción manual** (decisión validada): requiere clase pagada vs. volada, dato ausente en intake. La regla reconoce el incidente y marca "excepción".

## **Tabla de bandas — Art. 7(1) y 7(2) (Pin 6, v2.1)**

| Banda | Monto pleno (Art. 7(1)) | Margen de reducción (Art. 7(2)) | Monto reducido 50 % |
| ----- | ----- | ----- | ----- |
| ≤ 1500 km | €250 | llegada \< 2 h después de lo previsto | €125 |
| Intracomunitarios \> 1500 km y demás 1500–3500 km | €400 | llegada \< 3 h después de lo previsto | €200 |
| Demás \> 3500 km | €600 | llegada \< 4 h después de lo previsto | €300 |

Distancia: ortodrómica origen→**destino final** (Art. 7(4)). En **retraso**, la reducción solo opera en la práctica para \> 3500 km con llegada entre 3 h y 4 h (ver precisión determinista en B3).

## **Matriz de categorías exhaustivas — EU261**

| Categoría | Base legal | Determinismo / estado |
| ----- | ----- | ----- |
| Compensación tarifada | Art. 7(1): €250 / €400 / €600 por banda | **Determinista** (monto). Modificador: reducción 50 % (Art. 7(2)). Defensa: circunstancias extraordinarias \[EVAL\] |
| Reembolso | Art. 8(1)(a): precio del billete (parte no usada \+ usada si el viaje ya no tiene sentido) \+ vuelo de vuelta al origen si procede | **Determinista** |
| Reencaminamiento | Art. 8(1)(b)(c): lo antes posible, o fecha posterior a conveniencia | Derecho **determinista** |
| Atención / asistencia | Art. 9: comida/refrescos, alojamiento, transporte, 2 comunicaciones | Derecho **determinista**; monto \= gastos reales razonables \[suficiencia \= EVAL\]. *Tope 3 noches de alojamiento rige \~2027, no hoy* |
| Downgrade | Art. 10(2): 30/50/75 % | % determinista; dato de clase \= **excepción manual** |
| Daño moral | No es categoría tarifada EU261; vía Montreal Art. 19 / derecho nacional | \[REQUIERE EVALUACIÓN\] |
| Punitivo | — | **NO APLICA**: Montreal Art. 29 excluye daños punitivos; foro UE/España no los reconoce. *(Contraste: AR daño punitivo Art. 52 bis Ley 24.240 → fase AR)* |
| Daño Montreal (equipaje/demora/lesión) | Overlay, no EU261 | Categorías marcadas en ruteo; topes SDR **diferidos (opción B)** |
| Equipaje (daño/demora/pérdida) | — | **NO APLICA EU261.** Remitir a la Convención de Montreal (transporte internacional) o a la legislación nacional aplicable del Estado UE/EEE/CH (vuelos domésticos/intra-UE; ver Componente 2). El equipaje no es categoría del régimen de disrupción de pasajeros (Principio 4\) |
| Compensación suplementaria | Art. 12: habilitada; se deduce la compensación EU261; no aplica a voluntarios | \[REQUIERE EVALUACIÓN\] (cuantía no tarifada) |

## **Nodos \[REQUIERE EVALUACIÓN\] — consolidado EU261**

| Nodo | Duda/dato concreto |
| ----- | ----- |
| Circunstancias extraordinarias | ¿El suceso exonera la compensación (Art. 5(3))? Feed para la KB de evaluación *\[verificado-ahora\]*: la Comisión confirmó en 2026 que el precio alto del combustible **no** es circunstancia extraordinaria. No resuelve el nodo |
| Suficiencia probatoria del daño | ¿Los comprobantes sostienen el monto (atención, gastos, Montreal)? |
| Daño moral / suplementario | Cuantía no tarifada (Art. 12 \+ Montreal Art. 19 / derecho nacional) |
| Voluntariedad en denegación de embarque | Si la renuncia fue voluntaria o forzada (B1) |
| Borde de cobertura por hub | Cobertura de tramos no-UE en billete único vía hub UE (Test A, nodo borde) |

## **Prescripción**

* EU261 **no fija** plazo propio; rige la **ley nacional del foro** donde se reclama (TJUE *Cuadrench Moré* C-139/11). *\[conocimiento-previo\]*  
* **Foro España (vía AESA):** plazo general de acción personal de **5 años** (Art. 1964 Código Civil, tras reforma 2015). *\[conocimiento-previo; **POR-VERIFICAR** la posición consolidada española —existe debate sobre plazos del contrato de transporte—\]*  
* **Overlay Montreal:** **2 años** desde la llegada / llegada prevista (Art. 35). *\[conocimiento-previo\]*  
* **Comportamiento del motor (Pin 7, v2.1):** para casos EU261 el motor emite `prescripcion: segun_foro (no computable)` — **nunca** una fecha límite dependiente de un foro no decidido. Si además aplica el overlay Montreal, calcula y emite el **piso conservador de 2 años** (Art. 35) con fecha límite concreta, marcado como piso (el plazo del foro puede ser mayor). Argentina se computa normalmente (ver Parte IV). Cómputo de todos los plazos: **días corridos**, vencimiento a las 24:00 del último día (Pin 5).

---

# **Parte IV — Componente 3:**

# **Admisibilidad Argentina (régimen profundo)**

Todos los umbrales y montos de esta parte están **verificados contra el texto oficial vigente** (InfoLEG, texto consolidado de la Res 1532/98; argentina.gob.ar, Código Aeronáutico; jurisprudencia 2024-25; ver Parte V). Donde una regla deriva de jurisprudencia y no del texto, se indica.

## **Marco normativo y principio de articulación**

El régimen argentino se integra por cuatro cuerpos, **no excluyentes** entre sí pero jerarquizados por el Art. 63 Ley 24.240:

1. **Res. ANAC 1532/98** — Condiciones Generales del Contrato de Transporte Aéreo (Anexo I: pasajeros y equipaje). Núcleo del régimen de disrupción. Modificada por **Res ANAC 203/2013** (sustituye la definición de "servicio incidental" y el Art. 12 inc. a) y por **Res ANAC 727/2019** (sustituye la definición de "regulaciones del transportador"). *\[verificado-ahora\]*  
2. **Código Aeronáutico (Ley 17.285)** — Título VII (responsabilidad): límites indemnizatorios del transporte interno y prescripción (Art. 228). *\[verificado-ahora\]*  
3. **Convenio de Montreal 1999** (Ley 26.451) — overlay en transporte internacional; topes en DEG/SDR **diferidos**. *\[verificado-ahora / conocimiento-previo\]*  
4. **Ley 24.240 (Defensa del Consumidor) \+ CCyC** — aplicación **supletoria** (Art. 63 LDC). Vía para daño moral (CCyC Art. 1741); daño punitivo Art. 52 bis. *\[verificado-ahora\]*

**Principio de articulación (Art. 63 Ley 24.240)** *\[verificado-ahora\]*: *"Para el supuesto de contrato de transporte aéreo se aplicarán las normas del Código Aeronáutico, los tratados internacionales y, supletoriamente, la presente ley."* En consecuencia:

* El foro es el **federal civil y comercial** (Art. 198 Código Aeronáutico; CSJN *Civelli*, *Trombino*). La LDC **nunca desplaza** al Código Aeronáutico/Montreal; solo rellena lo no previsto.  
* **Decisión de negocio (validada):** SolucionAir litiga contra **aerolíneas** en este foro. Se descarta la vía consumeril ordinaria y la acción contra agencias de viaje. No se modela dualidad de foro.

**Doméstico vs. internacional (def. Res 1532 Art. 1):** internacional \= entre Argentina y un Estado extranjero, o entre dos puntos de Argentina con escala pactada en el extranjero; interno \= entre dos o más puntos de Argentina. El overlay Montreal solo aplica al internacional. El **Argentino Oro** es la unidad de los límites del **transporte interno** únicamente.

## **Gate de entrada (ámbito)**

Confirmar que el caso pasó el **Test D** del ruteo (doméstico AR, o internacional saliendo de AR). Si es internacional → activar **además** el overlay Montreal (Test E).

## **Ramas por tipo de incidente**

### **AR-B1 — Denegación de embarque / overbooking (Art. 12 Res 1532\)**

Gatillo: el transportador deniega el embarque por no poder proporcionar espacio previamente confirmado (overbooking/sobreventa). Derechos **deterministas**:

* inclusión obligatoria en el vuelo inmediato posterior del mismo transportador, **o** endoso del contrato (incluidas conexiones), **o** reencaminamiento por otra ruta/transportador/medio;  
* reintegro del precio no utilizado (Art. 13);  
* servicios incidentales sin cargo (ver AR-B5).

La **"compensación por embarque denegado"** se fija *de acuerdo a las regulaciones del transportador* (Art. 12 inc. a) → **no tarifada por la norma** → \[REQUIERE EVALUACIÓN\] / no determinista. La aceptación voluntaria y expresa de esa compensación \= **renuncia a reclamo posterior** (salvo incidentales). El régimen no ampara el transporte gratuito o \< 50 % de la tarifa pública (inc. b), ni al pasajero no presentado / no reconfirmado (inc. c).

### **AR-B2 — Cancelación (Art. 12 Res 1532\)**

Gatillo: cancelación por circunstancias operativas, técnicas o comerciales. Derechos **deterministas**: idénticos a AR-B1 (reencaminamiento / endoso / inclusión \+ reintegro \+ incidentales). **Sin compensación tarifada.**

* Reintegro (Art. 13 inc. b): completo si ningún tramo fue realizado; proporcional si un tramo fue realizado.  
* **Exención meteorológica** de incidentales (Res 203/2013): si la causa es meteorológica, el transportador no debe incidentales; subsiste el deber de información veraz. → \[REQUIERE EVALUACIÓN: causa\]

### **AR-B3 — Demora (Art. 12 Res 1532\)**

Gatillo determinista: **demora \> 4 h** (de vuelo o de entrega de equipaje). **Punto de medición (Pin 2, v2.1):** para el régimen de **servicios incidentales**, la demora se mide en la **salida** (\> 4 h vs. hora programada de salida; es la espera en el aeropuerto lo que genera la necesidad de comida/alojamiento, coherente con la finalidad del Art. 12). Activa reencaminamiento / reintegro \+ incidentales (incluido alojamiento). Por debajo de 4 h, la demora **no** activa el régimen de incidentales (sí lo activan cancelación y denegación).

* Daño por demora **acreditado**: doméstico → Código Aeronáutico Art. 141 (tope en AO); internacional → Montreal Art. 19 (tope SDR). **Se mide contra la demora de llegada al destino final** (Pin 2: el daño resarcible deriva del arribo tardío, no de la espera). Eximente: demora no imputable por causa técnica/meteorológica salvo negligencia probada (Res 1532 Art. 19 b.2.1; Montreal Art. 19). → \[REQUIERE EVALUACIÓN\]

### **AR-B4 — Pérdida de conexión / no escala (Art. 12 Res 1532\)**

Gatillo: pérdida de un vuelo de conexión con reserva confirmada, o imposibilidad de escala en la parada-estancia o destino. Mismos derechos que AR-B1/B2.

### **AR-B5 — Servicios incidentales (Art. 12 Res 1532, post 203/2013)**

Sin cargo, una vez activado el régimen (cancelación / demora \> 4 h / denegación / pérdida de conexión):

* comunicación telefónica o cablegráfica al destino \+ comunicaciones locales;  
* comidas y refrigerios según el tiempo de espera;  
* **alojamiento** (hotel, aeropuerto o ciudad) cuando la **demora de salida exceda 4 h** (Pin 2);  
* transporte terrestre desde y hacia el aeropuerto.

Monto \= gastos reales razonables \[suficiencia \= EVAL\]. **Exención meteorológica** (Res 203/2013): no se deben incidentales si la causa es meteorológica; subsiste el deber de información. → \[REQUIERE EVALUACIÓN: causa\]

### **AR-B6 — Equipaje (demora / daño / pérdida)**

**Doméstico (Res 1532 Art. 19 a \+ Código Aeronáutico Arts. 140/145):**

* equipaje **registrado**: hasta **2 AO/kg** de peso bruto (salvo declaración especial de interés con cargo);  
* objetos en **custodia del pasajero** (mano): hasta **40 AO por pasajero**;  
* entrega parcial: responsabilidad proporcional al peso.

**Internacional:** overlay **Montreal 1999** (topes SDR **diferidos**; la Res 1532 Art. 19 b remite a la Convención).

**Protesta — condición de admisibilidad (Res 1532 Art. 20 a)** *\[verificado-ahora; plazos duros\]*:

* **daño** al equipaje: **3 días** (interno) / **7 días** (internacional) desde la entrega;  
* **pérdida / destrucción / retardo**: **10 días** (interno) / **21 días** (internacional) desde que debió ponerse a disposición.

La falta de protesta en plazo torna **inadmisible toda acción** (salvo fraude) (Art. 20 b). Valor del AO y tope SDR: **diferidos** (cuantificación).

**Precisiones v2.1 (Pins 3 y 5):**

* **Cómputo:** días **corridos**, vencimiento a las 24:00 del último día. Daño: desde la **entrega**. Pérdida/destrucción/retardo: desde que el equipaje **debió ponerse a disposición**.  
* **PIR:** el gate de caducidad se evalúa con la fecha de **cualquier** protesta, incluido el PIR de aeropuerto. Si **solo** existe PIR (sin protesta escrita posterior), el gate pasa **provisionalmente** y se emite \[REQUIERE EVALUACIÓN: suficiencia de la protesta\] — la equivalencia PIR \= protesta (Art. 31 Montreal / Art. 20 Res 1532\) tiene jurisprudencia dividida y no se resuelve por regla.

### **AR-B7 — Muerte / lesión**

Doméstico: Código Aeronáutico Arts. 139/144 \+ Res 1532 Art. 19 a.I (hasta **1.000 AO/pasajero**). Internacional: Montreal Art. 17(1) (SDR diferido). Fuera del scope de intake estándar → **excepción de análisis manual**.

## **Matriz de categorías exhaustivas — Argentina**

| Categoría | Base legal AR | Determinismo / estado |
| ----- | ----- | ----- |
| Compensación tarifada | — | **NO APLICA.** La Res 1532 no tarifa compensación; la "compensación por embarque denegado" remite a las regulaciones del transportador (Art. 12\) → no determinista |
| Reintegro / reembolso | Res 1532 Arts. 12 y 13 | **Determinista.** Completo (ningún tramo) o proporcional (tramo realizado). Cancelación por el pasajero: cargo 10 % (\> 24 h) / 20 % (\< 24 h) (Art. 13 c) |
| Reencaminamiento / endoso / inclusión | Res 1532 Art. 12 | Derecho **determinista** |
| Servicios incidentales | Res 1532 Art. 12 (post 203/2013): comunicación, comidas, alojamiento si demora \> 4 h, transporte terrestre | Derecho **determinista**; monto \= gastos reales \[suficiencia \= EVAL\]. Exención meteorológica → \[EVAL: causa\] |
| Daño por demora | Doméstico: Cód. Aero. Art. 141 (tope AO) · Internacional: Montreal Art. 19 (tope SDR) | Categoría marcada; topes AO/SDR diferidos; eximente técnica/meteorológica \[EVAL\] |
| Equipaje (demora/daño/pérdida) | Doméstico: Res 1532 Art. 19 a (2 AO/kg registrado; 40 AO mano) · Internacional: Montreal Art. 17(2)/19 (SDR) | Tope determinista (unidad); valor AO/SDR diferido. **Admisibilidad sujeta a protesta** en plazo (Art. 20: 3/7 días daño; 10/21 días pérdida) |
| Muerte / lesión | Doméstico: Cód. Aero. 139/144 \+ Res 1532 Art. 19 a.I (1.000 AO) · Internacional: Montreal Art. 17(1) | **Excepción de análisis manual** (fuera de intake estándar) |
| Daño moral | CCyC Art. 1741; Montreal Art. 19 (intl, acreditado); Ley 24.240 supletoria (Art. 63\) | **\[REQUIERE EVALUACIÓN\]** (quantum y prueba). **Admisible** contra la aerolínea en el foro federal |
| Daño emergente / consecuencial acreditado | Montreal Art. 19 (intl) · CCyC / 24.240 supletoria (doméstico) | Monto \= gastos acreditados \[suficiencia \= EVAL\]. En internacional, Montreal excluye daños indirectos/consecuentes (Res 1532 Art. 19 b.3.5) |
| Daño punitivo (Art. 52 bis Ley 24.240) | — | **NO APLICA contra la aerolínea.** Internacional: Montreal Art. 29 excluye toda indemnización no compensatoria; doméstico: Art. 63 LDC subordina al Código Aeronáutico. Línea jurisprudencial uniforme 2024-25 (Piccardi c/LATAM; Martín c/Aeroméxico; M.B. c/Air Canada; Airala c/Aerolíneas; Peon c/United). *(La vía contra agencia de viajes —admitida bajo 24.240, solidaria— queda excluida por decisión de negocio.)* |

## **Nodos \[REQUIERE EVALUACIÓN\] — consolidado Argentina**

| Nodo | Duda/dato concreto |
| ----- | ----- |
| Causa de la disrupción | ¿Meteorológica? Exime los servicios incidentales (Res 203/2013) y, en demora, la responsabilidad por daño (Art. 19 b.2.1). Análogo funcional a "circunstancias extraordinarias" EU261 |
| Compensación por embarque denegado | No tarifada por la norma; depende de las regulaciones publicadas de cada transportador |
| Daño moral | Quantum y suficiencia probatoria |
| Suficiencia probatoria | Gastos, incidentales, equipaje |
| Suficiencia de la protesta (PIR) | Cuando solo existe PIR sin protesta escrita: ¿satisface el requisito del Art. 20 Res 1532 / Art. 31 Montreal? (jurisprudencia dividida; gate pasa provisional — Pin 3\) |
| Cotización del Argentino Oro | Input de cuantificación (BCRA, trimestral) — diferido |
| Tope SDR Montreal (internacional) | Diferido (detalle Montreal) |

## **Prescripción — Argentina**

* **Doméstico: 1 año** (Código Aeronáutico Art. 228 inc. 1 y 4; coincide con Res 1532 Art. 20 b), contado desde el arribo / la fecha en que debió arribar / la fecha en que se detuvo el transporte. Desplaza el plazo de 3 años del Art. 50 LDC (lex specialis; CNCCF Sala III). *\[verificado-ahora\]*  
* **Internacional: 2 años** (Montreal Art. 35; Res 1532 Art. 20 b). *\[verificado-ahora / conocimiento-previo\]*  
* **Caducidad por falta de protesta** (Res 1532 Art. 20 a/b): la omisión de protesta en plazo (3/7 días daño de equipaje; 10/21 días pérdida) torna **inadmisible** la acción, con independencia de la prescripción. *\[verificado-ahora\]*  
* **Cómputo (Pin 5, v2.1):** todos los plazos de protesta y prescripción en **días corridos**, vencimiento a las 24:00 del último día.

## **Contexto — Res. ANAC 188/2026**

Sistema de conciliación voluntaria previa (vigencia \~agosto 2026). Es una **vía procedimental** de resolución temprana; **no altera** la admisibilidad sustantiva ni las categorías reclamables mapeadas aquí. Se asienta como contexto operativo. *\[conocimiento-previo / por-verificar vigencia y alcance al activarse\]*

---

# **Parte V — Sello de verificación de fuentes**

Cada umbral/monto con consecuencia operativa, etiquetado. VA \= verificado-ahora (sesiones 18 y 19-jun-2026); CP \= conocimiento-previo; PV \= por-verificar.

| Ítem | Estado | Fuente |
| ----- | ----- | ----- |
| EU261/2004 vigente, sin enmiendas sustantivas (una sola versión consolidada; estado "en vigor") | **VA** | EUR-Lex CELEX 32004R0261 (ES, oficial) |
| Reforma cerró acuerdo político 15-jun-2026; mantiene 3 h y €250/400/600; aplica \~2027 (no hoy) | **VA** | Comunicados Comisión/Parlamento/Consejo, 15-jun-2026 |
| Ámbito Art. 3 (salida UE / llegada UE en carrier comunitario / exclusión billete no público) | **VA** | EUR-Lex 32004R0261 Art. 3 |
| Definición "destino final" Art. 2(h) | **VA** | EUR-Lex 32004R0261 Art. 2(h) |
| Denegación embarque involuntaria → Art. 7+8+9 inmediato (Art. 4(3)) | **VA** | EUR-Lex 32004R0261 Art. 4 |
| Cancelación: exoneraciones 14 días / 7 días / márgenes 2h-\<4h / 1h-\<2h (Art. 5(1)(c)) | **VA** | EUR-Lex 32004R0261 Art. 5 |
| Circunstancias extraordinarias exoneran compensación; carga de prueba del aviso en el transportista | **VA** | EUR-Lex 32004R0261 Art. 5(3)(4) |
| Retraso: atención a 2h/3h/4h por banda; reembolso a ≥5h (Art. 6\) | **VA** | EUR-Lex 32004R0261 Art. 6 |
| Compensación montos €250/400/600 \+ distancia al destino final (Art. 7(1)) | **VA** | EUR-Lex 32004R0261 Art. 7(1) |
| Reducción 50 % con márgenes 2h/3h/4h (Art. 7(2)); cálculo ortodrómico (Art. 7(4)) | **VA** | EUR-Lex 32004R0261 Art. 7(2)(4) |
| Reembolso/reencaminamiento — opciones (Art. 8\) | **VA** | EUR-Lex 32004R0261 Art. 8 |
| Atención — enumeración (Art. 9\) | **VA** | EUR-Lex 32004R0261 Art. 9 |
| Downgrade 30/50/75 % (Art. 10(2)) | **VA** | EUR-Lex 32004R0261 Art. 10 |
| Compensación suplementaria deducible (Art. 12\) | **VA** | EUR-Lex 32004R0261 Art. 12 |
| Combustible no es circunstancia extraordinaria (2026) | **VA** | Resolución/comunicado Comisión 2026 (vía prensa especializada) |
| Retraso ≥3h → compensación (doctrina Sturgeon C-402/07) | **VA** | Resumen oficial EUR-Lex (LSU) 32004R0261 |
| Aplicación de la reducción 50 % al retraso (solo \>3500 km, 3–4h) | **CP** | Interpretación Sturgeon/Nelson del Art. 7(2) |
| Conexión perdida en billete único (Folkerts C-11/11) | **CP** | — (verificar al cerrar nodo borde) |
| Extensión a EEE (IS/NO/LI) y Suiza | **CP** | Acuerdo EEE \+ acuerdo bilateral CH (corroborado por fuente secundaria) |
| Borde de cobertura por hub UE (Wegener C-537/17 y conexas) | **PV** | — (verificación caso a caso) |
| Prescripción \= ley del foro (Cuadrench Moré C-139/11) | **CP** | — |
| Prescripción foro España 5 años (Art. 1964 CC) | **PV** | — (debate doctrinal; verificar) |
| Prescripción Montreal 2 años (Art. 35\) | **CP** | Texto del Convenio de Montreal |
| Aplicabilidad y montos US/DOT, Brasil/ANAC 400, Argentina/Res 1532 | **CP** | — (fases profundas respectivas, diferidas) |
| Topes SDR Montreal vigentes | **PV** | — (detalle Montreal, diferido por opción B) |
| **— Tarea 1 · Equipaje EU261 —** |  |  |
| EU261 no cubre equipaje; remite a Montreal (intl) / ley nacional (doméstico-intra UE) | **VA** | EUR-Lex 32004R0261 (ámbito) \+ Convenio Montreal Arts. 17/19 |
| **— Tarea 2 · Punteros locales UE \+ NEB —** |  |  |
| NEB como organismo competente (Art. 16 EU261); AESA \= NEB de España | **VA** | EUR-Lex 32004R0261 Art. 16; AESA |
| Nómina de NEB por Estado (LBA/DGAC/ENAC, etc.) | **CP** | lista oficial Comisión Europea (verificación caso a caso) |
| Legislación nacional UE como derecho de relleno (equipaje doméstico, Art. 12, prescripción, consumo) | **CP** | estructura; contenido sustantivo diferido |
| **— Tarea 3 · Argentina —** |  |  |
| Res 1532/98 vigente, Anexo I (pasajeros/equipaje); estructura por artículos | **VA** | InfoLEG texact 54791 (texto consolidado) |
| Res 1532 Art. 12 (sust. por Res ANAC 203/2013): régimen de disrupción; gatillo demora \>4 h; reencaminamiento/endoso/reintegro; incidentales; exención meteorológica | **VA** | InfoLEG texact 54791 Art. 12 (mod. B.O. 12/4/2013) |
| Res 1532 NO tarifa compensación; "compensación por embarque denegado" \= regulaciones del transportador | **VA** | InfoLEG texact 54791 Art. 12 a |
| Res ANAC 727/2019 sustituye definición de "regulaciones del transportador" | **VA** | InfoLEG texact 54791 (nota, B.O. 14/11/2019) |
| Res 1532 Art. 13: reintegro completo/proporcional; cargo por cancelación del pasajero 10 %/20 % | **VA** | InfoLEG texact 54791 Art. 13 |
| Res 1532 Art. 19 a (interno): 1.000 AO persona; 2 AO/kg equipaje registrado; 40 AO objetos en custodia | **VA** | InfoLEG texact 54791 Art. 19 |
| Res 1532 Art. 20: protesta 3/7 días (daño) y 10/21 días (pérdida) interno/intl; prescripción 1 año interno / 2 años intl | **VA** | InfoLEG texact 54791 Art. 20 |
| Cód. Aeronáutico Ley 17.285 Arts. 139-150: responsabilidad; límites en AO (144/145); nulidad de cláusulas limitativas (146); dolo rompe el tope (147) | **VA** | argentina.gob.ar texto actualizado (sust. Ley 22.390/1981) |
| Cód. Aeronáutico Art. 228: prescripción 1 año (inc. 1 y 4); desplaza el Art. 50 LDC (3 años) | **VA** | InfoLEG/CEDAE \+ CNCCF Sala III (jurisprudencia) |
| Argentino Oro: unidad de cuenta de los límites del transporte interno; cotización trimestral del BCRA | **VA** | InfoLEG texact 54791 (def.) \+ BCRA |
| Cotización del Argentino Oro vigente (trim. 2026\) | **PV** | BCRA (input de cuantificación, diferido) |
| Art. 63 Ley 24.240: Cód. Aeronáutico \+ tratados; LDC supletoria | **VA** | InfoLEG Ley 24.240 \+ jurisprudencia |
| Daño punitivo (Art. 52 bis LDC) NO APLICA vs aerolínea (Montreal Art. 29 intl; Art. 63 LDC doméstico) | **VA** | Fallos 2024-25: Piccardi, Martín, M.B., Airala, Peon |
| Daño punitivo vs agencia de viajes: admitido (solidaria 24.240) — excluido por decisión de negocio | **VA** | Infobae 2024 \+ doctrina |
| Daño moral vs aerolínea: admisible, sujeto a prueba/quantum (CCyC 1741 / Montreal 19 / 24.240 supletoria) | **VA** | jurisprudencia (Airala admite; otros rechazan por prueba) |
| Montreal 1999 (Ley 26.451) overlay; Art. 29 (no punitivo) y Art. 35 (2 años) | **VA** | texto del Convenio \+ Ley 26.451 (citados en fallos) |
| Art. 52 bis LDC: texto base sin cambios; tope remite al Art. 47 inc. b (montos act. por Ley 27.742); anteproyecto "grave menosprecio" NO vigente | **VA** | InfoLEG \+ doctrina |
| Res ANAC 188/2026 (conciliación voluntaria, \~ago 2026): contexto, no altera admisibilidad | **CP** | a verificar vigencia/alcance al activarse |

