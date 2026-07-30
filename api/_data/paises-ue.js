/**
 * api/_data/paises-ue.js
 *
 * Conjuntos de países que consume el ruteo de jurisdicción (Componente 2 del v2.1).
 *
 * TODO en ISO-3166-1 alfa-2. Es el único idioma de países del motor: `airports.json`
 * trae `pais_iso` (de la columna iso_country de OurAirports) justamente para esto. El
 * campo `country` del JSON de aeropuertos es el nombre en inglés y NO se usa para
 * decidir nada legal.
 *
 * Semántica de la pertenencia, distinta por conjunto:
 *   - UE / EEE_CH son EXHAUSTIVOS y cerrados: un código que no está, no es Estado
 *     miembro. Es una lista de derecho positivo, no una muestra.
 *   - MONTREAL_PARTES es un SEED de los mercados objetivo: un código que no está NO
 *     significa "no es parte", significa DESCONOCIDO. Ver montrealParte().
 */

/* Los 27 Estados miembros de la UE. */
export var UE = new Set([
  'AT', // Austria
  'BE', // Bélgica
  'BG', // Bulgaria
  'CY', // Chipre
  'CZ', // Chequia
  'DE', // Alemania
  'DK', // Dinamarca
  'EE', // Estonia
  'ES', // España (incluye Canarias, Baleares, Ceuta y Melilla: mismo ISO)
  'FI', // Finlandia
  'FR', // Francia
  'GR', // Grecia
  'HR', // Croacia
  'HU', // Hungría
  'IE', // Irlanda
  'IT', // Italia
  'LT', // Lituania
  'LU', // Luxemburgo
  'LV', // Letonia
  'MT', // Malta
  'NL', // Países Bajos (la parte europea; el Caribe neerlandés tiene ISO propio)
  'PL', // Polonia
  'PT', // Portugal (incluye Azores y Madeira: mismo ISO)
  'RO', // Rumania
  'SE', // Suecia
  'SI', // Eslovenia
  'SK', // Eslovaquia
]);

/* Ámbito territorial de EU261: los 27 + la extensión a EEE (Islandia, Noruega,
   Liechtenstein) y a Suiza por acuerdo bilateral de transporte aéreo.
   v2.1 Test A, "Extensión territorial" [conocimiento-previo → pendiente reconfirmar]. */
export var EEE_CH = new Set([...UE, 'IS', 'NO', 'LI', 'CH']);

/**
 * Territorios con código ISO propio que dependen de un Estado miembro (o del EEE) y
 * cuya cobertura por EU261 NO está resuelta en el v2.1.
 *
 * El problema es real y no teórico: un vuelo desde Fort-de-France (FDF) tiene
 * `pais_iso: 'MQ'`, no 'FR'. Si Martinica no está en ninguna lista, el Test A1 daría
 * "no aplica" —un falso negativo sobre territorio que, siendo región ultraperiférica
 * (TFUE Art. 349), muy probablemente SÍ está cubierto—. Y al revés: Aruba o Groenlandia
 * son PTU y probablemente NO lo están.
 *
 * Por eso no se resuelven acá: el motor los trata como DESCONOCIDO y emite FALTA_DATO
 * (o el nodo de verificación caso a caso), nunca un "no aplica" silencioso.
 * → PENDIENTE JPA: clasificar cada uno como dentro o fuera del ámbito de EU261.
 */
export var TERRITORIOS_AMBIGUOS = new Set([
  /* Francia — regiones ultraperiféricas (probable: dentro) */
  'GP', // Guadalupe
  'MQ', // Martinica
  'GF', // Guayana Francesa
  'RE', // Reunión
  'YT', // Mayotte
  /* Francia — PTU y colectividades (probable: fuera) */
  'PF', // Polinesia Francesa
  'NC', // Nueva Caledonia
  'WF', // Wallis y Futuna
  'PM', // San Pedro y Miquelón
  'BL', // San Bartolomé
  'MF', // San Martín (parte francesa)
  /* Países Bajos — Caribe neerlandés (probable: fuera) */
  'AW', // Aruba
  'CW', // Curazao
  'SX', // Sint Maarten
  'BQ', // Bonaire, San Eustaquio y Saba
  /* Dinamarca (probable: fuera) */
  'GL', // Groenlandia
  'FO', // Islas Feroe
  /* Finlandia (probable: dentro) */
  'AX', // Åland
  /* Otros */
  'GI', // Gibraltar — post-Brexit, fuera de la UE
]);

/**
 * Estados parte del Convenio de Montreal 1999.
 *
 * SEED de los mercados objetivo, no la nómina completa (son ~140 Estados). Arranca con
 * toda la UE/EEE/CH más los mercados en los que se opera. Ampliable sin tocar el motor.
 * v2.1 Test E: "Verificar que AMBOS Estados sean parte".
 */
export var MONTREAL_PARTES = new Set([
  ...EEE_CH,
  'AR', // Argentina — Ley 26.451
  'US', // Estados Unidos
  'BR', // Brasil
  'UY', // Uruguay
  'CL', // Chile
  'PY', // Paraguay
  'BO', // Bolivia
  'PE', // Perú
  'CO', // Colombia
  'MX', // México
  'CA', // Canadá
  'GB', // Reino Unido
]);

/**
 * ¿Es el país parte de Montreal?
 *
 * Tri-estado a propósito: devuelve `true` o `null` (desconocido), NUNCA `false`.
 * Como MONTREAL_PARTES es un seed y no la nómina completa, la ausencia no prueba la
 * no-pertenencia: si el motor necesita el dato y acá no está, corresponde FALTA_DATO,
 * no descartar el overlay.
 *
 * @param {string|null} iso Código ISO-2
 * @returns {true|null}
 */
export function montrealParte(iso) {
  if (!iso) return null;
  return MONTREAL_PARTES.has(String(iso).toUpperCase()) ? true : null;
}

/**
 * ¿Está el aeropuerto en el ámbito territorial de EU261 (UE + EEE + CH)?
 *
 * Tri-estado: `true` / `false` / `null`. El `false` es firme porque EEE_CH es
 * exhaustivo; el `null` queda reservado a los territorios de TERRITORIOS_AMBIGUOS,
 * donde la respuesta exige decisión legal y no puede darse por regla.
 *
 * @param {string|null} iso Código ISO-2
 * @returns {boolean|null}
 */
export function enAmbitoEU261(iso) {
  if (!iso) return null;
  var c = String(iso).toUpperCase();
  if (EEE_CH.has(c)) return true;
  if (TERRITORIOS_AMBIGUOS.has(c)) return null;
  return false;
}
