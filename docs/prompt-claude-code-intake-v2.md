# Prompt Claude Code — Ciclo: Intake v2 (scan-first + dirección afectada)

**Documentos rectores (leer ANTES de tocar código):**
1. `docs/Capa_1_-_Logica_legal_determinista_v2.1.md` (versión v2.1.2) — en particular el Pin 4 y su precisión v2.1.2: la unidad de análisis es la **dirección afectada** por el incidente.
2. `docs/motor-capa1-contratos.md` — contrato de entrada §1 (semántica de `origen_iata`/`destino_iata`, estructura `segmentos` con `afectado`, `datos_extraidos`, campos críticos §1.1).

**Regla maestra:** si el código real contradice estos documentos o este prompt, DETENERSE y reportar. No improvisar. No "mejorar de paso" fuera de alcance.

**Objetivo del ciclo:** rediseñar la captura del caso (form público + scan IA + panel agencias) para que: (a) el escaneo de la reserva sea el paso protagonista, (b) la extracción de IA devuelva el itinerario completo por segmentos, (c) el pasajero marque el tramo afectado con un tap, y (d) el payload persista `segmentos`, `origen_iata`/`destino_iata` y candidatos declarativos con la semántica de dirección afectada.

**Fuera de alcance (NO tocar):** motor legal, rulesets, backoffice (salvo nada), portal abogados, `perfil.html`, migraciones nuevas (las columnas ya existen del ciclo motor), redacción de reclamos.

---

## Reglas de NO RUPTURA (todas las fases)

1. **Ningún campo legacy cambia de escritura:** `origen`/`destino` (display), `tipo_incidencia`, `horas_retraso`, `anticipacion_aviso`, `monto_gastos`/`moneda_gastos`, `tipo_caso_equipaje`, `pir_presentado`/`pir_numero` se siguen escribiendo exactamente como hoy. Semántica de `origen`/`destino` a partir de este ciclo: extremos de la **dirección afectada** (display); documentarlo en el código.
2. **El camino manual es ciudadano de primera:** todo lo que se puede lograr con scan se puede lograr sin scan. El scan nunca es obligatorio ni bloquea el avance del wizard. Con el feature flag de IA apagado, el flujo manual completo funciona idéntico.
3. **Compatibilidad del JSON de IA:** la respuesta de `process-ticket` conserva TODAS las claves actuales (`origen`, `destino`, `escalas`, `vuelo_nro`, etc.) para no romper el autofill existente; las claves nuevas (`segmentos`, `direccion_afectada_sugerida`) son aditivas.
4. **i18n:** todo texto nuevo del form entra por claves `data-t` en ES e IN, siguiendo el diccionario existente en `app.js`.
5. **Estilo del codebase:** ES5 en front, ESM en `/api`, comentarios en español, sin dependencias nuevas.
6. **Probar tras cada fase:** flujo B2C con scan, B2C manual, panel agencias, y que un caso cargado se vea correcto en el backoffice actual (editor de datos legales del ciclo motor incluido).

---

## Fase 0 — Inventario obligatorio (sin editar)

Reportar antes de cualquier cambio:

```
grep -n "wz-1\|wz-2\|wz-3\|ctype-\|ai-scan" index.html | head -60
grep -n "applyExtracted\|f-origin\|f-destination\|data-airport" src/js/app.js | head -40
grep -n "segmentos\|origen_iata\|destino_iata\|datos_extraidos" api/ -r
grep -n "escalas" api/ src/js/ -r
grep -n "flagAi\|feature" api/process-ticket.js | head -20
grep -n "scannedFiles\|scanned_files" panel-agencia.html api/agency.js
```

Entregable: estructura real del wizard (pasos, sub-flujos vuelo/equipaje), cómo aplica hoy el autofill del scan, qué escribió el ciclo motor en `process-ticket.js`/`agency.js` para `origen_iata`/`destino_iata` y `datos_extraidos`, y estado del flag de IA. **Discrepancia con lo asumido acá → detenerse y reportar.**

## Fase 1 — Prompt de Gemini v2: extracción por segmentos

En `api/process-ticket.js`, reescribir el prompt de extracción:

- **Nuevo campo `segmentos`**: array con TODOS los tramos de TODOS los documentos, cada uno `{orden, direccion: 'ida'|'vuelta', origen: 'EZE - Buenos Aires', destino: '...', vuelo_nro, aerolinea_operadora, fecha}`. Orden cronológico. Si un dato del tramo no está visible, `""` (regla anti-fabricación vigente).
- **Nuevo campo `direccion_afectada_sugerida`**: `'ida'|'vuelta'|''` — solo si algún documento muestra la incidencia explícitamente en un tramo; si no, `''`. Es sugerencia, nunca decisión.
- **Claves legacy intactas**: `origen`/`destino`/`escalas` se siguen devolviendo; su semántica pasa a ser "de la dirección afectada sugerida, o de la ida si no hay sugerencia" (documentar en el prompt de Gemini).
- Sanitización backend: validar que `segmentos` sea array, tramos con formato esperado, descartar tramos sin origen y destino.

**Aceptación:** un set de prueba con (a) reserva ida y vuelta con escalas, (b) pasaje de un solo tramo, (c) documento ilegible — los tres devuelven JSON válido; el caso (b) produce `segmentos` de un elemento; el (c) produce `segmentos: []` sin inventar nada.

## Fase 2 — Wizard scan-first (index.html + app.js)

- **Paso 1 protagonista:** el scanner IA existente (`ai-scan`) se promueve a elemento central del paso 1, con título tipo "Cargá tu reserva o pasaje" y debajo un enlace/botón secundario **"Prefiero cargar los datos manualmente"** que avanza al wizard sin scan. Con el flag de IA apagado, el paso 1 muestra directamente el modo manual (sin scanner ni enlace).
- **Confirmación de ruta (post-scan):** si el scan devolvió `segmentos` con más de un tramo o más de una dirección, mostrar la ruta como fichas legibles (EZE→MAD, MAD→BCN, BCN→EZE...) y UNA pregunta: **"¿En qué tramo tuviste el problema?"** — selección por tap, preseleccionada con `direccion_afectada_sugerida` si vino. Con un solo tramo, no se pregunta nada (afectado = ese tramo). El pasajero puede corregir fichas (editar aeropuerto vía `airport-select`) o descartarlas y pasar a manual.
- **Derivación automática:** marcado el tramo, el front computa la **dirección afectada** (todos los tramos de esa dirección), y de ella: `origen`/`destino` display + `origen_iata`/`destino_iata` (del `data-iata`) + `segmentos` completo con `afectado: true` en el tramo marcado. Los campos visibles de origen/destino del paso 2 quedan prellenados y editables como hoy.
- **Camino manual:** el paso 2 agrega DOS preguntas livianas antes de origen/destino: "¿Tu viaje era solo ida o ida y vuelta?" y "¿Tuviste escalas en el viaje del problema?" (sí/no). Si hubo escalas: un mini-armador de tramos (lista de aeropuertos con `airport-select`, agregar/quitar) + la misma pregunta de tramo afectado. Si no: origen/destino a secas = dirección afectada de un tramo, `segmentos` de un elemento con `afectado: true`. Ida y vuelta sin escalas: se cargan los extremos del viaje del problema (la pregunta ya orienta: "del viaje donde tuviste el problema").
- **No preguntar jamás al pasajero** el carrier operante por tramo (fuente: documentos/admin/API, no declaración).

**Aceptación:** scan de ida y vuelta con escalas termina con `segmentos` completo y afectado correcto en ≤2 taps extra; manual directo sin escalas agrega exactamente 2 preguntas de un tap; flag IA apagado = flujo manual íntegro; wizard de equipaje no cambia salvo compartir el paso 1.

## Fase 3 — Payload y persistencia

- `app.js` (submit): agregar al payload `segmentos`, `origen_iata`, `destino_iata`, `tipo_viaje` (`solo_ida`|`ida_vuelta`) — aditivo al payload actual.
- `api/process-ticket.js` (flujo manual/registro): persistir `segmentos` (columna JSONB del ciclo motor), `origen_iata`/`destino_iata` (semántica dirección afectada), y escribir en `datos_extraidos` los candidatos con procedencia: tramos provenientes del scan → `fuente: 'adjunto'`; tramos armados a mano por el pasajero → `fuente: 'declaracion_pasajero'`; en ambos casos `verificado: false` (la marca de tramo afectado es declarativa — §1.1: campos críticos no se autoverifican).
- `api/agency.js`: mismos campos.

**Aceptación:** un caso nuevo con scan muestra en el editor de datos legales del backoffice sus `segmentos` con el afectado marcado, sin tocar el backoffice; `campos_meta` refleja `verificado: false`; los campos legacy quedan escritos igual que antes.

## Fase 4 — Panel de agencias

Réplica ligera del patrón en `panel-agencia.html`: el scanner existente adopta scan-first con la confirmación de tramo afectado; el modo manual agrega tipo de viaje + escalas + mini-armador (mismos componentes; los operadores de agencia son usuarios expertos, sin simplificaciones extra). Mismo payload que Fase 3.

**Aceptación:** paridad funcional con el form público; nada del resto del panel cambia.

## Fase 5 — i18n + textos

Claves nuevas ES/IN para: título del paso 1 scan-first, enlace manual, pregunta de tramo afectado, tipo de viaje, escalas, textos del armador de tramos. Verificar que el conmutador de idioma no rompe las fichas de ruta (elementos hijos del DOM).

## Cierre del ciclo

- Actualizar `README.md` (flujo de intake nuevo, semántica de dirección afectada, claves nuevas del JSON de IA).
- **Errata de documentos rectores:** actualizar en `docs/motor-capa1-contratos.md` la fila 1-2 del §1.2 (ahora el form también llena `origen_iata`/`destino_iata` con semántica de dirección afectada) y anotar en el prompt del ciclo motor que la advertencia de "origen/destino sin confirmar" del render del análisis ya no aplica a casos creados por este intake (solo a los históricos).
- Reporte final: qué se hizo por fase, discrepancias, y capturas del flujo (scan, manual, agencia).
