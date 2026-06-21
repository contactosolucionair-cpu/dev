# SolucionAir - Portal de Reclamaciones de Vuelos

Plataforma LegalTech que automatiza reclamos aereos mediante inteligencia artificial. Extrae datos de pasajes y comprobantes de vuelo usando vision por IA, calcula el porcentaje de exito del reclamo segun normativas vigentes y gestiona el proceso legal completo.

## Arquitectura del Sistema

```
solucionair-web/
├── index.html              # Landing + formulario de 3 pasos
├── perfil.html             # Panel del cliente (estado de reclamos)
├── backoffice.html         # Panel de administracion interno
├── src/
│   ├── css/
│   │   └── styles.css      # Estilos globales (Plus Jakarta Sans, Inter, JetBrains Mono)
│   └── js/
│       └── app.js          # Logica del formulario, AI scanner, wizard de 3 pasos
├── api/
│   ├── process-ticket.js   # Procesamiento de reclamos + AI vision + calculo % exito
│   ├── analyze-document.js # Analisis individual de documentos con AI
│   ├── get-claims.js       # Listado de reclamos desde Supabase
│   ├── generate-reply.js   # Generacion de respuestas con AI (backoffice)
│   ├── update-ticket.js    # Actualizacion de estado y novedades
│   └── login.js            # Autenticacion de usuarios
└── README.md
```

### Frontend
- HTML5, CSS3 con diseno responsivo
- Formulario wizard de 3 pasos con validacion en tiempo real
- Carga multi-archivo con preview y autocompletado por IA
- Tipografias: Plus Jakarta Sans (titulos), Inter (cuerpo), JetBrains Mono (datos tecnicos)

### Backend
- Vercel Serverless Functions (Node.js, ESM)
- 6 endpoints API independientes en `/api/`
- Sin dependencias npm — usa `fetch` nativo para Supabase REST API y OpenRouter

### Procesamiento de IA
- Modelo: `google/gemini-2.5-flash` via OpenRouter
- Extraccion unificada multi-archivo (imagenes + PDFs)
- Sanitizacion anti-null en 3 capas (prompt, backend, frontend)
- Calculo automatico de porcentaje de exito basado en:
  - **Argentina (ANAC / Decreto 1476/98)**: Umbral de 4 horas, causa climatica = 0%
  - **Europa (EU261)**: Demoras +3hs, multas automaticas 90-100%
  - **EEUU (DOT)**: Sin compensacion obligatoria por demora simple
  - Ponderacion por comportamiento historico de la aerolinea

### Base de Datos
- Supabase (PostgreSQL)
- Tabla principal: `reclamos`
- Datos extendidos almacenados en columna JSONB `ai_raw`
- REST API directa (sin SDK)

## Configuracion del Entorno

Variables requeridas en Vercel Dashboard > Settings > Environment Variables:

| Variable | Descripcion |
|---|---|
| `OPENROUTER_API_KEY` | API key de OpenRouter para acceder a modelos de IA (Gemini 2.5 Flash) |
| `SUPABASE_URL` | URL del proyecto Supabase (ej: `https://xxxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase con permisos de escritura |
| `RESEND_API_KEY` | API key de Resend para envio de emails transaccionales |
| `NOTIFY_EMAIL` | Casilla interna donde llegan alertas de nuevos reclamos |

## Schema de Base de Datos

```sql
CREATE TABLE IF NOT EXISTS reclamos (
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

ALTER TABLE reclamos DISABLE ROW LEVEL SECURITY;
```

Campos extendidos almacenados en `ai_raw` (JSONB):
- `doc_tipo`, `doc_numero`, `origen`, `destino`, `pnr`
- `incidencia`, `delay_hours`, `causa`, `reembolso`
- `moneda`, `gastos_monto`, `gastos_detalle`
- `porcentaje_exito` (0-100, oculto del usuario)

## Guia de Despliegue

### Desarrollo local
```bash
# Servir archivos estaticos
python3 -m http.server 8000
# Abrir http://localhost:8000

# Las funciones de /api/ solo funcionan en Vercel
# Para probar el backend usar npx vercel dev
npx vercel dev
```

### Rutas limpias (Clean URLs)

El proyecto usa `cleanUrls: true` en `vercel.json`, lo que elimina la extension `.html` de todas las rutas. El acceso a los modulos se realiza sin extension:

- `/backoffice` en lugar de `/backoffice.html`
- `/perfil` en lugar de `/perfil.html`

Todos los enlaces internos y redirecciones del frontend ya apuntan a las rutas limpias.

### Produccion
```bash
# Login (una sola vez)
npx vercel login

# Linkear al proyecto (una sola vez)
npx vercel link --scope solucionair --yes

# Deploy a produccion
npx vercel --prod --yes

# Ver logs
npx vercel logs --since 1h --expand

# Ver variables de entorno
npx vercel env ls
```

### URLs de produccion
| Pagina | URL |
|---|---|
| Landing | https://solucionair-web-seven.vercel.app |
| Backoffice | https://solucionair-web-seven.vercel.app/backoffice |
| Panel cliente | https://solucionair-web-seven.vercel.app/perfil |

## Flujo del Sistema

```
Usuario sube documentos (multi-archivo)
    │
    ▼
Frontend convierte a Base64 → POST /api/process-ticket
    │
    ▼
Backend envia imagenes a Gemini 2.5 Flash (OpenRouter)
    │
    ▼
IA extrae: nombre, vuelo, PNR, origen, destino, fecha
    │
    ▼
Frontend autocompleta formulario (Paso 1 y 2)
    │
    ▼
Usuario completa datos faltantes + firma (Paso 3)
    │
    ▼
POST /api/process-ticket (manualSubmit)
    │
    ├── Calcula % exito con IA (oculto)
    ├── INSERT en Supabase
    ├── Email interno via Resend
    └── Email confirmacion al cliente
    │
    ▼
Tarjeta de exito con codigo CSA correlativo
```

## Endpoints API

| Metodo | Ruta | Descripcion |
|---|---|---|
| POST | `/api/process-ticket` | Scan IA multi-archivo + submit final de reclamo |
| POST | `/api/analyze-document` | Analisis individual de documento |
| GET | `/api/get-claims` | Lista todos los reclamos (backoffice) |
| POST | `/api/generate-reply` | Genera respuesta con IA / optimiza borrador |
| POST | `/api/update-ticket` | Actualiza estado o agrega novedades |
| POST | `/api/login` | Autenticacion de usuarios |

## Licencia

Proyecto privado. Todos los derechos reservados. SolucionAir 2026.
