/**
 * tests/casos-dorados.js
 *
 * Casos dorados del motor legal: entrada + salida esperada. Los escribe JPA, porque la
 * salida esperada es un CRITERIO LEGAL, no un detalle de implementación.
 *
 * Se corren con: node tests/motor.test.js
 *
 * ------------------------------------------------------------------
 * FORMA DE UN CASO
 * ------------------------------------------------------------------
 * {
 *   id: 'CD-NN',
 *   descripcion: 'una línea, en castellano',
 *   caso: { ...columnas de `reclamos` según el contrato §1... },
 *   esperado: { ...ver abajo... }
 * }
 *
 * `caso` son las COLUMNAS del reclamo (contrato §1), no el objeto derivado: el runner le
 * pasa la fila al normalizador y después al motor, así el caso dorado prueba la cadena
 * completa. Si hiciera falta saltear el normalizador y armar el caso derivado a mano,
 * se usa `caso_normalizado` en lugar de `caso`.
 *
 * ------------------------------------------------------------------
 * FORMA DE `esperado` — se comparan SOLO las claves declaradas
 * ------------------------------------------------------------------
 * Todas las claves son opcionales. Lo que no se declara, no se chequea.
 *
 *   marcos:              { EU261: 'si' | 'no' | 'pendiente_analisis_profundo' | 'falta_dato' }
 *   categorias_clave:    { 'EU261.compensacion_tarifada': 'RECLAMABLE' }
 *                        ...o un objeto para comparar más de un campo:
 *                        { 'EU261.compensacion_tarifada': { estado: 'RECLAMABLE',
 *                                                           monto: { valor: 300, moneda: 'EUR' } } }
 *   gates:               { 'RES1532.protesta': 'inadmisible' }  (o un objeto parcial)
 *   prescripcion:        { RES1532: { tipo: 'firme', plazo: '1 año' } }
 *   nodos_eval_incluye:  ['causa_disrupcion']
 *   nodos_eval_excluye:  ['circunstancias_extraordinarias']
 *   faltan_datos_incluye:['checkin_presentacion']
 *   provisional:         true | false
 *   normalizacion:       { distancia_km: 10087, banda_eu261: '>3500' }   (parcial)
 *   resumen:             { categorias_reclamables: 3 }                    (parcial)
 *   parcial:             { ...cualquier subconjunto de analisis_legal, comparado en profundidad... }
 *
 * ------------------------------------------------------------------
 * ESQUELETOS TODO-JPA
 * ------------------------------------------------------------------
 * Un caso con `esperado: {}` se SALTEA con aviso, no falla. Sirve para dejar reservada la
 * cobertura mínima del contrato §5 sin que el suite quede rojo mientras JPA la completa.
 *
 * Para ayudar a completarlos, cada esqueleto trae en un comentario la SALIDA ACTUAL del
 * motor. **No es la respuesta correcta: es lo que el motor contesta hoy.** JPA la
 * confirma o la corrige; hasta entonces nada de eso está asertado.
 */

export var CASOS = [

  /* ================================================================
     CD-01 — completo (viene del §5 del documento de contratos)
     ================================================================ */
  {
    id: 'CD-01',
    descripcion: 'Doméstico AR, demora de salida 5 h, causa operativa, sin equipaje',
    caso: {
      ref_code: 'CD-01',
      origen_iata: 'AEP',
      destino_iata: 'COR',
      aerolinea: 'Aerolíneas Argentinas',
      incidentes: ['demora'],
      demora_salida_min: 300,
      causa_alegada: 'Motivo operativo de la aerolínea',
      fecha_incidente: '2026-05-10',
      billete_unico: true,
      checkin_presentacion: 'en_hora',
    },
    esperado: {
      marcos: { RES1532: 'si', EU261: 'no', MONTREAL: 'no' },
      categorias_clave: {
        'RES1532.servicios_incidentales': 'RECLAMABLE',
        'RES1532.compensacion_tarifada': 'NO_APLICA',
      },
      nodos_eval_incluye: ['causa_disrupcion'],
      prescripcion: { RES1532: { tipo: 'firme', plazo: '1 año' } },
    },
  },

  /* ================================================================
     ESQUELETOS — cobertura mínima del §5. completar JPA — criterio legal
     ================================================================ */

  {
    id: 'CD-02',
    descripcion: 'Doméstico AR, demora de salida 3 h (por debajo del gatillo de 4 h del Art. 12)',
    caso: {
      ref_code: 'CD-02',
      origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
      incidentes: ['demora'], demora_salida_min: 180, demora_llegada_min: 180,
      causa_alegada: 'Motivo operativo de la aerolínea',
      fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         marcos: RES1532 si · EU261 no · MONTREAL no
         RES1532.servicios_incidentales: NO_APLICA (180 min no supera el gatillo de 240)
         RES1532.reintegro: RECLAMABLE · RES1532.reencaminamiento_endoso: RECLAMABLE
         RES1532.dano_por_demora: REQUIERE_EVALUACION (unidad AO, cantidad pendiente) */
    esperado: {},
  },

  {
    id: 'CD-03',
    descripcion: 'Retraso EU261 de 2 h 59 min en la llegada: borde inferior del umbral de Sturgeon (Pin 1)',
    caso: {
      ref_code: 'CD-03',
      origen_iata: 'MAD', destino_iata: 'BCN', aerolinea: 'Iberia',
      incidentes: ['demora'], demora_llegada_min: 179, demora_salida_min: 179,
      fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         EU261.compensacion_tarifada: NO_APLICA (179 < 180 min)
         EU261.atencion: RECLAMABLE (179 min de salida supera el umbral de 120 de la banda ≤1500)
         monto_tarifado_total: [] */
    esperado: {},
  },

  {
    id: 'CD-04',
    descripcion: 'Retraso EU261 de 3 h 01 min en la llegada: borde superior del umbral de Sturgeon (Pin 1)',
    caso: {
      ref_code: 'CD-04',
      origen_iata: 'MAD', destino_iata: 'BCN', aerolinea: 'Iberia',
      incidentes: ['demora'], demora_llegada_min: 181, demora_salida_min: 181,
      fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         EU261.compensacion_tarifada: RECLAMABLE, monto {valor: 250, moneda: 'EUR'} */
    esperado: {},
  },

  {
    id: 'CD-05',
    descripcion: 'EZE→MAD en Iberia, retraso de 3 h 30 min: Tests A2 + D + E juntos, y reducción del 50 % (€300)',
    caso: {
      ref_code: 'CD-05',
      origen_iata: 'EZE', destino_iata: 'MAD', aerolinea: 'Iberia',
      incidentes: ['demora'], demora_llegada_min: 210, demora_salida_min: 210,
      causa_alegada: 'Problema técnico de la aeronave',
      fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         marcos: EU261 si (A2, carrier comunitario) · RES1532 si (parte de AR) · MONTREAL si
         normalizacion: distancia_km 10087 · banda >3500
         EU261.compensacion_tarifada: RECLAMABLE, monto {valor: 300, moneda: 'EUR'}
           (reducción del Art. 7(2): >3500 km con llegada entre 3 h y 4 h)
         EU261.prescripcion: tipo segun_foro, sin fecha, con piso_conservador 2028-05-10
         RES1532.prescripcion: tipo firme, 2 años (internacional) */
    esperado: {},
  },

  {
    id: 'CD-06',
    descripcion: 'Cancelación EU261 con aviso de 5 días y reencaminamiento dentro del margen del inciso (iii)',
    caso: {
      ref_code: 'CD-06',
      origen_iata: 'MAD', destino_iata: 'BCN', aerolinea: 'Iberia',
      incidentes: ['cancelacion'], antelacion_aviso_dias: 5,
      reencaminamiento: { ofrecido: true, delta_salida_min: -30, delta_llegada_min: 90, aceptado: true },
      fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'no_aplica',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         EU261.compensacion_tarifada: NO_APLICA (exoneración del Art. 5(1)(c)(iii))
         EU261.reembolso / reencaminamiento / atencion: RECLAMABLE (siempre, Art. 5(1)(a)(b)) */
    esperado: {},
  },

  {
    id: 'CD-07',
    descripcion: 'Cancelación EU261 con aviso de 5 días y reencaminamiento FUERA del margen: reducción del 50 %',
    caso: {
      ref_code: 'CD-07',
      origen_iata: 'EZE', destino_iata: 'MAD', aerolinea: 'Iberia',
      incidentes: ['cancelacion'], antelacion_aviso_dias: 5,
      reencaminamiento: { ofrecido: true, delta_salida_min: -30, delta_llegada_min: 200, aceptado: true },
      fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'no_aplica',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         EU261.compensacion_tarifada: RECLAMABLE, monto {valor: 300, moneda: 'EUR'}
           (banda >3500 reducida al 50 %: la llegada del reencaminamiento queda a 200 min,
            por debajo del margen de 240 min de la banda — Art. 7(2))
       OJO: acá la reducción sale de comparar el reencaminamiento contra el margen de la
       banda, distinto del caso de retraso puro (CD-05), donde sale de la demora de llegada.
       Al ser EZE→MAD también se activan RES1532 (parte de AR) y MONTREAL: 7 categorías
       reclamables en total, y las prescripciones de AR y Montreal firmes a 2 años. */
    esperado: {},
  },

  {
    id: 'CD-08',
    descripcion: 'Check-in desconocido en un retraso EU261: el gate del Art. 3(2) no se presume (Pin 3)',
    caso: {
      ref_code: 'CD-08',
      origen_iata: 'MAD', destino_iata: 'BCN', aerolinea: 'Iberia',
      incidentes: ['demora'], demora_llegada_min: 240, demora_salida_min: 240,
      fecha_incidente: '2026-05-10', billete_unico: true,
      /* checkin_presentacion sin cargar → 'desconocido' */
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         EU261.gates.checkin: falta_dato
         EU261.compensacion_tarifada: FALTA_DATO (bloqueada por el gate), y con ella
           reembolso, reencaminamiento, atencion, downgrade y compensacion_suplementaria:
           el gate declara alcance sobre todas las categorías del régimen de disrupción
         faltan_datos incluye checkin_presentacion
         provisional: false — contraintuitivo pero correcto: al quedar todo bloqueado por el
           gate, ninguna categoría llegó a apoyarse en un dato sin verificar */
    esperado: {},
  },

  {
    id: 'CD-09',
    descripcion: 'Equipaje internacional dañado con protesta fuera del plazo de 7 días: inadmisible (Art. 20 Res 1532)',
    caso: {
      ref_code: 'CD-09',
      origen_iata: 'EZE', destino_iata: 'MAD', aerolinea: 'Iberia',
      incidentes: ['equipaje_dano'],
      /* fecha_incidente en equipaje = fecha de ENTREGA (Tabla A fila 13) */
      fecha_incidente: '2026-05-01',
      protesta: { realizada: 'si', fecha: '2026-05-15', medio: 'escrita' },
      billete_unico: true, checkin_presentacion: 'en_hora',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         RES1532.gates.protesta: inadmisible (14 días corridos > plazo de 7 internacional)
         RES1532.equipaje: NO_APLICA por el gate
         MONTREAL.equipaje: REQUIERE_EVALUACION — el gate de protesta está declarado en el
           marco AR, no en Montreal. ¿Debería el Art. 31 de Montreal tener su propio gate
           equivalente? Ver §2ter.2 de docs/motor-capa1-pendientes-legales.md */
    esperado: {},
  },

  {
    id: 'CD-10',
    descripcion: 'Equipaje perdido con SOLO PIR de aeropuerto: el gate pasa provisionalmente (Pin 3)',
    caso: {
      ref_code: 'CD-10',
      origen_iata: 'AEP', destino_iata: 'COR', aerolinea: 'Aerolíneas Argentinas',
      incidentes: ['equipaje_perdida'],
      /* fecha_incidente = fecha en que el equipaje debió ponerse a disposición */
      fecha_incidente: '2026-05-01',
      protesta: { realizada: 'si', fecha: '2026-05-02', medio: 'pir', numero: 'AEP-2026-0091' },
      billete_unico: true, checkin_presentacion: 'en_hora',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         RES1532.gates.protesta: pasa_provisional (1 día, plazo interno de 10)
         nodos_eval incluye suficiencia_protesta_pir
         RES1532.equipaje: RECLAMABLE, monto simbólico {unidad: 'AO', cantidad_pendiente: true}
         nodos_eval incluye cotizacion_ao */
    esperado: {},
  },

  {
    id: 'CD-11',
    descripcion: 'Billete único vía hub UE sin origen ni destino en la UE (JFK→MAD→EZE): nodo borde Wegener (Pin 4)',
    caso: {
      ref_code: 'CD-11',
      billete_unico: true,
      segmentos: [
        { orden: 1, origen_iata: 'JFK', destino_iata: 'MAD', carrier_operante: 'Iberia', fecha: '2026-05-10' },
        { orden: 2, origen_iata: 'MAD', destino_iata: 'EZE', carrier_operante: 'Iberia', fecha: '2026-05-11' },
      ],
      incidentes: ['demora'], demora_llegada_min: 300, demora_salida_min: 300,
      fecha_incidente: '2026-05-10', checkin_presentacion: 'en_hora',
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         EU261: pendiente_analisis_profundo, SIN categorías (no se resuelve por regla)
         nodos_eval incluye borde_cobertura_hub
         DOT: pendiente_analisis_profundo (el itinerario toca EE.UU.)
         MONTREAL: si · RES1532: no (no parte de Argentina) */
    esperado: {},
  },

  {
    id: 'CD-12',
    descripcion: 'Campo crítico en conflicto entre fuentes: el análisis sale provisional y la categoría en FALTA_DATO (§1.1)',
    caso: {
      ref_code: 'CD-12',
      origen_iata: 'MAD', destino_iata: 'BCN', aerolinea: 'Iberia',
      incidentes: ['demora'], demora_llegada_min: 200, demora_salida_min: 200,
      fecha_incidente: '2026-05-10', billete_unico: true, checkin_presentacion: 'en_hora',
      datos_extraidos: [
        { campo: 'demora_llegada_min', valor: 200, fuente: 'declaracion_pasajero', extraido_en: '2026-05-12T10:00:00Z' },
        { campo: 'demora_llegada_min', valor: 95, fuente: 'adjunto', archivo: 'doc_2.pdf', extraido_en: '2026-05-12T10:05:00Z' },
      ],
      /* Todo lo demás verificado a propósito, para que el único dato dudoso del caso sea
         el que está en conflicto y la pregunta sobre `provisional` quede aislada. */
      campos_meta: {
        incidentes: { verificado: true, fuente: 'formulario', conflicto: false },
        fecha_incidente: { verificado: true, fuente: 'adjunto', conflicto: false },
        checkin_presentacion: { verificado: true, fuente: 'admin', conflicto: false },
        billete_unico: { verificado: true, fuente: 'admin', conflicto: false },
        demora_salida_min: { verificado: true, fuente: 'api_vuelo', conflicto: false },
        demora_llegada_min: { verificado: false, fuente: 'adjunto', conflicto: true },
      },
    },
    /* completar JPA — criterio legal.
       Salida actual del motor (a confirmar, no asertada):
         EU261.compensacion_tarifada: FALTA_DATO (crítico en conflicto = FALTA_DATO, §1.1)
         faltan_datos incluye demora_llegada_min con en_conflicto: true
         EU261.atencion: RECLAMABLE (se apoya en demora_salida_min, que está verificado)
         provisional: false

       PREGUNTA PARA JPA: ¿está bien ese `false`?
       El §2 regla 3 condiciona el flag a que el campo dudoso se haya USADO, y acá no se
       usó: la categoría que lo consumía quedó bloqueada en FALTA_DATO antes de evaluarse.
       Formalmente el análisis emitido no se apoya en ningún dato dudoso. Pero se puede
       argumentar lo contrario: que un crítico en conflicto ensucia el caso entero y debería
       marcarlo provisional igual. Es criterio, no implementación. */
    esperado: {},
  },
];

export default CASOS;
