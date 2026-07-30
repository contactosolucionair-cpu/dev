/**
 * GET /api/public-config — configuración del sitio que puede ver el navegador.
 *
 * Único canal público de configuración. Devuelve SOLO las claves de la whitelist de
 * `_utils/config-publica.js` (hoy: el flag `ai_extraction`), nunca la fila de
 * `site_config`, que tiene configuración interna.
 *
 * Sin autenticación a propósito: lo consume el formulario público antes de que exista
 * ningún usuario. Por eso la whitelist es la única barrera y el filtro es server-side.
 *
 * Nunca devuelve error: si Supabase no responde, sirve los valores por defecto (el
 * comportamiento histórico del sitio) con 200. Un endpoint caído no puede dejar al
 * formulario sin su paso 1.
 *
 * @returns {Object} { success: true, flags: { ai_extraction: bool } }
 */
import { leerFlagsPublicos, flagsPorDefecto } from './_utils/config-publica.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  /* Cache corto: el flag cambia muy de vez en cuando y esto lo pega cada visita.
     `stale-while-revalidate` evita que un cambio tarde más de un minuto en verse. */
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SB_URL || !SB_KEY) {
    return res.status(200).json({ success: true, flags: flagsPorDefecto(), porDefecto: true });
  }

  var flags = await leerFlagsPublicos(SB_URL, SB_KEY);
  return res.status(200).json({ success: true, flags: flags });
}
