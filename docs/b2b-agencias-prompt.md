# TAREA: Portal B2B de Agencias para SolucionAir

Estás trabajando en `solucionair-web`: sitio de reclamos aéreos. Stack: **HTML estático + JS vanilla + funciones serverless Vercel en `/api/*` + Supabase vía REST API**. NO hay framework ni build step (package.json solo tiene `pdf-lib`). `vercel.json` tiene `cleanUrls:true` (así `/backoffice` sirve `backoffice.html`).

## Contexto del código existente (NO reinventar patrones)

- **API pattern** (seguir EXACTO, ver `api/get-claims.js`, `api/login.js`, `api/process-ticket.js`): cada handler setea headers CORS, maneja `OPTIONS`, valida método, lee `process.env.SUPABASE_URL` + `process.env.SUPABASE_SERVICE_ROLE_KEY`, y hace `fetch` a `${SB_URL}/rest/v1/...` con headers `apikey` + `Authorization: Bearer ${SB_KEY}`. Usa `var`, try/catch, `console.log('[nombre-endpoint] ...')`.
- **Frontend**: vanilla JS, sin imports/módulos. Reusar el design system (CSS tokens `--g`, `--au`, `--bg`, `--fh`, `--fm`, etc.) tal como están en `backoffice.html` y `perfil.html`.
- **Auth existente**: `api/login.js` hace Supabase Auth `password grant` y cae a buscar el email en `reclamos`. `perfil.html` (panel cliente) guarda `localStorage.sb_token` / `sb_email` y redirige a `/` si no hay token.
- **Tabla `reclamos`** (columnas ya existentes relevantes): `id` (uuid), `nombre, telefono, email, documento_tipo, documento_numero, aerolinea, vuelo_nro, fecha_vuelo, origen, destino, pnr, tipo_reclamo, tipo_incidencia, horas_retraso, anticipacion_aviso, ofrecimiento_aerolinea, causa_informada, moneda_gastos, monto_gastos, gastos_detalle, tipo_caso_equipaje, descripcion_equipaje, valor_equipaje, fecha_entrega_equipaje, google_sub, google_email_verified, google_iss, fecha_carga, fuente, estado, ref_code, consent_*, firma_fecha, firma_ts, user_agent, ip_firmante, adjuntos (jsonb), ai_raw (jsonb), novedades, creado_en, deleted_at`.
- **PDF**: `api/utils/pdf-receipt.js` exporta `generateAuthorizationPdf(d)` — reutilizable para la autorización B2B.
- **Backoffice admin** `backoffice.html`: tiene sidebar con vistas Reclamos / Papelera / Configuración (toggle por JS mostrando/ocultando divs `#view-*`). NO tiene gate de auth actualmente.
- El flujo cliente B2C (muro de Google en `index.html` + `src/js/app.js` + `process-ticket.js`) **NO se debe romper**. B2B es un canal paralelo.

## Decisiones de producto (ya tomadas, respetar)

1. **Alta de agencia con aprobación admin**: registro crea cuenta en estado `pendiente`; no puede cargar casos hasta `activa`.
2. **1 login = 1 usuario** (sea "agencia" o "agente individual", distinguido por campo `tipo`). El caso se asigna a ese usuario para comisiones/KPIs.
3. **Firma B2B vía Zoho Sign**: el agente declara que tiene autorización del cliente; el sistema genera la autorización y la envía al cliente (email) para firma electrónica con **Zoho Sign**. Trackear estado de firma.
4. **Vista admin de Agencias** en `backoffice.html` para aprobar/suspender y ver casos + comisiones.

## Seguridad (CRÍTICO)

- `api/get-claims.js` devuelve TODOS los reclamos sin auth. **NO reusarlo para agencias.** Crear endpoints `/api/agency/*` que:
  1. Lean el JWT del header `Authorization: Bearer <token>`.
  2. Lo validen llamando `GET ${SB_URL}/auth/v1/user` con `apikey` + `Authorization: Bearer <token>` para obtener el `id`/`email` del usuario autenticado.
  3. Busquen la fila en `agencias` por `auth_user_id`, verifiquen `estado='activa'`.
  4. Recién entonces usen `SERVICE_ROLE_KEY` para consultar `reclamos` **filtrando por `agencia_id`**. Un agente NUNCA debe ver casos de otra agencia.
- Usar claves de localStorage distintas a las del cliente: `sa_ag_token` / `sa_ag_email`.

## FASES (implementar en orden, commitear por fase)

### Fase 1 — Migración DB
Crear `supabase/migration_002_agencias.sql` con:
- Tabla `agencias`: `id uuid PK default gen_random_uuid()`, `auth_user_id uuid unique`, `nombre text`, `tipo text` (`'agencia'|'individual'`), `cuit_dni text`, `email text`, `telefono text`, `estado text default 'pendiente'` (`'pendiente'|'activa'|'suspendida'`), `comision_pct numeric default 10`, `aprobada_en timestamptz`, `creado_en timestamptz default now()`.
- Columnas nuevas en `reclamos` (con `IF NOT EXISTS`): `canal text default 'B2C'`, `agencia_id uuid`, `agente_nombre text`, `agente_email text`, `cliente_autorizacion_declarada boolean default false`, `firma_estado text default 'no_aplica'` (`'no_aplica'|'pendiente_envio'|'enviada'|'firmada'|'rechazada'`), `firma_proveedor text`, `firma_zoho_request_id text`, `firma_zoho_url text`, `monto_compensacion numeric`.
- Índices: `reclamos(agencia_id)`, `agencias(auth_user_id)`, `agencias(estado)`.
- Incluir comentario al inicio: "Correr en Supabase SQL Editor".

### Fase 2 — Auth de agencias
- `POST /api/agency/register`: recibe `{nombre, tipo, cuit_dni, email, telefono, password}`. Crea usuario en Supabase Auth (`POST ${SB_URL}/auth/v1/signup` con apikey) e inserta fila en `agencias` (estado `pendiente`, `auth_user_id` = id devuelto). Devuelve `{success}`. Manejar email duplicado.
- `POST /api/agency/login`: `password grant` (como `login.js`). Tras login, leer la fila `agencias`. Si `estado!='activa'` devolver `{success:true, estado:'pendiente'}` SIN permitir operar (el front muestra "tu cuenta está en revisión"). Devolver `{token, email, agencia:{nombre,estado,comision_pct,tipo}}`.
- Helper compartido `api/utils/agency-auth.js` con `async function verifyAgency(req, SB_URL, SB_KEY)` que valida el JWT, devuelve la fila `agencias` o `null`. Reutilizar en todos los `/api/agency/*`.

### Fase 3 — Páginas del portal
- `agencias.html`: landing B2B con tabs Login / Registro (mismo design system). En éxito de login guarda `sa_ag_token`/`sa_ag_email` y redirige a `/panel-agencia`. Si la cuenta está `pendiente`, mostrar aviso.
- `panel-agencia.html`: panel gated (si no hay `sa_ag_token` → redirige a `/agencias`). Sidebar estilo `backoffice.html` con vistas: Dashboard, Mis casos, Cargar caso, Perfil, Cerrar sesión. Toda llamada a `/api/agency/*` manda `Authorization: Bearer ${sa_ag_token}`.

### Fase 4 — Mis casos
- `GET /api/agency/claims`: valida agencia (Fase 2 helper) → devuelve solo `reclamos` con `agencia_id = agencia.id` y `deleted_at IS NULL`, ordenados por `creado_en desc`.
- Vista "Mis casos": tabla (Ref, Pasajero, Vuelo, Aerolínea, Fecha, Estado, % éxito, Estado firma) + búsqueda + filtro por estado. Click → drawer read-only con detalle, novedades y estado de firma. Reusar estilos `.tbl-*`, `.badge--*`, `.detail*` de `backoffice.html`.

### Fase 5 — Cargar caso (formulario B2B)
- Vista "Cargar caso" en `panel-agencia.html`: wizard similar al público pero **sin muro de Google**. Campos: datos del **cliente** (nombre, email, teléfono, doc tipo/número), selector vuelo/equipaje + campos correspondientes (reusar la misma estructura de `index.html`), y checkbox obligatorio "Declaro que cuento con autorización del cliente para gestionar este reclamo". Reutilizar el escaneo con IA (`POST /api/process-ticket` modo multiFile ya existe).
- `POST /api/agency/submit-claim`: valida agencia `activa` → inserta `reclamos` con `canal='B2B'`, `fuente='Agencia'`, `agencia_id`, `agente_nombre`, `agente_email`, `cliente_autorizacion_declarada=true`, `estado='pendiente'`, `firma_estado='pendiente_envio'`, `firma_proveedor='zoho'`, genera `ref_code` (misma lógica que `process-ticket.js`), sube `scanned_files` al bucket (reusar lógica de `process-ticket.js`), y dispara el módulo de firma (Fase 8). Devuelve `{success, refCode}`.

### Fase 6 — KPIs / comisiones
- `GET /api/agency/stats`: valida agencia → devuelve `{total, por_estado:{...}, tasa_exito, comision_estimada}`. `comision_estimada` = suma de `monto_compensacion * comision_pct/100` sobre casos resueltos con `monto_compensacion` no nulo.
- Vista Dashboard: tarjetas con esos números (reusar `.stat`/`.stats` de backoffice).

### Fase 7 — Admin: vista Agencias
- En `backoffice.html` agregar item de sidebar "Agencias" + `#view-agencias` (mismo patrón de toggle de vistas existente).
- `GET /api/admin/agencies`: lista todas las agencias con conteo de casos (join lógico vía 2 queries).
- `POST /api/admin/agencies`: `{id, action}` con `action` `'aprobar'|'suspender'|'reactivar'` → PATCH `estado`. Al aprobar setear `aprobada_en`.
- Tabla con: Nombre, Tipo, Email, CUIT/DNI, Estado, # casos, Comisión %, acciones (Aprobar/Suspender).
- **Hardening recomendado**: agregar un gate simple de auth al backoffice admin (al menos password contra una env var `ADMIN_PASSWORD`), ya que ahora gestiona comisiones. Implementarlo como modal de acceso en `backoffice.html`.

### Fase 8 — Módulo de firma Zoho Sign
- `api/utils/zoho-sign.js`: módulo que (1) genera el PDF con `generateAuthorizationPdf` en variante B2B (poderdante = pasajero, mandataria = agencia), (2) crea una solicitud de firma en Zoho Sign vía su REST API con el cliente como firmante, (3) devuelve `{requestId, signUrl}`. Requiere env vars `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNT_DOMAIN`.
- **Fallback**: si las env vars de Zoho NO están configuradas, NO romper: dejar `firma_estado='pendiente_envio'` y loguear que el envío es manual. Aislar toda la lógica Zoho en este módulo con try/catch.
- `POST /api/zoho/webhook`: recibe callback de Zoho al firmarse → ubica el reclamo por `firma_zoho_request_id` → setea `firma_estado='firmada'` y guarda URL del doc firmado en `adjuntos`.
- En `submit-claim` (Fase 5): tras insertar, llamar al módulo; si devuelve requestId, PATCH `reclamos` con `firma_zoho_request_id`, `firma_zoho_url`, `firma_estado='enviada'`.

## Requisitos no funcionales
- Mantener estilo de código existente (var, vanilla, comentarios en español, headers de doc en cada `/api/*`).
- No agregar dependencias salvo que sea imprescindible (solo `pdf-lib` está permitido; para Zoho usar `fetch` nativo).
- Cada fase: probar que no rompe el flujo B2C. Commit por fase con mensajes `feat:`/`fix:` y co-author trailer.
- Variables de entorno nuevas: documentarlas en el README (sección "Env vars": `ZOHO_*`, `ADMIN_PASSWORD`).

## Entregables / criterios de aceptación
1. Una agencia puede registrarse, queda `pendiente`, el admin la aprueba, y entonces puede loguearse y operar.
2. Un agente solo ve SUS casos (verificado server-side por JWT).
3. Al cargar un caso B2B queda con `canal='B2B'`, `agencia_id`, `agente_nombre`, y se dispara (o se deja pendiente si Zoho no está configurado) el envío de firma al cliente.
4. El dashboard muestra KPIs y comisión estimada de esa agencia.
5. El admin ve y gestiona agencias y sus comisiones desde `backoffice.html`.
6. El flujo cliente B2C original sigue funcionando igual.

Antes de empezar, leé: `api/process-ticket.js`, `api/login.js`, `api/get-claims.js`, `backoffice.html`, `perfil.html`, `index.html`, `src/js/app.js`, `api/utils/pdf-receipt.js`. Trabajá fase por fase y mostrá el plan de archivos a tocar antes de cada fase.
