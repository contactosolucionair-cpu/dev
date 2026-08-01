# Prompt Claude Code — Fix: ciudades con múltiples aeropuertos en extracción de ruta

> Guardar como `docs/prompt-claude-code-ruta-metro.md` y pegar el contenido desde "INSTRUCCIONES" en Claude Code.
> Ciclo independiente y autocontenido. NO forma parte de "ivB - FINAL" y no colisiona con él: puede correrse antes o después.

---

## INSTRUCCIONES

Sos el ejecutor de un fix quirúrgico en el repo de SolucionAir (HTML estático + JS vanilla ES5, funciones serverless en `/api`, sin build step). Trabajás por fases. **Regla global: si en cualquier fase encontrás una discrepancia entre lo que este prompt asume y lo que existe en el código, DETENETE, reportá la discrepancia con archivo y línea, y esperá instrucciones. NO improvises soluciones alternativas.**

### Contexto del bug

El escáner de IA (`api/process-ticket.js`) extrae `origen`, `destino` y `escalas` de los documentos de viaje. Ante una reserva ida y vuelta donde la vuelta usa **otro aeropuerto de la misma ciudad** (ej.: ida USH→EZE, vuelta AEP→USH), la IA no detecta el punto de retorno y colapsa todo en un solo viaje: `origen = USH`, `destino = USH`, `escalas = EZE, AEP`. Las reservas ida y vuelta simétricas (mismo aeropuerto en ambas direcciones) funcionan bien y NO deben modificarse en su comportamiento.

El fix tiene dos capas: (1) reglas nuevas en el prompt de extracción para que la IA razone en **ciudades**, no solo aeropuertos; (2) una guarda determinística en backend que corrige el colapso aunque la IA falle. La guarda se factoriza en un helper compartido porque hay DOS endpoints de extracción (`process-ticket.js` y `analyze-document.js`) y el segundo hoy no tiene ninguna sanitización de ruta.

### Alcance estricto

- Archivos a crear: `api/_utils/itinerario.js`.
- Archivos a editar: `api/process-ticket.js`, `api/analyze-document.js`.
- **Nada más.** No tocar `estado`/`instancia` ni ningún archivo del ciclo "ivB - FINAL". Sin refactors oportunistas, sin renombres, sin cambios de formato en código no relacionado.

### Supuestos a verificar en Fase 0 (si alguno falla → HALT y reportar)

- S1. Los módulos de `/api` usan sintaxis ESM (`export` / `export default`), como `api/_utils/instancias.js`.
- S2. En `api/process-ticket.js` existe una guarda que limpia `destino` cuando coincide con `origen` comparando `substring(0, 3)` en mayúsculas.
- S3. `escalas` viaja como string plano (posiblemente con varios aeropuertos separados por comas), no como array.
- S4. El prompt de extracción de `process-ticket.js` contiene el bloque "REGLAS DE ITINERARIO MULTI-TRAMO" construido por concatenación de strings con `\n`.
- S5. `api/analyze-document.js` devuelve `origen`/`destino` sin ninguna guarda de ruta.

---

## FASE 0 — Inventario (obligatoria, sin ediciones)

Ejecutar y reportar resultados ANTES de editar:

```bash
grep -rn "escalas" api/ src/js/ | grep -v node_modules
grep -n "substring(0, 3)" api/process-ticket.js
grep -n "REGLAS DE ITINERARIO" api/process-ticket.js
grep -n "origen" api/analyze-document.js
ls api/_utils/
head -5 api/_utils/instancias.js   # confirmar estilo de módulo (ESM)
grep -rn "analyze-document" src/js/ index.html
```

Con el output, confirmá explícitamente S1–S5 uno por uno. Reportá además todo consumidor de `escalas` fuera de los dos endpoints (frontend, backoffice) para verificar que el contrato (string plano) no cambia. Si todo cierra, continuá. Si algo no cierra, HALT.

---

## FASE 1 — Crear `api/_utils/itinerario.js`

Crear el archivo con exactamente este contenido (ajustar solo la sintaxis de export si la Fase 0 reveló otro estilo de módulo — en ese caso, HALT primero y reportar):

```javascript
/**
 * Sanitización determinística de ruta (origen / destino / escalas) para la
 * salida del extractor de IA. Problema que resuelve: en reservas ida y vuelta
 * donde la vuelta usa OTRO aeropuerto de la misma ciudad (ej. ida USH→EZE,
 * vuelta AEP→USH), la IA colapsa todo en un viaje con escalas y devuelve
 * origen == destino. Acá se razona por CIUDAD (área metropolitana), se
 * limpian escalas espurias y se recupera el destino real de la ida.
 * Compartido por api/process-ticket.js y api/analyze-document.js.
 */

/* Áreas metropolitanas con múltiples aeropuertos comerciales relevantes. */
export var METRO = {
  EZE: 'BUE', AEP: 'BUE',
  GRU: 'SAO', CGH: 'SAO', VCP: 'SAO',
  GIG: 'RIO', SDU: 'RIO',
  JFK: 'NYC', LGA: 'NYC', EWR: 'NYC',
  LHR: 'LON', LGW: 'LON', STN: 'LON', LTN: 'LON', LCY: 'LON',
  CDG: 'PAR', ORY: 'PAR',
  FCO: 'ROM', CIA: 'ROM',
  MXP: 'MIL', LIN: 'MIL', BGY: 'MIL',
  NRT: 'TYO', HND: 'TYO',
  ICN: 'SEL', GMP: 'SEL',
  KIX: 'OSA', ITM: 'OSA',
  ORD: 'CHI', MDW: 'CHI',
  IAD: 'WAS', DCA: 'WAS', BWI: 'WAS',
  SVO: 'MOW', DME: 'MOW', VKO: 'MOW',
  IST: 'IST', SAW: 'IST'
};

/* Primer código IATA presente en un texto tipo "EZE - Buenos Aires". */
export function iataOf(txt) {
  var m = String(txt || '').toUpperCase().match(/\b[A-Z]{3}\b/);
  return m ? m[0] : null;
}

/* Ciudad metropolitana de un texto de aeropuerto; la IATA misma si no
   pertenece a un área metro conocida; null si no hay IATA legible. */
export function metroOf(txt) {
  var code = iataOf(txt);
  if (!code) return null;
  return METRO[code] || code;
}

function splitEscalas(s) {
  return String(s || '').split(',')
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return !!x; });
}

/**
 * Sanitiza la ruta extraída por IA. Recibe strings crudos, devuelve
 * { origen, destino, escalas } con el mismo contrato (escalas = string
 * separado por comas, posiblemente vacío).
 *
 * Regla 1: una "escala" en la misma ciudad que el origen o el destino es
 *          siempre un artefacto de parseo → se elimina.
 * Regla 2: origen y destino en la misma ciudad = ida y vuelta colapsada.
 *          Recuperación: la primera escala que NO sea de la ciudad de
 *          origen es, con altísima probabilidad, el destino real de la
 *          ida (caso USH→USH, escalas [EZE, AEP] → destino EZE). Si no
 *          hay de dónde recuperar, destino queda vacío para que el
 *          usuario lo complete (el frontend ya muestra "Confirmá el
 *          aeropuerto" ante campo sin resolver).
 * Fallback: si origen o destino no traen IATA legible, la detección de
 *          "misma ciudad" cae a la comparación legacy de los primeros
 *          3 caracteres en mayúsculas.
 */
export function sanitizeRuta(origen, destino, escalas) {
  var o = String(origen || '').trim();
  var d = String(destino || '').trim();
  var list = splitEscalas(escalas);
  var mo = metroOf(o);
  var md = metroOf(d);

  /* Regla 1 */
  list = list.filter(function (e) {
    var me = metroOf(e);
    if (!me) return true;
    return me !== mo && me !== md;
  });

  /* Regla 2 */
  var mismaCiudad = (mo && md)
    ? (mo === md)
    : (!!o && !!d && o.substring(0, 3).toUpperCase() === d.substring(0, 3).toUpperCase());

  if (o && d && mismaCiudad) {
    var recovered = null;
    for (var i = 0; i < list.length; i++) {
      var me2 = metroOf(list[i]);
      if (me2 && me2 !== mo) { recovered = list[i]; list.splice(i, 1); break; }
    }
    if (recovered) {
      d = recovered;
      md = metroOf(d);
      /* re-filtrar contra el nuevo destino (ej. sacar AEP si destino pasó a EZE) */
      list = list.filter(function (e) {
        var me3 = metroOf(e);
        return !me3 || (me3 !== mo && me3 !== md);
      });
    } else {
      d = '';
    }
  }

  return { origen: o, destino: d, escalas: list.join(', ') };
}
```

**Criterio de aceptación F1:** el archivo existe, exporta `METRO`, `iataOf`, `metroOf`, `sanitizeRuta`, y `node --input-type=module -e "import('./api/_utils/itinerario.js').then(m => console.log(typeof m.sanitizeRuta))"` (o equivalente según cómo resuelva imports el entorno) no arroja error de sintaxis.

---

## FASE 2 — `api/process-ticket.js`

### 2a. Reglas nuevas en el prompt de extracción

Dentro del bloque "REGLAS DE ITINERARIO MULTI-TRAMO", **inmediatamente después** de la línea de `escalas` ("escalas: Aeropuertos intermedios. Ej: \"ATL - Atlanta\"."), insertar estas tres reglas, respetando el estilo de concatenación existente (`+ '...\n'`) y **sin tildes ni caracteres especiales**, igual que el resto del prompt:

```
- CIUDADES CON VARIOS AEROPUERTOS: una misma ciudad puede tener varios aeropuertos (Buenos Aires = EZE y AEP; San Pablo = GRU y CGH; Rio de Janeiro = GIG y SDU; Nueva York = JFK, LGA y EWR; Londres = LHR, LGW, STN y LTN; Paris = CDG y ORY; Tokio = NRT y HND). Si un tramo LLEGA a un aeropuerto y el tramo siguiente SALE de otro aeropuerto de la MISMA CIUDAD, eso NO es una escala: es el punto de retorno donde termina la ida y comienza la vuelta. Ejemplo: itinerario USH→EZE y luego AEP→USH es IDA (USH→EZE) y VUELTA (AEP→USH); origen = "USH - Ushuaia", destino = "EZE - Buenos Aires", escalas = "".
- CORTE TEMPORAL: si entre la llegada de un tramo y la salida del siguiente pasan mas de 24 horas, ese punto marca el fin de la ida y el comienzo de la vuelta u otro viaje. NUNCA lo trates como escala.
- escalas NUNCA puede incluir un aeropuerto de la misma ciudad que origen o que destino.
```

No modificar ninguna otra línea del prompt.

### 2b. Reemplazar la guarda legacy por el helper

1. Importar el helper al inicio del archivo, junto a los imports existentes: `import { sanitizeRuta } from './_utils/itinerario.js';` (ajustar ruta/extensión al patrón con que el archivo ya importa `_utils`, p. ej. cómo se importa `instancias.js` en otros endpoints — verificado en Fase 0).
2. Localizar la guarda actual (la comparación `substring(0, 3)` entre `rawOrigen` y `rawDestino` que vacía `rawDestino`) y **reemplazarla** por:

```javascript
var ruta = sanitizeRuta(clean(parsed.origen), clean(parsed.destino), clean(parsed.escalas));
```

3. En el objeto `data` de respuesta, usar `ruta.origen`, `ruta.destino`, `ruta.escalas` en lugar de `rawOrigen`, `rawDestino`, `clean(parsed.escalas)`. Eliminar las variables `rawOrigen`/`rawDestino` si quedan sin uso. No tocar ningún otro campo de `data`.

**Criterios de aceptación F2:**
- El prompt contiene las tres reglas nuevas, en el lugar indicado, sin tildes.
- `grep -n "substring(0, 3)" api/process-ticket.js` no devuelve resultados (la comparación legacy vive ahora solo como fallback dentro del helper).
- El contrato de respuesta del endpoint no cambió: mismos campos, mismos tipos (strings).
- Ningún otro flujo del archivo (alta manual, emails, flags) fue modificado.

---

## FASE 3 — `api/analyze-document.js`

1. Importar `sanitizeRuta` igual que en F2.
2. Antes del `return res.status(200)` final, aplicar:

```javascript
var ruta = sanitizeRuta(parsed.origen, parsed.destino, '');
```

y en el objeto `data` de la respuesta devolver `origen: ruta.origen || null` y `destino: ruta.destino || null` en lugar de los valores crudos. Los demás campos quedan igual (este endpoint no maneja `escalas`; no agregarlas al contrato).

3. En el prompt de este endpoint, agregar al final de la instrucción de extracción (antes de "Responde SOLO el JSON"), en el mismo estilo sin tildes:

```
Si el documento contiene una reserva ida y vuelta, origen y destino corresponden SOLO a la ida. Una ciudad puede tener varios aeropuertos (Buenos Aires = EZE y AEP): si la vuelta sale de otro aeropuerto de la misma ciudad de llegada, NO es una escala, es el retorno. origen y destino NUNCA pueden ser el mismo aeropuerto ni la misma ciudad.
```

**Criterios de aceptación F3:** contrato de respuesta sin campos nuevos; `origen`/`destino` pasan por `sanitizeRuta`; prompt actualizado.

> Nota consciente de deuda: esto duplica reglas de prompt entre dos endpoints. La unificación de ambos extractores queda explícitamente FUERA de este ciclo. Dejar un comentario `/* TODO: unificar con process-ticket (ver docs/prompt-claude-code-ruta-metro.md) */` junto al import en `analyze-document.js`.

---

## FASE 4 — Verificación

### 4a. Tests del helper (ejecutar con node, sin dejar archivos residuales)

Ejecutar los cinco casos y verificar salida exacta:

| # | Input (origen / destino / escalas) | Salida esperada |
|---|---|---|
| 1 | `"USH - Ushuaia"` / `"USH - Ushuaia"` / `"EZE - Buenos Aires, AEP - Buenos Aires"` | origen `USH - Ushuaia`, destino `EZE - Buenos Aires`, escalas `""` |
| 2 | `"EZE - Buenos Aires"` / `"AEP - Buenos Aires"` / `""` | destino `""` (misma ciudad, sin recuperación posible) |
| 3 | `"EZE - Buenos Aires"` / `"TUL - Tulsa"` / `"ATL - Atlanta"` | sin cambios (viaje con escala legítima) |
| 4 | `"Ushuaia"` / `"Ushuaia"` / `""` | destino `""` (fallback substring sin IATA) |
| 5 | `"USH - Ushuaia"` / `"EZE - Buenos Aires"` / `"AEP - Buenos Aires"` | escalas `""` (escala espuria en la ciudad del destino) |

Si algún caso no da la salida esperada, HALT y reportar (no "ajustar" el helper por tu cuenta).

### 4b. Alcance del diff

`git status` / `git diff --stat` debe mostrar exactamente: `api/_utils/itinerario.js` (nuevo), `api/process-ticket.js`, `api/analyze-document.js`. Cualquier otro archivo modificado = HALT.

### 4c. Reporte final

Resumir: reglas agregadas a cada prompt (citar líneas), ubicación del reemplazo de la guarda, resultado de los 5 tests, y confirmación de diff acotado. Sugerir mensaje de commit: `fix(intake): rutas con ciudades multi-aeropuerto — reglas de prompt + guarda determinística compartida (sanitizeRuta)`.

### 4d. Prueba de aceptación manual (la hace Juan en preview, no vos)

Subir al preview de Vercel el pasaje real USH→EZE / AEP→USH. Esperado: Origen `Ushuaia (USH)`, Destino `Buenos Aires (EZE)`, sin escalas. Verificar también una reserva ida y vuelta simétrica (mismo aeropuerto) para confirmar que no hubo regresión.

---

> **Nota posterior:** el extractor `api/analyze-document.js` al que esta tarea
> aplicó `sanitizeRuta` resultó ser código muerto (sin llamadores) y fue
> eliminado en el ciclo `limpieza-analyze-document`. El fix sigue vigente en
> `api/process-ticket.js`, que es el único camino vivo.
