import { createHash } from 'crypto';

/**
 * Computes a SHA-256 fingerprint over the substantive claim fields.
 * Same fields as the old AppScript huellaDatos_().
 * Returns the full hex string.
 */
export function computeClaimHash(f) {
  const str = [
    f.refCode          || '',
    f.nombre           || '',
    (f.docTipo || '') + ' ' + (f.docNumero || ''),
    f.email            || '',
    f.pnr              || '',
    f.aerolinea        || '',
    f.vuelo            || '',
    f.origen           || '',
    f.destino          || '',
    f.fechaVuelo       || '',
    f.tipoReclamo      || '',
    f.firmaFecha       || '',
    f.consentVersion   || '',
  ].join('|');
  return createHash('sha256').update(str, 'utf8').digest('hex');
}
