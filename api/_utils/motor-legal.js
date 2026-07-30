/**
 * api/_utils/motor-legal.js
 *
 * Evaluador determinista de la Capa 1. `analizar(caso, ruleset, hoy)` → `analisis_legal`.
 *
 * Este archivo es GENÉRICO Y ESTABLE: recorre la estructura declarativa del ruleset y
 * arma la salida. **No contiene ningún número legal, ninguna cita normativa y ninguna
 * regla de fondo.** Todo eso vive en api/_utils/rulesets/<vigencia>.js. Agregar el
 * ruleset de la reforma EU261 (~2027) no debería tocar una línea de acá.
 *
 * Las 7 reglas de comportamiento del contrato §2, y dónde se cumplen:
 *
 *  1. Función pura. No hay `new Date()`: la fecha entra por el parámetro `hoy`, así el
 *     cálculo de prescripción es testeable y reproducible.
 *  2. Ruleset elegido por `fecha_incidente` → seleccionarRuleset().
 *  3. Campo crítico null, sin verificar o en conflicto → FALTA_DATO en las categorías
 *     que lo consumen, más `provisional: true` global. Se aplica ESTRUCTURALMENTE: cada
 *     categoría declara qué campos consume y el evaluador cruza esa lista contra
 *     `caso.campos_falta_dato`, sin depender de que cada regla se acuerde de chequearlo.
 *  4. Gates antes que categorías. Cada gate declara su `alcance`: qué categorías bloquea.
 *  5. Nunca resuelve nodos EVAL, nunca elige marco ganador, nunca emite fecha de
 *     prescripción `segun_foro`.
 *  6. Cuantificación AO/SDR siempre simbólica: el evaluador copia el objeto `monto` tal
 *     como lo emite el ruleset y solo suma los montos tarifados con valor y moneda.
 *  7. Toda categoría y todo gate llevan `base_legal` no vacía: se garantiza acá, con la
 *     declaración de la categoría como respaldo si la regla no la devuelve.
 *
 * Nunca lanza. Un error dentro de una regla se convierte en FALTA_DATO y queda anotado
 * en `avisos`, para que un bug no deje un caso sin análisis ni tape el problema.
 */
import { RULESET as RULESET_2024_10_10 } from './rulesets/2024-10-10.js';
import { RULESET as RULESET_2026_06_19 } from './rulesets/2026-06-19.js';

export var VERSION_MOTOR = '1.1.0';

/* Registro de rulesets, del más nuevo al más viejo por fecha de inicio de vigencia.
   El régimen argentino está partido por la derogación de la Res. 1532/98: el Decreto
   809/2024 rige los incidentes desde el 10-oct-2024 y la 1532 sigue siendo ley al momento
   del hecho para los anteriores. EU261 y Montreal no se enteran de ese corte: viven en
   `rulesets/_compartido.js` y los dos rulesets los importan. */
var REGISTRO = [RULESET_2024_10_10, RULESET_2026_06_19];

/* ------------------------------------------------------------------ */
/* Fechas — días corridos, sin zona horaria                            */
/* ------------------------------------------------------------------ */

/* Todo en UTC a propósito: los plazos legales se cuentan en días de calendario y no
   deben moverse por el huso del servidor. */
function aFecha(s) {
  if (!s) return null;
  var m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

function fmtFecha(d) { return d.toISOString().slice(0, 10); }

/** Días corridos entre dos fechas (Pin 5). `null` si alguna no es interpretable. */
export function diasCorridos(desde, hasta) {
  var a = aFecha(desde), b = aFecha(hasta);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function sumarDias(fecha, n) {
  var d = aFecha(fecha);
  if (!d) return null;
  return fmtFecha(new Date(d.getTime() + n * 86400000));
}

/** Suma años calendario. El 29-feb + 1 año cae en el 1-mar (normalización de Date). */
export function sumarAnios(fecha, n) {
  var d = aFecha(fecha);
  if (!d) return null;
  return fmtFecha(new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate())));
}

/**
 * Ruleset vigente a la fecha del incidente (ley al momento del hecho, §2 regla 2).
 * Sin fecha devuelve el más reciente, porque es el único análisis posible; el caso ya
 * arrastra FALTA_DATO en `fecha_incidente` por otro lado.
 */
export function seleccionarRuleset(fechaIncidente, registro) {
  var lista = registro || REGISTRO;
  var f = aFecha(fechaIncidente);
  if (f) {
    for (var i = 0; i < lista.length; i++) {
      var v = lista[i].vigencia || {};
      var desde = aFecha(v.desde), hasta = aFecha(v.hasta);
      if (desde && f < desde) continue;
      if (hasta && f > hasta) continue;
      return lista[i];
    }
  }
  return lista[0];
}

/* ------------------------------------------------------------------ */
/* Utilidades internas                                                 */
/* ------------------------------------------------------------------ */

function esArray(v) { return Array.isArray(v) ? v : []; }

/* Corre una regla del ruleset sin dejar que una excepción tumbe el análisis. */
function correr(fn, args, alFallar, avisos, etiqueta) {
  try {
    return fn.apply(null, args);
  } catch (e) {
    avisos.push('error en la regla ' + etiqueta + ': ' + (e && e.message ? e.message : String(e)));
    return alFallar;
  }
}

/* Dedupe de nodos EVAL por (nodo, marco): el mismo nodo puede emitirse desde una
   categoría y desde un gate, y en la salida tiene que aparecer una sola vez. */
function agregarNodos(destino, nuevos) {
  esArray(nuevos).forEach(function (n) {
    if (!n || !n.nodo) return;
    var yaEsta = destino.some(function (x) { return x.nodo === n.nodo && x.marco === n.marco; });
    if (!yaEsta) destino.push(n);
  });
}

/* ------------------------------------------------------------------ */
/* analizar()                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {Object} caso     Salida de normalizarCaso()
 * @param {Object} ruleset  Ruleset ya seleccionado (ver seleccionarRuleset)
 * @param {string} hoy      Fecha u hora del análisis. 'YYYY-MM-DD' o ISO completo.
 *                          Entra por parámetro para que la función sea pura.
 * @param {Object} [opciones] { disparado_por: 'manual'|'auto' }
 * @returns {Object} analisis_legal (contrato §2)
 */
export function analizar(caso, ruleset, hoy, opciones) {
  caso = caso || {};
  var U = (ruleset && ruleset.umbrales) || {};
  var defs = esArray(ruleset && ruleset.marcos);
  var opts = opciones || {};
  var avisos = esArray(caso.avisos).slice();

  var hoyFecha = (hoy && String(hoy).slice(0, 10)) || null;

  /* --- Pasada 1: tests de aplicabilidad (los marcos se evalúan en paralelo) --- */
  var evaluados = defs.map(function (def) {
    var t = correr(def.test, [caso, U],
      { aplica: 'falta_dato', activado_por: 'La regla de aplicabilidad falló', base_legal: 'Test del ruteo' },
      avisos, def.marco + '.test');
    return { def: def, test: t || {} };
  });

  function marcoAplica(nombre) {
    return evaluados.some(function (e) { return e.def.marco === nombre && e.test.aplica === 'si'; });
  }

  /* Contexto que reciben las reglas: solo helpers deterministas y consultas de estado.
     Nada de fechas del sistema ni de I/O. */
  var ctx = {
    aplica: marcoAplica,
    diasCorridos: diasCorridos,
    sumarDias: sumarDias,
    sumarAnios: sumarAnios,
    hoy: hoyFecha,
  };

  /* --- Pasada 2: gates, categorías y prescripción --- */
  var nodosEval = [];
  var faltan = {};          // campo → { campo, para: [], en_conflicto }
  var consumidos = {};      // campos efectivamente usados por categorías con resultado
  var marcos = [];

  var enConflicto = esArray(caso.campos_en_conflicto);
  var faltaDato = esArray(caso.campos_falta_dato);
  var sinVerificar = esArray(caso.campos_sin_verificar);

  function registrarFalta(campo, ref) {
    if (!campo) return;
    if (!faltan[campo]) {
      faltan[campo] = { campo: campo, para: [], en_conflicto: enConflicto.indexOf(campo) !== -1 };
    }
    if (ref && faltan[campo].para.indexOf(ref) === -1) faltan[campo].para.push(ref);
  }

  evaluados.forEach(function (ev) {
    var def = ev.def, t = ev.test;
    var out = {
      marco: def.marco,
      aplica: t.aplica === 'si' || t.aplica === 'no' || t.aplica === 'pendiente_analisis_profundo' ? t.aplica : 'falta_dato',
      activado_por: t.activado_por || '',
      base_legal: t.base_legal || '',
    };
    if (t.punteros) out.punteros = t.punteros;
    if (t.nota) out.nota = t.nota;
    agregarNodos(nodosEval, t.nodos_eval);

    /* Un marco cuyo test no pasó no emite gates ni categorías: el ruteo ya dijo que no
       corresponde, o que falta el dato para saberlo. */
    if (out.aplica !== 'si') {
      if (out.aplica === 'falta_dato' && t.dato_faltante) {
        out.dato_faltante = t.dato_faltante;
        registrarFalta(t.dato_faltante, def.marco + '.aplicabilidad');
      }
      marcos.push(out);
      return;
    }

    /* ---- Gates (§2 regla 4: antes que las categorías) ---- */
    var gates = [];
    esArray(def.gates).forEach(function (g) {
      var relevante = g.aplica ? correr(g.aplica, [caso, U], false, avisos, def.marco + '.gate.' + g.gate + '.aplica') : true;
      if (!relevante) return;
      var r = correr(g.evaluar, [caso, U, ctx],
        { resultado: 'falta_dato', detalle: 'La regla del gate falló', base_legal: g.base_legal || out.base_legal },
        avisos, def.marco + '.gate.' + g.gate);
      r = r || {};
      var gOut = {
        gate: g.gate,
        resultado: r.resultado || 'falta_dato',
        detalle: r.detalle || '',
        /* §2 regla 7: base_legal nunca vacía. */
        base_legal: r.base_legal || g.base_legal || out.base_legal,
        alcance: esArray(g.alcance),
      };
      if (r.dato_faltante) {
        gOut.dato_faltante = r.dato_faltante;
        registrarFalta(r.dato_faltante, def.marco + '.gate.' + g.gate);
      }
      agregarNodos(nodosEval, r.nodos_eval);
      /* Los campos que mira el gate cuentan como consumidos: si están sin verificar, el
         análisis es provisional igual que si los hubiera usado una categoría. */
      if (g.consume) {
        esArray(correr(g.consume, [caso], [], avisos, def.marco + '.gate.' + g.gate + '.consume'))
          .forEach(function (c) { consumidos[c] = true; });
      }
      gates.push(gOut);
    });
    if (gates.length) out.gates = gates;

    function gateSobre(categoria, resultado) {
      return gates.filter(function (g) {
        return g.resultado === resultado && (!g.alcance.length || g.alcance.indexOf(categoria) !== -1);
      })[0] || null;
    }

    /* ---- Categorías ---- */
    out.categorias = esArray(def.categorias).map(function (c) {
      var ref = def.marco + '.' + c.categoria;
      var necesita = c.consume
        ? esArray(correr(c.consume, [caso, U], [], avisos, ref + '.consume'))
        : [];

      var base = { categoria: c.categoria, base_legal: c.base_legal || out.base_legal };

      /* 1. Gate inadmisible: corta antes de mirar cualquier otra cosa. */
      var bloqueo = gateSobre(c.categoria, 'inadmisible');
      if (bloqueo) {
        return Object.assign(base, {
          estado: 'NO_APLICA',
          motivo: 'Inadmisible por el gate "' + bloqueo.gate + '": ' + bloqueo.detalle,
          base_legal: bloqueo.base_legal || base.base_legal,
        });
      }

      /* 2. Gate sin dato: no se puede afirmar ni negar la categoría. */
      var gateFalta = gateSobre(c.categoria, 'falta_dato');
      if (gateFalta) {
        registrarFalta(gateFalta.dato_faltante, ref);
        return Object.assign(base, {
          estado: 'FALTA_DATO',
          dato_faltante: gateFalta.dato_faltante || gateFalta.gate,
          nota: 'Bloqueada por el gate "' + gateFalta.gate + '": ' + gateFalta.detalle,
        });
      }

      /* 3. Campos críticos ausentes o en conflicto (§2 regla 3, aplicada
            estructuralmente sobre lo que la categoría declara consumir). */
      var faltantes = necesita.filter(function (f) { return faltaDato.indexOf(f) !== -1; });
      if (faltantes.length) {
        faltantes.forEach(function (f) { registrarFalta(f, ref); });
        return Object.assign(base, {
          estado: 'FALTA_DATO',
          dato_faltante: faltantes[0],
          nota: faltantes.length > 1 ? 'También falta: ' + faltantes.slice(1).join(', ') : undefined,
        });
      }

      /* 4. Regla de fondo. */
      var r = correr(c.evaluar, [caso, U, ctx],
        { estado: 'FALTA_DATO', dato_faltante: 'error interno de la regla' },
        avisos, ref);
      r = r || {};

      var salida = Object.assign(base, {
        estado: r.estado || 'FALTA_DATO',
        base_legal: r.base_legal || base.base_legal,
      });
      if (r.monto) salida.monto = r.monto;
      if (r.motivo) salida.motivo = r.motivo;
      if (r.dato_faltante) salida.dato_faltante = r.dato_faltante;
      if (r.eval_nodo) salida.eval_nodo = r.eval_nodo;
      if (r.deducible_de) salida.deducible_de = r.deducible_de;
      if (r.nota) salida.nota = r.nota;

      if (salida.estado === 'FALTA_DATO') registrarFalta(salida.dato_faltante, ref);
      agregarNodos(nodosEval, r.nodos_eval);

      /* Solo cuenta como "campo usado" si la categoría produjo algo distinto de un
         NO_APLICA: es la condición del §2 regla 3 para el flag `provisional`. */
      if (salida.estado !== 'NO_APLICA') {
        necesita.forEach(function (f) { consumidos[f] = true; });
      }
      return salida;
    });

    /* ---- Prescripción ---- */
    if (def.prescripcion) {
      var p = correr(def.prescripcion, [caso, hoyFecha, U, ctx],
        { computable: false, tipo: 'firme', plazo: null, fecha_limite: null, base_legal: out.base_legal },
        avisos, def.marco + '.prescripcion');
      p = p || {};
      /* §2 regla 5: nunca una fecha límite cuando el plazo depende de un foro no
         decidido. Si una regla la emitiera por error, se descarta acá. */
      if (p.tipo === 'segun_foro' && p.fecha_limite) {
        avisos.push('se descartó la fecha límite de ' + def.marco + ': el tipo `segun_foro` no puede emitir fecha (Pin 7)');
        p.fecha_limite = null;
        p.computable = false;
      }
      /* `hoy` sirve para esto: saber si el plazo ya venció sin que el llamador recalcule. */
      if (p.fecha_limite && hoyFecha) {
        var restan = diasCorridos(hoyFecha, p.fecha_limite);
        p.dias_restantes = restan;
        p.vencida = restan != null ? restan < 0 : null;
      }
      out.prescripcion = p;
    }

    marcos.push(out);
  });

  /* --- Jurisdicción: bloque INFORMATIVO, nunca gate (v2.2) --- */
  /* Va después de los marcos y fuera de ellos a propósito: describe dónde se puede
     reclamar, no si corresponde reclamo. Lo produce el ruleset —es doctrina, no mecánica—
     y el evaluador solo lo copia. Un ruleset sin la función simplemente no lo emite. */
  var bloqueJurisdiccion = null;
  if (ruleset && typeof ruleset.jurisdiccion === 'function') {
    bloqueJurisdiccion = correr(ruleset.jurisdiccion, [caso, U, ctx], null, avisos, 'jurisdiccion');
  }

  /* --- provisional (§2 regla 3) --- */
  var criticosUsadosDudosos = Object.keys(consumidos).filter(function (f) {
    return sinVerificar.indexOf(f) !== -1 || enConflicto.indexOf(f) !== -1;
  });
  var provisional = criticosUsadosDudosos.length > 0;

  /* --- Resumen --- */
  var marcosActivos = marcos.filter(function (m) { return m.aplica === 'si'; }).map(function (m) { return m.marco; });
  var reclamables = 0;
  var totalPorMoneda = {};
  marcos.forEach(function (m) {
    esArray(m.categorias).forEach(function (c) {
      if (c.estado !== 'RECLAMABLE') return;
      reclamables++;
      /* Solo se suman los montos tarifados (valor + moneda). Los simbólicos (AO/SDR)
         nunca se agregan: la cuantificación es un paso posterior (§2 regla 6). */
      if (c.monto && c.monto.valor != null && c.monto.moneda) {
        totalPorMoneda[c.monto.moneda] = (totalPorMoneda[c.monto.moneda] || 0) + c.monto.valor;
      }
    });
  });

  return {
    version_motor: VERSION_MOTOR,
    version_ruleset: (ruleset && ruleset.version) || null,
    fecha_analisis: hoy || null,
    disparado_por: opts.disparado_por === 'auto' ? 'auto' : 'manual',
    provisional: provisional,
    normalizacion: {
      internacional: caso.internacional != null ? caso.internacional : null,
      origen: caso.origen ? caso.origen.iata : null,
      destino_final: caso.destino_final ? caso.destino_final.iata : null,
      distancia_km: caso.distancia_km != null ? caso.distancia_km : null,
      banda_eu261: caso.banda_eu261 || null,
    },
    marcos: marcos,
    jurisdiccion: bloqueJurisdiccion,
    nodos_eval: nodosEval,
    faltan_datos: Object.keys(faltan).map(function (k) { return faltan[k]; }),
    resumen: {
      marcos_activos: marcosActivos,
      categorias_reclamables: reclamables,
      monto_tarifado_total: Object.keys(totalPorMoneda).map(function (m) {
        return { moneda: m, valor: totalPorMoneda[m] };
      }),
      /* Qué campos hicieron provisional el análisis: sin esto, `provisional: true` no
         le dice nada a quien lee el caso en el backoffice. */
      provisional_por: criticosUsadosDudosos,
    },
    avisos: avisos,
  };
}

export default analizar;
