# SolucionAir — instrucciones de proyecto

Plataforma de gestión de reclamos aéreos. Cuatro canales de entrada de casos
(B2C público, backoffice manual, portal de agencias, portal de abogados) sobre
una única tabla `reclamos`.

## Stack y restricciones del entorno

- HTML estático + **JavaScript vanilla ES5** en el navegador. Sin framework,
  sin bundler, **sin build step**. Sí hay suite de tests: `npm test` (7 suites,
  tres de ellas con jsdom sobre los formularios).
- Funciones serverless en `/api` (Vercel). Base de datos: Supabase, accedida por
  **fetch a la REST API**, sin cliente oficial.
- El código del navegador es ES5 estricto: `var`, `function`, concatenación de
  strings. Nada de `let`/`const`, arrow functions, template literals ni
  optional chaining en los `.html` ni en `src/js/app.js`.
- `/api` usa sintaxis ESM (`import`/`export`) pero **Vercel lo compila a
  CommonJS** (`package.json` no declara `"type": "module"`). Por lo tanto:
  **prohibido `import.meta`** y cualquier otra construcción que solo exista en
  ESM en runtime. Ya rompió el motor legal una vez, solo en producción.
- Deploy: `npx vercel --prod --yes`. Logs: `npx vercel logs --since 1h --expand`.

## Mapa del repo

| Archivo | Rol |
|---|---|
| `index.html` + `src/js/app.js` | Landing + login de Google + i18n; monta el wizard tras verificar identidad |
| `src/js/intake-wizard.js` | **Componente de alta de casos**: el popup de micro-pasos que usan las tres superficies |
| `backoffice.html` | Panel admin: casos, papelera, alertas, agencias, abogados, config |
| `perfil.html` | Panel del cliente (uso real bajo; el seguimiento va por WhatsApp) |
| `agencias.html` / `panel-agencia.html` | Portal B2B de agencias |
| `abogados.html` / `panel-abogado.html` | Portal de abogados (mediación) |
| `api/_utils/instancias.js` | **Fuente de verdad del ciclo de vida del caso** |
| `api/_utils/legal-docs.js` | Generación de poder / patrocinio / T&C |
| `api/_utils/{agency,abogado,cliente}-auth.js` | Validación de JWT por rol |
| `api/{admin,agency,abogados}.js` | Handlers consolidados por `?action=` |
| `vercel.json` | `cleanUrls` + rewrites `/api/{agency,abogados,admin}/:action` |
| `docs/` | Inventarios de fase y prompts de ciclo |

## Alta de casos — un solo componente, tres montajes

La carga de caso vive en **un componente compartido**: `src/js/intake-wizard.js`,
un popup de micro-pasos que las tres superficies montan con configuración
distinta (B2C desde `src/js/app.js`, backoffice y panel de agencias desde sus
scripts inline). **Los formularios largos que había antes fueron eliminados**
—ciclo `limpieza-formularios-viejos`, agosto 2026— y con ellos las tres copias
divergentes de la lógica de carga y de consumo del escáner.

El comportamiento del formulario, el árbol de preguntas y el mapeo de campos se
tocan **en el componente, una sola vez**. No hay que replicar nada.

Lo que **sí** sigue existiendo por triplicado son los cuatro callbacks con que
cada superficie se engancha: `alEscanear`, `alElegirArchivo`, `alEnviar` y
`alMontarCampoAeropuerto`. Son transporte —autenticación propia, endpoint propio,
traducción del payload al contrato de su API— y ahí la regla de paridad sigue
vigente: si cambia el contrato de respuesta del extractor o el del alta, hay que
revisar los tres. Ya falló una vez: los tres `alEscanear` truncaban `segmentos`
antes de entregárselo al componente y el caso llegaba al motor sin itinerario,
sin que se rompiera nada a la vista.

El único camino vivo de extracción por IA es `api/process-ticket.js` (escaneo
multi-archivo, prompt con reglas de itinerario multi-tramo, escalas y
sanitización de ruta). Los fixes de prompt van ahí.

## Modelo de estados — invariantes duros

El ciclo de vida se modela con **`instancia` + `momento` + `resultado` + esperas**
(`api/_utils/instancias.js`). Es la única fuente de verdad.

- `estado` es un **espejo derivado**. Se escribe **solo** vía
  `instanciaAEstadoLegacy()`, en el mismo PATCH que escribe `instancia`.
- **Nunca** leer `estado` para decidir lógica ni filtrar consultas por él.
  `getInstancia()` es la red de seguridad para filas viejas con `instancia` null.
- Los portales externos (agencia, cliente) consumen **solo** `etapaExterna()`
  (vista de 5+3 etapas), nunca instancia/momento crudos.
- Toda transición pasa por `validarTransicion()` contra la tabla `TRANSICIONES`.
  No inventar transiciones ad-hoc en los handlers.
- Todo cierre escribe `resultado` y, cuando corresponde, `motivo_cierre`.
- Excepciones legítimas al grep de `estado`: `agencias.estado` / `abogados.estado`
  (estado de **cuenta**, otra tabla) y la red de seguridad de `getInstancia()`.

**Columnas deprecadas — no resucitar:** `monto_compensacion` (usar
`monto_reclamado` / `monto_acordado`), `firma_proveedor`, `firma_zoho_request_id`,
`firma_zoho_url`, `requerimiento_tipo/fecha/detalle` (reemplazadas por esperas).

## Seguridad

- `admin`, `get-claims`, `update-ticket`, `delete-ticket` → header
  `X-Admin-Password`. Si `ADMIN_PASSWORD` no está seteada, responden 500; **nunca
  quedan abiertos**.
- Portales externos (cliente, agencia, abogado) → JWT de Supabase Auth
  (`Authorization: Bearer`). El email/identidad **siempre** sale del token
  validado, nunca de query params ni del body.
- **Todo endpoint nuevo nace autenticado.** Y su `Access-Control-Allow-Headers`
  tiene que incluir el header de auth que el front va a mandar: olvidarlo produce
  un fallo silencioso solo en el browser.
- Los selects que alimentan portales externos son explícitos y excluyen `ai_raw`,
  IPs y datos de otros casos.
- Al renderizar datos de usuario en los HTML, pasar siempre por `esc()`.

## Documentos legales

`api/_utils/legal-docs.js` y sus plantillas (`poder`, `patrocinio_es`, `tyc`)
se alimentan **exclusivamente de campos estructurados**. Nunca inyectar texto
libre del usuario (`comentario_caso`, novedades, detalle de gastos) en una
plantilla contractual. Esto es un criterio de aceptación negativo permanente.

## Cómo se trabaja en este repo

- Los cambios se ejecutan por **ciclos en fases** definidos en `docs/prompt-*.md`.
- **Fase 0 siempre es un inventario por grep**, sin editar código.
- **El censo es bidireccional.** Encontrar quién llama a algo no alcanza: hay que
  verificar que lo llamado exista y esté cableado. Un `getElementById` de un id
  que ya no está en el HTML es una llamada que nunca ejecuta, y da la falsa
  impresión de una funcionalidad viva. Confirmar en las dos direcciones antes de
  concluir.
- **Ante cualquier discrepancia entre lo que el prompt asume y lo que existe en
  el código: HALT.** Reportar archivo:línea y esperar instrucciones. No
  improvisar una solución alternativa ni "arreglarlo de paso".
- Un commit por fase, con el criterio de aceptación de esa fase verificado.
- Antes de dar por cerrado un ciclo: `npm test` en verde, más chequeo de sintaxis
  de todos los `api/**/*.js` y de los scripts inline de los siete HTML. Las
  suites no cubren la ida y vuelta real contra los endpoints ni el
  comportamiento en el browser: lo que dependa de eso se reporta como
  **pendiente de prueba manual**, nunca como verificado.
