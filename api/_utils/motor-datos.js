/**
 * api/_utils/motor-datos.js
 *
 * Carga de los datos auxiliares que consume el motor legal, con caché de módulo.
 *
 * Se separó del endpoint por dos razones: `airports.json` pesa ~800 KB y no conviene
 * leerlo en cada invocación (acá queda cacheado mientras la instancia esté caliente), y
 * el mismo cargador lo va a necesitar el disparo automático del motor en un ciclo
 * posterior.
 *
 * Sobre las rutas: el resto de /api lee archivos del repo con
 * `path.join(process.cwd(), ...)` (ver legal-docs.js, pdf-receipt.js) y `vercel.json`
 * los incluye en el bundle con `includeFiles`. Se mantiene ese patrón, pero se prueban
 * también rutas relativas al módulo, porque un cambio de layout del bundle no debería
 * dejar el endpoint con un 500 opaco. Si igual no aparece, el error dice exactamente qué
 * archivo falta y dónde se buscó.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { construirIndiceAeropuertos, construirIndiceAerolineas } from './motor-normalizar.js';
import * as paises from '../_data/paises-ue.js';

var __dirname = path.dirname(fileURLToPath(import.meta.url));

var cache = null;

/** Lee el primer candidato que exista. Si no existe ninguno, error con las rutas probadas. */
function leerJson(relativo, etiqueta) {
  var candidatos = [
    path.join(process.cwd(), relativo),
    path.join(__dirname, '..', '..', relativo),
  ];
  for (var i = 0; i < candidatos.length; i++) {
    try {
      if (fs.existsSync(candidatos[i])) return JSON.parse(fs.readFileSync(candidatos[i], 'utf8'));
    } catch (e) {
      throw new Error('No se pudo leer ' + etiqueta + ' (' + candidatos[i] + '): ' + e.message);
    }
  }
  throw new Error('No se encontró ' + etiqueta + '. Rutas probadas: ' + candidatos.join(' | ')
    + '. Si esto pasa en Vercel, falta el glob en `functions.includeFiles` de vercel.json.');
}

/**
 * @returns {{ idxAeropuertos: Object, idxAerolineas: Object, paises: Object }}
 * @throws {Error} con mensaje explícito si falta un archivo de datos
 */
export function cargarDatosMotor() {
  if (cache) return cache;
  var aeropuertos = leerJson(path.join('src', 'data', 'airports.json'), 'src/data/airports.json');
  var aerolineas = leerJson(path.join('api', '_data', 'aerolineas.json'), 'api/_data/aerolineas.json');
  cache = {
    idxAeropuertos: construirIndiceAeropuertos(aeropuertos),
    idxAerolineas: construirIndiceAerolineas(aerolineas),
    paises: paises,
  };
  return cache;
}

export default cargarDatosMotor;
