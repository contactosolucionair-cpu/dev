/**
 * POST /api/update-ticket
 *
 * Acciones del ciclo de vida del caso (instancia + momento + esperas + cobro):
 *   avanzar          Transición válida entre instancia/momento (ver api/_utils/instancias.js)
 *   cancel            Alias de avanzar con transición 'abandonar' (usado por perfil.html)
 *   set-espera        Agrega una espera abierta
 *   resolver-espera    Marca una espera como resuelta
 *   set-cobro          Marca/deshace una fecha del checklist de cobro
 *   set-instancia      Corrección manual de instancia/momento/resultado
 *   set-documentos     Reordena/actualiza los documentos (el primero pasa a ser el principal)
 *   set-acompanantes   Agrega/edita/elimina los pasajeros adicionales del caso
 *
 * Otras acciones (sin cambios): add-novedad, update-firma, set-fecha-mediacion,
 * update-abogado, confirm-update-cliente, set-campo, dismiss-alerta.
 *
 * @param {string} req.body.id - Claim UUID (required)
 * @param {string} req.body.action
 * @returns {Object} {success, action, ...}
 */
import {
  getInstancia, instanciaAEstadoLegacy, validarTransicion,
  MOTIVOS_CIERRE, TIPOS_ESPERA, RESPONSABLES_ESPERA,
  INSTANCIAS_VALIDAS, MOMENTOS_VALIDOS, RESULTADOS_VALIDOS, MONEDAS_VALIDAS,
} from './_utils/instancias.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SB_URL = process.env.SUPABASE_URL;
  var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ADMIN_PWD = process.env.ADMIN_PASSWORD;

  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase not configured' });
  /* Admin-only (backoffice). Las acciones del cliente van por api/my-actions.js
     (autenticadas con el JWT del pasajero). Sin ADMIN_PASSWORD NO queda abierto. */
  if (!ADMIN_PWD) return res.status(500).json({ error: 'ADMIN_PASSWORD no configurado' });
  if ((req.headers['x-admin-password'] || '') !== ADMIN_PWD) return res.status(401).json({ error: 'No autorizado.' });

  function fetchRow(select) {
    return fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=' + select, {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
    }).then(function (r) { return r.json(); }).then(function (rows) { return (rows && rows[0]) || null; });
  }

  function patchRow(patch) {
    return fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch),
    });
  }

  var id;
  try {
    var body = req.body;
    id = body.id;
    if (!id) return res.status(400).json({ error: 'ID de reclamo requerido' });

    /* ---- AVANZAR (transición de instancia/momento) + CANCEL (alias: abandonar) ---- */
    if (body.action === 'avanzar' || body.action === 'cancel') {
      var transicion = body.action === 'cancel' ? 'abandonar' : (body.transicion || '').trim();
      if (!transicion) return res.status(400).json({ error: 'transicion requerida' });

      var row = await fetchRow('instancia,momento,resultado,estado,estado_historial,instancia_historial,'
        + 'monto_reclamado,monto_acordado,acuerdo_instancia,pago_aerolinea_fecha,comision_cobrada_fecha,'
        + 'honorarios_abogado_fecha,novedades,via_reclamo,organismo');
      if (!row) return res.status(404).json({ error: 'Reclamo no encontrado' });

      var pos = getInstancia(row);
      var check = validarTransicion(pos.instancia, pos.momento, transicion);
      if (!check.ok) return res.status(400).json({ error: check.error });
      var def = check.def;

      var patch = {};

      /* 'presentar' desde reclamo_directo/preparacion exige monto_reclamado si no está seteado */
      if (transicion === 'presentar' && pos.instancia === 'reclamo_directo' && pos.momento === 'preparacion') {
        var yaTieneMonto = row.monto_reclamado !== null && row.monto_reclamado !== undefined;
        var montoNuevo = body.monto_reclamado;
        if (!yaTieneMonto && (montoNuevo === undefined || montoNuevo === null || montoNuevo === ''))
          return res.status(400).json({ error: 'Monto reclamado requerido' });
        if (montoNuevo !== undefined && montoNuevo !== null && montoNuevo !== '') {
          patch.monto_reclamado = Number(montoNuevo);
          var monedaReclamado = (body.monto_reclamado_moneda || '').trim().toUpperCase();
          patch.monto_reclamado_moneda = MONEDAS_VALIDAS.indexOf(monedaReclamado) !== -1 ? monedaReclamado : 'ARS';
        }
      }

      if (def.requires) {
        for (var ri = 0; ri < def.requires.length; ri++) {
          var reqField = def.requires[ri];
          if (body[reqField] === undefined || body[reqField] === null || body[reqField] === '')
            return res.status(400).json({ error: 'Campo requerido: ' + reqField });
        }
      }

      var motivo = null, motivoDetalle = null;
      if (def.requiresMotivo) {
        motivo = (body.motivo_cierre || '').trim();
        if (!motivo && transicion === 'abandonar') motivo = 'desistimiento_pasajero';
        if (MOTIVOS_CIERRE.indexOf(motivo) === -1) return res.status(400).json({ error: 'Motivo de cierre inválido' });
        motivoDetalle = (body.motivo_cierre_detalle || '').trim() || null;
      }

      /* Cierre exitoso desde cobro: checklist completa */
      if (transicion === 'cerrar_exito') {
        if (!row.pago_aerolinea_fecha || !row.comision_cobrada_fecha)
          return res.status(400).json({ error: 'Completá el checklist de cobro antes de cerrar con éxito.' });
        if (row.acuerdo_instancia === 'mediacion' && !row.honorarios_abogado_fecha)
          return res.status(400).json({ error: 'Falta registrar los honorarios del abogado.' });
      }

      var newInstancia = def.to.instancia;
      var newMomento = def.to.momento;
      var newResultado = def.closes || null;

      patch.instancia = newInstancia;
      patch.momento = newMomento;
      if (def.closes) {
        patch.resultado = newResultado;
        patch.motivo_cierre = motivo;
        patch.motivo_cierre_detalle = motivoDetalle;
      }

      /* 'acuerdo': setea cobro + acuerdo_instancia (de dónde vino) + fecha_acuerdo + monto */
      if (transicion === 'acuerdo') {
        patch.acuerdo_instancia = pos.instancia;
        patch.fecha_acuerdo = new Date().toISOString();
        patch.monto_acordado = Number(body.monto_acordado);
        var monedaAcordado = (body.monto_acordado_moneda || '').trim().toUpperCase();
        patch.monto_acordado_moneda = MONEDAS_VALIDAS.indexOf(monedaAcordado) !== -1 ? monedaAcordado : 'ARS';
      }

      /* 'elevar_organismo': eleva el reclamo directo a un organismo administrativo */
      var newViaReclamo = row.via_reclamo || 'aerolinea';
      var newOrganismo = row.organismo || null;
      if (transicion === 'elevar_organismo') {
        newViaReclamo = 'organismo';
        newOrganismo = (body.organismo || '').trim();
        if (!newOrganismo) return res.status(400).json({ error: 'Nombre del organismo requerido' });
        patch.via_reclamo = newViaReclamo;
        patch.organismo = newOrganismo;
      }

      var nowIso = new Date().toISOString();
      var estadoLegacy = instanciaAEstadoLegacy(newInstancia, newMomento, newResultado);
      patch.estado = estadoLegacy;

      var estadoHist = Array.isArray(row.estado_historial) ? row.estado_historial : [];
      estadoHist.push({ estado: estadoLegacy, fecha: nowIso, por: 'admin' });
      patch.estado_historial = estadoHist;

      var instEntry = { instancia: newInstancia, momento: newMomento, fecha: nowIso, por: 'admin' };
      if (newInstancia === 'reclamo_directo') {
        instEntry.via = newViaReclamo;
        if (newViaReclamo === 'organismo' && newOrganismo) instEntry.organismo = newOrganismo;
      }
      var instHist = Array.isArray(row.instancia_historial) ? row.instancia_historial : [];
      instHist.push(instEntry);
      patch.instancia_historial = instHist;

      var novedades = Array.isArray(row.novedades) ? row.novedades : [];
      if (def.novedad) {
        novedades.unshift({ fecha: nowIso, texto: def.novedad });
        patch.novedades = novedades;
      }

      var updRes = await patchRow(patch);
      if (!updRes.ok) {
        console.error('[update-ticket] avanzar error:', (await updRes.text()).substring(0, 300));
        return res.status(500).json({ error: 'Error al actualizar el caso' });
      }

      if (body.action === 'cancel') return res.status(200).json({ success: true, action: 'cancel' });
      return res.status(200).json({
        success: true, action: 'avanzar', transicion: transicion,
        instancia: newInstancia, momento: newMomento, resultado: newResultado,
        estado: estadoLegacy, estado_historial: estadoHist, instancia_historial: instHist,
        monto_reclamado: patch.monto_reclamado, monto_acordado: patch.monto_acordado,
        monto_reclamado_moneda: patch.monto_reclamado_moneda, monto_acordado_moneda: patch.monto_acordado_moneda,
        acuerdo_instancia: patch.acuerdo_instancia, fecha_acuerdo: patch.fecha_acuerdo,
        motivo_cierre: patch.motivo_cierre, motivo_cierre_detalle: patch.motivo_cierre_detalle,
        via_reclamo: patch.via_reclamo, organismo: patch.organismo,
        novedades: novedades,
      });
    }

    /* ---- NOVEDAD ---- */
    if (body.action === 'add-novedad') {
      var texto = (body.texto || '').trim();
      if (!texto) return res.status(400).json({ error: 'El texto no puede estar vacío' });

      var getRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=novedades', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var rows = await getRes.json();
      var novedadesN = Array.isArray(rows[0]?.novedades) ? rows[0].novedades : [];
      novedadesN.unshift({ fecha: new Date().toISOString(), texto });

      var patchRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ novedades: novedadesN }),
      });
      if (!patchRes.ok) return res.status(500).json({ error: 'Error al guardar la novedad' });
      return res.status(200).json({ success: true, novedades: novedadesN });
    }

    /* ---- SET ESPERA ---- */
    if (body.action === 'set-espera') {
      var espTipo = (body.tipo || '').trim();
      var espResp = (body.responsable || '').trim();
      if (TIPOS_ESPERA.indexOf(espTipo) === -1) return res.status(400).json({ error: 'Tipo de espera inválido' });
      if (RESPONSABLES_ESPERA.indexOf(espResp) === -1) return res.status(400).json({ error: 'Responsable inválido' });
      var espDetalle = (body.detalle || '').trim() || null;
      var espVence = body.vence ? new Date(body.vence).toISOString() : null;

      var seRow = await fetchRow('esperas,novedades');
      if (!seRow) return res.status(404).json({ error: 'Reclamo no encontrado' });
      var esperas = Array.isArray(seRow.esperas) ? seRow.esperas : [];
      var nowSe = new Date().toISOString();
      var espId = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      esperas.push({ id: espId, tipo: espTipo, detalle: espDetalle, responsable: espResp, creada: nowSe, vence: espVence, resuelta: null });

      var seNov = Array.isArray(seRow.novedades) ? seRow.novedades : [];
      seNov.unshift({ fecha: nowSe, texto: 'Nueva espera: ' + espTipo + (espDetalle ? ' — ' + espDetalle : '') });

      var sePatch = await patchRow({ esperas: esperas, novedades: seNov });
      if (!sePatch.ok) return res.status(500).json({ error: 'Error al agregar la espera' });
      return res.status(200).json({ success: true, action: 'set-espera', esperas: esperas, novedades: seNov });
    }

    /* ---- RESOLVER ESPERA ---- */
    if (body.action === 'resolver-espera') {
      var esperaId = (body.espera_id || '').trim();
      if (!esperaId) return res.status(400).json({ error: 'espera_id requerido' });
      var reRow = await fetchRow('esperas,novedades');
      if (!reRow) return res.status(404).json({ error: 'Reclamo no encontrado' });
      var esperasRe = Array.isArray(reRow.esperas) ? reRow.esperas : [];
      var found = null;
      esperasRe.forEach(function (e) { if (e.id === esperaId) found = e; });
      if (!found) return res.status(404).json({ error: 'Espera no encontrada' });
      var nowRe = new Date().toISOString();
      found.resuelta = nowRe;

      var reNov = Array.isArray(reRow.novedades) ? reRow.novedades : [];
      reNov.unshift({ fecha: nowRe, texto: 'Espera resuelta: ' + found.tipo });

      var rePatch = await patchRow({ esperas: esperasRe, novedades: reNov });
      if (!rePatch.ok) return res.status(500).json({ error: 'Error al resolver la espera' });
      return res.status(200).json({ success: true, action: 'resolver-espera', esperas: esperasRe, novedades: reNov });
    }

    /* ---- SET COBRO (checklist: pago aerolínea / comisión / honorarios abogado) ---- */
    if (body.action === 'set-cobro') {
      var CAMPOS_COBRO = ['pago_aerolinea_fecha', 'comision_cobrada_fecha', 'honorarios_abogado_fecha'];
      var cobroCampo = (body.campo || '').trim();
      if (CAMPOS_COBRO.indexOf(cobroCampo) === -1) return res.status(400).json({ error: 'Campo de cobro inválido' });
      var cobroFecha = (body.fecha === null || body.fecha === undefined || body.fecha === '') ? null : new Date(body.fecha).toISOString();
      var scPatch = {};
      scPatch[cobroCampo] = cobroFecha;
      var cobroRes = await patchRow(scPatch);
      if (!cobroRes.ok) return res.status(500).json({ error: 'Error al guardar el cobro' });
      return res.status(200).json({ success: true, action: 'set-cobro', campo: cobroCampo, fecha: cobroFecha });
    }

    /* ---- SET INSTANCIA (corrección manual) ---- */
    if (body.action === 'set-instancia') {
      var siInstancia = (body.instancia || '').trim();
      var siMomento = body.momento ? String(body.momento).trim() : null;
      var siResultado = body.resultado ? String(body.resultado).trim() : null;
      if (INSTANCIAS_VALIDAS.indexOf(siInstancia) === -1) return res.status(400).json({ error: 'Instancia inválida' });
      if (siMomento && MOMENTOS_VALIDOS.indexOf(siMomento) === -1) return res.status(400).json({ error: 'Momento inválido' });
      if (siResultado && RESULTADOS_VALIDOS.indexOf(siResultado) === -1) return res.status(400).json({ error: 'Resultado inválido' });
      if (siInstancia !== 'reclamo_directo' && siInstancia !== 'mediacion') siMomento = null;
      if (siInstancia !== 'cerrado') siResultado = null;

      var siRow = await fetchRow('estado_historial,instancia_historial');
      if (!siRow) return res.status(404).json({ error: 'Reclamo no encontrado' });
      var siNow = new Date().toISOString();
      var siEstadoLegacy = instanciaAEstadoLegacy(siInstancia, siMomento, siResultado);

      var siEstHist = Array.isArray(siRow.estado_historial) ? siRow.estado_historial : [];
      siEstHist.push({ estado: siEstadoLegacy, fecha: siNow, por: 'admin (corrección)' });
      var siInstHist = Array.isArray(siRow.instancia_historial) ? siRow.instancia_historial : [];
      siInstHist.push({ instancia: siInstancia, momento: siMomento, fecha: siNow, por: 'admin (corrección)' });

      var siPatchBody = {
        instancia: siInstancia, momento: siMomento, resultado: siResultado,
        estado: siEstadoLegacy, estado_historial: siEstHist, instancia_historial: siInstHist,
      };
      if (body.motivo_cierre !== undefined) siPatchBody.motivo_cierre = body.motivo_cierre || null;
      if (body.motivo_cierre_detalle !== undefined) siPatchBody.motivo_cierre_detalle = body.motivo_cierre_detalle || null;

      var siPatchRes = await patchRow(siPatchBody);
      if (!siPatchRes.ok) return res.status(500).json({ error: 'Error al corregir la instancia' });
      return res.status(200).json({
        success: true, action: 'set-instancia', instancia: siInstancia, momento: siMomento, resultado: siResultado,
        estado: siEstadoLegacy, estado_historial: siEstHist, instancia_historial: siInstHist,
      });
    }

    /* ---- SET DOCUMENTOS (reordenar / hacer principal) ---- */
    if (body.action === 'set-documentos') {
      var docsArr = Array.isArray(body.documentos) ? body.documentos : null;
      if (!docsArr || !docsArr.length) return res.status(400).json({ error: 'documentos requerido' });
      for (var dvi = 0; dvi < docsArr.length; dvi++) {
        var dv = docsArr[dvi];
        if (!dv || typeof dv !== 'object' || !dv.tipo || !dv.numero)
          return res.status(400).json({ error: 'Cada documento requiere tipo y número' });
      }
      var sdPatch = { documentos: docsArr, documento_tipo: docsArr[0].tipo, documento_numero: docsArr[0].numero };
      var sdRes = await patchRow(sdPatch);
      if (!sdRes.ok) return res.status(500).json({ error: 'Error al actualizar los documentos' });
      return res.status(200).json({
        success: true, action: 'set-documentos', documentos: docsArr,
        documento_tipo: sdPatch.documento_tipo, documento_numero: sdPatch.documento_numero,
      });
    }

    /* ---- SET ACOMPAÑANTES (agregar/editar/eliminar pasajeros adicionales) ---- */
    if (body.action === 'set-acompanantes') {
      var acompArr = Array.isArray(body.acompanantes) ? body.acompanantes : null;
      if (!acompArr) return res.status(400).json({ error: 'acompanantes requerido' });
      for (var avi = 0; avi < acompArr.length; avi++) {
        var av = acompArr[avi];
        if (!av || typeof av !== 'object' || !av.nombre || !av.documento_tipo || !av.documento_numero)
          return res.status(400).json({ error: 'Cada acompañante requiere nombre, tipo y número de documento' });
      }
      var saRes = await patchRow({ acompanantes: acompArr });
      if (!saRes.ok) return res.status(500).json({ error: 'Error al actualizar los acompañantes' });
      return res.status(200).json({ success: true, action: 'set-acompanantes', acompanantes: acompArr });
    }

    /* ---- UPDATE FIRMA ESTADO ---- */
    if (body.action === 'update-firma') {
      var newFirma = (body.firma_estado || '').trim();
      var validFirmas = ['no_aplica', 'pendiente_envio', 'enviada', 'firmada', 'rechazada'];
      if (validFirmas.indexOf(newFirma) === -1) return res.status(400).json({ error: 'Estado de firma inválido' });
      var firmaRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ firma_estado: newFirma }),
      });
      if (!firmaRes.ok) return res.status(500).json({ error: 'Error al actualizar autorización' });
      return res.status(200).json({ success: true, action: 'update-firma', firma_estado: newFirma });
    }

    /* ---- SET FECHA MEDIACION ---- */
    if (body.action === 'set-fecha-mediacion') {
      var fm = body.fecha_mediacion;
      var fmVal = (fm === null || fm === undefined || fm === '') ? null : new Date(fm).toISOString();
      if (fm && fmVal && isNaN(new Date(fm).getTime())) return res.status(400).json({ error: 'Fecha inválida' });
      var fmRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ fecha_mediacion: fmVal }),
      });
      if (!fmRes.ok) return res.status(500).json({ error: 'Error al guardar la fecha de mediación' });
      return res.status(200).json({ success: true, action: 'set-fecha-mediacion', fecha_mediacion: fmVal });
    }

    /* ---- REASIGNAR ABOGADO (+ bitácora) ---- */
    if (body.action === 'update-abogado') {
      var newAbogadoId = (body.abogado_id || '').trim();
      if (!newAbogadoId) return res.status(400).json({ error: 'abogado_id es requerido' });

      var abogRes = await fetch(SB_URL + '/rest/v1/abogados?id=eq.' + newAbogadoId + '&select=id,nombre', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var abogRows = await abogRes.json();
      if (!Array.isArray(abogRows) || !abogRows.length) return res.status(400).json({ error: 'Abogado no encontrado' });
      var abogadoNombre = abogRows[0].nombre || 'sin nombre';

      var uaRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=novedades', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var uaRows = await uaRes.json();
      var uaNov = Array.isArray(uaRows[0]?.novedades) ? uaRows[0].novedades : [];
      uaNov.unshift({ fecha: new Date().toISOString(), texto: 'Caso reasignado a ' + abogadoNombre + '.' });

      var uaPatch = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ abogado_id: newAbogadoId, novedades: uaNov }),
      });
      if (!uaPatch.ok) return res.status(500).json({ error: 'Error al reasignar el abogado' });
      return res.status(200).json({ success: true, action: 'update-abogado', abogado_id: newAbogadoId, abogado_nombre: abogadoNombre, novedades: uaNov });
    }

    /* ---- CONFIRM UPDATE AL CLIENTE (+ bitácora) ---- */
    if (body.action === 'confirm-update-cliente') {
      var nowTs = new Date().toISOString();
      var cuRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=novedades', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var cuRows = await cuRes.json();
      var cuNov = Array.isArray(cuRows[0]?.novedades) ? cuRows[0].novedades : [];
      cuNov.unshift({ fecha: nowTs, texto: '✓ Update enviado al cliente' });
      var cuPatch = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ ultimo_update_cliente: nowTs, novedades: cuNov }),
      });
      if (!cuPatch.ok) return res.status(500).json({ error: 'Error al registrar el update' });
      return res.status(200).json({ success: true, action: 'confirm-update-cliente', ultimo_update_cliente: nowTs, novedades: cuNov });
    }

    /* ---- EDITOR GENÉRICO DE CAMPOS (corrección manual de un dato del caso) ---- */
    /* documento_tipo/documento_numero excluidos a propósito: son un espejo de
       documentos[0] y patchearlos acá directo desincroniza el array. Usar la
       acción set-documentos para eso. */
    var CAMPOS_EDITABLES = [
      'nombre', 'email', 'telefono', 'pnr',
      'aerolinea', 'vuelo_nro', 'fecha_vuelo', 'origen', 'destino',
      'tipo_incidencia', 'causa_informada', 'horas_retraso',
      'moneda_gastos', 'monto_gastos', 'gastos_detalle',
      'cuil', 'fecha_nacimiento', 'domicilio_real', 'pais_emisor', 'id_fiscal_extranjero',
      'agente_nombre', 'agente_email', 'monto_reclamado', 'monto_acordado',
      'anticipacion_aviso', 'ofrecimiento_aerolinea', 'viajo_finalmente', 'embarque_presentado',
      'pir_presentado', 'pir_numero', 'pasaje_alternativo_monto', 'pasaje_alternativo_moneda',
      'monto_reclamado_moneda', 'monto_acordado_moneda', 'organismo',
    ];

    if (body.action === 'set-campo') {
      var campo = (body.campo || '').trim();
      if (CAMPOS_EDITABLES.indexOf(campo) === -1) return res.status(400).json({ error: 'Campo no editable: ' + campo });
      var valor = body.valor;
      var scfPatch = {};
      scfPatch[campo] = (valor === undefined || valor === '') ? null : valor;

      var scfRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify(scfPatch),
      });
      if (!scfRes.ok) return res.status(500).json({ error: 'Error al guardar el campo.' });
      return res.status(200).json({ success: true, action: 'set-campo', campo: campo, valor: scfPatch[campo] });
    }

    /* ---- DESCARTAR ALERTA (manual) ---- */
    if (body.action === 'dismiss-alerta') {
      var regla = (body.regla || '').trim();
      if (!regla) return res.status(400).json({ error: 'regla requerida' });
      var daRes = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id + '&select=alertas_descartadas', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      var daRows = await daRes.json();
      var descartadas = Array.isArray(daRows[0]?.alertas_descartadas) ? daRows[0].alertas_descartadas : [];
      /* Reemplaza descarte previo de la misma regla con la fecha actual */
      descartadas = descartadas.filter(function (d) { return d.regla !== regla; });
      descartadas.push({ regla: regla, fecha: new Date().toISOString() });
      var daPatch = await fetch(SB_URL + '/rest/v1/reclamos?id=eq.' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ alertas_descartadas: descartadas }),
      });
      if (!daPatch.ok) return res.status(500).json({ error: 'Error al descartar la alerta' });
      return res.status(200).json({ success: true, action: 'dismiss-alerta', alertas_descartadas: descartadas });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });

  } catch (err) {
    console.error('[update-ticket] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
