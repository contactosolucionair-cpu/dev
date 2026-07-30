/**
 * api/_utils/rulesets/2026-06-19.js
 *
 * Reglas legales como DATOS, vigencia 19-jun-2026. Un archivo por vigencia.
 *
 * Contrato con el evaluador (api/_utils/motor-legal.js):
 *   - TODO umbral con consecuencia legal vive acá, en `umbrales`. El evaluador no
 *     contiene ni un número legal: solo recorre esta estructura.
 *   - TODA regla lleva `base_legal` con la cita literal del v2.1.
 *   - Los predicados son funciones puras `(caso, U) => resultado`, donde `U` son los
 *     umbrales de este mismo archivo. Nunca leen fecha del sistema ni hacen fetch.
 *
 * Fuente legal: docs/Capa_1_-_Logica_legal_determinista_v2.1.md (v2.1.1).
 * Ambigüedades no resueltas por el v2.1: docs/motor-capa1-pendientes-legales.md.
 * Acá NO se inventa regla: donde el documento no decide, se emite FALTA_DATO o un
 * nodo [REQUIERE EVALUACIÓN].
 */

/* ================================================================== */
/* UMBRALES — todo número con consecuencia legal                       */
/* ================================================================== */

export var UMBRALES = {
  /* --- EU261 --- */

  /* Compensación por retraso: TJUE Sturgeon C-402/07. En minutos porque la llegada se
     mide en horas:minutos (Pin 1) y el borde 2h59 vs 3h01 tiene que ser exacto. */
  eu261_compensacion_retraso_llegada_min: 180,

  /* Art. 6: opción de reembolso a partir de 5 h de retraso en la SALIDA. */
  eu261_reembolso_retraso_salida_min: 300,

  /* Art. 6: gatillo de atención según retraso en la SALIDA, por banda. */
  eu261_atencion_retraso_salida_min: {
    '<=1500': 120,
    '1500-3500': 180,
    '>3500': 240,
  },

  /* Art. 5(1)(c): exoneraciones temporales de la compensación en cancelación.
     Días de antelación del aviso respecto de la salida programada. */
  eu261_cancelacion_aviso_exonera_dias: 14,        // (i) ≥ 2 semanas
  eu261_cancelacion_aviso_intermedio_dias: 7,      // (ii) entre 2 semanas y 7 días
  /* Márgenes del reencaminamiento en cada ventana, en minutos.
     `salida_antes_max`: cuánto puede adelantarse la salida (delta negativo).
     `llegada_despues_max`: cuánto puede retrasarse la llegada (delta positivo). */
  eu261_cancelacion_margen_intermedio: { salida_antes_max: 120, llegada_despues_max: 240 },
  eu261_cancelacion_margen_corto:      { salida_antes_max: 60,  llegada_despues_max: 120 },

  /* Tabla de bandas Art. 7(1) y 7(2) — Pin 6.
     `margen_reduccion_min`: si la llegada del reencaminamiento queda por debajo de ese
     retraso, el monto se reduce 50 % (Art. 7(2)). */
  eu261_bandas: {
    '<=1500':    { pleno: 250, reducido: 125, margen_reduccion_min: 120, moneda: 'EUR' },
    '1500-3500': { pleno: 400, reducido: 200, margen_reduccion_min: 180, moneda: 'EUR' },
    '>3500':     { pleno: 600, reducido: 300, margen_reduccion_min: 240, moneda: 'EUR' },
  },

  /* Precisión determinista de B3: como el gatillo de compensación por retraso (3 h) ya
     iguala o supera los márgenes de 2 h y 3 h, la reducción del Art. 7(2) solo opera en
     la práctica para >3500 km con llegada entre 3 h y 4 h. */
  eu261_reduccion_retraso_solo_banda: '>3500',
  eu261_reduccion_retraso_llegada_max_min: 240,

  /* Art. 10(2): porcentajes de reembolso por downgrade. El % es determinista; la
     cuantificación exige clase pagada vs. volada, dato ausente en intake. */
  eu261_downgrade_pct: { '<=1500': 30, '1500-3500': 50, '>3500': 75 },

  /* --- Argentina (Res. ANAC 1532/98) --- */

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

  /* --- Prescripción (días corridos, vencimiento 24:00 del último día — Pin 5) --- */
  prescripcion_ar_interno_anios: 1,          // Cód. Aeronáutico Art. 228 inc. 1 y 4
  prescripcion_montreal_anios: 2,            // Montreal Art. 35
};

/* ================================================================== */
/* Helpers de lectura del caso (no deciden nada legal)                 */
/* ================================================================== */

function tiene(caso, incidente) {
  return (caso.incidentes || []).indexOf(incidente) !== -1;
}

function algunEquipaje(caso) {
  return tiene(caso, 'equipaje_dano') || tiene(caso, 'equipaje_perdida') || tiene(caso, 'equipaje_demora');
}

/* ¿Algún extremo del itinerario está en el país? (Tests B, C, D: "sale de, llega a, o
   es dentro de"). */
function tocaPais(caso, iso) {
  return (caso.ruta || []).some(function (p) { return p.pais_iso === iso; });
}

function parteDe(caso, iso) {
  return !!(caso.origen && caso.origen.pais_iso === iso);
}

/* Reencaminamiento dentro del margen de una ventana del Art. 5(1)(c) / Art. 7(2). */
function reencaminamientoEnMargen(reenc, margen) {
  if (!reenc || reenc.ofrecido !== true) return false;
  var dSal = reenc.delta_salida_min, dLle = reenc.delta_llegada_min;
  if (dSal == null || dLle == null) return null;   // ofrecido pero sin tiempos → no se sabe
  return dSal >= -margen.salida_antes_max && dLle < margen.llegada_despues_max;
}

/* ================================================================== */
/* Nodos [REQUIERE EVALUACIÓN] — consolidados del v2.1                 */
/* ================================================================== */

var NODO = {
  circunstancias_extraordinarias: {
    nodo: 'circunstancias_extraordinarias',
    dato_concreto: '¿El suceso alegado exonera la compensación (Art. 5(3))?',
  },
  suficiencia_probatoria: {
    nodo: 'suficiencia_probatoria',
    dato_concreto: '¿Los comprobantes sostienen el monto reclamado (atención, gastos, Montreal)?',
  },
  dano_moral_suplementario: {
    nodo: 'dano_moral_suplementario',
    dato_concreto: 'Cuantía no tarifada (Art. 12 EU261 + Montreal Art. 19 / derecho nacional)',
  },
  voluntariedad_denegacion: {
    nodo: 'voluntariedad_denegacion',
    dato_concreto: '¿La renuncia a la reserva fue voluntaria o forzada? (Art. 4(1) vs. 4(3))',
  },
  borde_cobertura_hub: {
    nodo: 'borde_cobertura_hub',
    dato_concreto: 'Cobertura de los tramos no-UE en billete único que solo transita un hub UE (línea Wegener C-537/17)',
  },
  downgrade_cuantificacion: {
    nodo: 'downgrade_cuantificacion',
    dato_concreto: 'Clase pagada vs. clase volada — dato ausente en intake (excepción de análisis manual)',
  },
  causa_disrupcion: {
    nodo: 'causa_disrupcion',
    dato_concreto: '¿La causa fue meteorológica? Exime los servicios incidentales (Res 203/2013) y, en demora, la responsabilidad por daño (Res 1532 Art. 19 b.2.1)',
  },
  compensacion_embarque_denegado: {
    nodo: 'compensacion_embarque_denegado',
    dato_concreto: 'No tarifada por la norma: depende de las regulaciones publicadas del transportador (Res 1532 Art. 12 a)',
  },
  suficiencia_protesta_pir: {
    nodo: 'suficiencia_protesta_pir',
    dato_concreto: 'Solo existe PIR sin protesta escrita posterior: ¿satisface el Art. 20 Res 1532 / Art. 31 Montreal? (jurisprudencia dividida)',
  },
  cotizacion_ao: {
    nodo: 'cotizacion_ao',
    dato_concreto: 'Valor del Argentino Oro (BCRA, trimestral) — input de cuantificación diferido',
  },
  tope_sdr_montreal: {
    nodo: 'tope_sdr_montreal',
    dato_concreto: 'Tope en DEG/SDR aplicable — diferido (detalle Montreal)',
  },
  analisis_manual_muerte_lesion: {
    nodo: 'analisis_manual_muerte_lesion',
    dato_concreto: 'Muerte o lesión: fuera del intake estándar, excepción de análisis manual',
  },
};

function nodoCon(base, marco, extra) {
  return {
    nodo: base.nodo,
    marco: marco,
    dato_concreto: base.dato_concreto,
    insumo: extra || '',
  };
}

/* ================================================================== */
/* Punteros EU261: NEB y ley nacional de relleno (Art. 16)             */
/* ================================================================== */

/* Solo los que el v2.1 nombra. AESA está verificado; LBA/DGAC/ENAC son ilustrativos.
   Para el resto de los Estados el puntero queda null a propósito: la nómina vinculante
   la publica la Comisión Europea y se verifica caso a caso. */
var NEB_POR_PAIS = {
  ES: 'AESA (España)',
  DE: 'LBA (Alemania)',
  FR: 'DGAC (Francia)',
  IT: 'ENAC (Italia)',
};

function punterosEu261(caso, viaA2) {
  /* Regla de selección del v2.1: NEB del Estado de SALIDA (caso A1); si el vuelo llega
     a la UE desde un tercer país en carrier comunitario (caso A2), NEB del Estado de
     LLEGADA. */
  var punto = viaA2 ? caso.destino_final : caso.origen;
  var iso = punto && punto.pais_iso ? punto.pais_iso : null;
  return {
    neb: iso && NEB_POR_PAIS[iso] ? NEB_POR_PAIS[iso] : null,
    ley_nacional: iso,
    nota: iso && !NEB_POR_PAIS[iso]
      ? 'NEB no mapeado para ' + iso + ': la nómina vinculante la publica la Comisión Europea (verificación caso a caso)'
      : '',
  };
}

/* ================================================================== */
/* MARCO — EU261/2004                                                  */
/* ================================================================== */

/* Banda efectiva para la compensación. `null` cuando no se pudo determinar (distancia
   desconocida, o >3500 km sin saber si el vuelo es intracomunitario). */
function bandaDe(caso) { return caso.banda_eu261; }

/**
 * Monto de la compensación del Art. 7, con la reducción del 7(2) si corresponde.
 * Devuelve `{ monto, reducido }` o `null` si falta la banda.
 */
function montoArt7(caso, U, porRetraso) {
  var banda = bandaDe(caso);
  if (!banda) return null;
  var b = U.eu261_bandas[banda];

  if (porRetraso) {
    /* Precisión determinista de B3: en retraso la reducción solo opera para >3500 km
       con llegada entre 3 h y 4 h. Por encima de 4 h, monto completo. */
    var aplicaRed = banda === U.eu261_reduccion_retraso_solo_banda
      && caso.demora_llegada_min != null
      && caso.demora_llegada_min >= U.eu261_compensacion_retraso_llegada_min
      && caso.demora_llegada_min < U.eu261_reduccion_retraso_llegada_max_min;
    return aplicaRed
      ? { monto: { valor: b.reducido, moneda: b.moneda }, reducido: true }
      : { monto: { valor: b.pleno, moneda: b.moneda }, reducido: false };
  }

  /* Cancelación y denegación de embarque: la reducción exige reencaminamiento con
     llegada dentro del margen de la banda. */
  var enMargen = reencaminamientoEnMargen(caso.reencaminamiento,
    { salida_antes_max: Infinity, llegada_despues_max: b.margen_reduccion_min });
  if (enMargen === true) return { monto: { valor: b.reducido, moneda: b.moneda }, reducido: true };
  return { monto: { valor: b.pleno, moneda: b.moneda }, reducido: false };
}

var MARCO_EU261 = {
  marco: 'EU261',

  test: function (caso) {
    /* Pin 4 — segmento relevante: con billete único el itinerario se evalúa como un todo
       (origen = primer aeropuerto, destino final = último; Art. 2(h), Folkerts C-11/11).
       El normalizador ya resolvió ese par. */
    var o = caso.origen, d = caso.destino_final;

    if (!o || !d || o.ambito_eu261 == null || d.ambito_eu261 == null) {
      return {
        aplica: 'falta_dato',
        activado_por: 'No se pudo determinar si el itinerario toca territorio UE/EEE/CH',
        base_legal: 'EU261 Art. 3(1)',
        dato_faltante: !o || !d ? 'origen_iata / destino_iata' : 'pais del aeropuerto (ámbito EU261 sin clasificar)',
      };
    }

    /* A1 — salida desde aeropuerto UE/EEE/CH, con cualquier transportista. */
    if (o.ambito_eu261 === true) {
      return {
        aplica: 'si',
        via: 'A1',
        activado_por: 'Test A1: salida desde aeropuerto UE/EEE/CH (' + o.iata + ')',
        base_legal: 'EU261 Art. 3(1)(a)',
        punteros: punterosEu261(caso, false),
      };
    }

    /* A2 — llegada a UE/EEE/CH desde tercer país: solo si el transportista operante es
       comunitario. La condición de no haber recibido beneficios en el tercer país es una
       excepción documentada del v2.1, no un campo de intake. */
    if (d.ambito_eu261 === true) {
      var carrier = caso.carrier_operante;
      if (!carrier || carrier.comunitario == null) {
        return {
          aplica: 'falta_dato',
          activado_por: 'Test A2: llegada a UE/EEE/CH (' + d.iata + ') desde tercer país, pero no se conoce si el transportista operante es comunitario',
          base_legal: 'EU261 Art. 3(1)(b)',
          dato_faltante: 'carrier_operante (condición de comunitario)',
        };
      }
      if (carrier.comunitario === true) {
        return {
          aplica: 'si',
          via: 'A2',
          activado_por: 'Test A2: llegada a ' + d.iata + ' desde tercer país con transportista comunitario (' + carrier.nombre + ')',
          base_legal: 'EU261 Art. 3(1)(b)',
          punteros: punterosEu261(caso, true),
          nota: 'Art. 3(1)(b) exige además que el pasajero no haya disfrutado de beneficios o compensación en el tercer país; el v2.1 lo trata como excepción documentada, no como campo de intake',
        };
      }
      return {
        aplica: 'no',
        activado_por: 'Test A2: llegada a UE/EEE/CH desde tercer país pero el transportista operante no es comunitario (' + carrier.nombre + ')',
        base_legal: 'EU261 Art. 3(1)(b)',
      };
    }

    /* Nodo borde (Pin 4): ni parte ni llega a UE/EEE/CH pero transita un hub UE. */
    if (caso.transita_hub_eu261) {
      return {
        aplica: 'pendiente_analisis_profundo',
        activado_por: 'Billete único que ni parte ni llega a UE/EEE/CH pero transita un hub UE: la cobertura de los tramos no-UE depende de jurisprudencia TJUE',
        base_legal: 'EU261 Art. 3(1) + línea Wegener C-537/17 (verificación caso a caso)',
        nodos_eval: [nodoCon(NODO.borde_cobertura_hub, 'EU261',
          'Itinerario: ' + (caso.paises || []).join('→'))],
      };
    }

    return {
      aplica: 'no',
      activado_por: 'Test A: el itinerario no parte de ni llega a un aeropuerto UE/EEE/CH',
      base_legal: 'EU261 Art. 3(1)',
    };
  },

  gates: [{
    gate: 'checkin',
    /* Art. 3(2): condición de ámbito. No exigible en cancelación.
       Alcance: las categorías del régimen de disrupción de pasajeros. El equipaje no
       está alcanzado porque EU261 no lo cubre (Principio 4). */
    alcance: ['compensacion_tarifada', 'reembolso', 'reencaminamiento', 'atencion', 'downgrade', 'compensacion_suplementaria'],
    consume: function () { return ['checkin_presentacion']; },
    evaluar: function (caso) {
      var base = 'EU261 Art. 3(2)';
      if (tiene(caso, 'cancelacion')) {
        return { resultado: 'pasa', detalle: 'No exigible: el incidente incluye cancelación (Art. 3(2) exceptúa el caso)', base_legal: base };
      }
      var v = caso.checkin_presentacion;
      if (v === 'no_aplica') return { resultado: 'pasa', detalle: 'Marcado como no aplicable', base_legal: base };
      if (v === 'en_hora')   return { resultado: 'pasa', detalle: 'Presentación al check-in en hora', base_legal: base };
      if (v === 'tarde' || v === 'no_presentado') {
        return {
          resultado: 'inadmisible',
          detalle: v === 'tarde' ? 'Presentación al check-in fuera de la hora indicada' : 'El pasajero no se presentó al check-in',
          base_legal: base,
        };
      }
      return {
        resultado: 'falta_dato',
        detalle: 'Presentación al check-in desconocida. Nunca se presume (Pin 3)',
        base_legal: base,
        dato_faltante: 'checkin_presentacion',
      };
    },
  }],

  categorias: [
    {
      categoria: 'compensacion_tarifada',
      base_legal: 'EU261 Art. 7(1): €250 / €400 / €600 por banda de distancia',
      consume: function (caso) {
        var f = ['incidentes'];
        if (tiene(caso, 'cancelacion')) f.push('antelacion_aviso_dias');
        if (tiene(caso, 'demora') || tiene(caso, 'conexion_perdida')) f.push('demora_llegada_min');
        return f;
      },
      evaluar: function (caso, U) {
        var banda = bandaDe(caso);
        var sinBanda = {
          estado: 'FALTA_DATO',
          dato_faltante: caso.distancia_km == null ? 'origen_iata / destino_iata (distancia)' : 'banda_eu261 (>3500 km sin saber si el vuelo es intracomunitario)',
          base_legal: 'EU261 Art. 7(1) y 7(4)',
        };

        /* --- B1: denegación de embarque (Art. 4) --- */
        if (tiene(caso, 'denegacion_embarque')) {
          if (!banda) return sinBanda;
          var m1 = montoArt7(caso, U, false);
          return {
            estado: 'RECLAMABLE',
            monto: m1.monto,
            base_legal: 'EU261 Art. 4(3) + Art. 7(1)' + (m1.reducido ? ' con reducción del Art. 7(2)' : ''),
            nota: 'Denegación involuntaria: compensación íntegra y de inmediato, sin umbral de tiempo. '
              + (m1.reducido ? 'Reducida 50 % por reencaminamiento con llegada dentro del margen (Art. 7(2)).' : 'La reducción del Art. 7(2) es defensa del transportista: exige probar reencaminamiento con llegada dentro del margen.'),
            nodos_eval: [nodoCon(NODO.voluntariedad_denegacion, 'EU261',
              'La voluntariedad no es campo de intake: si la renuncia fue voluntaria, sale del esquema tarifado (Art. 4(1))')],
          };
        }

        /* --- B2: cancelación (Art. 5) --- */
        if (tiene(caso, 'cancelacion')) {
          var dias = caso.antelacion_aviso_dias;
          if (dias == null) {
            return { estado: 'FALTA_DATO', dato_faltante: 'antelacion_aviso_dias', base_legal: 'EU261 Art. 5(1)(c)' };
          }
          /* (i) aviso con ≥ 2 semanas de antelación */
          if (dias >= U.eu261_cancelacion_aviso_exonera_dias) {
            return {
              estado: 'NO_APLICA',
              motivo: 'Aviso con ' + dias + ' días de antelación (≥ ' + U.eu261_cancelacion_aviso_exonera_dias + '): exoneración del Art. 5(1)(c)(i)',
              base_legal: 'EU261 Art. 5(1)(c)(i)',
            };
          }
          /* (ii) y (iii): la exoneración exige un reencaminamiento dentro de margen. */
          var esIntermedio = dias >= U.eu261_cancelacion_aviso_intermedio_dias;
          var margen = esIntermedio ? U.eu261_cancelacion_margen_intermedio : U.eu261_cancelacion_margen_corto;
          var incisoBase = esIntermedio ? 'EU261 Art. 5(1)(c)(ii)' : 'EU261 Art. 5(1)(c)(iii)';
          var enMargen = reencaminamientoEnMargen(caso.reencaminamiento, margen);

          if (enMargen === null) {
            /* Hay reencaminamiento ofrecido pero sin tiempos, o no hay dato: no se puede
               confirmar ni descartar la exoneración. No se decide: FALTA_DATO. */
            return { estado: 'FALTA_DATO', dato_faltante: 'reencaminamiento (delta_salida_min / delta_llegada_min)', base_legal: incisoBase };
          }
          if (enMargen === true) {
            return {
              estado: 'NO_APLICA',
              motivo: 'Aviso con ' + dias + ' días + reencaminamiento dentro del margen del inciso: exoneración temporal',
              base_legal: incisoBase,
            };
          }
          if (!banda) return sinBanda;
          var m2 = montoArt7(caso, U, false);
          return {
            estado: 'RECLAMABLE',
            monto: m2.monto,
            base_legal: 'EU261 Art. 5(1)(c) + Art. 7(1)' + (m2.reducido ? ' con reducción del Art. 7(2)' : ''),
            nota: 'La carga de la prueba del aviso y su momento recae en el transportista (Art. 5(4)).'
              + (m2.reducido ? ' Monto reducido 50 % por reencaminamiento con llegada dentro del margen (Art. 7(2)).' : ''),
            nodos_eval: [nodoCon(NODO.circunstancias_extraordinarias, 'EU261',
              caso.causa_alegada ? 'Causa alegada: ' + caso.causa_alegada : 'Sin causa alegada registrada')],
          };
        }

        /* --- B3 retraso / B4 conexión perdida (Art. 7 vía Sturgeon / Folkerts) --- */
        if (tiene(caso, 'demora') || tiene(caso, 'conexion_perdida')) {
          var min = caso.demora_llegada_min;
          if (min == null) {
            return { estado: 'FALTA_DATO', dato_faltante: 'demora_llegada_min', base_legal: 'TJUE Sturgeon C-402/07 (retraso ≥ 3 h en la llegada al destino final)' };
          }
          var esConexion = tiene(caso, 'conexion_perdida') && !tiene(caso, 'demora');
          if (esConexion && caso.billete_unico !== true) {
            return {
              estado: caso.billete_unico == null ? 'FALTA_DATO' : 'NO_APLICA',
              dato_faltante: caso.billete_unico == null ? 'billete_unico' : undefined,
              motivo: caso.billete_unico === false ? 'Conexión perdida sin billete único: cada billete es un itinerario independiente (Pin 4)' : undefined,
              base_legal: 'TJUE Folkerts C-11/11 (conexión perdida en billete único)',
            };
          }
          if (min < U.eu261_compensacion_retraso_llegada_min) {
            return {
              estado: 'NO_APLICA',
              motivo: 'Retraso en la llegada de ' + min + ' min, por debajo del umbral de ' + U.eu261_compensacion_retraso_llegada_min + ' min',
              base_legal: 'TJUE Sturgeon C-402/07',
            };
          }
          if (!banda) return sinBanda;
          var m3 = montoArt7(caso, U, true);
          return {
            estado: 'RECLAMABLE',
            monto: m3.monto,
            base_legal: (esConexion ? 'TJUE Folkerts C-11/11' : 'TJUE Sturgeon C-402/07') + ' + EU261 Art. 7(1)' + (m3.reducido ? ' con reducción del Art. 7(2)' : ''),
            nota: 'Llegada medida como apertura de al menos una puerta de la aeronave (TJUE Germanwings C-452/13, Pin 1).'
              + (m3.reducido ? ' Monto reducido 50 %: >3500 km con llegada entre 3 h y 4 h.' : ''),
            nodos_eval: [nodoCon(NODO.circunstancias_extraordinarias, 'EU261',
              caso.causa_alegada ? 'Causa alegada: ' + caso.causa_alegada : 'Sin causa alegada registrada')],
          };
        }

        return {
          estado: 'NO_APLICA',
          motivo: 'Ningún incidente del caso activa la compensación tarifada del Art. 7',
          base_legal: 'EU261 Art. 7(1)',
        };
      },
    },

    {
      categoria: 'reembolso',
      base_legal: 'EU261 Art. 8(1)(a): precio del billete (parte no usada, más la usada si el viaje ya no tiene sentido) + vuelo de vuelta al origen si procede',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso, U) {
        if (tiene(caso, 'cancelacion') || tiene(caso, 'denegacion_embarque')) {
          return {
            estado: 'RECLAMABLE',
            base_legal: (tiene(caso, 'cancelacion') ? 'EU261 Art. 5(1)(a)' : 'EU261 Art. 4(3)') + ' + Art. 8(1)(a)',
            nota: 'Derecho determinista, con cualquier antelación de aviso. El monto es el precio del billete: dato de cuantificación, no de esta capa.',
          };
        }
        if (tiene(caso, 'demora')) {
          var min = caso.demora_salida_min;
          if (min == null) {
            return { estado: 'FALTA_DATO', dato_faltante: 'demora_salida_min', base_legal: 'EU261 Art. 6(1)(iii) + Art. 8(1)(a)' };
          }
          if (min >= U.eu261_reembolso_retraso_salida_min) {
            return {
              estado: 'RECLAMABLE',
              base_legal: 'EU261 Art. 6(1)(iii) + Art. 8(1)(a)',
              nota: 'Retraso en la salida de ' + min + ' min (≥ ' + U.eu261_reembolso_retraso_salida_min + '): habilita la opción de reembolso.',
            };
          }
          return {
            estado: 'NO_APLICA',
            motivo: 'Retraso en la salida de ' + min + ' min, por debajo de los ' + U.eu261_reembolso_retraso_salida_min + ' min que habilitan el reembolso',
            base_legal: 'EU261 Art. 6(1)(iii)',
          };
        }
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa el derecho de reembolso', base_legal: 'EU261 Art. 8(1)(a)' };
      },
    },

    {
      categoria: 'reencaminamiento',
      base_legal: 'EU261 Art. 8(1)(b)(c): reencaminamiento lo antes posible, o en fecha posterior a conveniencia del pasajero',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        if (tiene(caso, 'cancelacion') || tiene(caso, 'denegacion_embarque') || tiene(caso, 'conexion_perdida')) {
          return { estado: 'RECLAMABLE', base_legal: 'EU261 Art. 8(1)(b)(c)', nota: 'Derecho determinista, con cualquier antelación de aviso.' };
        }
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa el derecho de reencaminamiento', base_legal: 'EU261 Art. 8(1)(b)(c)' };
      },
    },

    {
      categoria: 'atencion',
      base_legal: 'EU261 Art. 9: comida y refrescos, alojamiento, transporte y dos comunicaciones',
      consume: function (caso) {
        return tiene(caso, 'demora') ? ['incidentes', 'demora_salida_min'] : ['incidentes'];
      },
      evaluar: function (caso, U) {
        var nodos = [nodoCon(NODO.suficiencia_probatoria, 'EU261',
          'Gastos itemizados cargados: ' + (caso.gastos_items || []).length)];

        if (tiene(caso, 'cancelacion') || tiene(caso, 'denegacion_embarque')) {
          return {
            estado: 'RECLAMABLE',
            base_legal: (tiene(caso, 'cancelacion') ? 'EU261 Art. 5(1)(b)' : 'EU261 Art. 4(3)') + ' + Art. 9',
            nota: 'Derecho determinista. El monto son los gastos reales razonables. El tope de 3 noches de alojamiento rige ~2027, no hoy.',
            nodos_eval: nodos,
          };
        }
        if (tiene(caso, 'demora')) {
          var banda = bandaDe(caso);
          if (!banda) {
            return { estado: 'FALTA_DATO', dato_faltante: 'banda_eu261 (el gatillo del Art. 6 depende de la banda de distancia)', base_legal: 'EU261 Art. 6(1) + Art. 9' };
          }
          var umbral = U.eu261_atencion_retraso_salida_min[banda];
          var min = caso.demora_salida_min;
          if (min == null) {
            return { estado: 'FALTA_DATO', dato_faltante: 'demora_salida_min', base_legal: 'EU261 Art. 6(1) + Art. 9' };
          }
          if (min >= umbral) {
            return {
              estado: 'RECLAMABLE',
              base_legal: 'EU261 Art. 6(1) + Art. 9',
              nota: 'Retraso en la salida de ' + min + ' min, umbral de la banda ' + banda + ': ' + umbral + ' min. '
                + 'El alojamiento del Art. 9(1)(b)(c) exige además que la nueva salida sea al día siguiente, dato que el intake no captura.',
              nodos_eval: nodos,
            };
          }
          return {
            estado: 'NO_APLICA',
            motivo: 'Retraso en la salida de ' + min + ' min, por debajo del umbral de ' + umbral + ' min de la banda ' + banda,
            base_legal: 'EU261 Art. 6(1)',
          };
        }
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa el derecho de atención', base_legal: 'EU261 Art. 9' };
      },
    },

    {
      categoria: 'downgrade',
      base_legal: 'EU261 Art. 10(2): reembolso del 30 % (≤1500 km) / 50 % (intracomunitarios >1500 km y demás 1500–3500 km) / 75 % (>3500 km) del precio del billete, en 7 días',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso, U) {
        if (!tiene(caso, 'downgrade')) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye downgrade', base_legal: 'EU261 Art. 10(2)' };
        }
        var banda = bandaDe(caso);
        var pct = banda ? U.eu261_downgrade_pct[banda] : null;
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.downgrade_cuantificacion.nodo,
          monto: pct != null ? { unidad: 'porcentaje_billete', formula: pct + ' % del precio del billete', cantidad_pendiente: true } : undefined,
          base_legal: 'EU261 Art. 10(2)',
          nota: 'El porcentaje es determinista' + (pct != null ? ' (' + pct + ' % para la banda ' + banda + ')' : '')
            + ', pero la cuantificación exige clase pagada vs. clase volada: dato ausente en intake. Excepción de análisis manual.',
          nodos_eval: [nodoCon(NODO.downgrade_cuantificacion, 'EU261')],
        };
      },
    },

    {
      categoria: 'equipaje',
      base_legal: 'EU261 no cubre el equipaje: remite a la Convención de Montreal (transporte internacional) o a la legislación nacional del Estado UE/EEE/CH (doméstico/intra-UE)',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        return {
          estado: 'NO_APLICA',
          motivo: algunEquipaje(caso)
            ? 'El equipaje nunca es categoría del régimen de disrupción de pasajeros (Principio 4). Se enruta al overlay Montreal si el transporte es internacional, o a la ley nacional del Estado si es doméstico/intra-UE.'
            : 'El caso no incluye incidentes de equipaje',
          base_legal: 'EU261 (ámbito) + Convenio de Montreal Arts. 17/19',
        };
      },
    },

    {
      categoria: 'dano_moral',
      base_legal: 'No es categoría tarifada de EU261: la vía es Montreal Art. 19 o el derecho nacional del foro',
      consume: function () { return []; },
      evaluar: function () {
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.dano_moral_suplementario.nodo,
          base_legal: 'Montreal Art. 19 / derecho nacional (vía Art. 12 EU261)',
          nota: 'Cuantía no tarifada.',
          nodos_eval: [nodoCon(NODO.dano_moral_suplementario, 'EU261')],
        };
      },
    },

    {
      categoria: 'compensacion_suplementaria',
      base_legal: 'EU261 Art. 12: habilitada; la compensación del Art. 7 se deduce de ella. No aplica a los pasajeros que renunciaron voluntariamente a la reserva',
      consume: function () { return []; },
      evaluar: function () {
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.dano_moral_suplementario.nodo,
          deducible_de: ['EU261.compensacion_tarifada'],
          base_legal: 'EU261 Art. 12',
          nota: 'Cuantía no tarifada. No hay doble recuperación por el mismo daño: la compensación del Art. 7 se deduce.',
          nodos_eval: [nodoCon(NODO.dano_moral_suplementario, 'EU261', 'Art. 12: deducción de la compensación tarifada')],
        };
      },
    },

    {
      categoria: 'punitivo',
      base_legal: 'Montreal Art. 29 excluye toda indemnización de carácter punitivo; el foro UE/España no los reconoce',
      consume: function () { return []; },
      evaluar: function () {
        return { estado: 'NO_APLICA', motivo: 'El daño punitivo no procede en este marco', base_legal: 'Convenio de Montreal Art. 29' };
      },
    },
  ],

  prescripcion: function (caso, hoy, U, ctx) {
    /* Pin 7: para EU261 el motor NUNCA emite una fecha límite dependiente de un foro no
       decidido. Si además aplica el overlay Montreal, se emite el piso conservador de 2
       años con fecha concreta, marcado como piso. */
    var out = {
      computable: false,
      tipo: 'segun_foro',
      plazo: null,
      fecha_limite: null,
      base_legal: 'EU261 no fija plazo propio: rige la ley nacional del foro donde se reclama (TJUE Cuadrench Moré C-139/11)',
      nota: 'No se emite fecha límite: el foro no está decidido. El plazo general de acción personal del Art. 1964 CC español (5 años) está marcado POR-VERIFICAR en el v2.1.',
    };
    if (ctx.aplica('MONTREAL') && caso.fecha_incidente) {
      out.piso_conservador = {
        plazo: U.prescripcion_montreal_anios + ' años',
        fecha_limite: ctx.sumarAnios(caso.fecha_incidente, U.prescripcion_montreal_anios),
        base_legal: 'Convenio de Montreal Art. 35 (2 años desde la llegada o la llegada prevista)',
        nota: 'Piso conservador: el plazo del foro puede ser mayor. Días corridos, vencimiento a las 24:00 del último día (Pin 5).',
      };
    }
    return out;
  },
};

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
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa el reintegro', base_legal: 'Res. 1532/98 Art. 13' };
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
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa el reencaminamiento o endoso', base_legal: 'Res. 1532/98 Art. 12' };
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
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa los servicios incidentales', base_legal: 'Res. 1532/98 Art. 12' };
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
/* MARCO — Convenio de Montreal 1999 (overlay)                         */
/* ================================================================== */

var MARCO_MONTREAL = {
  marco: 'MONTREAL',

  test: function (caso) {
    var base = 'Convenio de Montreal 1999 Art. 1 (transporte internacional) — Test E del ruteo';
    if (caso.internacional == null) {
      return { aplica: 'falta_dato', activado_por: 'No se pudo determinar si el transporte es internacional', base_legal: base, dato_faltante: 'origen_iata / destino_iata' };
    }
    if (caso.internacional === false) {
      return { aplica: 'no', activado_por: 'Test E: transporte doméstico. El overlay Montreal solo aplica al internacional', base_legal: base };
    }
    if (caso.montreal_ambos_partes !== true) {
      return {
        aplica: 'falta_dato',
        activado_por: 'Test E: transporte internacional, pero no está confirmado que ambos Estados sean parte de Montreal',
        base_legal: base,
        dato_faltante: 'Estados parte de Montreal (' + (caso.paises || []).join(', ') + ')',
      };
    }
    return {
      aplica: 'si',
      activado_por: 'Test E: transporte internacional entre Estados parte de Montreal (' + (caso.paises || []).join('→') + ')',
      base_legal: base,
      nota: 'Capa superpuesta: EU261 da la compensación tarifada por molestia y Montreal cubre el daño acreditado. La compensación EU261 puede deducirse de la indemnización suplementaria (Art. 12 EU261). No hay doble recuperación por el mismo daño.',
    };
  },

  categorias: [
    {
      categoria: 'equipaje',
      base_legal: 'Convenio de Montreal Art. 17(2) (equipaje registrado) y Art. 19 (retraso)',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        if (!algunEquipaje(caso)) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye incidentes de equipaje', base_legal: 'Convenio de Montreal Art. 17(2)/19' };
        }
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.tope_sdr_montreal.nodo,
          monto: { unidad: 'SDR', formula: 'tope del Art. 22(2)', cantidad_pendiente: true },
          base_legal: 'Convenio de Montreal Art. 17(2)/19 + Art. 22(2) (tope)',
          nota: 'Topes en DEG/SDR diferidos a la cuantificación. La declaración especial de interés (Art. 22(2)) es una excepción, no un campo de intake.',
          nodos_eval: [nodoCon(NODO.tope_sdr_montreal, 'MONTREAL'), nodoCon(NODO.suficiencia_probatoria, 'MONTREAL')],
        };
      },
    },
    {
      categoria: 'dano_por_demora_pasajeros',
      base_legal: 'Convenio de Montreal Art. 19: daño causado por retraso en el transporte de pasajeros',
      consume: function (caso) { return tiene(caso, 'demora') || tiene(caso, 'conexion_perdida') ? ['incidentes', 'demora_llegada_min'] : ['incidentes']; },
      evaluar: function (caso) {
        if (!tiene(caso, 'demora') && !tiene(caso, 'conexion_perdida')) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye demora', base_legal: 'Convenio de Montreal Art. 19' };
        }
        if (caso.demora_llegada_min == null) {
          return { estado: 'FALTA_DATO', dato_faltante: 'demora_llegada_min', base_legal: 'Convenio de Montreal Art. 19' };
        }
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.suficiencia_probatoria.nodo,
          monto: { unidad: 'SDR', formula: 'tope del Art. 22(1)', cantidad_pendiente: true },
          base_legal: 'Convenio de Montreal Art. 19 + Art. 22(1) (tope)',
          nota: 'Daño acreditado por el arribo tardío (' + caso.demora_llegada_min + ' min). Exonera al transportista la prueba de haber adoptado todas las medidas razonables. Tope diferido.',
          nodos_eval: [nodoCon(NODO.tope_sdr_montreal, 'MONTREAL'), nodoCon(NODO.suficiencia_probatoria, 'MONTREAL')],
        };
      },
    },
    {
      categoria: 'muerte_lesion',
      base_legal: 'Convenio de Montreal Art. 17(1): muerte o lesión corporal del pasajero',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        if (!tiene(caso, 'muerte_lesion')) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye muerte ni lesión', base_legal: 'Convenio de Montreal Art. 17(1)' };
        }
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.analisis_manual_muerte_lesion.nodo,
          monto: { unidad: 'SDR', formula: 'Art. 21 (responsabilidad objetiva hasta el tope, y sin tope con culpa)', cantidad_pendiente: true },
          base_legal: 'Convenio de Montreal Art. 17(1) + Art. 21',
          nota: 'Fuera del intake estándar: excepción de análisis manual.',
          nodos_eval: [nodoCon(NODO.analisis_manual_muerte_lesion, 'MONTREAL')],
        };
      },
    },
    {
      categoria: 'punitivo',
      base_legal: 'Convenio de Montreal Art. 29: la acción por daños no da lugar a indemnización punitiva, ejemplar o de cualquier naturaleza no compensatoria',
      consume: function () { return []; },
      evaluar: function () {
        return { estado: 'NO_APLICA', motivo: 'Montreal excluye expresamente toda indemnización no compensatoria', base_legal: 'Convenio de Montreal Art. 29' };
      },
    },
  ],

  prescripcion: function (caso, hoy, U, ctx) {
    var base = 'Convenio de Montreal Art. 35: 2 años desde la llegada a destino, desde la llegada prevista, o desde la detención del transporte';
    if (!caso.fecha_incidente) {
      return { computable: false, tipo: 'firme', plazo: U.prescripcion_montreal_anios + ' años', fecha_limite: null, base_legal: base, nota: 'Sin fecha del incidente no se puede calcular la fecha límite.' };
    }
    return {
      computable: true,
      tipo: 'firme',
      plazo: U.prescripcion_montreal_anios + ' años',
      fecha_limite: ctx.sumarAnios(caso.fecha_incidente, U.prescripcion_montreal_anios),
      base_legal: base,
      nota: 'Días corridos, vencimiento a las 24:00 del último día (Pin 5).',
    };
  },
};

/* ================================================================== */
/* MARCOS — triggers sin árbol profundo (fases diferidas)              */
/* ================================================================== */

var MARCO_DOT = {
  marco: 'DOT',
  test: function (caso) {
    if (!caso.ruta || !caso.ruta.length) {
      return { aplica: 'falta_dato', activado_por: 'Itinerario desconocido', base_legal: 'Test B del ruteo', dato_faltante: 'origen_iata / destino_iata' };
    }
    if (tocaPais(caso, 'US')) {
      return {
        aplica: 'pendiente_analisis_profundo',
        activado_por: 'Test B: el itinerario sale de, llega a o es dentro de EE.UU.',
        base_legal: 'Régimen DOT (refund rule + compensación por denied boarding) — Test B del ruteo',
        nota: 'Trigger sin árbol: el alcance preciso y los montos quedan a la fase profunda US. No se emiten categorías.',
      };
    }
    return { aplica: 'no', activado_por: 'Test B: el itinerario no toca EE.UU.', base_legal: 'Test B del ruteo' };
  },
  categorias: [],
};

var MARCO_ANAC400 = {
  marco: 'ANAC400',
  test: function (caso) {
    if (!caso.ruta || !caso.ruta.length) {
      return { aplica: 'falta_dato', activado_por: 'Itinerario desconocido', base_legal: 'Test C del ruteo', dato_faltante: 'origen_iata / destino_iata' };
    }
    if (tocaPais(caso, 'BR')) {
      return {
        aplica: 'pendiente_analisis_profundo',
        activado_por: 'Test C: el itinerario sale de, llega a o es dentro de Brasil',
        base_legal: 'Resolução ANAC 400/2016 — Test C del ruteo',
        nota: 'Trigger sin árbol: queda a la fase profunda BR. No se emiten categorías.',
      };
    }
    return { aplica: 'no', activado_por: 'Test C: el itinerario no toca Brasil', base_legal: 'Test C del ruteo' };
  },
  categorias: [],
};

/* ================================================================== */
/* Export                                                              */
/* ================================================================== */

export var RULESET = {
  version: '2026-06-19',
  fuente: 'docs/Capa_1_-_Logica_legal_determinista_v2.1.md (v2.1.1)',
  /* Vigencia por fecha del incidente (ley al momento del hecho). `hasta: null` = vigente.
     La reforma EU261 cerró acuerdo político el 15-jun-2026 y aplica ~2027: cuando entre
     en vigor se agrega un ruleset nuevo con `desde` en esa fecha, sin tocar el evaluador. */
  vigencia: { desde: '2004-02-17', hasta: null },
  umbrales: UMBRALES,
  /* Orden de evaluación irrelevante: los marcos se evalúan en paralelo y no se elige
     ganador (Principio 1). MONTREAL va antes que EU261 solo porque la prescripción de
     EU261 consulta si el overlay aplica. */
  marcos: [MARCO_MONTREAL, MARCO_EU261, MARCO_RES1532, MARCO_DOT, MARCO_ANAC400],
};

export default RULESET;
