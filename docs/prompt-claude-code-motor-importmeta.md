# Prompt Claude Code — Motor legal caído en Vercel: eliminar `import.meta`

> Guardar como `docs/prompt-claude-code-motor-importmeta.md` (commit de docs separado).
> Síntoma: en staging, "Analizar caso" en el backoffice responde: "El motor legal no está disponible: Cannot use 'import.meta' outside a module". En local `npm test` está verde (motor 21/21).

---

## INSTRUCCIONES

Repo SolucionAir. **Regla global: discrepancia con lo asumido → HALT con archivo:línea.**

### Diagnóstico de partida (verificar, no asumir)

Algún archivo del pipeline del motor usa `import.meta` (probablemente `import.meta.url` para ubicar un archivo de datos o template). En local pasa porque Node moderno detecta la sintaxis ESM del archivo y habilita `import.meta`; en Vercel, el bundler compila las funciones de `/api` a CommonJS porque `package.json` no declara `"type": "module"`, y `import.meta` no existe en CJS → falla solo en runtime de Vercel y solo en la cadena de módulos que lo usa. Por eso el resto de los endpoints anda.

### Decisión ya tomada (no reabrir)
**NO agregar `"type": "module"` al `package.json`.** Cambia la resolución de módulos de todo el repo y quedó declarado como ciclo propio con deploy verificado (ver reporte del ciclo del harness de tests). Este ciclo elimina el uso de `import.meta`, no cambia el sistema de módulos.

### Alcance estricto
Los archivos de `/api` (motor y utilidades) que usen `import.meta`, y `tests/` para el tripwire de la Fase 2. Nada más.

---

## FASE 0 — Inventario (sin ediciones)

```bash
grep -rn "import.meta" api/ src/ tests/
grep -rn "fileURLToPath\|createRequire" api/
grep -n "analizar-caso" api/admin.js   # cómo se carga el motor desde el endpoint
```

Reportar: cada uso de `import.meta` con archivo:línea y PARA QUÉ se usa (ubicar archivo de datos, `__dirname` sintético, `createRequire`, otro), y la cadena de imports desde `admin?action=analizar-caso` hasta cada uso. Confirmar que ningún endpoint fuera del motor lo usa (si aparece en otro lado, también entra en este ciclo — mismo tratamiento).

## REGLAS DE DECISIÓN (ejecutar sin consultar)

- **R1 — `import.meta.url` para ubicar un archivo de datos/template y leerlo con `fs`**: reemplazar por un **import estático** de un módulo JS que exporte el contenido (si el dato es JSON, convertirlo a `export default {...}` en un `.js` hermano, o si ya existe como módulo, importarlo directo). El bundler de Vercel sigue imports estáticos y empaqueta el contenido; `fs` + rutas calculadas es exactamente lo que se rompe. Si el archivo es grande (>1MB), HALT y reportar tamaño antes de convertir.
- **R2 — `import.meta` para `createRequire` o `__dirname` sintético**: eliminar la necesidad — el consumo debe poder expresarse como import estático. Si no se puede (p. ej. carga dinámica por nombre variable), HALT con el detalle.
- **R3 — uso en `tests/` o `src/`**: fuera del runtime de Vercel; no tocar, solo reportar.

## FASE 1 — Ejecución

Aplicar R1/R2. Los templates o datos convertidos conservan su contenido byte-idéntico (si se convierte texto a módulo, verificar con un test de igualdad contra el original antes de borrar el original; el original se borra solo si nada más lo lee).

**Criterio de aceptación F1:** `grep -rn "import.meta" api/` devuelve vacío.

## FASE 2 — Verificación

1. **Tripwire de regresión**: agregar a la suite un test barato que falle si reaparece `import.meta` bajo `api/` (lectura de archivos + assert; sin dependencias nuevas). Esta clase de bug es invisible en local por diseño — el test es la única defensa automatizada.
2. `npm test` verde completo (motor 21/21 incluido: la conversión de datos no puede cambiar resultados del motor).
3. Diff: solo los archivos del alcance. Reporte con la tabla de usos encontrados y qué regla se aplicó a cada uno.

## Aceptación manual (Juan, en preview)
Deploy a staging y apretar "Analizar caso" en el backoffice sobre el caso USH/EZE/AEP cargado. El motor debe responder con el análisis, sin el error de `import.meta`. Este paso es OBLIGATORIO antes de dar el ciclo por cerrado: el bug es indetectable localmente, así que el veredicto solo existe en Vercel.
