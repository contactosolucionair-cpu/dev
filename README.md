# SolucionAir — Enterprise Flight Claim Portal

Plataforma LegalTech de nivel enterprise que automatiza la gestión integral de reclamos aéreos mediante inteligencia artificial. El sistema procesa documentos de viaje con visión por IA, calcula la viabilidad financiera del reclamo según normativas internacionales y gestiona el ciclo de vida completo del caso desde la carga inicial hasta la resolución.

## Características Clave Integradas

### Procesamiento Inteligente Multi-Archivo
Motor avanzado de visión artificial (Google Gemini 2.5 Flash via OpenRouter) que extrae, unifica y sanitiza datos de múltiples pasajes, fotos de boarding passes y PDFs en una única sesión consolidada. El sistema implementa sanitización en tres capas (prompt, backend, frontend) para garantizar la integridad de los datos extraídos, incluyendo detección automática de códigos PNR, rutas de vuelo con escalas, importes de gastos y tipo de incidencia.

### Módulo de Internacionalización Dinámica (i18n)
Sistema centralizado que conmuta de forma fluida el 100% de la interfaz entre Español e Inglés. La traducción abarca el Hero, el proceso de 4 pasos, las secciones de asesoría legal, los tipos de cobertura, tarjetas de testimonios y el formulario completo de 3 pasos. Las traducciones se gestionan mediante un diccionario built-in con fallback automático y pueden ser sobreescritas dinámicamente desde la base de datos.

### Core de Configuración Dinámica (CMS & Feature Flags)
Panel administrativo en el Backoffice que permite controlar en tiempo real:
- **Paleta de colores**: Modificación de colores primario, secundario, fondo y texto mediante variables CSS (`:root`) que se inyectan dinámicamente al cargar la página.
- **Textos globales**: Edición de títulos, subtítulos y CTAs en ambos idiomas desde una interfaz visual.
- **Feature Flags**: Interruptores para activar/desactivar el procesamiento de imágenes con IA y el cálculo automático de tasa de éxito, almacenados en estructura JSONB.

### Cálculo Predictivo de Éxito
Algoritmo predictivo basado en IA que analiza parámetros del vuelo (aerolínea, horas de retraso, causa informada, tipo de incidencia) cruzándolos con normativas internacionales para otorgar un porcentaje de viabilidad financiera:
- **Argentina (ANAC / Decreto 1476/98)**: Umbral de 4 horas para demoras. Cancelaciones sin aviso y overbooking en vuelos nacionales: 85-95%. Causa meteorológica comprobable: 0%.
- **Europa (EU261)**: Demoras superiores a 3 horas o cancelaciones con aerolínea europea: 90-100% por multas automáticas.
- **EE.UU. (DOT)**: Sin compensación obligatoria por demora simple. Overbooking o cancelación sin reembolso: 60-80%.
- **Ponderación por aerolínea**: Ajuste según comportamiento histórico en mediaciones.

El porcentaje se almacena internamente y es visible únicamente para el equipo administrativo en el Backoffice.

## Arquitectura del Sistema

```
solucionair-web/
├── index.html              # Landing page + formulario wizard de 3 pasos
├── perfil.html             # Panel del cliente (estado de reclamos)
├── backoffice.html         # Panel de administración (reclamos + config)
├── vercel.json             # Configuración de Clean URLs
├── src/
│   ├── css/
│   │   └── styles.css      # Sistema de diseño con CSS custom properties
│   └── js/
│       └── app.js          # Lógica del formulario, AI scanner, wizard, i18n
├── api/
│   ├── process-ticket.js   # Procesamiento de reclamos + AI vision + % éxito
│   ├── analyze-document.js # Análisis individual de documentos con AI
│   ├── get-claims.js       # Listado de reclamos desde Supabase
│   ├── generate-reply.js   # Generación y optimización de respuestas con AI
│   ├── update-ticket.js    # Actualización de estado y novedades de casos
│   ├── login.js            # Autenticación de usuarios
│   ├── get-config.js       # Lectura de configuración dinámica (site_config)
│   └── save-config.js      # Persistencia de configuración dinámica
└── README.md
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
  estado        TEXT NOT NULL DEFAULT 'pendiente',
  ai_raw        JSONB,
  ref_code      TEXT,
  creado_en     TIMESTAMPTZ DEFAULT now()
);
```

El campo `ai_raw` (JSONB) almacena datos extendidos: documento, origen, destino, PNR, incidencia, gastos, causa y porcentaje de éxito.

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

## Configuración del Entorno

Variables requeridas en Vercel Dashboard > Settings > Environment Variables:

| Variable | Descripción |
|---|---|
| `OPENROUTER_API_KEY` | API key de OpenRouter para modelos de IA (Gemini 2.5 Flash) |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase con permisos de escritura |
| `RESEND_API_KEY` | API key de Resend para emails transaccionales |
| `NOTIFY_EMAIL` | Casilla interna para alertas de nuevos reclamos |

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

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/process-ticket` | Scan AI multi-archivo + submit final de reclamo |
| POST | `/api/analyze-document` | Análisis individual de documento con AI |
| GET | `/api/get-claims` | Lista todos los reclamos |
| POST | `/api/generate-reply` | Genera o optimiza respuestas con AI |
| POST | `/api/update-ticket` | Actualiza estado o agrega novedades |
| POST | `/api/login` | Autenticación de usuarios |
| GET | `/api/get-config` | Lee configuración dinámica del sitio |
| POST | `/api/save-config` | Guarda configuración dinámica |

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
    ├── Cálculo predictivo de % éxito (interno)
    ├── Persistencia en Supabase
    ├── Email de alerta interna (Resend)
    └── Email de confirmación al cliente
    │
    ▼
Tarjeta de éxito con código CSA correlativo
```

## URLs de Producción

| Recurso | URL |
|---|---|
| Landing | https://solucionair-web-seven.vercel.app |
| Backoffice | https://solucionair-web-seven.vercel.app/backoffice |
| Panel Cliente | https://solucionair-web-seven.vercel.app/perfil |

## Licencia

Proyecto privado. Todos los derechos reservados. SolucionAir 2026.
