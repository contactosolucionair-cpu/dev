/**
 * tests/motor.test.js
 *
 * Runner del motor legal. Sin framework ni dependencias.
 *
 *   node tests/motor.test.js              corre todo
 *   node tests/motor.test.js CD-05        corre solo los casos dorados que matcheen
 *   node tests/motor.test.js --verbose    imprime el análisis completo de cada caso
 *
 * Qué corre, y por qué está separado:
 *
 *   1. CASOS DORADOS (tests/casos-dorados.js). La salida esperada es criterio legal y la
 *      escribe JPA. Comparación por DEEP PARTIAL MATCH: solo se chequean las claves
 *      declaradas en `esperado`; todo lo demás se ignora. Un caso con `esperado: {}` se
 *      SALTEA con aviso y no falla — es un esqueleto TODO-JPA reservando cobertura.
 *
 *   2. UNITARIOS. Hechos mecánicos y verificables sin criterio legal: haversine, bandas,
 *      internacional/doméstico, propagación del conflicto, determinismo, que no lance
 *      nunca, que toda categoría lleve base_legal, y que el evaluador no tenga ningún
 *      umbral legal hardcodeado. Estos SÍ los puede asertar el desarrollador.
 *
 * Exit code distinto de 0 si algo falla. Los salteados no afectan el exit code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizarCaso, haversineKm, bandaEu261 } from '../api/_utils/motor-normalizar.js';
import { analizar, seleccionarRuleset, diasCorridos, sumarAnios } from '../api/_utils/motor-legal.js';
import { cargarDatosMotor } from '../api/_utils/motor-datos.js';
import * as paises from '../api/_data/paises-ue.js';
import { CASOS } from './casos-dorados.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var RAIZ = join(__dirname, '..');

/* Fecha fija: el motor recibe `hoy` por parámetro justamente para que los tests no
   dependan del día en que se corren. */
var HOY = '2026-07-29';

/* Los índices salen del mismo cargador que usa el endpoint, con los mismos módulos de
   datos: si el motor se prueba contra otra fuente que la de producción, los 21 en verde no
   dicen nada sobre lo que corre en Vercel. */
var datosMotor = cargarDatosMotor();
var idxAeropuertos = datosMotor.idxAeropuertos;
var idxAerolineas = datosMotor.idxAerolineas;

var args = process.argv.slice(2);
var VERBOSE = args.indexOf('--verbose') !== -1;
var FILTRO = args.filter(function (a) { return a.indexOf('--') !== 0; })[0] || null;

/* ------------------------------------------------------------------ */
/* Colores (se apagan solos si la salida no es una terminal)           */
/* ------------------------------------------------------------------ */
var TTY = process.stdout.isTTY;
function c(codigo, s) { return TTY ? '[' + codigo + 'm' + s + '[0m' : s; }
var verde = function (s) { return c('32', s); };
var rojo = function (s) { return c('31', s); };
var amarillo = function (s) { return c('33', s); };
var gris = function (s) { return c('90', s); };
var negrita = function (s) { return c('1', s); };

/* ------------------------------------------------------------------ */
/* Helpers de análisis                                                 */
/* ------------------------------------------------------------------ */

function correrCaso(cd) {
  var caso = cd.caso_normalizado || normalizarCaso(cd.caso, idxAeropuertos, idxAerolineas, paises);
  var ruleset = seleccionarRuleset(caso.fecha_incidente);
  return { caso: caso, analisis: analizar(caso, ruleset, HOY) };
}

function buscarMarco(a, nombre) {
  return (a.marcos || []).filter(function (m) { return m.marco === nombre; })[0] || null;
}

function buscarCategoria(a, ref) {
  var partes = String(ref).split('.');
  var m = buscarMarco(a, partes[0]);
  if (!m) return null;
  return (m.categorias || []).filter(function (x) { return x.categoria === partes[1]; })[0] || null;
}

function buscarGate(a, ref) {
  var partes = String(ref).split('.');
  var m = buscarMarco(a, partes[0]);
  if (!m) return null;
  return (m.gates || []).filter(function (x) { return x.gate === partes[1]; })[0] || null;
}

/* ------------------------------------------------------------------ */
/* Deep partial match                                                  */
/* ------------------------------------------------------------------ */

function esObjetoSimple(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Compara `esperado` contra `real` mirando SOLO las claves presentes en `esperado`.
 * Los arrays se comparan por igualdad exacta (si se quiere "contiene", hay claves
 * dedicadas como nodos_eval_incluye). Devuelve un array de diferencias legibles.
 */
function parcial(real, esperado, ruta, difs) {
  difs = difs || [];
  ruta = ruta || '';
  if (esObjetoSimple(esperado)) {
    if (!esObjetoSimple(real)) {
      difs.push(ruta + ': se esperaba un objeto y llegó ' + JSON.stringify(real));
      return difs;
    }
    Object.keys(esperado).forEach(function (k) {
      parcial(real[k], esperado[k], ruta ? ruta + '.' + k : k, difs);
    });
    return difs;
  }
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    difs.push(ruta + ': esperado ' + JSON.stringify(esperado) + ', real ' + JSON.stringify(real));
  }
  return difs;
}

/** Traduce las claves-atajo de `esperado` a comparaciones concretas. */
function verificarEsperado(a, esp) {
  var difs = [];

  if (esp.marcos) {
    Object.keys(esp.marcos).forEach(function (nombre) {
      var m = buscarMarco(a, nombre);
      var real = m ? m.aplica : '(marco ausente)';
      if (real !== esp.marcos[nombre]) {
        difs.push('marcos.' + nombre + ': esperado ' + JSON.stringify(esp.marcos[nombre]) + ', real ' + JSON.stringify(real));
      }
    });
  }

  if (esp.categorias_clave) {
    Object.keys(esp.categorias_clave).forEach(function (ref) {
      var cat = buscarCategoria(a, ref);
      var quiere = esp.categorias_clave[ref];
      if (!cat) { difs.push('categorias_clave.' + ref + ': la categoría no está en la salida'); return; }
      if (typeof quiere === 'string') {
        if (cat.estado !== quiere) difs.push('categorias_clave.' + ref + ': esperado ' + quiere + ', real ' + cat.estado);
      } else {
        parcial(cat, quiere, 'categorias_clave.' + ref, difs);
      }
    });
  }

  if (esp.gates) {
    Object.keys(esp.gates).forEach(function (ref) {
      var g = buscarGate(a, ref);
      var quiere = esp.gates[ref];
      if (!g) { difs.push('gates.' + ref + ': el gate no está en la salida'); return; }
      if (typeof quiere === 'string') {
        if (g.resultado !== quiere) difs.push('gates.' + ref + ': esperado ' + quiere + ', real ' + g.resultado);
      } else {
        parcial(g, quiere, 'gates.' + ref, difs);
      }
    });
  }

  if (esp.prescripcion) {
    Object.keys(esp.prescripcion).forEach(function (nombre) {
      var m = buscarMarco(a, nombre);
      if (!m || !m.prescripcion) { difs.push('prescripcion.' + nombre + ': el marco no emitió prescripción'); return; }
      parcial(m.prescripcion, esp.prescripcion[nombre], 'prescripcion.' + nombre, difs);
    });
  }

  if (esp.nodos_eval_incluye) {
    esp.nodos_eval_incluye.forEach(function (n) {
      if (!(a.nodos_eval || []).some(function (x) { return x.nodo === n; })) {
        difs.push('nodos_eval_incluye: falta el nodo "' + n + '"');
      }
    });
  }

  if (esp.nodos_eval_excluye) {
    esp.nodos_eval_excluye.forEach(function (n) {
      if ((a.nodos_eval || []).some(function (x) { return x.nodo === n; })) {
        difs.push('nodos_eval_excluye: el nodo "' + n + '" no debería estar');
      }
    });
  }

  if (esp.faltan_datos_incluye) {
    esp.faltan_datos_incluye.forEach(function (campo) {
      if (!(a.faltan_datos || []).some(function (f) { return f.campo === campo; })) {
        difs.push('faltan_datos_incluye: falta el campo "' + campo + '"');
      }
    });
  }

  if (esp.provisional !== undefined && a.provisional !== esp.provisional) {
    difs.push('provisional: esperado ' + esp.provisional + ', real ' + a.provisional);
  }

  if (esp.normalizacion) parcial(a.normalizacion, esp.normalizacion, 'normalizacion', difs);
  if (esp.resumen) parcial(a.resumen, esp.resumen, 'resumen', difs);
  if (esp.parcial) parcial(a, esp.parcial, '', difs);

  return difs;
}

/* ------------------------------------------------------------------ */
/* UNITARIOS — hechos mecánicos, sin criterio legal                    */
/* ------------------------------------------------------------------ */

function norm(row) { return normalizarCaso(row, idxAeropuertos, idxAerolineas, paises); }
function analizarRow(row) { var ca = norm(row); return analizar(ca, seleccionarRuleset(ca.fecha_incidente), HOY); }

/* Cada unitario devuelve null si pasa, o un string con el motivo si falla. */
function igual(nombre, real, esperado) {
  return JSON.stringify(real) === JSON.stringify(esperado)
    ? null
    : nombre + ': esperado ' + JSON.stringify(esperado) + ', real ' + JSON.stringify(real);
}

var UNITARIOS = [
  {
    nombre: 'haversine EZE→MAD ≈ 10.000 km (±2 %)',
    correr: function () {
      var a = idxAeropuertos.EZE, b = idxAeropuertos.MAD;
      var km = haversineKm(a, b);
      if (km == null) return 'devolvió null: faltan lat/lon en EZE o MAD';
      var desvio = Math.abs(km - 10000) / 10000;
      return desvio <= 0.02 ? null : 'km = ' + Math.round(km) + ', desvío del ' + (desvio * 100).toFixed(1) + '% respecto de 10.000 (tolerancia 2 %)';
    },
  },
  {
    nombre: 'haversine devuelve null si falta una coordenada',
    correr: function () {
      return igual('sin lat', haversineKm({ lat: null, lon: 1 }, { lat: 2, lon: 3 }), null)
        || igual('sin punto', haversineKm(null, { lat: 2, lon: 3 }), null);
    },
  },
  {
    nombre: 'bandas del Art. 7(1) por distancia',
    correr: function () {
      return igual('1500 km exactos', bandaEu261(1500, false), '<=1500')
        || igual('1501 km', bandaEu261(1501, false), '1500-3500')
        || igual('3500 km exactos', bandaEu261(3500, false), '1500-3500')
        || igual('3501 km no intra', bandaEu261(3501, false), '>3500')
        /* La fila de €400 no tiene techo para vuelos intracomunitarios. */
        || igual('4000 km intracomunitario', bandaEu261(4000, true), '1500-3500')
        /* Por debajo de 3500 las dos filas coinciden, así que la duda no importa. */
        || igual('2000 km con intra desconocido', bandaEu261(2000, null), '1500-3500')
        /* Arriba de 3500 sí importa: no se elige monto. */
        || igual('4000 km con intra desconocido', bandaEu261(4000, null), null)
        || igual('distancia desconocida', bandaEu261(null, false), null);
    },
  },
  {
    nombre: 'internacional vs. doméstico',
    correr: function () {
      return igual('AEP→COR', norm({ origen_iata: 'AEP', destino_iata: 'COR' }).internacional, false)
        || igual('EZE→MAD', norm({ origen_iata: 'EZE', destino_iata: 'MAD' }).internacional, true)
        || igual('sin ruta', norm({}).internacional, null);
    },
  },
  {
    nombre: 'ámbito EU261 tri-estado (firme, firme, desconocido)',
    correr: function () {
      return igual('MAD dentro', norm({ origen_iata: 'MAD' }).origen.ambito_eu261, true)
        || igual('EZE fuera', norm({ origen_iata: 'EZE' }).origen.ambito_eu261, false)
        /* FDF tiene pais_iso 'MQ': territorio sin clasificar → null, no "no aplica". */
        || igual('FDF sin clasificar', norm({ origen_iata: 'FDF' }).origen.ambito_eu261, null);
    },
  },
  {
    /* Enmienda legal v2.1.2: cada dirección de un billete redondo es un itinerario
       aparte. La partición es mecánica (corta donde el itinerario no engancha o vuelve
       sobre un aeropuerto ya visitado), así que se puede asertar sin criterio legal. */
    nombre: 'dirección afectada: el redondo parte en dos, la conexión no',
    correr: function () {
      var vuelta = norm({ segmentos: [
        { orden: 1, origen_iata: 'EZE', destino_iata: 'MAD' },
        { orden: 2, origen_iata: 'MAD', destino_iata: 'EZE', afectado: true },
      ] });
      var hub = norm({ segmentos: [
        { orden: 1, origen_iata: 'JFK', destino_iata: 'MAD' },
        { orden: 2, origen_iata: 'MAD', destino_iata: 'EZE' },
      ] });
      return igual('redondo: dos direcciones', vuelta.direcciones_total, 2)
        || igual('redondo: origen de la vuelta', vuelta.origen_iata, 'MAD')
        || igual('redondo: destino de la vuelta', vuelta.destino_iata, 'EZE')
        /* Sin la enmienda esto daba 0 km: origen = destino. */
        || igual('redondo: distancia real', vuelta.distancia_km, 10087)
        || igual('conexión: una sola dirección', hub.direcciones_total, 1)
        || igual('conexión: extremos del itinerario', hub.origen_iata + '→' + hub.destino_iata, 'JFK→EZE')
        || igual('conexión: nodo borde por hub UE', hub.transita_hub_eu261, true);
    },
  },
  {
    nombre: 'dirección afectada: sin tramo marcado se analiza la primera y se avisa',
    correr: function () {
      var r = norm({ segmentos: [
        { orden: 1, origen_iata: 'EZE', destino_iata: 'MAD' },
        { orden: 2, origen_iata: 'MAD', destino_iata: 'EZE' },
      ] });
      var unTramo = norm({ segmentos: [{ orden: 1, origen_iata: 'EZE', destino_iata: 'MAD' }] });
      return igual('cae en la ida', r.origen_iata + '→' + r.destino_iata, 'EZE→MAD')
        || igual('no la eligió nadie', r.direccion_afectada.marcada, false)
        || igual('queda constancia', r.avisos.some(function (a) { return a.indexOf('ninguna está marcada') !== -1; }), true)
        /* Un solo tramo no tiene ambigüedad posible: no corresponde avisar nada. */
        || igual('un tramo, sin aviso', unTramo.avisos.length, 0);
    },
  },
  {
    nombre: 'el carrier del Test A2 sale del tramo afectado, no del primero del billete',
    correr: function () {
      var r = norm({ segmentos: [
        { orden: 1, origen_iata: 'EZE', destino_iata: 'MAD', carrier_operante: 'Iberia' },
        { orden: 2, origen_iata: 'MAD', destino_iata: 'EZE', carrier_operante: 'Aerolíneas Argentinas', afectado: true },
      ] });
      return igual('carrier de la vuelta', r.carrier_operante && r.carrier_operante.nombre, 'Aerolíneas Argentinas')
        || igual('no comunitario', r.carrier_operante && r.carrier_operante.comunitario, false);
    },
  },
  {
    nombre: 'campo crítico en conflicto → FALTA_DATO en la categoría que lo consume (§1.1)',
    correr: function () {
      var a = analizarRow({
        origen_iata: 'MAD', destino_iata: 'BCN', aerolinea: 'Iberia', incidentes: ['demora'],
        demora_llegada_min: 200, fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora',
        campos_meta: { demora_llegada_min: { verificado: false, conflicto: true } },
      });
      var cat = buscarCategoria(a, 'EU261.compensacion_tarifada');
      var f = (a.faltan_datos || []).filter(function (x) { return x.campo === 'demora_llegada_min'; })[0];
      return igual('estado', cat && cat.estado, 'FALTA_DATO')
        || igual('marcado en_conflicto en faltan_datos', f && f.en_conflicto, true);
    },
  },
  {
    nombre: 'campo crítico ausente → FALTA_DATO (no NO_APLICA)',
    correr: function () {
      var a = analizarRow({
        origen_iata: 'MAD', destino_iata: 'BCN', aerolinea: 'Iberia', incidentes: ['demora'],
        fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora',
      });
      var cat = buscarCategoria(a, 'EU261.compensacion_tarifada');
      return igual('estado', cat && cat.estado, 'FALTA_DATO')
        || igual('dato_faltante', cat && cat.dato_faltante, 'demora_llegada_min');
    },
  },
  {
    nombre: 'campo crítico sin verificar → análisis provisional',
    correr: function () {
      var base = {
        origen_iata: 'MAD', destino_iata: 'BCN', aerolinea: 'Iberia', incidentes: ['demora'],
        demora_llegada_min: 200, demora_salida_min: 200, fecha_incidente: '2026-05-10',
        billete_unico: true, checkin_presentacion: 'en_hora',
      };
      var sinVerificar = analizarRow(base);
      var verificado = analizarRow(Object.assign({}, base, {
        campos_meta: {
          incidentes: { verificado: true }, demora_llegada_min: { verificado: true },
          demora_salida_min: { verificado: true }, fecha_incidente: { verificado: true },
          checkin_presentacion: { verificado: true }, billete_unico: { verificado: true },
        },
      }));
      return igual('sin verificar', sinVerificar.provisional, true)
        || igual('todo verificado', verificado.provisional, false);
    },
  },
  {
    nombre: 'determinismo: misma entrada → misma salida',
    correr: function () {
      var row = { origen_iata: 'EZE', destino_iata: 'MAD', aerolinea: 'Iberia', incidentes: ['demora'], demora_llegada_min: 200, fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora' };
      return JSON.stringify(analizarRow(row)) === JSON.stringify(analizarRow(row))
        ? null : 'dos corridas con la misma entrada dieron salidas distintas';
    },
  },
  {
    nombre: 'nunca lanza: caso vacío, nulos y datos basura',
    correr: function () {
      var entradas = [{}, null, undefined, { incidentes: 'no-es-array' }, { origen_iata: 123, incidentes: ['inventado'] }, { protesta: 'texto' }, { segmentos: [null, {}] }, { campos_meta: 'texto' }];
      for (var i = 0; i < entradas.length; i++) {
        try { analizarRow(entradas[i]); } catch (e) { return 'lanzó con la entrada ' + i + ': ' + e.message; }
      }
      try { analizar(null, null, null); } catch (e) { return 'analizar(null, null, null) lanzó: ' + e.message; }
      return null;
    },
  },
  {
    nombre: 'caso vacío: todo FALTA_DATO, ningún marco activo, cero reclamables',
    correr: function () {
      var a = analizarRow({});
      return igual('marcos_activos', a.resumen.marcos_activos, [])
        || igual('categorias_reclamables', a.resumen.categorias_reclamables, 0)
        || igual('monto_tarifado_total', a.resumen.monto_tarifado_total, [])
        || (a.faltan_datos.length > 0 ? null : 'faltan_datos quedó vacío');
    },
  },
  {
    nombre: 'toda categoría y todo gate llevan base_legal no vacía (§2 regla 7)',
    correr: function () {
      var filas = [
        {},
        { origen_iata: 'EZE', destino_iata: 'MAD', aerolinea: 'Iberia', incidentes: ['demora', 'equipaje_dano'], demora_llegada_min: 400, demora_salida_min: 400, fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora', protesta: { realizada: 'si', medio: 'pir', fecha: '2026-05-03' } },
        { origen_iata: 'AEP', destino_iata: 'COR', incidentes: ['cancelacion', 'downgrade', 'muerte_lesion', 'conexion_perdida', 'denegacion_embarque'], antelacion_aviso_dias: 2, fecha_incidente: '2026-01-01', billete_unico: false, demora_llegada_min: 500, demora_salida_min: 500, checkin_presentacion: 'en_hora' },
        { origen_iata: 'JFK', destino_iata: 'GRU', aerolinea: 'American Airlines', incidentes: ['equipaje_perdida'], fecha_incidente: '2026-02-02', protesta: { realizada: 'no' } },
        { origen_iata: 'MAD', destino_iata: 'JFK', aerolinea: 'British Airways', incidentes: ['demora'], demora_llegada_min: 400, demora_salida_min: 400, fecha_incidente: '2026-03-03', billete_unico: true, checkin_presentacion: 'en_hora' },
      ];
      var vacias = [], errores = [], nCat = 0, nGate = 0;
      filas.forEach(function (row, i) {
        var a = analizarRow(row);
        (a.avisos || []).forEach(function (x) { if (x.indexOf('error en la regla') === 0) errores.push('fila ' + i + ': ' + x); });
        (a.marcos || []).forEach(function (m) {
          (m.gates || []).forEach(function (g) { nGate++; if (!g.base_legal) vacias.push('fila ' + i + ' gate ' + m.marco + '.' + g.gate); });
          (m.categorias || []).forEach(function (cc) { nCat++; if (!cc.base_legal) vacias.push('fila ' + i + ' cat ' + m.marco + '.' + cc.categoria); });
        });
      });
      if (errores.length) return 'una regla del ruleset lanzó: ' + errores.join(' | ');
      if (vacias.length) return 'base_legal vacía en: ' + vacias.join(', ');
      if (nCat < 20) return 'solo se revisaron ' + nCat + ' categorías, el barrido no cubrió lo esperado';
      return null;
    },
  },
  {
    nombre: 'el evaluador no tiene ningún umbral legal hardcodeado',
    correr: function () {
      /* Todo número con consecuencia legal tiene que vivir en el ruleset. Si alguno se
         filtra al evaluador, se rompe la premisa de "un archivo por vigencia". */
      var src = readFileSync(join(RAIZ, 'api', '_utils', 'motor-legal.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/'[^']*'/g, "''");
      var UMBRALES_LEGALES = [120, 125, 180, 200, 240, 250, 300, 400, 600, 1500, 3500, 14, 21, 30, 40, 50, 60, 75, 1000];
      var hallados = UMBRALES_LEGALES.filter(function (n) {
        return new RegExp('(?<![\\w.])' + n + '(?![\\w.])').test(src);
      });
      return hallados.length ? 'aparecen umbrales legales en motor-legal.js: ' + hallados.join(', ') : null;
    },
  },
  {
    nombre: 'prescripción: días corridos y suma de años en UTC',
    correr: function () {
      return igual('días corridos', diasCorridos('2026-05-01', '2026-05-20'), 19)
        || igual('cruce de mes', diasCorridos('2026-01-30', '2026-02-02'), 3)
        || igual('fecha inválida', diasCorridos('no-fecha', '2026-05-20'), null)
        || igual('+1 año', sumarAnios('2026-05-10', 1), '2027-05-10')
        || igual('+2 años', sumarAnios('2026-05-10', 2), '2028-05-10')
        /* 29-feb + 1 año cae el 1-mar por normalización de Date. Documentado. */
        || igual('29-feb +1 año', sumarAnios('2024-02-29', 1), '2025-03-01');
    },
  },
  {
    nombre: 'EU261 nunca emite fecha de prescripción (Pin 7)',
    correr: function () {
      var a = analizarRow({ origen_iata: 'EZE', destino_iata: 'MAD', aerolinea: 'Iberia', incidentes: ['demora'], demora_llegada_min: 400, fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora' });
      var p = buscarMarco(a, 'EU261').prescripcion;
      return igual('tipo', p.tipo, 'segun_foro')
        || igual('computable', p.computable, false)
        || igual('fecha_limite', p.fecha_limite, null)
        /* Con overlay Montreal sí se emite el piso concreto, marcado como piso. */
        || igual('piso conservador', p.piso_conservador && p.piso_conservador.fecha_limite, '2028-05-10');
    },
  },
  {
    nombre: 'los montos simbólicos (AO/SDR) no entran al total tarifado (§2 regla 6)',
    correr: function () {
      var a = analizarRow({
        origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
        incidentes: ['equipaje_perdida'], fecha_incidente: '2026-05-01',
        protesta: { realizada: 'si', medio: 'pir', fecha: '2026-05-02' },
        billete_unico: true, checkin_presentacion: 'en_hora',
      });
      /* Fecha de 2026 → rige el Reglamento 809/2024, no la Res. 1532 (derogada). Lo que
         prueba este caso es la regla 6 del §2, que no cambió entre vigencias. */
      var cat = buscarCategoria(a, 'REGL809.equipaje');
      return igual('estado', cat && cat.estado, 'RECLAMABLE')
        || igual('cantidad pendiente', cat && cat.monto && cat.monto.cantidad_pendiente, true)
        || igual('sin valor numérico', cat && cat.monto && cat.monto.valor, undefined)
        || igual('total tarifado vacío', a.resumen.monto_tarifado_total, []);
    },
  },
  {
    nombre: 'seleccionarRuleset elige por fecha del incidente',
    correr: function () {
      return igual('dentro de vigencia', seleccionarRuleset('2026-05-10').version, '2024-10-10')
        || igual('sin fecha', seleccionarRuleset(null).version, '2024-10-10');
    },
  },
  {
    /* La 1532 fue derogada por el Dec. 809/2024, en vigor el 10-oct-2024 (Art. 7). El
       borde tiene que ser exacto: un incidente del 9 se juzga con la norma vieja, uno del
       10 con la nueva. Es ley al momento del hecho, no fecha de carga del caso. */
    nombre: 'partición de vigencia AR: el 9-oct-2024 es 1532 y el 10-oct-2024 es 809/2024',
    correr: function () {
      return igual('9-oct-2024 → IV-A', seleccionarRuleset('2024-10-09').version, '2026-06-19')
        || igual('10-oct-2024 → IV-B', seleccionarRuleset('2024-10-10').version, '2024-10-10')
        || igual('marco AR de IV-A', seleccionarRuleset('2024-10-09').marcos.some(function (m) { return m.marco === 'RES1532'; }), true)
        || igual('marco AR de IV-B', seleccionarRuleset('2024-10-10').marcos.some(function (m) { return m.marco === 'REGL809'; }), true)
        /* EU261 y Montreal son los mismos objetos en las dos vigencias: si alguien los
           duplica en vez de importarlos, esto se cae. */
        || igual('EU261 compartido', seleccionarRuleset('2024-10-09').marcos.filter(function (m) { return m.marco === 'EU261'; })[0]
          === seleccionarRuleset('2024-10-10').marcos.filter(function (m) { return m.marco === 'EU261'; })[0], true);
    },
  },
  {
    /* El cambio material del Reglamento: el alojamiento pasó de deberse a las 4 h a
       deberse a las 8 h. Mismo caso, un día de diferencia, resultado distinto. */
    nombre: 'partición de vigencia: demora de 6 h da alojamiento en IV-A y no en IV-B',
    correr: function () {
      function correrCon(fecha) {
        return analizarRow({
          origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
          incidentes: ['demora'], demora_salida_min: 360, fecha_incidente: fecha,
          billete_unico: true, checkin_presentacion: 'en_hora',
        });
      }
      var vieja = buscarCategoria(correrCon('2024-10-09'), 'RES1532.servicios_incidentales');
      var nueva = buscarCategoria(correrCon('2024-10-10'), 'REGL809.servicios_incidentales');
      /* El motor emite UNA categoría de incidentales, así que el escalón se lee en la
         cita: bajo la 1532 el Art. 12 incluye el alojamiento desde las 4 h; bajo el
         Reglamento, 6 h caen en el inciso b (comidas) y el alojamiento es el inciso c. */
      var nueveHoras = buscarCategoria(analizarRow({
        origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
        incidentes: ['demora'], demora_salida_min: 540, fecha_incidente: '2024-10-10',
        billete_unico: true, checkin_presentacion: 'en_hora',
      }), 'REGL809.servicios_incidentales');
      return igual('IV-A: reclamable', vieja && vieja.estado, 'RECLAMABLE')
        || igual('IV-A: Art. 12 de la 1532', /Res\. 1532\/98 Art\. 12/.test((vieja && vieja.base_legal) || ''), true)
        || igual('IV-B a las 6 h: reclamable', nueva && nueva.estado, 'RECLAMABLE')
        || igual('IV-B a las 6 h: inciso b (comidas)', /Art\. 43 inc\. b/.test((nueva && nueva.base_legal) || ''), true)
        || igual('IV-B a las 9 h: inciso c (alojamiento)', /Art\. 43 inc\. c/.test((nueveHoras && nueveHoras.base_legal) || ''), true);
    },
  },
  {
    /* D4: por debajo de 4 h el Reglamento no obliga a nada SALVO que la espera caiga entre
       las 00:00 y las 06:00, y la hora programada de partida no existe en el intake. El
       motor no puede presumir que no fue nocturno. */
    nombre: 'D4: demora ≤ 4 h en IV-B → FALTA_DATO por la hora de partida, no NO_APLICA',
    correr: function () {
      var a = analizarRow({
        origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
        incidentes: ['demora'], demora_salida_min: 180, fecha_incidente: '2026-05-10',
        billete_unico: true, checkin_presentacion: 'en_hora',
      });
      var cat = buscarCategoria(a, 'REGL809.servicios_incidentales');
      return igual('estado', cat && cat.estado, 'FALTA_DATO')
        || igual('dato_faltante', cat && cat.dato_faltante, 'hora_salida_programada')
        /* Las otras bandas no dependen de la hora: no se contaminan. */
        || igual('el reintegro sigue determinista', buscarCategoria(a, 'REGL809.reintegro').estado, 'NO_APLICA');
    },
  },
  {
    /* Art. 42: la reprogramación es tipo propio del Reglamento y tiene sus excepciones. */
    nombre: 'reprogramación con aviso de 10 días y alternativo → sin incidentales (Art. 42 ii)',
    correr: function () {
      function conAviso(dias, ofrecido) {
        return buscarCategoria(analizarRow({
          origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
          incidentes: ['reprogramacion'], antelacion_aviso_dias: dias,
          reencaminamiento: { ofrecido: ofrecido }, fecha_incidente: '2026-05-10',
          billete_unico: true, checkin_presentacion: 'en_hora',
        }), 'REGL809.servicios_incidentales');
      }
      return igual('10 días + alternativo → exceptuado', conAviso(10, true).estado, 'NO_APLICA')
        || igual('20 días → exceptuado por antelación', conAviso(20, false).estado, 'NO_APLICA')
        /* Sin alternativo y con menos de 2 semanas el derecho existe; cuál escalón del
           Art. 43 corresponde depende de la demora efectiva, que acá no se sabe. Que
           falte el escalón no puede borrar el derecho. */
        || igual('10 días sin alternativo → hay derecho', conAviso(10, false).estado, 'RECLAMABLE');
    },
  },
  {
    /* Aritmética de la prescripción. Nada de criterio legal acá: el plazo y su punto de
       arranque los fija el documento; esto verifica que la CONSECUENCIA aritmética sea
       coherente y que el cómputo del Reglamento (exclusión del dies a quo) esté aplicado.
       Sin esto, un caso dorado puede estar prescripto hace más de un año y el test no se
       entera, porque `vencida` y `dias_restantes` no están en ningún `esperado`. */
    nombre: 'prescripción: vencida y dias_restantes son coherentes con fecha_limite y hoy',
    correr: function () {
      var fila = {
        origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
        incidentes: ['demora'], demora_salida_min: 300, fecha_incidente: '2024-05-10',
        billete_unico: true, checkin_presentacion: 'en_hora',
      };
      var caso = norm(fila);
      function presc(hoy) {
        var a = analizar(caso, seleccionarRuleset(caso.fecha_incidente), hoy);
        return a.marcos.filter(function (m) { return m.marco === 'RES1532'; })[0].prescripcion;
      }
      var limite = presc('2024-05-11').fecha_limite;
      var antes = presc('2025-04-10');   // un mes antes del vencimiento
      var justo = presc(limite);         // el último día
      var despues = presc('2025-06-10'); // un mes después

      return igual('la fecha límite no depende de hoy', presc('2030-01-01').fecha_limite, limite)
        /* Pin 5: días corridos, vencimiento a las 24:00 del ÚLTIMO día. El día del
           vencimiento todavía no está vencido. */
        || igual('antes: no vencida', antes.vencida, false)
        || igual('antes: dias_restantes = distancia real a la fecha límite', antes.dias_restantes, diasCorridos('2025-04-10', limite))
        || igual('el último día: 0 días restantes', justo.dias_restantes, 0)
        || igual('el último día: todavía NO vencida (24:00 del último día)', justo.vencida, false)
        || igual('después: vencida', despues.vencida, true)
        || igual('después: dias_restantes negativo', despues.dias_restantes < 0, true);
    },
  },
  {
    /* Exclusión del dies a quo (Anexo I Art. 1, def. DÍAS): en IV-B el plazo arranca al día
       SIGUIENTE del hecho, así que la fecha límite corre exactamente un día respecto del
       mismo cómputo bajo la 1532. Para aislar esa única variable se corre el MISMO caso
       —misma fecha de incidente— contra los dos rulesets, pasando el ruleset a mano. La
       combinación es deliberadamente sintética: sirve para medir el corrimiento, no para
       afirmar que un incidente post-809 pueda juzgarse con la norma derogada. */
    nombre: 'prescripción: la exclusión del dies a quo corre la fecha límite un día en IV-B',
    correr: function () {
      var fila = {
        origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
        incidentes: ['demora'], demora_salida_min: 300, fecha_incidente: '2025-03-01',
        billete_unico: true, checkin_presentacion: 'en_hora',
      };
      var caso = norm(fila);
      function limiteCon(version, marco) {
        var rs = seleccionarRuleset(version === '2026-06-19' ? '2024-10-09' : '2024-10-10');
        var a = analizar(caso, rs, HOY);
        var m = a.marcos.filter(function (x) { return x.marco === marco; })[0];
        return m.prescripcion.fecha_limite;
      }
      var iva = limiteCon('2026-06-19', 'RES1532');
      var ivb = limiteCon('2024-10-10', 'REGL809');
      return igual('IV-A: un año exacto desde el hecho', iva, sumarAnios('2025-03-01', 1))
        || igual('IV-B: un día más', diasCorridos(iva, ivb), 1);
    },
  },
  {
    /* D3: en un billete redondo el destino contractual es el PUNTO DE PARTIDA, no el
       último aeropuerto. Es lo que decide el foro, y es un plano distinto del de la
       dirección afectada, que sigue siendo la unidad de la admisibilidad. */
    nombre: 'destino contractual: en ida y vuelta es el punto de partida (D3)',
    correr: function () {
      var redondo = analizarRow({
        billete_unico: true, incidentes: ['cancelacion'], antelacion_aviso_dias: 2,
        fecha_incidente: '2026-05-24', checkin_presentacion: 'no_aplica',
        segmentos: [
          { orden: 1, origen_iata: 'EZE', destino_iata: 'MAD', carrier_operante: 'Iberia', fecha: '2026-05-10' },
          { orden: 2, origen_iata: 'MAD', destino_iata: 'EZE', carrier_operante: 'Iberia', fecha: '2026-05-24', afectado: true },
        ],
      });
      var soloIda = analizarRow({
        billete_unico: true, incidentes: ['cancelacion'], antelacion_aviso_dias: 2,
        fecha_incidente: '2026-05-10', checkin_presentacion: 'no_aplica',
        segmentos: [{ orden: 1, origen_iata: 'EZE', destino_iata: 'MAD', carrier_operante: 'Iberia', fecha: '2026-05-10', afectado: true }],
      });
      /* Doméstico cargado solo con las columnas sueltas: el foro interno no depende del
         destino contractual, así que igual hay respuesta. */
      var domesticoSinSegmentos = analizarRow({
        origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
        incidentes: ['demora'], demora_salida_min: 300, fecha_incidente: '2026-05-10',
        billete_unico: true, checkin_presentacion: 'en_hora',
      });
      /* Internacional sin segmentos: sin billete no hay destino contractual, y de él
         dependen los cuatro foros del Art. 33. */
      var sinSegmentos = analizarRow({
        origen_iata: 'EZE', destino_iata: 'MAD', aerolinea: 'Iberia',
        incidentes: ['demora'], demora_salida_min: 300, fecha_incidente: '2026-05-10',
        billete_unico: true, checkin_presentacion: 'en_hora',
      });
      return igual('redondo → destino contractual EZE', redondo.jurisdiccion.destino_contractual.iata, 'EZE')
        || igual('redondo → foro garantizado', redondo.jurisdiccion.foro_argentino, 'garantizado')
        /* Solo ida saliendo de AR con carrier extranjero: el foro depende del canal de
           emisión, así que no se afirma más de lo que se sabe. */
        || igual('solo ida → destino contractual MAD', soloIda.jurisdiccion.destino_contractual.iata, 'MAD')
        || igual('solo ida → foro posible', soloIda.jurisdiccion.foro_argentino, 'posible')
        || igual('internacional sin segmentos → no computable', sinSegmentos.jurisdiccion.foro_argentino, 'no_computable')
        || igual('doméstico sin segmentos → igual garantizado', domesticoSinSegmentos.jurisdiccion.foro_argentino, 'garantizado')
        || igual('y sin destino contractual', domesticoSinSegmentos.jurisdiccion.destino_contractual, null)
        /* Y nunca es gate: el bloque informa, no bloquea ninguna categoría. */
        || igual('no bloquea categorías', buscarCategoria(soloIda, 'EU261.reembolso').estado, 'RECLAMABLE');
    },
  },
  {
    /* D2: la sanción de caducidad doméstica no sobrevivió textualmente a la derogación del
       Art. 20 b. En internacional la aporta Montreal Art. 31(4), que es expresa. */
    nombre: 'gate D2: protesto fuera de plazo es inadmisible en internacional y provisional en doméstico',
    correr: function () {
      function gateDe(a, nombre) {
        var m = (a.marcos || []).filter(function (x) { return x.marco === 'REGL809'; })[0];
        return ((m && m.gates) || []).filter(function (g) { return g.gate === nombre; })[0];
      }
      var domestico = analizarRow({
        origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
        incidentes: ['equipaje_perdida'], fecha_incidente: '2026-05-01',
        protesta: { realizada: 'si', medio: 'escrita', fecha: '2026-05-20' },
        billete_unico: true, checkin_presentacion: 'en_hora',
      });
      var internacional = analizarRow({
        origen_iata: 'EZE', destino_iata: 'MAD', aerolinea: 'Iberia',
        incidentes: ['equipaje_perdida'], fecha_incidente: '2026-05-01',
        protesta: { realizada: 'si', medio: 'escrita', fecha: '2026-05-30' },
        billete_unico: true, checkin_presentacion: 'en_hora',
      });
      return igual('doméstico fuera de plazo → pasa provisional', gateDe(domestico, 'protesto').resultado, 'pasa_provisional')
        || igual('y no mata la categoría', buscarCategoria(domestico, 'REGL809.equipaje').estado, 'RECLAMABLE')
        || igual('emite el nodo de la sanción', (domestico.nodos_eval || []).some(function (n) { return n.nodo === 'sancion_caducidad_domestica'; }), true)
        || igual('internacional fuera de plazo → inadmisible', gateDe(internacional, 'protesto').resultado, 'inadmisible')
        || igual('y mata la categoría', buscarCategoria(internacional, 'REGL809.equipaje').estado, 'NO_APLICA');
    },
  },
];

/* ------------------------------------------------------------------ */
/* Ejecución                                                           */
/* ------------------------------------------------------------------ */

var okCount = 0, failCount = 0, skipCount = 0;
var fallas = [];

console.log('\n' + negrita('Motor legal Capa 1') + gris('  ·  hoy = ' + HOY) + (FILTRO ? gris('  ·  filtro: ' + FILTRO) : ''));

console.log('\n' + negrita('Unitarios'));
UNITARIOS.forEach(function (u) {
  var motivo;
  try { motivo = u.correr(); } catch (e) { motivo = 'lanzó: ' + e.message; }
  if (motivo) {
    failCount++; fallas.push({ id: u.nombre, difs: [motivo] });
    console.log('  ' + rojo('✗') + ' ' + u.nombre);
    console.log('      ' + rojo(motivo));
  } else {
    okCount++;
    console.log('  ' + verde('✓') + ' ' + u.nombre);
  }
});

console.log('\n' + negrita('Casos dorados'));
CASOS.forEach(function (cd) {
  if (FILTRO && cd.id.indexOf(FILTRO) === -1 && (cd.descripcion || '').indexOf(FILTRO) === -1) return;

  var esp = cd.esperado || {};
  if (!Object.keys(esp).length) {
    skipCount++;
    console.log('  ' + amarillo('○ TODO-JPA') + ' ' + cd.id + gris(' — ' + cd.descripcion));
    console.log('      ' + amarillo('sin `esperado`: completar JPA — criterio legal'));
    return;
  }

  var r;
  try {
    r = correrCaso(cd);
  } catch (e) {
    failCount++; fallas.push({ id: cd.id, difs: ['el motor lanzó: ' + e.message] });
    console.log('  ' + rojo('✗') + ' ' + cd.id + gris(' — ' + cd.descripcion));
    console.log('      ' + rojo('el motor lanzó: ' + e.message));
    return;
  }

  var difs = verificarEsperado(r.analisis, esp);
  if (difs.length) {
    failCount++; fallas.push({ id: cd.id, difs: difs });
    console.log('  ' + rojo('✗') + ' ' + cd.id + gris(' — ' + cd.descripcion));
    difs.forEach(function (d) { console.log('      ' + rojo(d)); });
  } else {
    okCount++;
    console.log('  ' + verde('✓') + ' ' + cd.id + gris(' — ' + cd.descripcion));
  }
  if (VERBOSE) console.log(gris(JSON.stringify(r.analisis, null, 2).replace(/^/gm, '      ')));
});

console.log('\n' + negrita('Resumen'));
console.log('  ' + verde(okCount + ' ok') + '   ' + (failCount ? rojo(failCount + ' fallan') : gris('0 fallan')) + '   ' + (skipCount ? amarillo(skipCount + ' TODO-JPA') : gris('0 TODO-JPA')));

if (skipCount) {
  console.log(gris('  Los TODO-JPA no cuentan como falla: son cobertura reservada del §5 esperando criterio legal.'));
}

if (failCount) {
  console.log('\n' + rojo(negrita('Fallan:')));
  fallas.forEach(function (f) {
    console.log('  ' + rojo(f.id));
    f.difs.forEach(function (d) { console.log('    · ' + d); });
  });
  console.log('');
  process.exit(1);
}

console.log('');
process.exit(0);
