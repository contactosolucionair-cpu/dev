# Inventario de `estado` legacy y deuda asociada (Fase 0)

> Generado en la Fase 0 del prompt "Migración total de estados + Seguridad + Portal Agencias v2 + Limpieza".
> **No se editó código en esta fase.** Cada hallazgo tiene una fase asignada.

## Estado de resolución (Fase 6)

Rama: `feat/migracion-estados-seguridad`. Un commit por fase:

| Fase | Commit | Qué resolvió | Criterio |
|---|---|---|---|
| F0 | `ff842cd` | Este inventario | — |
| F1 | `a65e7ae` | get-claims/update-ticket/delete-ticket con `X-Admin-Password`; `my-claims`/`my-actions` por JWT; perfil migrado; ai_raw fuera de agency | curl sin credencial → 401/500 (código); backoffice manda el header en las 20 llamadas |
| F2 | `58fce92` | agency/abogados/admin/process-ticket por instancia/momento/resultado; acción `transicion`; D2/D3 | grep F2 ✅ (solo estados de cuenta + red de seguridad) |
| F3 | `1fc56e7` | panel-agencia/panel-abogado/perfil por etapa/etapa_label + timelines | grep F3 ✅ |
| F4 | `f2652b8` | comisiones parametrizables (migration_010) + `notify-agencia` | stats por 3 modos; agencia-config; mail best-effort |
| F5 | `9c4cb3c` | soft-delete solo por deleted_at; docs/README; sin Zoho en código | grep F5 zoho (js/html) ✅ vacío |

**Verificación estática F6 (2026-07-23):** sintaxis de todos los `api/*.js` y de los scripts inline de los 7 HTML OK; greps de aceptación F2/F3/F5 en verde; contrato de respuesta B2C de `process-ticket` sin cambios (solo inserts aditivos). **Pendiente de prueba en vivo** (requiere deploy a preview + Supabase con `migration_010` corrida): flujos de browser de los 6 puntos funcionales de F6.

Los hits residuales de `estado` que quedan y son legítimos (no son deuda):
- `ab.estado`/`ag.estado` y `?estado=eq.activa` → estado de **cuenta** de agencia/abogado (otra tabla/columna).
- `getInstancia`/`getPos` con `c.estado` → red de seguridad de derivación para filas viejas con `instancia` null.

Convención de columna "fase":
- **F1** Seguridad de endpoints · **F2** Migración estados backend · **F3** Migración estados frontend
- **F4** Comisiones + notificaciones · **F5** Limpieza de deuda · **—** se mantiene tal cual (no es deuda)

---

## 1. `api/_utils/instancias.js` (fuente de verdad del modelo)

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| instancias.js | 13-35 | — | `ESTADO_A_INSTANCIA` | Mapping directo estado legacy → {instancia,momento,resultado}. Red de seguridad para filas viejas. | — (se mantiene) |
| instancias.js | 43-47 | lee `estado` | `getInstancia(c)` | Deriva {instancia,momento} del caso; usa `c.instancia` si existe, si no cae al mapping por `estado`. **No devuelve `resultado`.** | **F2a** (agregar `resultado: c.resultado \|\| null`) |
| instancias.js | 52-74 | — | `instanciaAEstadoLegacy()` | Mapping inverso instancia→estado legacy. Única forma permitida de escribir `estado`. | — (se mantiene) |
| instancias.js | 79-124 | — | `TRANSICIONES` | Tabla de transiciones válidas. Cubre exactamente el subconjunto de mediación que la Fase 2c pide para el abogado. | — |
| instancias.js | 151-162 | — | `MOTIVOS_CIERRE`, `TIPOS_ESPERA`, etc. | Constantes de validación. | — |
| instancias.js | (nuevo) | — | `etapaExterna(c)` | **No existe todavía.** Hay que crearla exactamente como el prompt indica (vista de 5+3 etapas para portales externos). | **F2a** (crear + exportar) |

---

## 2. `api/get-claims.js`

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| get-claims.js | 9-20 | — | headers/env | Sin auth: cualquiera lee toda la base. `Access-Control-Allow-Headers: Content-Type` (sin `X-Admin-Password`). | **F1** (proteger + agregar header) |
| get-claims.js | 24 | lee | `select=*` | Trae TODAS las columnas (incluye `ai_raw`, IPs). Usado por backoffice y perfil. | **F1** (backoffice mantiene; perfil migra a my-claims) |

---

## 3. `api/my-claims.js` (a crear)

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| my-claims.js | — | — | — | **No existe.** Endpoint nuevo: valida JWT del cliente vs `/auth/v1/user`, filtra `reclamos?email=eq.<email del token>&deleted_at=is.null`, select explícito sin `ai_raw`/IPs, adjunta `etapa`/`etapa_label`. | **F1** (+ etapa en F1/F2) |

---

## 4. `api/update-ticket.js` (backoffice; también lo llama perfil.html)

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| update-ticket.js | 27-30 | — | headers | Sin auth. `Allow-Headers: Content-Type` (sin `X-Admin-Password`). | **F1** (proteger + header) ⚠ ver Discrepancia D1 |
| update-ticket.js | 65 | lee | `estado,estado_historial` | Trae estado legacy junto a instancia/momento en `avanzar`. | — (lo usa solo para el push espejo) |
| update-ticket.js | 147-152 | escribe | `estado`, `estado_historial` | Doble escritura espejo vía `instanciaAEstadoLegacy` + push a `estado_historial`. **Correcto** (escritura espejo centralizada). | — |
| update-ticket.js | 179 | escribe(resp) | `estado` | Devuelve `estado` legacy en la respuesta de `avanzar`. Backoffice lo consume; no decide por él. | — |
| update-ticket.js | 279-291 | escribe | `estado`, `estado_historial` | `set-instancia` (corrección manual): mismo patrón espejo. **Correcto.** | — |
| update-ticket.js | — | — | — | No hay lectura de `estado` para DECIDIR lógica (todo pasa por `getInstancia`/`validarTransicion`). Cumple F2d. | — (verificado, sin cambios) |

---

## 5. `api/delete-ticket.js`

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| delete-ticket.js | 13-16 | — | headers | Sin auth. `Allow-Headers: Content-Type`. Cualquiera puede borrar permanentemente. | **F1** (proteger + header) |
| delete-ticket.js | 33, 51-65 | escribe | `estado:'eliminado'` | Fallback: si no existe `deleted_at`, marca `estado='eliminado'`. Deuda: `deleted_at` ya existe hace varias migraciones. | **F5** (soft-delete solo por `deleted_at`) |
| delete-ticket.js | 81 | escribe | `deleted_at:null`, `estado:'pendiente'` | `restore` fuerza `estado='pendiente'`. | **F5** (restaurar solo limpiando `deleted_at`) |
| delete-ticket.js | 88-98 | escribe | `estado:'pendiente'` | Fallback de restore por `estado`. | **F5** (eliminar) |

---

## 6. `api/abogados.js`

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| abogados.js | 15 | — | import | Importa `ESTADO_A_INSTANCIA`. | **F2c** (reemplazar por validarTransicion/instanciaAEstadoLegacy) |
| abogados.js | 20 | — | `ESTADOS_ABOGADO` | Whitelist de estados legacy que el abogado puede setear. | **F2c** (eliminar) |
| abogados.js | 39, 190-235 | lee/escribe | `estado`, `estado_historial` | Acción `update-estado`: setea estado legacy + mapea a instancia. Modelo legacy. | **F2c** (reemplazar por acción `transicion`) |
| abogados.js | 150-157 | lee | `ab.estado` | Estado de la CUENTA del abogado (pendiente/activa/suspendida). **Otro campo, no reclamos.** | — |
| abogados.js | 172 | lee | `select=...estado,estado_historial...` | Claims del abogado: trae estado legacy, sin instancia/momento/resultado. | **F2c** (agregar `instancia,momento,resultado,motivo_cierre,instancia_historial,monto_acordado`) |
| abogados.js | 175 | lee/filtra | `estado=neq.eliminado` | **Bug:** filtra papelera por estado legacy → un caso en papelera sigue visible. | **F2c** (cambiar a `deleted_at=is.null`) |

---

## 7. `api/agency.js`

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| agency.js | 153-162 | lee | `ag.estado` | Estado de la CUENTA de la agencia. Otro campo. | — |
| agency.js | 177 | lee | `select=...estado...ai_raw` | Claims: trae `estado` legacy y `ai_raw` (pesado/interno). | **F1** (quitar `ai_raw`) + **F2b** (agregar `instancia,momento,resultado,instancia_historial,esperas` y adjuntar `etapa`/`etapa_label`) |
| agency.js | 311 | lee/filtra | `select=estado` | `stats` consulta solo `estado`. | **F2b** (consultar instancia/momento/resultado/monto_acordado/moneda) |
| agency.js | 322-328 | lee | `c.estado` | `stats` agrupa `por_estado` por estado legacy. | **F2b** (por_etapa via etapaExterna) + **F4** (comisiones) |

---

## 8. `api/admin.js`

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| admin.js | 105 | lee/filtra | `reclamos?estado=neq.eliminado` | Conteo de casos por entidad filtra papelera por estado legacy. La grep de criterio F2 lo marca. | **F5** (cambiar a `deleted_at=is.null`) ⚠ ver D3 |
| admin.js | 152 | lee/filtra | `abogados?estado=eq.activa` | Estado de CUENTA del abogado (no reclamos). La grep F2 lo marca pero es legítimo. | — (documentar en D3) |
| admin.js | 413-414 | escribe | `estado:'pendiente'`, `estado_historial` | `create-case` inserta `estado` pero **no `instancia`** ni `instancia_historial`. | **F2/F5** ⚠ ver D2 |
| admin.js | (F4) | — | `agencia-config` | Acción nueva para editar `comision_modo/pct/valor_fijo`. No existe. | **F4** (crear) |

---

## 9. `perfil.html` (portal cliente)

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| perfil.html | 120 | lee | `/api/get-claims` | Trae TODA la base y filtra por email en el cliente (línea 122). Fuga de datos. | **F1** (migrar a my-claims con token, sin filtro cliente, manejar 401) |
| perfil.html | 131-134 | lee | `c.estado` | Deriva `estado`/`estadoLabel`/`bc` legacy. Incluye el bug `estado==='en revision'` (con espacio). | **F3c** (reemplazar por `etapa`/`etapa_label`) |
| perfil.html | 192 | escribe | `/api/update-ticket {id,novedad}` | Envía novedad **sin `action`** → hoy ya devuelve "Acción no reconocida" (bug preexistente). | **F1/F3** ⚠ ver D1 |
| perfil.html | 207 | escribe | `/api/update-ticket {action:'cancel'}` | Cliente cancela su propio caso. **Hoy funciona.** Se rompe si update-ticket queda admin-only. | **F1** ⚠ ver D1 (bloqueante) |

---

## 10. `panel-agencia.html` (portal agencia)

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| panel-agencia.html | 187-192 | lee | `por_estado`, `pendiente/aprobado` | Dashboard: tarjetas y breakdown por estado legacy. | **F3b** (etapas + comisiones) |
| panel-agencia.html | 206 | — | filtro estado | Opciones de filtro legacy (pendiente/aprobado/…). | **F3a** (5+3 etapas) |
| panel-agencia.html | 457-485 | lee | `c.estado`, `badgeClass()` | Detalle + tabla: badge y filtro por estado legacy crudo. | **F3a** (etapa_label + badge por etapa, eliminar `badgeClass`) |
| panel-agencia.html | 531-542 | lee | `d.por_estado` | Breakdown "Por estado". | **F3b** ("Por etapa") |
| panel-agencia.html | 576, 584, 592 | lee | `c.estado` | Filtro y render de la tabla por estado legacy. | **F3a** |
| panel-agencia.html | 963 | lee | `ag.estado` | Estado de la CUENTA de agencia (perfil). Otro campo. | — |
| panel-agencia.html | (nuevo) | — | timeline / requiere acción / autorización | Bloques a agregar en el drawer. | **F3a** |

---

## 11. `panel-abogado.html` (portal abogado)

| archivo | línea | lee/escribe | campo | qué hace | fase |
|---|---|---|---|---|---|
| panel-abogado.html | 116-119 | lee | `ESTADO_LABELS`, `estadoBadge` | Labels/badges por estado legacy de reclamos. | **F3d** (derivar de instancia/momento) |
| panel-abogado.html | 144, 184 | lee | `c.estado` | Tabla y detalle: badge/label por estado legacy. | **F3d** |
| panel-abogado.html | 207-209 | escribe | `sel-med` + `MED_OPCIONES` | Select de estados legacy de mediación. | **F3d** (botones por posición actual) |
| panel-abogado.html | 213-216 | lee | `estado_historial` | Historial por estado legacy. | **F3d** (usar `instancia_historial`) |
| panel-abogado.html | 260-269 | escribe | `/api/abogados/update-estado {estado}` | Guarda estado legacy de mediación. | **F3d** (llamar `/api/abogados/transicion`) |

---

## 12. Otros hallazgos (greps del prompt)

| tema | ubicación | qué pasa | fase |
|---|---|---|---|
| Zoho | `docs/b2b-agencias-prompt.md` (líneas 19,36,55,68-72,76,78,83) | Referencias a Zoho Sign en el doc histórico. En **código activo no hay** `firma_proveedor:'zoho'` (submit-claim NO lo escribe). | **F5** (banner de doc histórico; README flujo manual) |
| `monto_compensacion` | `supabase/migration_002_agencias.sql:28` (columna); `docs/b2b-agencias-prompt.md:36,58` | Columna existe; **ningún código JS/HTML la lee ni escribe.** Concepto vigente: `monto_reclamado`/`monto_acordado`. | **F5** (documentar como deprecada; limpiar refs en docs) |
| `estado_historial` residual | `api/admin.js:414` (create-case) | Inserta `estado_historial` sin `instancia_historial`. | **F2/F5** ⚠ D2 |
| B2C insert sin instancia | `api/process-ticket.js:135` | Inserta `estado:'pendiente'` sin `instancia`. F6.1 espera `instancia='evaluacion'`. | ⚠ D2 |

---

## Discrepancias que requieren decisión ANTES de editar (regla global)

### D1 — `perfil.html` (cliente) escribe en `update-ticket`, que la F1 vuelve admin-only  🔴 BLOQUEANTE
- La F1 exige proteger `/api/update-ticket` con `ADMIN_PASSWORD` (igual que admin.js).
- Pero `perfil.html` (cliente, **no** admin, sin la contraseña) llama a `update-ticket`:
  - `action:'cancel'` (cancelar su propio caso) — **hoy funciona**; quedaría roto.
  - novedad `{id,novedad}` sin `action` — **hoy ya está roto** (no matchea ninguna acción; espera `action:'add-novedad'` con `texto`).
- El prompt no define un camino de auth de cliente para `update-ticket`.
- **RESUELTO (F1):** `update-ticket` queda **admin-only sin excepciones**. Se crea **`api/my-actions.js`** (POST, misma validación JWT que `my-claims`: token → `auth/v1/user` → email autenticado; luego verificar que el caso con ese `id` tenga `email` == autenticado y `deleted_at is null`, si no → 403). Acciones:
  - `cancel`: solo si el caso **no** está `instancia='cerrado'`. Se aplica como transición del modelo nuevo con los helpers de `instancias.js`: `validarTransicion(..., 'abandonar')`, PATCH `instancia='cerrado'`, `resultado='abandonado'`, `motivo_cierre='desistimiento_pasajero'`, push a `instancia_historial` con `por:'cliente'`, y en el **mismo PATCH** el espejo `estado` vía `instanciaAEstadoLegacy` + push a `estado_historial`. **Nunca** escribir `estado:'cancelado'` directo.
  - `novedad`: `{id, texto}`, validar `texto` no vacío, append a `novedades` con formato `{fecha, texto, por:'cliente'}` (arregla el bug preexistente).
  - `perfil.html`: redirigir ambas llamadas a `/api/my-actions` con el Bearer token; manejar 401 (logout) y 403/error de transición mostrando el mensaje del backend.
  - Documentar el endpoint en el README en la **F5**.

### D2 — Inserts nuevos (B2C y alta manual) no setean `instancia`
- `process-ticket.js` (B2C) y `admin.js/create-case` insertan `estado:'pendiente'` pero **no** `instancia`/`instancia_historial`.
- Hoy funciona por la red de seguridad `getInstancia()`, pero la verificación F6.1 pide literalmente `instancia='evaluacion'` al crear.
- Ninguno de los dos archivos figura en la lista de edición de la F2.
- **RESUELTO (F2, aditivo):** agregar `instancia:'evaluacion'` + `instancia_historial` inicial `[{instancia:'evaluacion', momento:null, fecha:<now>, por:'sistema'}]` a los inserts de `process-ticket.js` y `admin/create-case`. **Cambio aditivo únicamente**: no modificar ningún otro campo ni el contrato de respuesta. Verificar el flujo B2C completo al cerrar la fase.

### D3 — `estado=neq.eliminado` en `api/admin.js:105`
- Es una lectura de `estado` legacy como filtro; la grep de criterio F2 la marcaría.
- `admin.js` no está en la lista de edición de la F2 (solo agency/abogados/update-ticket).
- **RESUELTO (F2, no F5):** cambiarla a `deleted_at=is.null` en la **F2**, junto con el fix equivalente de `abogados/claims`, para que la grep del criterio de aceptación de la F2 quede en verde al cerrar esa fase. `abogados?estado=eq.activa` (línea 152) es estado de CUENTA y se mantiene.
