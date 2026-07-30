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
│   ├── admin.js            # Admin: agencias/abogados, comisiones, storage, docs legales, motor legal
│   ├── _data/              # Datos auxiliares del motor legal
│   │   ├── paises-ue.js        # Sets UE / EEE+CH / Montreal en ISO-2 + territorios sin clasificar
│   │   └── aerolineas.json     # {nombre, iata, pais_licencia, comunitario}
│   └── _utils/
│       ├── instancias.js       # Modelo instancia/momento/resultado + transiciones + etapaExterna
│       ├── cliente-auth.js     # Valida el JWT del cliente (my-claims / my-actions)
│       ├── agency-auth.js      # Valida el JWT de la agencia
│       ├── abogado-auth.js     # Valida el JWT del abogado
│       ├── notify-agencia.js   # Mail a la agencia al cambiar la etapa de su caso
│       ├── motor-normalizar.js # Fila de reclamos → objeto `caso` (función pura)
│       ├── motor-legal.js      # Evaluador determinista `analizar(caso, ruleset, hoy)`
│       ├── motor-datos.js      # Carga con caché de airports.json + aerolineas.json
│       └── rulesets/
│           └── 2026-06-19.js   # Reglas legales como datos. Un archivo por vigencia
├── scripts/                # One-off / mantenimiento (Node, sin dependencias)
├── tests/                  # Suite del motor legal (sin framework)
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

**Columnas del motor legal Capa 1** (`supabase/migration_015_motor_capa1.sql`). Son la
**capa canónica** que lee el motor: un solo valor por campo, y lo que está en `null` se
lee como falta de dato, nunca se presume.

| Columna | Tipo | Para qué |
|---|---|---|
| `origen_iata` · `destino_iata` | TEXT(3) | Ruta canónica. `origen`/`destino` quedan como texto de display |
| `segmentos` | JSONB | `[{orden, origen_iata, destino_iata, carrier_operante, fecha}]`. Si está cargado, define el itinerario y gana sobre las dos columnas de arriba |
| `billete_unico` | BOOLEAN | Evaluar el itinerario como un todo vs. por tramos (Test A) |
| `incidentes` | JSONB | **Conjunto**: `demora`, `cancelacion`, `denegacion_embarque`, `downgrade`, `conexion_perdida`, `equipaje_{demora,dano,perdida}`, `muerte_lesion` |
| `demora_salida_min` · `demora_llegada_min` | INTEGER | En minutos. La llegada se mide como apertura de puertas |
| `antelacion_aviso_dias` | NUMERIC | Antelación del aviso de cancelación (fraccionable) |
| `reencaminamiento` | JSONB | `{ofrecido, delta_salida_min, delta_llegada_min, aceptado}`. Deltas contra el horario programado; negativos = antes |
| `atencion_ofrecida` | JSONB | `{ofrecida, items:[refrigerio\|comida\|alojamiento\|transporte\|comunicaciones]}` |
| `fecha_incidente` | DATE | En equipaje es la fecha de entrega o la que debió entregarse, **no** la del vuelo |
| `causa_alegada` | TEXT | Insumo del nodo de circunstancias extraordinarias |
| `protesta` | JSONB | `{realizada:'si'\|'no'\|'desconocido', fecha, medio:'pir'\|'escrita', numero}` |
| `checkin_presentacion` | TEXT | `en_hora` \| `tarde` \| `no_presentado` \| `no_aplica` \| `desconocido` |
| `comentarios_pasajero` | TEXT | Texto libre del pasajero |
| `gastos_items` | JSONB | **Canónico** itemizado: `[{concepto, monto, moneda, fecha, archivo, fuente}]` |
| `datos_extraidos` | JSONB | **Capa de evidencia**: candidatos con procedencia, sin pisar el canónico |
| `campos_meta` | JSONB | `{campo: {verificado, fuente, conflicto}}` |
| `analisis_legal` | JSONB | Salida del motor: `{actual, historial}` (historial capado a 10) |

> **`monto_gastos` / `moneda_gastos` son un ESPEJO DERIVADO — no editar directo.** El
> canónico es `gastos_items`. Todo PATCH que toca `gastos_items` reescribe esas dos con la
> suma de la moneda dominante, en el mismo PATCH (mismo patrón que `estado` ← `instancia`).
> Se conservan porque el backoffice, el panel de agencias y el perfil del cliente las leen
> sin cambios. Ver la acción `set-datos-legales` en `api/update-ticket.js`.

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
| POST | `/api/admin?action=create-case\|generar-documento` | `X-Admin-Password` | Alta manual de caso, generar poder/patrocinio/T&C |
| POST | `/api/admin?action=sign\|upload\|remove\|retag\|download-zip` | `X-Admin-Password` | Gestión de adjuntos en Storage |
| POST | `/api/admin?action=analizar-caso` | `X-Admin-Password` | Corre el motor legal sobre `{id}` y guarda `analisis_legal`. **No escribe ninguna otra columna.** Datos incompletos no son error: responde 200 con FALTA_DATO |

`POST /api/update-ticket` con `action=set-datos-legales` escribe los campos del contrato de
entrada del motor (y solo esos). Un campo que no venga en el body no se toca.

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

## Firma de autorización y de los T&C

El flujo de firma es **manual**: el admin genera el documento (poder / convenio
de patrocinio / T&C) desde el backoffice, lo envía al pasajero por WhatsApp o
email, y una vez firmado actualiza el estado desde el backoffice (`no_aplica` →
`pendiente_envio` → `enviada` → `firmada` / `rechazada`). Los portales de agencia
y cliente muestran ese estado con un texto explicativo.

Son **dos columnas con el mismo circuito**: `firma_estado` (autorización/poder) y
`tyc_estado` (Términos y Condiciones). Los dos arrancan en `pendiente_envio` para
todo caso nuevo; sólo los casos que entran por el formulario público nacen con
`tyc_estado='firmada'`, porque ahí el pasajero acepta los T&C en el acto y se
genera el PDF de constancia. Si un caso no necesita alguno de los dos documentos,
se marca `no_aplica` a mano. Mientras estén en `pendiente_envio` saltan las
alertas «Autorización pendiente de envío» y «T&C pendientes de envío».

La **integración con un proveedor de firma electrónica está pendiente de
contratación**. Las columnas `firma_proveedor`, `firma_zoho_request_id` y
`firma_zoho_url` quedaron en la base de una iteración anterior pero **ningún
código las escribe**.

## Motor legal determinista (Capa 1)

Resuelve **por regla** qué marcos aplican a un caso y qué categorías son reclamables en
cada uno. Los marcos **no son excluyentes**: un vuelo puede activar EU261 + Montreal +
Res. 1532 a la vez y el motor devuelve **todos**, sin elegir ganador.

Fuente de verdad legal: `docs/Capa_1_-_Logica_legal_determinista_v2.1.md`.
Contratos de entrada/salida: `docs/motor-capa1-contratos.md`.
**Lo que no está decidido: `docs/motor-capa1-pendientes-legales.md`.**

| Pieza | Archivo | Rol |
|---|---|---|
| Normalizador | `api/_utils/motor-normalizar.js` | Fila → objeto `caso`. Deriva países, ámbito EU261, intl/doméstico, distancia ortodrómica, banda del Art. 7(1) y condición de comunitario. Clasifica los campos críticos en ausente / en conflicto / sin verificar |
| Evaluador | `api/_utils/motor-legal.js` | `analizar(caso, ruleset, hoy)`. **Genérico y estable: no contiene ningún número legal.** Solo recorre la estructura del ruleset |
| Ruleset | `api/_utils/rulesets/2026-06-19.js` | Reglas como datos: Tests A–E, árboles EU261 y AR, gates, prescripción. **Todos los umbrales viven acá**, con el `base_legal` literal del v2.1 |
| Datos auxiliares | `api/_data/`, `src/data/airports.json` | Países en ISO-2, aerolíneas, y coordenadas + `pais_iso` por aeropuerto |

**Dos principios que conviene no romper:**

1. **Los umbrales legales viven solo en el ruleset.** Agregar la vigencia de la reforma
   EU261 (~2027) debería ser un archivo nuevo en `rulesets/`, sin tocar el evaluador. Hay un
   test que falla si un número legal se filtra a `motor-legal.js`.
2. **El motor nunca presume.** Un dato ausente, sin verificar o en conflicto entre fuentes
   sale como `FALTA_DATO`; lo difuso sale como `REQUIERE_EVALUACION` con su nodo. No
   resuelve nodos de evaluación, no elige marco ganador y no emite fecha de prescripción
   cuando el plazo depende de un foro no decidido.

En el backoffice, todo esto vive en dos secciones del drawer del caso: **Datos legales del
caso** (editor de la entrada) y **Análisis legal** (botón Analizar + render de la salida).

### Tests

```bash
node tests/motor.test.js              # todo
node tests/motor.test.js CD-05        # filtra casos dorados por id o descripción
node tests/motor.test.js --verbose    # imprime el análisis completo de cada caso
```

Sin framework ni dependencias. Exit distinto de 0 si algo falla. Dos grupos:

- **Unitarios** — hechos mecánicos (haversine, bandas, propagación del conflicto,
  determinismo, que no lance nunca, `base_legal` en toda categoría).
- **Casos dorados** (`tests/casos-dorados.js`) — la salida esperada es **criterio legal y la
  escribe JPA**. Se comparan solo las claves declaradas en `esperado`. Un caso con
  `esperado: {}` se **saltea con aviso** (`TODO-JPA`) y no rompe el suite: es cobertura
  reservada esperando criterio.

### Scripts

Todos aceptan `--dry-run` y leen `SB_URL`/`SB_KEY` (o `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).

```bash
node scripts/backfill-iata.mjs --dry-run       # origen_iata/destino_iata del histórico
node scripts/backfill-candidatos.mjs --dry-run # datos declarativos → datos_extraidos
node scripts/enrich-airports.mjs --dry-run     # lat/lon + pais_iso desde OurAirports
```

`backfill-iata` porta el `resolve()` de `src/js/airport-select.js` y solo escribe cuando el
match es inequívoco; lo ambiguo queda en `null` y se lista al final con ref, id y texto
original. `backfill-candidatos` **no** escribe columnas canónicas: deja los datos
declarativos como candidatos con procedencia, porque un campo crítico no se auto-verifica
desde una sola fuente declarativa.

## URLs de Producción

| Recurso | URL |
|---|---|
| Landing | https://solucionair-web-seven.vercel.app |
| Backoffice | https://solucionair-web-seven.vercel.app/backoffice |
| Panel Cliente | https://solucionair-web-seven.vercel.app/perfil |

## Licencia

Proyecto privado. Todos los derechos reservados. SolucionAir 2026.
