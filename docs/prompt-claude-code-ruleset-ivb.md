# Prompt Claude Code — Mini-ciclo: Ruleset IV-B (Reglamento Dec. 809/2024)

**Contexto:** hallazgo legal mayor posterior al ciclo motor: la **Res 1532/98 fue derogada por el Decreto 809/2024** (vigencia 10-oct-2024), que aprueba el Reglamento del Contrato Aéreo de Pasajeros y Equipaje (Anexo I). El documento legal fue reestructurado como **v2.2** (Parte IV-A = 1532, incidentes < 10-oct-2024; Parte IV-B = Reglamento 809/2024, incidentes ≥ 10-oct-2024), validado por JPA con las dudas D1–D4 resueltas. Este mini-ciclo lleva la v2.2 al código.

**Documento rector:** la **v2.2** se entrega junto a este prompt (`Capa\\\\\\\_1\\\\\\\_-\\\\\\\_Logica\\\\\\\_legal\\\\\\\_determinista\\\\\\\_v2\\\\\\\_2.md`). Tarea 1 la incorpora al repo. TODA regla nueva sale de su Parte IV-B, Test D, subsección de Jurisdicción y tabla de eximentes — no de conocimiento general.

**Regla maestra:** discrepancia entre lo construido y este prompt → DETENERSE y reportar. Ambigüedad legal no cubierta por la v2.2 → DETENERSE y reportar (no decidir derecho).

\---

## Fase 0 — Inventario (sin editar)

Reportar:

1. Estructura actual de `api/\\\\\\\_utils/rulesets/2026-06-19.js`: cómo conviven EU261 y AR; cómo `seleccionarRuleset(fecha)` resuelve hoy (¿un solo ruleset global?).
2. Dónde vive el dominio de `incidentes` (constante compartida entre editor del drawer, normalizador y ruleset).
3. Conteo en DB: filas con `tipo\\\\\\\_incidencia='reprogramacion'`, particionadas por `fecha\\\\\\\_incidente` < / ≥ 2024-10-10, y cuántas ya fueron backfilleadas a `\\\\\\\["cancelacion"]`.
4. Cómo emite hoy el motor el gate de protesta (estados disponibles) y si la salida tiene lugar para un bloque nuevo `jurisdiccion`.

## Tarea 1 — Documento legal v2.2 (commit propio, PRIMERA tarea)

Reemplazar `docs/Capa\\\\\\\_1\\\\\\\_-\\\\\\\_Logica\\\\\\\_legal\\\\\\\_determinista\\\\\\\_v2\\\\\\\_1\\\\\\\_2.md` por la v2.2 provista (renombrar a `...\\\\\\\_v2\\\\\\\_2.md`; eliminar la versión anterior del repo para mantener fuente única). Verificar que el documento diga "validado JPA" y contenga las dudas D1–D4 como RESUELTAS. Si el archivo provisto difiere de eso → detenerse.

## Tarea 2 — Ruleset IV-B: `api/\\\\\\\_utils/rulesets/2024-10-10.js`

**Diseño de selección:** la selección por `fecha\\\\\\\_incidente` aplica al **régimen AR**; EU261/Montreal no cambian entre vigencias. Resolver la mecánica que menos duplique (p. ej. ruleset compuesto: bloque EU261 compartido + bloque AR por vigencia), documentando la decisión. Si la estructura actual no lo permite sin reescritura mayor → detenerse y proponer.

Contenido del bloque AR IV-B (fuente: Parte IV-B v2.2, cada regla con su `base\\\\\\\_legal` del Anexo I):

1. **Incidentales escalonados (Art. 43)** medidos sobre demora de SALIDA: ≤4 h → nada, **salvo nocturno** (espera transcurriendo total o parcialmente entre 00:00–06:00 → comidas/refrescos; regla D4); >4 h y ≤8 h → comidas/refrescos; >8 h → + alojamiento + traslados. Umbrales en minutos (240/480).
2. **Reintegro por demora > 4 h** (Art. 48) → categoría determinista propia.
3. **Cancelación** (Arts. 41/43/47/48): alternativas + reintegro (reglas de cálculo del Art. 48 como nota simbólica, no cuantificar); compensación tarifada NO\_APLICA; plazo de reintegro 30 días como dato informativo.
4. **Reprogramación (Art. 42) — tipo propio (D1):** incidentales del Art. 43 según demora, excepto aviso ≥14 días, o aviso 14–7 días + transporte alternativo al destino final. Usa `antelacion\\\\\\\_aviso\\\\\\\_dias` y `reencaminamiento`.
5. **Overbooking (Arts. 45/46):** régimen 41/42/43; compensación de voluntarios → REQUIERE\_EVALUACION (regulaciones del transportador). Denegación con causa (Art. 38) → NO\_APLICA con motivo.
6. **Equipaje (Art. 61) + gate D2:** plazos 10/21 (pérdida-retraso, desde puesta a disposición) y 3/7 o antes de retirarse (daño, desde entrega). Gate: internacional fuera de plazo → `inadmisible` (base Montreal Art. 31(4)); **doméstico fuera de plazo → `pasa\\\\\\\_provisional` + nodo EVAL `sancion\\\\\\\_caducidad\\\\\\\_domestica`** (regla D2). PIR: Pin 3 sin cambios. Categorías nuevas: gastos de primera necesidad (retraso, determinista, monto EVAL-suficiencia); daño funcional 3 AO/bulto (simbólico); daños menores → NO\_APLICA (Art. 61 b).
7. **Eximentes (Art. 44):** apagan SOLO incidentales (tabla transversal v2.2); emitir el nodo EVAL causa una única vez con la lista de categorías que apaga por marco.
8. **Prescripción (Art. 71):** 1 año interno / 2 años intl; puntos de arranque expresos del Art. 71 según incidente; **cómputo con exclusión del dies a quo** (solo IV-B; IV-A conserva el cómputo Pin 5 original).

## Tarea 3 — Dominio, backfill y erratas

1. Dominio de incidentes: agregar reprogramacion, válido solo cuando rige IV-B (fecha\_incidente ≥ 2024-10-10); el editor del drawer lo muestra siempre, y el motor lo trata como NO\_APLICA con motivo "tipo sin régimen en 1532 — v2.1.1" si la fecha es anterior.
2. Errata de backfill (D1): script/SQL que corrige SOLO las filas tipo\_incidencia='reprogramacion' con fecha\_incidente >= '2024-10-10' que fueron mapeadas a \["cancelacion"] → \["reprogramacion"]. Dry-run primero; reportar conteo.
3. Erratas de docs: motor-capa1-contratos.md (dominio de incidentes; nota de selección de ruleset AR por vigencia; y en §1.1 agregar billete\_unico a la enumeración de campos críticos — resuelve la contradicción interna con §1.2 fila 4, ítem 6.4 del registro de pendientes; se ratifica el criterio conservador que el motor ya aplica) y README (segundo ruleset, bloque jurisdicción).
4. Derivación de incidentes en el intake (process-ticket.js / agency.js, agregada en el ciclo Intake v2): actualizar tipo\_incidencia='reprogramacion' → \["reprogramacion"].
5. api/\_data/aerolineas.json: agregar la fila de JetSMART Argentina (WJ, pais\_licencia: 'AR', comunitario: false) junto a la matriz chilena existente (ítem 2.3 del registro de pendientes) — importa para legitimado pasivo y Test D.
6. Registro de pendientes (documento de pendientes legales en docs/): actualizarlo así, sin tocar nada más:
* Marcar RESUELTO con fecha 30-jul-2026 y decisión JPA:
2.1 — BA comunitario: false: ratificado (pérdida de condición comunitaria post-Brexit).
2.3 — JetSMART: resuelto por este mini-ciclo (fila WJ/AR agregada).
2ter.2 — Alcance del gate de protesta: ratificado alcance: \['equipaje']. Nota: aplica al ruleset IV-A; en IV-B rige la regla D2 de la v2.2 (doméstico → pasa\_provisional + EVAL; internacional → inadmisible por Montreal Art. 31(4)).
6.3 — Mapeo PIR a candidatos: ratificado tal como está, incluida la ausencia deliberada de fecha.
6.4 — billete\_unico crítico: ratificado el criterio conservador; la contradicción del contrato se corrige en §1.1 (punto 3 de esta tarea).
En la tabla §7: "Cancelación con aviso < 14 días y reencaminamiento desconocido → FALTA\_DATO": ratificado. "Denegación de embarque con reencaminamiento desconocido → RECLAMABLE pleno con nota": ratificado.
* Agregar como RESUELTOS por la v2.2 (referencia cruzada al documento legal, sin reabrir discusión): derogación de la Res 1532 → Parte IV-B; ámbito amplio del Test D; reprogramación como tipo propio (D1 — anotar en la fila correspondiente de la tabla §7 que el mapeo "reprogramación → cancelación" queda acotado a fecha\_incidente < 10-oct-2024); caducidad doméstica post-809 (D2); destino contractual round-trip (D3, ahora VA); horario nocturno (D4).
* Los ítems 1.1, 1.2, 2bis.1, 2ter.1, 6.6 y 6.7 permanecen ABIERTOS — no tocarlos ni resolverlos: se deciden en sesión legal aparte (futura v2.2.1). El comportamiento actual del motor ante cada uno (FALTA\_DATO / null / nota) se mantiene tal cual.



## Tarea 4 — Bloque `jurisdiccion` en la salida

Nuevo bloque informativo (NUNCA gate), según la subsección "Jurisdicción y foro" v2.2:

* **Destino contractual:** último aeropuerto del billete completo; si el itinerario es ida y vuelta bajo billete único → destino contractual = punto de partida (D3). Se computa desde `segmentos` (ambas direcciones); sin segmentos → `no\\\\\\\_computable`.
* Salida: `jurisdiccion: { foro\\\\\\\_argentino: 'garantizado' | 'posible' | 'no' | 'no\\\\\\\_computable', base\\\\\\\_legal, destino\\\\\\\_contractual }`. Reglas: doméstico AR → garantizado (Anexo I Art. 13); internacional con destino contractual AR → garantizado (Montreal Art. 33: tribunal del destino); internacional saliendo de AR con carrier extranjero y destino contractual no-AR → posible (foro del canal de emisión, jurisprudencia dividida); dirección sin contacto con AR → no.
* Render en backoffice: línea informativa en la sección Análisis legal ("Foro argentino: garantizado — Montreal Art. 33, destino contractual EZE").

## Tarea 5 — Tests

1. Re-correr suite → verde.
2. Unitarios nuevos: partición de vigencia (mismo caso, fecha 2024-10-09 vs 2024-10-10 → alojamiento a >4 h vs >8 h); nocturno D4 (salida 23:30 + demora 3 h → incidentales sí); reprogramación con aviso 10 días + alternativo → sin incidentales; gate D2 (doméstico fuera de plazo → pasa\_provisional; intl → inadmisible); destino contractual redondo → punto de partida.
3. Esqueletos TODO-JPA nuevos: par espejo IV-A/IV-B de demora 6 h (alojamiento sí/no); reprogramación post-809; equipaje doméstico sin protesto post-809; redondo con incidente en la ida (jurisdicción garantizada).

## Aceptación global

* Ningún cambio de schema. Ningún campo legacy tocado fuera de la errata D1 (acotada por fecha). Casos IV-A re-analizados producen exactamente el mismo `analisis\\\\\\\_legal.actual` que antes (salvo el bloque `jurisdiccion` nuevo). Reporte final por tarea con conteos del backfill y hallazgos de Fase 0.

