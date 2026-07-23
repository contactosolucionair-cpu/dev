# SolucionAir — Enterprise Flight Claim Portal

Plataforma LegalTech de nivel enterprise que automatiza la gestión integral de reclamos aéreos mediante inteligencia artificial. El sistema procesa documentos de viaje con visión por IA, calcula la viabilidad financiera del reclamo según normativas internacionales y gestiona el ciclo de vida completo del caso desde la carga inicial hasta la resolución.

## Características Clave Integradas

### Procesamiento Inteligente Multi-Archivo
Motor avanzado de visión artificial (Google Gemini 2.5 Flash via OpenRouter) que extrae, unifica y sanitiza datos de múltiples pasajes, fotos de boarding passes y PDFs en una única sesión consolidada. El sistema implementa sanitización en tres capas (prompt, backend, frontend) para garantizar la integridad de los datos extraídos, incluyendo detección automática de códigos PNR, rutas de vuelo con escalas, importes de gastos y tipo de incidencia.

### Módulo de Internacionalización Completa (i18n)
Sistema de localización nativo con 135+ claves de traducción que conmuta de forma fluida el 100% de la interfaz entre Español e Inglés mediante atributos `data-t` declarativos. La cobertura abarca:
- **Landing page**: Hero (título, subtítulo, CTA, enlace secundario, badges de confianza), trust bar (3 tarjetas), navegación principal y footer
- **Secciones de contenido**: Cómo funciona (4 pasos), contingencia legal (4 sub-items), casos reclamables (6 tarjetas), ventajas (6 tarjetas), testimonios (3 reseñas), quiénes somos, FAQ (7 preguntas/respuestas)
- **Formulario wizard**: Etiquetas de campos, placeholders, opciones de select (DNI/Pasaporte/ID), botones de navegación entre pasos, estados del scanner IA
- **Modales y sistema**: Login, registro, confirmaciones, notificaciones

El motor de traducción preserva elementos hijos del DOM (asteriscos de campos obligatorios, iconos SVG) durante el intercambio de idioma sin corromper la estructura HTML. Las traducciones pueden ser sobreescritas dinámicamente desde la tabla `site_config` de Supabase.

### Core de Configuración Dinámica (CMS & Feature Flags)
Panel administrativo en el Backoffice que permite controlar en tiempo real:
- **Paleta de colores**: Modificación de colores primario, secundario, fondo y texto mediante variables CSS (`:root`) que se inyectan dinámicamente al cargar la página.
- **Textos globales**: Edición de títulos, subtítulos y CTAs en ambos idiomas desde una interfaz visual.
- **Feature Flags**: Interruptor para activar/desactivar el procesamiento de imágenes con IA, almacenado en estructura JSONB.

### Módulo de Seguridad de Datos (Soft Delete)
Sistema de papelera de reciclaje que implementa eliminación lógica (soft delete) mediante campo `deleted_at` en la tabla de reclamos. Los registros eliminados desaparecen de la vista principal con transición suave y se almacenan en una papelera accesible desde el Backoffice, desde donde pueden ser restaurados o eliminados permanentemente. La consulta principal filtra automáticamente los registros con `deleted_at` no nulo.

### Sistema de Confirmaciones Dinámicas y Notificaciones
Módulo de interfaz que reemplaza completamente los popups nativos del navegador (`alert`, `confirm`) por modales estilizados con backdrop blur y toast notifications animadas. Los modales adoptan la paleta de colores corporativa mediante CSS custom properties, soportan estados de carga durante operaciones asíncronas y muestran errores inline sin interrumpir el flujo de trabajo. Las notificaciones toast aparecen con animación y se auto-descartan a los 3 segundos.

## Arquitectura del Sistema

```
solucionair-web/
├── index.html              # Landing page + formulario wizard de 3 pasos (B2C)
├── perfil.html             # Panel del cliente (sus casos, timeline, cancelar/novedad)
├── backoffice.html         # Panel admin (reclamos, papelera, agencias, abogados, config)
├── agencias.html           # Login / registro del portal B2B de agencias
├── panel-agencia.html      # Panel de la agencia (dashboard, casos, cargar caso)
├── abogados.html           # Login / registro del portal de abogados
├── panel-abogado.html      # Panel del abogado (casos en mediación, transiciones)
├── vercel.json             # Clean URLs + rewrites /api/{agency,abogados,admin}/:action
├── src/
│   ├── css/styles.css      # Sistema de diseño con CSS custom properties
│   └── js/app.js           # Formulario, AI scanner, wizard, i18n
├── api/
│   ├── process-ticket.js   # Submit B2C + AI vision (crea caso en instancia 'evaluacion')
│   ├── get-claims.js       # Lista de reclamos para el backoffice (X-Admin-Password)
│   ├── my-claims.js        # Casos del cliente autenticado por su JWT (con etapa/etapa_label)
│   ├── my-actions.js       # Acciones del cliente sobre su caso (cancel / novedad, JWT)
│   ├── update-ticket.js    # Ciclo de vida del caso (admin, X-Admin-Password)
│   ├── delete-ticket.js    # Soft-delete / restore / permanent (X-Admin-Password)
│   ├── agency.js           # Portal B2B: register/login/claims/submit-claim/stats
│   ├── abogados.js         # Portal abogados: register/login/claims/transicion/sign
│   ├── admin.js            # Admin: agencias/abogados, comisiones, storage, docs legales
│   └── _utils/
│       ├── instancias.js       # Modelo instancia/momento/resultado + transiciones + etapaExterna
│       ├── cliente-auth.js     # Valida el JWT del cliente (my-claims / my-actions)
│       ├── agency-auth.js      # Valida el JWT de la agencia
│       ├── abogado-auth.js     # Valida el JWT del abogado
│       └── notify-agencia.js   # Mail a la agencia al cambiar la etapa de su caso
└── supabase/               # Migraciones SQL (correr en el SQL Editor)
```

### Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3 (custom properties), JavaScript ES5+ |
| Tipografías | Plus Jakarta Sans, Inter, JetBrains Mono |
| Backend | Vercel Serverless Functions (Node.js, ESM) |
| IA / Visión | Google Gemini 2.5 Flash via OpenRouter API |
| Base de Datos | Supabase (PostgreSQL) con REST API directa |
| Email | Resend API (transaccional) |
| Hosting | Vercel (Edge Network) |

### Persistencia y Esquema de Datos

**Tabla `reclamos`** — Almacena cada caso con datos del pasajero, vuelo, estado y metadatos de IA:
```sql
CREATE TABLE reclamos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre        TEXT NOT NULL,
  telefono      TEXT,
  email         TEXT NOT NULL,
  aerolinea     TEXT,
  vuelo_nro     TEXT,
  fecha_vuelo   DATE,
  tipo_reclamo  TEXT NOT NULL DEFAULT 'vuelo',
  instancia     TEXT DEFAULT 'evaluacion',   -- fuente de verdad del ciclo de vida
  momento       TEXT,                          -- preparacion | presentado | respuesta_recibida
  resultado     TEXT,                          -- exito | sin_exito | no_apto | abandonado
  instancia_historial JSONB DEFAULT '[]',
  estado        TEXT NOT NULL DEFAULT 'pendiente',  -- ESPEJO DERIVADO (deprecado)
  deleted_at    TIMESTAMPTZ,                    -- soft-delete (papelera)
  ai_raw        JSONB,
  ref_code      TEXT,
  creado_en     TIMESTAMPTZ DEFAULT now()
);
```

**Modelo de estados (importante).** El ciclo de vida del caso se modela con
`instancia + momento + resultado` (ver `api/_utils/instancias.js`), que es la
**única fuente de verdad**. La columna `estado` legacy **no se lee ni se filtra**
en ningún lado: se conserva solo como **espejo derivado**, escrito siempre vía
`instanciaAEstadoLegacy()` en el mismo PATCH que escribe `instancia`.
`getInstancia()` deriva la posición de filas antiguas con `instancia` en null, y
`etapaExterna()` produce la **vista simplificada de 5+3 etapas** que consumen los
portales externos (agencia y cliente): `evaluacion`, `reclamo`, `mediacion`,
`acuerdo`, y `cerrado_exito` / `cerrado_sin_exito` / `cerrado_no_viable`.

**Columnas deprecadas** (existen en la base pero ningún código las usa):
`estado` (reemplazada por instancia/momento/resultado), `monto_compensacion`
(el concepto vigente es `monto_reclamado` / `monto_acordado`) y las columnas de
firma electrónica `firma_proveedor` / `firma_zoho_request_id` / `firma_zoho_url`
(la integración con un proveedor de firma quedó pendiente; ver más abajo).

El campo `ai_raw` (JSONB) almacena la huella SHA-256 del caso (`huella_sha256`), usada como fingerprint de la firma electrónica.

**Tabla `site_config`** — Configuración dinámica del sitio con estructura JSONB:
```sql
CREATE TABLE site_config (
  id            TEXT PRIMARY KEY DEFAULT 'global',
  colors        JSONB,
  feature_flags JSONB,
  translations  JSONB,
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

Ambas tablas operan con Row Level Security (RLS) configurado para permitir operaciones del service role.

### Rutas Limpias (Clean URLs)

El proyecto utiliza `cleanUrls: true` en `vercel.json`, eliminando la extensión `.html` de todas las rutas:

| Ruta | Descripción |
|---|---|
| `/` | Landing page con formulario de reclamos |
| `/backoffice` | Panel de administración |
| `/perfil` | Panel del cliente |
| `/agencias` | Portal B2B — login / registro de agencias |
| `/panel-agencia` | Panel de la agencia (dashboard, casos, cargar caso) |
| `/abogados` | Portal de abogados — login / registro |
| `/panel-abogado` | Panel del abogado (casos en mediación, transiciones) |

## Configuración del Entorno

Variables requeridas en Vercel Dashboard > Settings > Environment Variables:

| Variable | Descripción |
|---|---|
| `OPENROUTER_API_KEY` | API key de OpenRouter para modelos de IA (Gemini 2.5 Flash) |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase con permisos de escritura |
| `RESEND_API_KEY` | API key de Resend para emails transaccionales y aviso de etapa a agencias |
| `ADMIN_PASSWORD` | Contraseña del backoffice. Protege `admin`, `get-claims`, `update-ticket` y `delete-ticket` (header `X-Admin-Password`). Si no está seteada, esos endpoints responden 500 (no quedan abiertos). |

> Los portales externos (cliente, agencia, abogado) se autentican con el **JWT de Supabase Auth** (header `Authorization: Bearer <token>`), no con `ADMIN_PASSWORD`.

## Despliegue

```bash
# Desarrollo local
npx vercel dev

# Producción
npx vercel --prod --yes

# Logs en tiempo real
npx vercel logs --since 1h --expand
```

## Endpoints API

Los handlers de agencia, abogados y admin son **consolidados**: `vercel.json`
reescribe `/api/agency/:action → /api/agency?action=:action` (ídem `abogados` y
`admin`). La columna **Auth** indica qué credencial exige cada endpoint.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/process-ticket` | — | Scan AI multi-archivo + submit B2C (crea caso en `evaluacion`) |
| GET | `/api/get-claims` | `X-Admin-Password` | Lista todos los reclamos (backoffice) |
| POST | `/api/update-ticket` | `X-Admin-Password` | Ciclo de vida del caso (avanzar, esperas, cobro, firma, etc.) |
| POST | `/api/delete-ticket` | `X-Admin-Password` | Soft-delete / restore / permanent |
| GET | `/api/my-claims` | `Bearer` (cliente) | Casos del cliente autenticado (con `etapa`/`etapa_label`) |
| POST | `/api/my-actions` | `Bearer` (cliente) | `cancel` / `novedad` sobre el propio caso |
| GET/POST | `/api/get-config` · `/api/save-config` | — / admin | Configuración dinámica del sitio |
| **B2B Agencias** | | | |
| POST | `/api/agency/register` · `/api/agency/login` | — | Alta / login de agencia |
| GET | `/api/agency/claims` | `Bearer` (agencia) | Casos de la agencia (con `etapa`/`etapa_label`) |
| POST | `/api/agency/submit-claim` | `Bearer` (agencia) | Carga de nuevo caso B2B |
| GET | `/api/agency/stats` | `Bearer` (agencia) | KPIs por etapa + comisión estimada/confirmada |
| **Abogados** | | | |
| POST | `/api/abogados/register` · `/api/abogados/login` | — | Alta / login de abogado |
| GET | `/api/abogados/claims` | `Bearer` (abogado) | Casos asignados (no borrados) |
| POST | `/api/abogados/transicion` | `Bearer` (abogado) | Avance de mediación (presentar, respuesta_recibida, volver_a_presentar, acuerdo, cerrar_sin_exito) |
| GET | `/api/abogados/sign` | `Bearer` (abogado) | URL firmada de un adjunto del caso asignado |
| **Admin** (`?action=`) | | | |
| GET/POST | `/api/admin?action=agencias\|agencia-accion\|agencia-config` | `X-Admin-Password` | Listar agencias, aprobar/suspender, editar comisión |
| GET/POST | `/api/admin?action=abogados\|abogado-accion\|abogados-activos` | `X-Admin-Password` | Gestión de abogados |
| POST | `/api/admin?action=create-case\|generar-documento` | `X-Admin-Password` | Alta manual de caso, generar poder/patrocinio |
| POST | `/api/admin?action=sign\|upload\|remove\|retag\|download-zip` | `X-Admin-Password` | Gestión de adjuntos en Storage |

## Flujo del Sistema

```
Carga de documentos (multi-archivo)
    │
    ▼
Gemini 2.5 Flash extrae datos unificados
    │
    ▼
Autocompletado del formulario (Paso 1 + 2)
    │
    ▼
Firma electrónica y envío (Paso 3)
    │
    ├── Persistencia en Supabase
    ├── PDF de autorización firmado (huella SHA-256)
    ├── Email de alerta interna (Resend)
    └── Email de confirmación al cliente
    │
    ▼
Tarjeta de éxito con código CSA correlativo
```

## Firma de autorización

El flujo de firma de la autorización es **manual**: el admin genera la
autorización (poder / convenio de patrocinio) desde el backoffice, la envía al
pasajero por WhatsApp o email, y una vez firmada actualiza `firma_estado` desde
el backoffice (`no_aplica` → `pendiente_envio` → `enviada` → `firmada` /
`rechazada`). Los portales de agencia y cliente muestran ese estado con un texto
explicativo.

La **integración con un proveedor de firma electrónica está pendiente de
contratación**. Las columnas `firma_proveedor`, `firma_zoho_request_id` y
`firma_zoho_url` quedaron en la base de una iteración anterior pero **ningún
código las escribe**.

## URLs de Producción

| Recurso | URL |
|---|---|
| Landing | https://solucionair-web-seven.vercel.app |
| Backoffice | https://solucionair-web-seven.vercel.app/backoffice |
| Panel Cliente | https://solucionair-web-seven.vercel.app/perfil |

## Licencia

Proyecto privado. Todos los derechos reservados. SolucionAir 2026.
