/**
 * api/_utils/rulesets/2024-10-10.js — régimen AR IV-B
 * Reglamento del Contrato Aéreo de Pasajeros y Equipaje (Decreto 809/2024, Anexo I).
 *
 * Reglas legales como DATOS. Incidentes DESDE EL 10-OCT-2024: el Dec. 809/2024 (B.O.
 * 10-sep-2024) derogó la Res. 1532/98 y entró en vigor a los 30 días corridos (Art. 7).
 * Los incidentes anteriores los toma `2026-06-19.js` (Parte IV-A), que sigue siendo ley
 * al momento del hecho para esa cola.
 *
 * El archivo se llama por la fecha en que empieza a regir, que es lo que consulta
 * `seleccionarRuleset(fecha_incidente)`.
 *
 * Acá vive SOLO el bloque argentino. EU261, Montreal, DOT y ANAC 400 se importan de
 * `_compartido.js`: no cambian entre vigencias del régimen AR.
 *
 * Qué cambia material vs. IV-A, y por qué importa al leer un análisis:
 *   - Los incidentales pasan a ser ESCALONADOS: el alojamiento subió de >4 h a >8 h.
 *   - Aparece el régimen nocturno (D4): una espera corta pero de madrugada sí genera
 *     comidas y refrescos.
 *   - `reprogramacion` es tipo propio (Art. 42), ya no se caracteriza como cancelación.
 *   - El daño menor de equipaje deja de ser indemnizable (Art. 61 b).
 *   - Los plazos se cuentan excluyendo el día inicial (Art. 1, def. DÍAS).
 *
 * Fuente legal: docs/Capa_1_-_Logica_legal_determinista_v2.2.md, Parte IV-B.
 * Ambigüedades no resueltas: docs/motor-capa1-pendientes-legales.md.
 * Acá NO se inventa regla: donde el documento no decide, se emite FALTA_DATO o un nodo
 * [REQUIERE EVALUACIÓN].
 */
import {
  UMBRALES_COMPARTIDOS, MARCOS_COMPARTIDOS,
  NODO, nodoCon, tiene, algunEquipaje, parteDe, tocaPais, jurisdiccion,
} from './_compartido.js';

/* ================================================================== */
/* UMBRALES — bloque argentino del Reglamento 809/2024                 */
/* ================================================================== */

export var UMBRALES_AR = {
  /* Art. 43: servicios incidentales ESCALONADOS, medidos sobre el retraso del horario de
     partida (el Reglamento valida textualmente el Pin 2). En minutos, porque el borde
     4h00 vs 4h01 decide si hay comida y el 8h00 vs 8h01 si hay hotel. */
  ar809_incidentales_comidas_min: 240,        // > 4 h y hasta 8 h → comidas y refrescos
  ar809_incidentales_alojamiento_min: 480,    // > 8 h → + alojamiento y traslados

  /* Art. 43 a — régimen nocturno (criterio D4, fijado por JPA el 30-jul-2026): una espera
     que transcurre total o parcialmente entre las 00:00 y las 06:00 activa el inciso b
     (comidas y refrescos) aunque el retraso no llegue a 4 h. El criterio es la ESPERA
     transcurriendo en la franja, por finalidad asistencial. */
  ar809_nocturno_desde_hora: 0,
  ar809_nocturno_hasta_hora: 6,

  /* Art. 48: reintegro por demora superior a 4 h respecto del horario publicado. */
  ar809_reintegro_demora_min: 240,
  /* Arts. 47-48: plazo de reintegro, mismo medio y moneda. Dato informativo: el motor no
     cuantifica ni controla el vencimiento del pago. */
  ar809_reintegro_plazo_dias: 30,

  /* Art. 42: excepciones de la reprogramación anticipada imputable. */
  ar809_reprogramacion_aviso_exonera_dias: 14,     // i) aviso ≥ 2 semanas
  ar809_reprogramacion_aviso_intermedio_dias: 7,   // ii) entre 2 semanas y 7 días + alternativo

  /* Art. 44: el aviso con esta antelación exime los incidentales (junto con meteo, caso
     fortuito y fuerza mayor). */
  ar809_eximente_aviso_dias: 15,

  /* Art. 61: plazos de protesto en días corridos. Pérdida y retraso desde que el equipaje
     debió ponerse a disposición; daño desde la entrega (o antes de retirarse del
     aeródromo, para el tope de 3 AO por bulto). */
  ar809_protesto_dias: {
    dano:    { interno: 3,  internacional: 7 },
    perdida: { interno: 10, internacional: 21 },
  },
  /* Art. 61 a: la compensación de gastos de primera necesidad se paga dentro de las 24 h
     del protesto. Dato informativo del derecho, no un umbral de admisibilidad. */
  ar809_primera_necesidad_horas: 24,
  /* Art. 61 b: tope del daño que afecta la funcionalidad del equipaje. */
  ar809_dano_funcional_ao_por_bulto: 3,

  /* Art. 19 a Res. 1532 → hoy Código Aeronáutico Arts. 140/144/145: los topes del
     transporte INTERNO en Argentinos Oro no los cambió el Reglamento. */
  ar_topes_ao: {
    equipaje_registrado_por_kg: 2,
    equipaje_mano_por_pasajero: 40,
    muerte_lesion_por_pasajero: 1000,
  },

  /* Art. 71: prescripción, con exclusión del dies a quo (Art. 1, def. DÍAS). */
  prescripcion_ar_interno_anios: 1,

  /* Cita del foro en transporte interno para el bloque de jurisdicción. */
  jurisdiccion_base_domestica: 'Reglamento Dec. 809/2024 Anexo I Art. 13 + Código Aeronáutico Art. 198 — materia federal',
};

/* Umbrales que ve el evaluador: los compartidos más el bloque argentino de ESTA vigencia. */
export var UMBRALES = Object.assign({}, UMBRALES_COMPARTIDOS, UMBRALES_AR);

/* ================================================================== */
/* Nodos [REQUIERE EVALUACIÓN] propios del Reglamento                  */
/* ================================================================== */

/* Mismos `nodo` que en IV-A donde el nodo es el mismo (el evaluador deduplica por
   (nodo, marco)); cambia el `dato_concreto` porque cambió la fuente normativa. */
var NODO_809 = {
  causa_disrupcion: {
    nodo: 'causa_disrupcion',
    dato_concreto: '¿Meteorología, caso fortuito o fuerza mayor (Art. 44)? Apaga SOLO los servicios incidentales; no apaga el reintegro (Arts. 47/48), el deber de información (Art. 44 i) ni la responsabilidad de Montreal / Código Aeronáutico',
  },
  compensacion_overbooking_voluntario: {
    nodo: 'compensacion_overbooking_voluntario',
    dato_concreto: 'Compensación del voluntario que cede su plaza: la fija cada transportador en sus Regulaciones (Art. 46), la norma no la tarifa',
  },
  sancion_caducidad_domestica: {
    nodo: 'sancion_caducidad_domestica',
    dato_concreto: 'Protesto doméstico fuera de plazo: el Anexo I formula el protesto como carga ("deberá presentar") sin la sanción expresa de inadmisibilidad del viejo Art. 20 b de la Res. 1532. Fuente normativa de la caducidad post-809 pendiente de verificación (D2)',
  },
  negligencia_equipaje_demorado: {
    nodo: 'negligencia_equipaje_demorado',
    dato_concreto: 'Demora de entrega del equipaje por razón técnica o meteorológica: no hay responsabilidad salvo negligencia probada (Art. 70), y la carga es del pasajero',
  },
};

/* ================================================================== */
/* Helpers de lectura (no deciden nada legal)                          */
/* ================================================================== */

/* Los incidentes que activan el régimen de alternativas y reintegro sin umbral de tiempo
   (Arts. 41, 43, 45). La demora y la reprogramación entran por su propia puerta. */
function activaRegimenSinUmbral(caso) {
  return tiene(caso, 'cancelacion') || tiene(caso, 'denegacion_embarque') || tiene(caso, 'conexion_perdida');
}

/**
 * Banda del Art. 43 según el retraso de partida, en la que cae el caso.
 * @returns {'nada'|'nocturno_indeterminado'|'comidas'|'alojamiento'|null} null = sin dato
 */
function bandaIncidentales(caso, U) {
  var min = caso.demora_salida_min;
  if (min == null) return null;
  if (min > U.ar809_incidentales_alojamiento_min) return 'alojamiento';
  if (min > U.ar809_incidentales_comidas_min) return 'comidas';
  /* ≤ 4 h: el Art. 43 a no obliga a nada SALVO que la espera caiga en la franja nocturna,
     y eso exige la hora programada de partida, que hoy el intake no captura por ninguna
     vía. No se presume que no fue nocturno: se declara el dato faltante (§2 regla 3). */
  return 'nocturno_indeterminado';
}

/* ================================================================== */
/* MARCO — Argentina (Reglamento Dec. 809/2024, Anexo I)               */
/* ================================================================== */

var MARCO_REGL809 = {
  marco: 'REGL809',

  test: function (caso) {
    var base = 'Reglamento del Contrato Aéreo (Dec. 809/2024) Anexo I Art. 2 (ámbito) — Test D del ruteo';
    if (caso.internacional == null || !caso.origen) {
      return {
        aplica: 'falta_dato',
        activado_por: 'No se pudo determinar el itinerario (doméstico AR o internacional con origen o destino en AR)',
        base_legal: base,
        dato_faltante: 'origen_iata / destino_iata',
      };
    }
    if (caso.internacional === false && parteDe(caso, 'AR')) {
      return { aplica: 'si', via: 'D-domestico', activado_por: 'Test D: vuelo doméstico argentino', base_legal: base };
    }
    /* Ámbito amplio (v2.2): el criterio es el servicio explotado en el país, no la
       dirección del vuelo. El regreso MAD→EZE está cubierto igual que la ida. El lugar de
       celebración del contrato es expresamente irrelevante en ambos sentidos. */
    if (caso.internacional === true && tocaPais(caso, 'AR')) {
      return {
        aplica: 'si',
        via: parteDe(caso, 'AR') ? 'D-internacional-origen' : 'D-internacional-destino',
        activado_por: 'Test D: vuelo internacional con ' + (parteDe(caso, 'AR') ? 'origen' : 'destino') + ' en Argentina',
        base_legal: base + ' ("servicios que exploten en la REPÚBLICA ARGENTINA… cualquiera sea el lugar de celebración del contrato")',
        nota: 'Siendo internacional, se activa además el overlay Montreal (Test E), que en responsabilidad y topes manda sobre el Reglamento (Anexo I Art. 3).',
      };
    }
    return {
      aplica: 'no',
      activado_por: 'Test D: la dirección analizada no toca territorio argentino',
      base_legal: base,
      nota: 'Una dirección que no toca Argentina no activa el régimen aunque el billete se haya comprado acá.',
    };
  },

  gates: [{
    gate: 'protesto',
    /* Art. 61: condición de admisibilidad del reclamo por equipaje. Mismo alcance que en
       IV-A: extenderlo a la disrupción de pasajeros mataría reclamos ajenos al equipaje. */
    alcance: ['equipaje', 'gastos_primera_necesidad'],
    aplica: function (caso) { return algunEquipaje(caso); },
    consume: function () { return ['protesta', 'fecha_incidente', 'incidentes']; },
    evaluar: function (caso, U, ctx) {
      var base = 'Reglamento Dec. 809/2024 Anexo I Art. 61 (protesto)';
      var esDano = tiene(caso, 'equipaje_dano');
      var tabla = esDano ? U.ar809_protesto_dias.dano : U.ar809_protesto_dias.perdida;
      var intl = caso.internacional;
      if (intl == null) {
        return { resultado: 'falta_dato', detalle: 'No se sabe si el transporte es internacional, y el plazo difiere', base_legal: base, dato_faltante: 'origen_iata / destino_iata' };
      }
      var plazo = intl ? tabla.internacional : tabla.interno;
      var detallePlazo = plazo + ' días corridos (' + (esDano ? 'daño, desde la entrega' : 'pérdida o retraso, desde que el equipaje debió ponerse a disposición') + ', transporte ' + (intl ? 'internacional' : 'interno') + ')';

      var p = caso.protesta;
      if (!p || !p.realizada || p.realizada === 'desconocido') {
        return { resultado: 'falta_dato', detalle: 'No se sabe si hubo protesto. Plazo aplicable: ' + detallePlazo, base_legal: base, dato_faltante: 'protesta' };
      }

      /* D2 — sanción de la caducidad, resuelta por JPA el 30-jul-2026 con la regla
         conservadora. En internacional la inadmisibilidad la aporta Montreal Art. 31(4),
         que es expresa. En doméstico el Anexo I formula el protesto como carga y NO
         reprodujo la sanción del viejo Art. 20 b de la 1532: el motor no la presume, deja
         pasar el caso provisionalmente y manda la pregunta a evaluación. */
      function fueraDePlazo(detalle) {
        if (intl) {
          return {
            resultado: 'inadmisible',
            detalle: detalle + ' Transporte internacional: la sanción de inadmisibilidad es expresa.',
            base_legal: base + ' + Convenio de Montreal Art. 31(4)',
          };
        }
        return {
          resultado: 'pasa_provisional',
          detalle: detalle + ' Transporte interno: el Reglamento no reprodujo la sanción expresa de inadmisibilidad del Art. 20 b de la Res. 1532, derogada. El caso pasa provisionalmente (D2).',
          base_legal: base,
          nodos_eval: [nodoCon(NODO_809.sancion_caducidad_domestica, 'REGL809', 'Protesto fuera del plazo de ' + detallePlazo)],
        };
      }

      if (p.realizada === 'no') {
        return fueraDePlazo('Sin protesto, habiendo un plazo de ' + detallePlazo + '.');
      }
      if (!p.fecha) {
        return { resultado: 'falta_dato', detalle: 'Protesto declarado pero sin fecha: el plazo de ' + detallePlazo + ' no se puede computar', base_legal: base, dato_faltante: 'protesta.fecha' };
      }
      if (!caso.fecha_incidente) {
        return { resultado: 'falta_dato', detalle: 'Sin fecha del incidente no se puede computar el plazo de protesto', base_legal: base, dato_faltante: 'fecha_incidente' };
      }
      var dias = ctx.diasCorridos(caso.fecha_incidente, p.fecha);
      if (dias == null) {
        return { resultado: 'falta_dato', detalle: 'Fechas no interpretables para computar el plazo de protesto', base_legal: base, dato_faltante: 'protesta.fecha' };
      }
      if (dias > plazo) {
        return fueraDePlazo('Protesto a los ' + dias + ' días, fuera del plazo de ' + detallePlazo + '.');
      }
      /* Pin 3, sin cambios: el gate se computa con la fecha de cualquier protesta, PIR
         incluido; si SOLO hay PIR pasa provisionalmente y se emite el nodo. */
      if (p.medio === 'pir') {
        return {
          resultado: 'pasa_provisional',
          detalle: 'PIR de aeropuerto a los ' + dias + ' días, dentro del plazo de ' + detallePlazo + '. La equivalencia PIR = protesto tiene jurisprudencia dividida',
          base_legal: base + ' + Convenio de Montreal Art. 31',
          nodos_eval: [nodoCon(NODO.suficiencia_protesta_pir, 'REGL809', 'Solo consta PIR' + (p.numero ? ' Nº ' + p.numero : '') + ', sin protesto escrito posterior')],
        };
      }
      return {
        resultado: 'pasa',
        detalle: 'Protesto escrito a los ' + dias + ' días, dentro del plazo de ' + detallePlazo,
        base_legal: base,
      };
    },
  }],

  categorias: [
    {
      categoria: 'compensacion_tarifada',
      base_legal: 'El Reglamento Dec. 809/2024 no tarifa compensación: la del voluntario que cede su plaza remite a las Regulaciones del Transportador (Anexo I Art. 46)',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        if (tiene(caso, 'denegacion_embarque')) {
          return {
            estado: 'REQUIERE_EVALUACION',
            eval_nodo: NODO_809.compensacion_overbooking_voluntario.nodo,
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Arts. 45 y 46',
            nota: 'El overbooking da derecho al régimen de los Arts. 41/42/43 (alternativas e incidentales), que se evalúan en sus propias categorías. La compensación del voluntario no está tarifada por la norma: la fija cada transportador. Aceptarla junto con el transporte alternativo cierra el reclamo posterior. La denegación con causa del Art. 38 (seguridad, documentación, conducta, tarifa impaga) queda fuera del régimen compensatorio.',
            nodos_eval: [nodoCon(NODO_809.compensacion_overbooking_voluntario, 'REGL809')],
          };
        }
        return {
          estado: 'NO_APLICA',
          motivo: 'El régimen argentino no tarifa compensación por disrupción, tampoco en el Reglamento 809/2024',
          base_legal: 'Reglamento Dec. 809/2024 Anexo I (no tarifa compensación)',
        };
      },
    },

    {
      categoria: 'reintegro',
      base_legal: 'Reglamento Dec. 809/2024 Anexo I Arts. 47 y 48: reintegro en 30 días, mismo medio y moneda, con reglas de cálculo expresas',
      consume: function (caso) {
        return (tiene(caso, 'demora') && !activaRegimenSinUmbral(caso)) ? ['incidentes', 'demora_salida_min'] : ['incidentes'];
      },
      evaluar: function (caso, U) {
        var calculo = 'Cálculo (Art. 48): ningún tramo realizado → tarifa completa; un tramo realizado → interno: la tarifa desde el punto de cancelación hasta el destino; internacional: la MAYOR entre la tarifa de ida desde la interrupción hasta el destino o primera parada-estancia, y la diferencia entre lo pagado y el transporte utilizado. Plazo de pago: ' + U.ar809_reintegro_plazo_dias + ' días, mismo medio y moneda. El monto es cuantificación, no esta capa.';
        if (activaRegimenSinUmbral(caso)) {
          return {
            estado: 'RECLAMABLE',
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Arts. 41, 43, 47 y 48',
            nota: 'Activado sin umbral de tiempo por cancelación, denegación de embarque o pérdida de conexión. ' + calculo,
          };
        }
        if (tiene(caso, 'demora')) {
          var min = caso.demora_salida_min;
          if (min == null) {
            return { estado: 'FALTA_DATO', dato_faltante: 'demora_salida_min', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 48 (gatillo: demora superior a 4 h respecto del horario publicado)' };
          }
          if (min > U.ar809_reintegro_demora_min) {
            return {
              estado: 'RECLAMABLE',
              base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 48',
              nota: 'Demora de partida de ' + min + ' min, por encima del gatillo de ' + U.ar809_reintegro_demora_min + ' min. ' + calculo,
            };
          }
          return {
            estado: 'NO_APLICA',
            motivo: 'Demora de partida de ' + min + ' min: el reintegro del Art. 48 se gatilla por encima de las 4 h',
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 48',
          };
        }
        if (tiene(caso, 'reprogramacion')) {
          return {
            estado: 'NO_APLICA',
            motivo: 'La reprogramación anticipada imputable (Art. 42) da derecho a los servicios incidentales del Art. 43, no al reintegro del Art. 48: el vuelo se cumple, corrido de fecha u horario',
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 42',
          };
        }
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa el reintegro', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 48' };
      },
    },

    {
      categoria: 'reencaminamiento_endoso',
      base_legal: 'Reglamento Dec. 809/2024 Anexo I Arts. 41, 43 y 45: inclusión en el vuelo inmediato posterior con disponibilidad en la misma clase y transportador, endoso a un transportador con convenio de contingencias, o reencaminamiento por otra ruta u otro medio',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso) {
        if (activaRegimenSinUmbral(caso) || tiene(caso, 'demora')) {
          return {
            estado: 'RECLAMABLE',
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Arts. 41, 43 y 45',
            nota: 'Derecho determinista: son alternativas a elección, y si ninguna resulta aceptable procede el reintegro. La demora que hace perder una conexión obliga además a gestionar la reubicación (Art. 43). Aceptar voluntaria y expresamente una alternativa cierra el reclamo posterior, salvo los incidentales.',
          };
        }
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa las alternativas de los Arts. 41/43/45', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 41' };
      },
    },

    {
      categoria: 'servicios_incidentales',
      base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 43: comunicaciones, comidas y refrescos según la espera, y a partir de las 8 h alojamiento y traslados. Art. 42 para la reprogramación; Art. 44 para las eximentes',
      consume: function (caso) {
        /* La demora y la reprogramación miden tiempo; cancelación, denegación y conexión
           perdida activan el régimen sin umbral. */
        if (activaRegimenSinUmbral(caso)) return ['incidentes'];
        /* La reprogramación NO declara `demora_salida_min`: las excepciones del Art. 42 se
           resuelven con la antelación del aviso, y la demora solo define el ESCALÓN del
           Art. 43. Declararla haría que un caso sin demora cargada saliera FALTA_DATO sin
           haber mirado siquiera si el aviso lo exceptúa. */
        if (tiene(caso, 'reprogramacion') && !tiene(caso, 'demora')) return ['incidentes', 'antelacion_aviso_dias'];
        if (tiene(caso, 'demora')) return ['incidentes', 'demora_salida_min'];
        return ['incidentes'];
      },
      evaluar: function (caso, U, ctx) {
        var nodos = [
          nodoCon(NODO_809.causa_disrupcion, 'REGL809', caso.causa_alegada ? 'Causa alegada: ' + caso.causa_alegada : 'Sin causa alegada registrada'),
          nodoCon(NODO.suficiencia_probatoria, 'REGL809', 'Gastos itemizados cargados: ' + (caso.gastos_items || []).length),
        ];
        var notaEximente = 'Eximentes del Art. 44: meteorología, caso fortuito o fuerza mayor, o aviso con al menos ' + U.ar809_eximente_aviso_dias + ' días. Apagan SOLO los incidentales —el reintegro, el deber de información y la responsabilidad de Montreal / Código Aeronáutico siguen encendidos— y subsiste el deber de informar. El monto son los gastos reales razonables.';

        if (activaRegimenSinUmbral(caso)) {
          return {
            estado: 'RECLAMABLE',
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Arts. 43 y 45',
            nota: 'Activado sin umbral de tiempo por cancelación, denegación de embarque o pérdida de conexión. ' + notaEximente,
            nodos_eval: nodos,
          };
        }

        /* Art. 42 — reprogramación anticipada imputable: da los incidentales del Art. 43
           según la demora, EXCEPTO si el aviso llegó con 2 semanas o más, o entre 2
           semanas y 7 días junto con transporte alternativo al destino final. */
        if (tiene(caso, 'reprogramacion') && !tiene(caso, 'demora')) {
          var aviso = caso.antelacion_aviso_dias;
          if (aviso == null) {
            return { estado: 'FALTA_DATO', dato_faltante: 'antelacion_aviso_dias', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 42 (excepciones por antelación del aviso)' };
          }
          if (aviso >= U.ar809_reprogramacion_aviso_exonera_dias) {
            return {
              estado: 'NO_APLICA',
              motivo: 'Reprogramación avisada con ' + aviso + ' días, a partir de las 2 semanas el Art. 42 exceptúa los servicios incidentales',
              base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 42 inc. i',
            };
          }
          if (aviso >= U.ar809_reprogramacion_aviso_intermedio_dias) {
            var r = caso.reencaminamiento;
            if (!r || r.ofrecido == null) {
              return { estado: 'FALTA_DATO', dato_faltante: 'reencaminamiento', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 42 inc. ii (aviso entre 2 semanas y 7 días con transporte alternativo)' };
            }
            if (r.ofrecido === true) {
              return {
                estado: 'NO_APLICA',
                motivo: 'Reprogramación avisada con ' + aviso + ' días y transporte alternativo ofrecido: el Art. 42 exceptúa los servicios incidentales',
                base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 42 inc. ii',
              };
            }
          }
          return {
            estado: 'RECLAMABLE',
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Arts. 42 y 43',
            nota: 'Reprogramación avisada con ' + aviso + ' días, fuera de las excepciones del Art. 42: corresponden los incidentales del Art. 43. '
              + (caso.demora_salida_min == null
                ? 'Qué escalón corresponde (comidas desde las 4 h, alojamiento desde las 8 h) depende de la demora efectiva, que no está cargada: el derecho existe igual. '
                : 'Escalón según la demora efectiva de ' + caso.demora_salida_min + ' min. ')
              + notaEximente,
            nodos_eval: nodos,
          };
        }

        if (tiene(caso, 'demora') || tiene(caso, 'reprogramacion')) {
          var banda = bandaIncidentales(caso, U);
          if (banda == null) {
            return { estado: 'FALTA_DATO', dato_faltante: 'demora_salida_min', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 43 (escalonado por retraso de partida)' };
          }
          var min = caso.demora_salida_min;
          if (banda === 'alojamiento') {
            return {
              estado: 'RECLAMABLE',
              base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 43 inc. c',
              nota: 'Retraso de partida de ' + min + ' min, por encima de las 8 h: comidas y refrescos MÁS alojamiento y los traslados hacia él. Cambio material respecto de la Res. 1532, donde el alojamiento se debía desde las 4 h. ' + notaEximente,
              nodos_eval: nodos,
            };
          }
          if (banda === 'comidas') {
            return {
              estado: 'RECLAMABLE',
              base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 43 inc. b',
              nota: 'Retraso de partida de ' + min + ' min, entre 4 h y 8 h: comidas y refrescos suficientes en función de la espera. El alojamiento recién se debe por encima de las 8 h. ' + notaEximente,
              nodos_eval: nodos,
            };
          }
          /* Banda ≤ 4 h: el resultado depende de si la espera cae entre las 00:00 y las
             06:00 (Art. 43 a, criterio D4), y la hora programada de partida no existe hoy
             en el intake. NO se presume que no fue nocturno: eso sería negarle en silencio
             al pasajero un derecho que quizás tiene. Ver el registro de pendientes: el dato
             va a entrar por el lookup de vuelo (procedencia `api_vuelo`), no por el
             formulario. */
          return {
            estado: 'FALTA_DATO',
            dato_faltante: 'hora_salida_programada',
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 43 inc. a (régimen nocturno)',
            nota: 'Retraso de partida de ' + min + ' min: por debajo de las 4 h no hay obligación de asistencia, SALVO que la espera transcurra total o parcialmente entre las 00:00 y las 06:00, en cuyo caso corresponden comidas y refrescos (criterio D4). Sin la hora programada de partida no se puede saber en qué franja transcurrió la espera.',
            nodos_eval: nodos,
          };
        }
        return { estado: 'NO_APLICA', motivo: 'Ningún incidente del caso activa los servicios incidentales', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 43' };
      },
    },

    {
      categoria: 'gastos_primera_necesidad',
      base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 61 a: ante el retraso del equipaje, compensación de los gastos de primera necesidad dentro de las 24 h del protesto, al pasajero que no esté en su lugar de residencia y se encuentre en el destino del viaje',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso, U) {
        if (!tiene(caso, 'equipaje_demora') && !tiene(caso, 'equipaje_perdida')) {
          return { estado: 'NO_APLICA', motivo: 'La categoría cubre el retraso del equipaje; el caso no lo incluye', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 61 a' };
        }
        return {
          estado: 'RECLAMABLE',
          base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 61 a',
          nota: 'Derecho determinista, novedad del Reglamento: se paga dentro de las ' + U.ar809_primera_necesidad_horas + ' h del protesto. El monto son los gastos de primera necesidad acreditados, y si después el equipaje no aparece, lo pagado se DEDUCE de la indemnización por no localización. Condición fáctica del beneficiario (fuera de su residencia, en el destino del viaje) y suficiencia de los comprobantes: evaluación.',
          nodos_eval: [nodoCon(NODO.suficiencia_probatoria, 'REGL809', 'Gastos itemizados cargados: ' + (caso.gastos_items || []).length)],
        };
      },
    },

    {
      categoria: 'equipaje',
      base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 61 + límites del Código Aeronáutico (AO, transporte interno) o del Convenio de Montreal (SDR, internacional)',
      consume: function () { return ['incidentes']; },
      evaluar: function (caso, U) {
        if (!algunEquipaje(caso)) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye incidentes de equipaje', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 61' };
        }
        var notaDano = tiene(caso, 'equipaje_dano')
          ? ' Daño: los daños menores que no afectan la funcionalidad, o propios del manipuleo, NO son indemnizables (Art. 61 b) — novedad restrictiva del Reglamento. El daño que sí afecta la funcionalidad se compensa hasta '
            + U.ar809_dano_funcional_ao_por_bulto + ' AO por bulto contra protesto efectuado antes de retirarse del aeródromo; si el pasajero no acepta esa compensación, queda el reclamo por las vías legales dentro de los límites aplicables.'
          : '';
        if (caso.internacional === true) {
          return {
            estado: 'REQUIERE_EVALUACION',
            eval_nodo: NODO.tope_sdr_montreal.nodo,
            monto: { unidad: 'SDR', formula: 'tope del Art. 22(2) Montreal', cantidad_pendiente: true },
            base_legal: 'Convenio de Montreal Art. 17(2)/19 (prelación del Anexo I Art. 3: en internacional los tratados mandan sobre el Reglamento)',
            nota: 'Transporte internacional: rige el overlay Montreal. Topes en DEG/SDR diferidos a la cuantificación.' + notaDano,
            nodos_eval: [nodoCon(NODO.tope_sdr_montreal, 'REGL809'), nodoCon(NODO.suficiencia_probatoria, 'REGL809')],
          };
        }
        if (caso.internacional === false) {
          var nodos = [nodoCon(NODO.cotizacion_ao, 'REGL809'), nodoCon(NODO.suficiencia_probatoria, 'REGL809')];
          if (tiene(caso, 'equipaje_demora')) nodos.push(nodoCon(NODO_809.negligencia_equipaje_demorado, 'REGL809'));
          return {
            estado: 'RECLAMABLE',
            monto: {
              unidad: 'AO',
              formula: U.ar_topes_ao.equipaje_registrado_por_kg + ' AO/kg de peso bruto (equipaje registrado); '
                + U.ar_topes_ao.equipaje_mano_por_pasajero + ' AO por pasajero (objetos en custodia)'
                + (tiene(caso, 'equipaje_dano') ? '; hasta ' + U.ar809_dano_funcional_ao_por_bulto + ' AO por bulto en el daño funcional del Art. 61 b' : ''),
              cantidad_pendiente: true,
            },
            base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 61 + Código Aeronáutico Arts. 140/145',
            nota: 'Tope determinista en la unidad; el valor del Argentino Oro es cuantificación diferida (BCRA, trimestral). '
              + 'El equipaje de mano no registrado no genera responsabilidad del transportador (Art. 61 in fine), y retirarlo sin reclamo hace presumir la entrega en buenas condiciones (Art. 58).' + notaDano,
            nodos_eval: nodos,
          };
        }
        return { estado: 'FALTA_DATO', dato_faltante: 'origen_iata / destino_iata (interno vs. internacional cambia el régimen y el tope)', base_legal: 'Reglamento Dec. 809/2024 Anexo I Art. 61' };
      },
    },

    {
      categoria: 'dano_por_demora',
      base_legal: 'Doméstico: Código Aeronáutico Art. 141 (tope en Argentinos Oro). Internacional: Convenio de Montreal Art. 19 (tope en DEG/SDR). El Reglamento no desplaza ninguno de los dos (Anexo I Art. 3)',
      consume: function (caso) { return tiene(caso, 'demora') ? ['incidentes', 'demora_llegada_min'] : ['incidentes']; },
      evaluar: function (caso) {
        if (!tiene(caso, 'demora') && !tiene(caso, 'conexion_perdida')) {
          return { estado: 'NO_APLICA', motivo: 'El caso no incluye demora', base_legal: 'Código Aeronáutico Art. 141 / Montreal Art. 19' };
        }
        /* Pin 2, sin cambios: el daño resarcible deriva del arribo tardío, no de la espera. */
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
          eval_nodo: NODO_809.causa_disrupcion.nodo,
          monto: intl
            ? { unidad: 'SDR', formula: 'tope del Art. 19 Montreal', cantidad_pendiente: true }
            : { unidad: 'AO', formula: 'tope del Art. 141 Código Aeronáutico', cantidad_pendiente: true },
          base_legal: intl ? 'Convenio de Montreal Art. 19' : 'Código Aeronáutico (Ley 17.285) Art. 141',
          nota: 'Daño acreditado, medido contra la demora de llegada al destino final (' + caso.demora_llegada_min + ' min, Pin 2). '
            + 'Eximente: causa técnica o meteorológica salvo negligencia probada. Las eximentes del Art. 44 apagan los incidentales, NO esta responsabilidad. Tope diferido a la cuantificación.',
          nodos_eval: [
            nodoCon(NODO_809.causa_disrupcion, 'REGL809', caso.causa_alegada ? 'Causa alegada: ' + caso.causa_alegada : 'Sin causa alegada registrada'),
            nodoCon(intl ? NODO.tope_sdr_montreal : NODO.cotizacion_ao, 'REGL809'),
          ],
        };
      },
    },

    {
      categoria: 'muerte_lesion',
      base_legal: 'Doméstico: Código Aeronáutico Arts. 139/144 (hasta 1.000 AO por pasajero). Internacional: Convenio de Montreal Art. 17(1). Más el régimen de pagos indemnizatorios adelantados del Anexo III del Dec. 809/2024',
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
          base_legal: caso.internacional === true ? 'Convenio de Montreal Art. 17(1)' : 'Código Aeronáutico Arts. 139/144',
          nota: 'Fuera del intake estándar: excepción de análisis manual. El Anexo III del Dec. 809/2024 agrega pagos a cuenta en accidentes, deducibles y sin reconocimiento de responsabilidad.',
          nodos_eval: [nodoCon(NODO.analisis_manual_muerte_lesion, 'REGL809')],
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
          nota: 'Admisible contra la aerolínea en el foro federal civil y comercial, sujeto a prueba y quantum. Los deberes de información y trato digno de los Arts. 4-11 y 16 no son rubros autónomos: son insumo de este nodo.',
          nodos_eval: [nodoCon(NODO.dano_moral_suplementario, 'REGL809')],
        };
      },
    },

    {
      categoria: 'dano_emergente',
      base_legal: 'Montreal Art. 19 (internacional) · Código Aeronáutico Art. 141, CCyC y Ley 24.240 supletoria (doméstico)',
      consume: function () { return []; },
      evaluar: function (caso) {
        return {
          estado: 'REQUIERE_EVALUACION',
          eval_nodo: NODO.suficiencia_probatoria.nodo,
          base_legal: caso.internacional === true ? 'Convenio de Montreal Art. 19' : 'Código Aeronáutico Art. 141 + CCyC / Ley 24.240 (supletoria, Art. 63)',
          nota: 'Monto = gastos acreditados. Gastos itemizados cargados: ' + (caso.gastos_items || []).length + '. '
            + (caso.internacional === true ? 'En transporte internacional, Montreal excluye los daños indirectos o consecuentes.' : ''),
          nodos_eval: [nodoCon(NODO.suficiencia_probatoria, 'REGL809')],
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
      ? 'Convenio de Montreal Art. 35 + Reglamento Dec. 809/2024 Anexo I Art. 71 (2 años)'
      : 'Reglamento Dec. 809/2024 Anexo I Art. 71 + Código Aeronáutico Art. 228 (1 año)';
    if (caso.internacional == null) {
      return { computable: false, tipo: 'firme', plazo: null, fecha_limite: null, base_legal: base, nota: 'No se sabe si el transporte es internacional: el plazo difiere (1 año interno / 2 años internacional).' };
    }
    var anios = caso.internacional ? U.prescripcion_montreal_anios : U.prescripcion_ar_interno_anios;
    var plazo = anios + (anios === 1 ? ' año' : ' años');
    if (!caso.fecha_incidente) {
      return { computable: false, tipo: 'firme', plazo: plazo, fecha_limite: null, base_legal: base, nota: 'Sin fecha del incidente no se puede calcular la fecha límite.' };
    }
    /* Art. 1, definición de DÍAS: corridos, EXCLUYENDO el día de la notificación, emisión
       o inicio. Es el refinamiento del Pin 5 que introduce el Reglamento y solo rige acá:
       el plazo arranca al día siguiente del hecho, así que la fecha límite corre un día. */
    var limite = ctx.sumarDias(ctx.sumarAnios(caso.fecha_incidente, anios), 1);
    return {
      computable: true,
      tipo: 'firme',
      plazo: plazo,
      fecha_limite: limite,
      base_legal: base,
      nota: 'Días corridos con exclusión del día inicial (Anexo I Art. 1, def. DÍAS): el cómputo arranca al día siguiente del hecho. '
        + 'Puntos de arranque expresos del Art. 71: la llegada (demoras y pérdidas); el día en que debió llegar la aeronave (cancelación); la detención del transporte (daños derivados de la cancelación); la declaración de ausencia, lesión o fallecimiento (daños personales); la emisión, para documentos de transporte no utilizados. '
        + 'La carga del protesto del Art. 61 es independiente de la prescripción.',
    };
  },
};

/* ================================================================== */
/* Export                                                              */
/* ================================================================== */

export var RULESET = {
  version: '2024-10-10',
  fuente: 'docs/Capa_1_-_Logica_legal_determinista_v2.2.md (Parte IV-B)',
  /* Vigencia por fecha del incidente (ley al momento del hecho). El Dec. 809/2024 se
     publicó el 10-sep-2024 y entró en vigor a los 30 días corridos (Art. 7). `hasta: null`
     = vigente: es el régimen de casi toda la cartera actual. */
  vigencia: { desde: '2024-10-10', hasta: null },
  umbrales: UMBRALES,
  marcos: MARCOS_COMPARTIDOS.concat([MARCO_REGL809]),
  /* Bloque informativo, no gate: ley aplicable y foro son planos distintos. */
  jurisdiccion: jurisdiccion,
};

export default RULESET;
