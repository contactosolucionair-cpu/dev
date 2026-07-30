/**
 * api/_utils/motor-datos.js
 *
 * Carga de los datos auxiliares que consume el motor legal, con caché de módulo.
 *
 * Los datos entran por import estático (`api/_data/airports.js`, `api/_data/aerolineas.js`),
 * no por lectura de archivos: el bundler de Vercel sigue los imports y empaqueta el
 * contenido junto con la función. La versión anterior calculaba una ruta en runtime a
 * partir de la URL del módulo, y esa sintaxis no sobrevive a la compilación a CommonJS que
 * hace Vercel (el repo no declara `"type": "module"`): `analizar-caso` moría con
 * `Cannot use ... outside a module` antes de ejecutar una sola línea. En local no se ve,
 * porque Node detecta la sintaxis ESM del archivo y la habilita. `tests/api-bundle.test.js`
 * es el que impide que esa forma vuelva a entrar bajo `api/`.
 *
 * Lo que se cachea acá son los ÍNDICES, no los datos: el array de aeropuertos pesa ~800 KB
 * y construir el índice en cada invocación es el costo que conviene evitar mientras la
 * instancia esté caliente.
 */
import aeropuertos from '../_data/airports.js';
import aerolineas from '../_data/aerolineas.js';

import { construirIndiceAeropuertos, construirIndiceAerolineas } from './motor-normalizar.js';
import * as paises from '../_data/paises-ue.js';

var cache = null;

/**
 * @returns {{ idxAeropuertos: Object, idxAerolineas: Object, paises: Object }}
 */
export function cargarDatosMotor() {
  if (cache) return cache;
  cache = {
    idxAeropuertos: construirIndiceAeropuertos(aeropuertos),
    idxAerolineas: construirIndiceAerolineas(aerolineas),
    paises: paises,
  };
  return cache;
}

export default cargarDatosMotor;
