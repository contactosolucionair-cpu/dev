/**
 * api/_utils/rulesets/2026-06-19.js — régimen AR IV-A (Res. ANAC 1532/98)
 *
 * Reglas legales como DATOS. Incidentes HASTA EL 9-OCT-2024: la Res 1532/98 fue
 * derogada por el Decreto 809/2024 y este archivo queda como *ley al momento del*
 * *hecho* (v2.2, Parte IV-A). Los incidentes desde el 10-oct-2024 los toma
 * `2024-10-10.js`.
 *
 * El nombre del archivo es la fecha de la VERSIÓN del documento legal que lo originó
 * (v2.1, 19-jun-2026), no la de su vigencia; el ruleset nuevo, en cambio, se llama por
 * la fecha en que empieza a regir. Se mantiene el nombre para no romper la trazabilidad
 * de los commits del ciclo del motor: la vigencia real es la que declara `vigencia`.
 *
 * Acá vive SOLO el bloque argentino. EU261, Montreal, DOT y ANAC 400 se importan de
 * `_compartido.js`: no cambian entre vigencias del régimen AR.
 *
 * Fuente legal: docs/Capa_1_-_Logica_legal_determinista_v2.2.md, Parte IV-A.
 * Ambigüedades no resueltas: docs/motor-capa1-pendientes-legales.md.
 * Acá NO se inventa regla: donde el documento no decide, se emite FALTA_DATO o un
 * nodo [REQUIERE EVALUACIÓN].
 */
import {
  UMBRALES_COMPARTIDOS, MARCOS_COMPARTIDOS,
  NODO, nodoCon, tiene, algunEquipaje, parteDe, tocaPais,
} from './_compartido.js';

/* ================================================================== */
/* UMBRALES — bloque argentino de la Res. 1532/98                      */
/* ================================================================== */

export var UMBRALES_AR = {

  /* Art. 12: gatillo del régimen de disrupción por demora. Pin 2: se mide en la SALIDA,
     porque es la espera en el aeropuerto lo que genera la necesidad de asistencia. */
  ar_demora_gatillo_salida_min: 240,

  /* Art. 20 a: plazos de protesta en días CORRIDOS (Pin 5), con vencimiento a las 24:00
     del último día. El plazo depende del tipo de incidente y de si el transporte es
     internacional. */
  ar_protesta_dias: {
    dano:    { interno: 3,  internacional: 7 },   // desde la entrega
    perdida: { interno: 10, internacional: 21 },  // desde que debió ponerse a disposición
  },

  /* Art. 19 a + Código Aeronáutico: topes en Argentinos Oro del transporte INTERNO.
     El valor del AO es un input de cuantificación diferido (BCRA, trimestral): el motor
     emite la unidad y la fórmula, nunca un monto en pesos. */
  ar_topes_ao: {
    equipaje_registrado_por_kg: 2,
    equipaje_mano_por_pasajero: 40,
    muerte_lesion_por_pasajero: 1000,
  },

  /* Art. 13 c: cargo por cancelación imputable al pasajero. */
  ar_cargo_cancelacion_pasajero_pct: { mas_24h: 10, menos_24h: 20 },

  /* --- Prescripción del régimen interno (días corridos, Pin 5) --- */
  prescripcion_ar_interno_anios: 1,          // Cód. Aeronáutico Art. 228 inc. 1 y 4
};

/* Umbrales que ve el evaluador: los compartidos más el bloque argentino de ESTA
   vigencia. Las reglas reciben todo junto en `U`, como hasta ahora. */
export var UMBRALES = Object.assign({}, UMBRALES_COMPARTIDOS, UMBRALES_AR);

/* ================================================================== */
/* `reprogramacion` bajo la 1532: tipo sin régimen                     */
/* ================================================================== */

/* El dominio de `incidentes` incluye `reprogramacion` desde la decisión D1 (v2.2), pero el
   tipo propio lo crea el Art. 42 del Reglamento Dec. 809/2024. Bajo la 1532 sigue rigiendo
   la v2.1.1: la reprogramación se caracteriza como cancelación. El editor del drawer
   muestra el dominio completo, así que un caso de esta vigencia puede llegar con el tipo
   cargado; se dice por qué no aplica en vez de tratarlo como "ningún incidente". */
function soloReprogramacion(caso) {
  return tiene(caso, 'reprogramacion')
    && !tiene(caso, 'cancelacion') && !tiene(caso, 'demora')
    && !tiene(caso, 'denegacion_embarque') && !tiene(caso, 'conexion_perdida');
}

var MOTIVO_REPROGRAMACION = 'Tipo sin régimen en la Res. 1532/98 — v2.1.1: para incidentes anteriores al 10-oct-2024 la reprogramación se caracteriza como cancelación, no como tipo propio (el régimen propio lo crea el Art. 42 del Reglamento Dec. 809/2024, vigente desde esa fecha). Si el vuelo contratado no se realizó, cargá `cancelacion`.';

function motivoSinIncidente(que, caso) {
  return soloReprogramacion(caso) ? MOTIVO_REPROGRAMACION : ('Ningún incidente del caso activa ' + que);
}

/* ================================================================== */
/* MARCO — Argentina (Res. ANAC 1532/98)                               */
/* ================================================================== */

var MARCO_RES1532 = {
  marco: 'RES1532',

  test: function (caso) {
    var base = 'Res. ANAC 1532/98 Art. 1 (ámbito) — Test D del ruteo';
    if (caso.internacional == null || !caso.origen) {
      return {
        aplica: 'falta_dato',
        activado_por: 'No se pudo determinar el itinerario (doméstico AR o internacional que parte de AR)',
        base_legal: base,
        dato_faltante: 'origen_iata / destino_iata',
      };
    }
    var domesticoAR = caso.internacional === false && parteDe(caso, 'AR');
    if (domesticoAR) {
      return { aplica: 'si', via: 'D-domestico', activado_por: 'Test D: vuelo doméstico argentino', base_legal: base };
    }
    if (caso.internacional === true && parteDe(caso, 'AR')) {
      return {
        aplica: 'si',
        via: 'D-internacional',
        activado_por: 'Test D: vuelo internacional que parte de Argentina (' + caso.origen.iata + ')',
        base_legal: base,
        nota: 'Siendo internacional, se activa además el overlay Montreal (Test E).',
      };
    }
    return {
      aplica: 'no',
      activado_por: 'Test D: el vuelo no es doméstico argentino ni internacional partiendo de Argentina',
      base_legal: base,
    };
  },

  gates: [{
    gate: 'protesta',
    /* Art. 20 a: condición de admisibilidad del reclamo por equipaje. Se declara con
       alcance sobre las categorías de equipaje: el v2.1 lo ubica en AR-B6 (equipaje) y
       extenderlo a la disrupción de pasajeros mataría reclamos ajenos al equipaje.
       Ambigüedad de "toda acción" (Art. 20 b) registrada en los pendientes. */
    alcance: ['equipaje'],
    aplica: function (caso) { return algunEquipaje(caso); },
    consume: function () { return ['protesta', 'fecha_incidente', 'incidentes']; },
    evaluar: function (caso, U, ctx) {
      var base = 'Res. ANAC 1532/98 Art. 20 a (protesta) y 20 b (inadmisibilidad)';
      /* El plazo depende del tipo de incidente: daño desde la entrega; pérdida,
         destrucción o retardo desde que el equipaje debió ponerse a disposición. */
      var esDano = tiene(caso, 'equipaje_dano');
      var tabla = esDano ? U.ar_protesta_dias.dano : U.ar_protesta_dias.perdida;
      var intl = caso.internacional;
      if (intl == null) {
        return { resultado: 'falta_dato', detalle: 'No se sabe si el transporte es internacional, y el plazo difiere', base_legal: base, dato_faltante: 'origen_iata / destino_iata' };
      }
      var plazo = intl ? tabla.internacional : tabla.interno;
      var detallePlazo = plazo + ' días corridos (' + (esDano ? 'daño' : 'pérdida, destrucción o retardo') + ', transporte ' + (intl ? 'internacional' : 'interno') + ')';

      var p = caso.protesta;
      if (!p || !p.realizada || p.realizada === 'desconocido') {
        return { resultado: 'falta_dato', detalle: 'No se sabe si hubo protesta. Plazo aplicable: ' + detallePlazo, base_legal: base, dato_faltante: 'protesta' };
      }
      if (p.realizada === 'no') {
        return { resultado: 'inadmisible', detalle: 'Sin protesta: la omisión en plazo torna inadmisible la acción (salvo fraude). Plazo aplicable: ' + detallePlazo, base_legal: base };
      }
      if (!p.fecha) {
        return { resultado: 'falta_dato', detalle: 'Protesta declarada pero sin fecha: el plazo de ' + detallePlazo + ' no se puede computar', base_legal: base, dato_faltante: 'protesta.fecha' };
      }
      if (!caso.fecha_incidente) {
        return { resultado: 'falta_dato', detalle: 'Sin fecha del incidente no se puede computar el plazo de protesta', base_legal: base, dato_faltante: 'fecha_incidente' };
      }
      var dias = ctx.diasCorridos(caso.fecha_incidente, p.fecha);
      if (dias == null) {
        return { resultado: 'falta_dato', detalle: 'Fechas no interpretables para computar el plazo de protesta', base_legal: base, dato_faltante: 'protesta.fecha' };
      }
      if (dias > plazo) {
        return {
          resultado: 'inadmisible',
          detalle: 'Protesta a los ' + dias + ' días, fuera del plazo de ' + detallePlazo + '. Vencimiento a las 24:00 del último día (Pin 5)',
          base_legal: base,
        };
      }
      /* Pin 3: el gate se computa con la fecha de cualquier protesta, PIR incluido. Si
         SOLO hay PIR, pasa provisionalmente y se emite el nodo EVAL. */
      if (p.medio === 'pir') {
        return {
          resultado: 'pasa_provisional',
          detalle: 'PIR de aeropuerto a los ' + dias + ' días, dentro del plazo de ' + detallePlazo + '. La equivalencia PIR = protesta tiene jurisprudencia dividida',
          base_legal: base + ' + Convenio de Montreal Art. 31',
          nodos_eval: [nodoCon(NODO.suficiencia_protesta_pir, 'RES1532', 'Solo consta PIR' + (p.numero ? ' Nº ' + p.numero : '') + ', sin protesta escrita posterior')],
        };
      }
      return {
        resultado: 'pasa',
        detalle: 'Protesta escrita a los ' + dias + ' días, dentro del plazo de ' + detallePlazo,
        base_legal: base,
      };
    },
  }],

  categorias: [
    {
      categoria: 'compensacion_tarifada',
      base_legal: 'La Res. 1532/98 no tarifa compensación: la "compensación por embarque denegado" remite a las regulaciones del transportador (Art. 12 inc. a)',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        if (tiene(caso, 'denegacion_embarque')) {
          return {
            estado: 'REQUIERE_EVALUACION',
            eval_nodo: NODO.compensacion_embarque_denegado.nodo,
            base_legal: 'Res. 1532/98 Art. 12 inc. a (mod. Res. ANAC 203/2013)',
            nota: 'No tarifada por la norma: depende de las regulaciones publicadas del transportador. La aceptación voluntaria y expresa de esa compensación implica renuncia a reclamo posterior, salvo los incidentales.',
            nodos_eval: [nodoCon(NODO.compensacion_embarque_denegado, 'RES1532')],
          };
        }
        return {
          estado: 'NO_APLICA',
          motivo: 'El régimen argentino no tarifa compensación por disrupción',
          base_legal: 'Res. ANAC 1532/98 (no tarifa compensación)',
        };
      },
    },

    {
      categoria: 'reintegro',
      base_legal: 'Res. 1532/98 Arts. 12 y 13: reintegro completo si ningún tramo fue realizado, proporcional si un tramo fue realizado',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        if (tiene(caso, 'cancelacion') || tiene(caso, 'denegacion_embarque') || tiene(caso, 'conexion_perdida') || tiene(caso, 'demora')) {
          return {
            estado: 'RECLAMABLE',
            base_legal: 'Res. 1532/98 Art. 13 inc. b',
            nota: 'Derecho determinista. Completo (ningún tramo realizado) o proporcional (un tramo realizado); el monto es cuantificación, no esta capa.',
          };
        }
        return { estado: 'NO_APLICA', motivo: motivoSinIncidente('el reintegro', caso), base_legal: 'Res. 1532/98 Art. 13' };
      },
    },

    {
      categoria: 'reencaminamiento_endoso',
      base_legal: 'Res. 1532/98 Art. 12: inclusión en el vuelo inmediato posterior del mismo transportador, endoso del contrato (incluidas conexiones) o reencaminamiento por otra ruta, transportador o medio',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        if (tiene(caso, 'cancelacion') || tiene(caso, 'denegacion_embarque') || tiene(caso, 'conexion_perdida') || tiene(caso, 'demora')) {
          return { estado: 'RECLAMABLE', base_legal: 'Res. 1532/98 Art. 12 (mod. Res. ANAC 203/2013)', nota: 'Derecho determinista.' };
        }
        return { estado: 'NO_APLICA', motivo: motivoSinIncidente('el reencaminamiento o endoso', caso), base_legal: 'Res. 1532/98 Art. 12' };
      },
    },

    {
      categoria: 'servicios_incidentales',
      base_legal: 'Res. 1532/98 Art. 12 (post Res. ANAC 203/2013): comunicación telefónica o cablegráfica al destino y comunicaciones locales, comidas y refrigerios según el tiempo de espera, alojamiento cuando la demora de salida exceda 4 h, y transporte terrestre desde y hacia el aeropuerto',
      consume: function (caso) {
        /* Pin 2: en demora el gatillo se mide en la SALIDA. Cancelación, denegación y
           pérdida de conexión activan el régimen sin umbral de tiempo. */
        return tiene(caso, 'demora') && !tiene(caso, 'cancelacion') && !tiene(caso, 'denegacion_embarque') && !tiene(caso, 'conexion_perdida')
          ? ['incidentes', 'demora_salida_min']
          : ['incidentes'];
      },
      evaluar: function (caso, U) {
        var nodos = [
          nodoCon(NODO.causa_disrupcion, 'RES1532', caso.causa_alegada ? 'Causa alegada: ' + caso.causa_alegada : 'Sin causa alegada registrada'),
          nodoCon(NODO.suficiencia_probatoria, 'RES1532', 'Gastos itemizados cargados: ' + (caso.gastos_items || []).length),
        ];
        var notaMeteo = 'Exención meteorológica (Res. 203/2013): si la causa es meteorológica el transportador no debe incidentales, pero subsiste el deber de información veraz. El monto son los gastos reales razonables.';

        if (tiene(caso, 'cancelacion') || tiene(caso, 'denegacion_embarque') || tiene(caso, 'conexion_perdida')) {
          return {
            estado: 'RECLAMABLE',
            base_legal: 'Res. 1532/98 Art. 12 (mod. Res. ANAC 203/2013)',
            nota: 'Activado sin umbral de tiempo por cancelación, denegación de embarque o pérdida de conexión. ' + notaMeteo,
            nodos_eval: nodos,
          };
        }
        if (tiene(caso, 'demora')) {
          var min = caso.demora_salida_min;
          if (min == null) {
            return { estado: 'FALTA_DATO', dato_faltante: 'demora_salida_min', base_legal: 'Res. 1532/98 Art. 12 (gatillo: demora de salida > 4 h, Pin 2)' };
          }
          if (min > U.ar_demora_gatillo_salida_min) {
            return {
              estado: 'RECLAMABLE',
              base_legal: 'Res. 1532/98 Art. 12 (mod. Res. ANAC 203/2013)',
              nota: 'Demora de salida de ' + min + ' min, por encima del gatillo de ' + U.ar_demora_gatillo_salida_min + ' min. La demora se mide en la salida (Pin 2). ' + notaMeteo,
              nodos_eval: nodos,
            };
          }
          return {
            estado: 'NO_APLICA',
            motivo: 'Demora de salida de ' + min + ' min: por debajo de las 4 h la demora no activa el régimen de incidentales (sí lo activan cancelación y denegación)',
            base_legal: 'Res. 1532/98 Art. 12',
          };
        }
        return { estado: 'NO_APLICA', motivo: motivoSinIncidente('los servicios incidentales', caso), base_legal: 'Res. 1532/98 Art. 12' };
      },
    },

    {
      categoria: 'dano_por_demora',
      base_legal: 'Doméstico: Código Aeronáutico Art. 141 (tope en Argentinos Oro). Internacional: Convenio de Montreal Art. 19 (tope en DEG/SDR)',
      consume: function (caso) { return tiene(caso, 'demora') ? ['incidentes', 'demora_llegada_min'] : ['incidentes']; },
      evaluar: function (caso) {
        if (!tiene(caso, 'demora') && !tiene(caso, 'conexion_perdida')) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye demora', base_legal: 'Código Aeronáutico Art. 141 / Montreal Art. 19' };
        }
        /* Pin 2: el daño resarcible deriva del arribo tardío, no de la espera. */
        if (caso.demora_llegada_min == null) {
          return {
            estado: 'FALTA_DATO',
            dato_faltante: 'demora_llegada_min',
            base_legal: 'Código Aeronáutico Art. 141 / Montreal Art. 19 (el daño por demora se mide contra la llegada al destino final, Pin 2)',
          };
        }
        var intl = caso.internacional === true;
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.causa_disrupcion.nodo,
          monto: intl
            ? { unidad: 'SDR', formula: 'tope del Art. 19 Montreal', cantidad_pendiente: true }
            : { unidad: 'AO', formula: 'tope del Art. 141 Código Aeronáutico', cantidad_pendiente: true },
          base_legal: intl ? 'Convenio de Montreal Art. 19' : 'Código Aeronáutico (Ley 17.285) Art. 141',
          nota: 'Daño acreditado, medido contra la demora de llegada al destino final (' + caso.demora_llegada_min + ' min, Pin 2). '
            + 'Eximente: demora no imputable por causa técnica o meteorológica salvo negligencia probada (Res. 1532 Art. 19 b.2.1; Montreal Art. 19). Tope diferido a la cuantificación.',
          nodos_eval: [
            nodoCon(NODO.causa_disrupcion, 'RES1532', caso.causa_alegada ? 'Causa alegada: ' + caso.causa_alegada : 'Sin causa alegada registrada'),
            nodoCon(intl ? NODO.tope_sdr_montreal : NODO.cotizacion_ao, 'RES1532'),
          ],
        };
      },
    },

    {
      categoria: 'equipaje',
      base_legal: 'Doméstico: Res. 1532/98 Art. 19 a (2 AO/kg de equipaje registrado; 40 AO por pasajero en objetos bajo su custodia). Internacional: overlay Montreal Art. 17(2)/19 (DEG/SDR)',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso, U) {
        if (!algunEquipaje(caso)) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye incidentes de equipaje', base_legal: 'Res. 1532/98 Art. 19 a' };
        }
        if (caso.internacional === true) {
          return {
            estado: 'REQUIERE_EVALUACION',
            eval_nodo: NODO.tope_sdr_montreal.nodo,
            monto: { unidad: 'SDR', formula: 'tope del Art. 22(2) Montreal', cantidad_pendiente: true },
            base_legal: 'Convenio de Montreal Art. 17(2)/19 (la Res. 1532 Art. 19 b remite a la Convención)',
            nota: 'Transporte internacional: rige el overlay Montreal. Topes en DEG/SDR diferidos a la cuantificación.',
            nodos_eval: [nodoCon(NODO.tope_sdr_montreal, 'RES1532'), nodoCon(NODO.suficiencia_probatoria, 'RES1532')],
          };
        }
        if (caso.internacional === false) {
          return {
            estado: 'RECLAMABLE',
            monto: { unidad: 'AO', formula: U.ar_topes_ao.equipaje_registrado_por_kg + ' AO/kg de peso bruto (equipaje registrado); '
              + U.ar_topes_ao.equipaje_mano_por_pasajero + ' AO por pasajero (objetos en custodia)', cantidad_pendiente: true },
            base_legal: 'Res. 1532/98 Art. 19 a + Código Aeronáutico Arts. 140/145',
            nota: 'Tope determinista en la unidad; el valor del Argentino Oro es cuantificación diferida (BCRA, trimestral). '
              + 'Entrega parcial: responsabilidad proporcional al peso. Salvo declaración especial de interés con cargo.',
            nodos_eval: [nodoCon(NODO.cotizacion_ao, 'RES1532'), nodoCon(NODO.suficiencia_probatoria, 'RES1532')],
          };
        }
        return { estado: 'FALTA_DATO', dato_faltante: 'origen_iata / destino_iata (interno vs. internacional cambia el régimen y el tope)', base_legal: 'Res. 1532/98 Art. 19' };
      },
    },

    {
      categoria: 'muerte_lesion',
      base_legal: 'Doméstico: Código Aeronáutico Arts. 139/144 + Res. 1532/98 Art. 19 a.I (hasta 1.000 AO por pasajero). Internacional: Convenio de Montreal Art. 17(1)',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso, U) {
        if (!tiene(caso, 'muerte_lesion')) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye muerte ni lesión', base_legal: 'Código Aeronáutico Arts. 139/144' };
        }
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.analisis_manual_muerte_lesion.nodo,
          monto: caso.internacional === true
            ? { unidad: 'SDR', formula: 'Art. 17(1) Montreal', cantidad_pendiente: true }
            : { unidad: 'AO', formula: 'hasta ' + U.ar_topes_ao.muerte_lesion_por_pasajero + ' AO por pasajero', cantidad_pendiente: true },
          base_legal: caso.internacional === true ? 'Convenio de Montreal Art. 17(1)' : 'Código Aeronáutico Arts. 139/144 + Res. 1532/98 Art. 19 a.I',
          nota: 'Fuera del intake estándar: excepción de análisis manual.',
          nodos_eval: [nodoCon(NODO.analisis_manual_muerte_lesion, 'RES1532')],
        };
      },
    },

    {
      categoria: 'dano_moral',
      base_legal: 'CCyC Art. 1741; Montreal Art. 19 (internacional, acreditado); Ley 24.240 supletoria (Art. 63)',
      consume: function () { return []; },
      evaluar: function () {
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.dano_moral_suplementario.nodo,
          base_legal: 'CCyC Art. 1741 / Montreal Art. 19 / Ley 24.240 Art. 63 (supletoria)',
          nota: 'Admisible contra la aerolínea en el foro federal civil y comercial, sujeto a prueba y quantum.',
          nodos_eval: [nodoCon(NODO.dano_moral_suplementario, 'RES1532')],
        };
      },
    },

    {
      categoria: 'dano_emergente',
      base_legal: 'Montreal Art. 19 (internacional) · CCyC y Ley 24.240 supletoria (doméstico)',
      consume: function () { return []; },
      evaluar: function (caso) {
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.suficiencia_probatoria.nodo,
          base_legal: caso.internacional === true ? 'Convenio de Montreal Art. 19' : 'CCyC / Ley 24.240 (supletoria, Art. 63)',
          nota: 'Monto = gastos acreditados. Gastos itemizados cargados: ' + (caso.gastos_items || []).length + '. '
            + (caso.internacional === true ? 'En transporte internacional, Montreal excluye los daños indirectos o consecuentes (Res. 1532 Art. 19 b.3.5).' : ''),
          nodos_eval: [nodoCon(NODO.suficiencia_probatoria, 'RES1532')],
        };
      },
    },

    {
      categoria: 'dano_punitivo',
      base_legal: 'Internacional: Montreal Art. 29 excluye toda indemnización no compensatoria. Doméstico: Art. 63 Ley 24.240 subordina al Código Aeronáutico',
      consume: function () { return []; },
      evaluar: function () {
        return {
          estado: 'NO_APLICA',
          motivo: 'El daño punitivo del Art. 52 bis Ley 24.240 no procede contra la aerolínea. Línea jurisprudencial uniforme 2024-25 (Piccardi c/LATAM; Martín c/Aeroméxico; M.B. c/Air Canada; Airala c/Aerolíneas; Peon c/United)',
          base_legal: 'Convenio de Montreal Art. 29 + Ley 24.240 Art. 63',
        };
      },
    },
  ],

  prescripcion: function (caso, hoy, U, ctx) {
    var base = caso.internacional === true
      ? 'Convenio de Montreal Art. 35 + Res. 1532/98 Art. 20 b (2 años)'
      : 'Código Aeronáutico (Ley 17.285) Art. 228 inc. 1 y 4 (1 año), coincidente con Res. 1532/98 Art. 20 b';
    if (caso.internacional == null) {
      return { computable: false, tipo: 'firme', plazo: null, fecha_limite: null, base_legal: base, nota: 'No se sabe si el transporte es internacional: el plazo difiere (1 año interno / 2 años internacional).' };
    }
    var anios = caso.internacional ? U.prescripcion_montreal_anios : U.prescripcion_ar_interno_anios;
    if (!caso.fecha_incidente) {
      return { computable: false, tipo: 'firme', plazo: anios + (anios === 1 ? ' año' : ' años'), fecha_limite: null, base_legal: base, nota: 'Sin fecha del incidente no se puede calcular la fecha límite.' };
    }
    return {
      computable: true,
      tipo: 'firme',
      plazo: anios + (anios === 1 ? ' año' : ' años'),
      fecha_limite: ctx.sumarAnios(caso.fecha_incidente, anios),
      base_legal: base,
      nota: 'Días corridos, vencimiento a las 24:00 del último día (Pin 5). Contado desde el arribo, la fecha en que debió arribar o la fecha en que se detuvo el transporte. '
        + 'La caducidad por falta de protesta (Art. 20 a) es independiente de la prescripción.',
    };
  },
};

/* ================================================================== */
/* Export                                                              */
/* ================================================================== */

export var RULESET = {
  version: '2026-06-19',
  fuente: 'docs/Capa_1_-_Logica_legal_determinista_v2.2.md (Parte IV-A)',
  /* Vigencia por fecha del incidente (ley al momento del hecho). El corte superior es el
     día anterior a la entrada en vigor del Decreto 809/2024 (Art. 7: 30 días corridos
     desde el B.O. del 10-sep-2024). Un incidente del 9-oct-2024 cae acá; uno del 10 cae
     en el ruleset IV-B. */
  vigencia: { desde: '2004-02-17', hasta: '2024-10-09' },
  umbrales: UMBRALES,
  marcos: MARCOS_COMPARTIDOS.concat([MARCO_RES1532]),
};

export default RULESET;
