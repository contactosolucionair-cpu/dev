# Mini-prompt Claude Code — Fix: cambiar de tramo no actualiza aeropuertos (ciudades multi-aeropuerto)

> Guardar como `docs/prompt-claude-code-force-fill-tramo.md` (commit de docs separado, fuera del diff del fix).
> Ciclo mínimo, solo frontend. Independiente de "ivB - FINAL": puede correrse antes o después sin colisión.

---

## INSTRUCCIONES

Sos el ejecutor de un fix quirúrgico en el repo de SolucionAir (HTML estático + JS vanilla ES5, sin build step). Trabajás por fases. **Regla global: si algo de lo que este prompt asume no coincide con el código real, DETENETE, reportá archivo y línea, y esperá instrucciones. NO improvises soluciones alternativas.**

### Contexto del bug

En el intake, cuando el escaneo de IA detecta ida y vuelta, el pasajero elige en qué dirección tuvo el problema y `aplicarDireccion()` rellena origen/destino con los extremos de esa dirección desde `segmentos`. La primera elección funciona. Pero si el pasajero **cambia** de tramo después (ida → vuelta o viceversa), los campos de aeropuerto NO se actualizan cuando la ciudad tiene múltiples aeropuertos (ej.: debería alternar EZE ↔ AEP y queda clavado en el primero). El resto de los datos derivados (vuelo, fecha) sí cambia.

### Hipótesis a verificar (H1) — es la causa probable, NO un hecho confirmado

La vía de escritura de los campos aeropuerto reutiliza la guarda de autofill inicial: `fillAirport()` en `src/js/app.js` contiene `if (!el || el.value) return;`, pensada para no pisar lo que el usuario ya escribió durante el escaneo inicial. Si `aplicarDireccion()` escribe origen/destino a través de `fillAirport` (o de `AirportSelect.setFromText` con una guarda equivalente), toda re-elección de tramo es un no-op silencioso: el campo ya tiene valor y la función retorna sin escribir.

**Si la Fase 0 muestra que el no-op viene de OTRO lado** (p. ej. una comparación previa "mismo valor, no actualizo" hecha por ciudad en vez de por IATA, o un early-return dentro de `aplicarDireccion`), **HALT y reportá**: el fix descripto abajo dejaría de ser el correcto.

### Alcance estricto

- Archivos a editar: `src/js/app.js` y, solo si la guarda vive también ahí, `src/js/airport-select.js`.
- **Nada más.** Sin cambios en `/api`, sin tocar el flujo de escaneo inicial, sin refactors oportunistas.

### Decisión de diseño ya tomada (no reabrir)

Elegir o cambiar de tramo es una **acción explícita del usuario**: origen/destino DEBEN sobrescribirse con los extremos de la dirección elegida, aunque el campo tenga valor previo, incluso si ese valor fue una edición manual. `segmentos` es la fuente de verdad de los extremos; el flash visual existente (`field-ai` → mensaje → `field-ok`) le comunica al usuario qué acaba de cambiar. NO implementar memoria de ediciones manuales ni confirmaciones adicionales.

---

## FASE 0 — Inventario y verificación de H1 (obligatoria, sin ediciones)

```bash
grep -n "fillAirport" src/js/app.js
grep -n "el.value) return" src/js/app.js
grep -n "aplicarDireccion" src/js/app.js
grep -n "setFromText" src/js/app.js src/js/airport-select.js
grep -n "data-iata" src/js/app.js src/js/airport-select.js
```

Con el output, respondé explícitamente:

1. ¿`aplicarDireccion()` escribe los campos `#f-origin` / `#f-destination` a través de `fillAirport` u otra vía? Citar líneas de la cadena completa de llamadas (aplicarDireccion → … → escritura del input).
2. ¿Dónde está exactamente la guarda que produce el no-op? (¿`if (!el || el.value) return;` en `fillAirport`, algo en `setFromText`, ambas, u otra cosa?)
3. ¿`setFromText` limpia o pisa `data-iata` del valor anterior, o puede quedar una IATA vieja colgada tras una sobrescritura?
4. ¿Algún otro llamador de `fillAirport` además del autofill inicial y `aplicarDireccion`? Listarlos: NO deben cambiar de comportamiento.

Si H1 se confirma (la guarda de valor existente está en la cadena de `aplicarDireccion`), continuá. Si no, HALT con el diagnóstico alternativo.

---

## FASE 1 — Parámetro `force` en la vía de escritura

1. Agregar a `fillAirport(id, raw)` un tercer parámetro opcional `force`:
   - Con `force` falsy: comportamiento EXACTAMENTE igual al actual (la guarda `if (!el || el.value) return;` sigue aplicando). Los llamadores existentes no se tocan y no cambian de semántica.
   - Con `force` truthy: saltear la guarda de valor existente (mantener solo el chequeo `if (!el) return;`), limpiar `data-iata` del input ANTES de resolver el texto nuevo, y escribir el aeropuerto nuevo. El flash visual y el mensaje ("Completado por IA" / "Confirmá el aeropuerto" según resuelva) se ejecutan igual que hoy — es la señal de que el campo cambió.
2. Si la Fase 0 mostró que `AirportSelect.setFromText` tiene su propia guarda de valor/IATA existente, propagarle el flag de la misma forma (parámetro opcional, default = comportamiento actual). Si no la tiene, NO tocar `airport-select.js`.
3. En `aplicarDireccion()`, las escrituras de origen y destino pasan a llamar con `force: true`. Ninguna otra llamada a `fillAirport` en el repo agrega el flag.

**Criterios de aceptación F1:**
- `grep -n "force" src/js/app.js` muestra el parámetro nuevo solo en `fillAirport` (y `setFromText` si aplicó) y en las llamadas dentro de `aplicarDireccion`.
- Todos los demás llamadores de `fillAirport` quedan byte-idénticos.
- Tras una sobrescritura forzada, el input queda con el `data-iata` del aeropuerto NUEVO (verificable leyendo el código: la limpieza previa + `setIata`), nunca con la IATA anterior.

---

## FASE 2 — Verificación

### 2a. Alcance del diff

`git diff --stat` debe mostrar exactamente `src/js/app.js` (y `src/js/airport-select.js` solo si la Fase 0 lo justificó). Cualquier otro archivo = HALT.

### 2b. Tests existentes

Correr la suite de formularios en jsdom que ya está verde (la de intake). Todo debe seguir verde. Si algún test asume la semántica vieja de `fillAirport` para el caso de re-elección de tramo, reportarlo antes de ajustarlo.

### 2c. Reporte final

Resumir: cadena de llamadas confirmada en Fase 0 (con líneas), ubicación exacta de la guarda salteada, llamadores no afectados, resultado de la suite. Sugerir commit: `fix(intake): re-eleccion de tramo sobrescribe origen/destino (force en fillAirport)`.

### 2d. Prueba de aceptación manual (la hace Juan en preview, no vos)

Con el pasaje real USH→EZE / AEP→USH:

1. Escanear, elegir **ida** → Origen `Ushuaia (USH)`, Destino `Buenos Aires (EZE)`.
2. Cambiar a **vuelta** → Origen `Buenos Aires (AEP)`, Destino `Ushuaia (USH)`, con flash visual en ambos campos.
3. Volver a **ida** → alterna de nuevo a USH → EZE. Repetir el toggle un par de veces: debe alternar SIEMPRE, y `data-iata` (inspeccionable en devtools) debe coincidir con lo visible en cada estado.
4. Editar manualmente el destino, cambiar de tramo y volver: la edición manual se pierde y gana la dirección elegida (comportamiento decidido, no bug).
5. Flujo de escaneo inicial sobre formulario con campos ya escritos a mano: la IA NO pisa lo escrito (la semántica sin `force` quedó intacta).

---

> **Nota posterior:** el formulario largo sobre el que corrió este ciclo fue eliminado en
> `limpieza-formularios-viejos` (2026-08-05). El comportamiento que este fix instaló —que
> cambiar de tramo reescriba los aeropuertos en vez de solo renombrar las etiquetas— se
> portó al componente compartido `src/js/intake-wizard.js` en el commit `92ffdbc`, y hoy
> lo cubre `tests/escaneo-wizard.test.js` en las tres superficies. Este documento queda
> como registro histórico del ciclo original.
