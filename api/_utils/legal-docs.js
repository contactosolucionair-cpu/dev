import fs from 'fs';
import path from 'path';
import { renderLegalPdf } from './legal-pdf.js';

const TEMPLATES_DIR = path.join(process.cwd(), 'templates');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function loadTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name + '.txt'), 'utf8');
}

function interpolate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, function (m, key) {
    return Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : m;
  });
}

function fmtFecha(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

function fechaLetras() {
  var d = new Date();
  return { dia: String(d.getDate()), mes: MESES[d.getMonth()], anio: String(d.getFullYear()) };
}

/* Con DNI: "DNI N° 12.345.678" · Con pasaporte: "Pasaporte N° AB1234567" */
function composeDocumento(tipo, numero) {
  if (!numero) return '';
  return tipo === 'pasaporte' ? ('Pasaporte N° ' + numero) : ('DNI N° ' + numero);
}

/* Residente/argentino con DNI: "DNI X, CUIT/CUIL Y" · Extranjero con pasaporte:
   "Pasaporte X (emitido por <país>), identificación fiscal: <id>" */
function composeClienteIdentificacion(r) {
  if (r.documento_tipo === 'pasaporte') {
    if (!r.documento_numero || !r.pais_emisor || !r.id_fiscal_extranjero) return '';
    return 'Pasaporte ' + r.documento_numero + ' (emitido por ' + r.pais_emisor + '), identificación fiscal: ' + r.id_fiscal_extranjero;
  }
  if (!r.documento_numero || !r.cuil) return '';
  return 'DNI ' + r.documento_numero + ', CUIT/CUIL ' + r.cuil;
}

function buildPoderData(reclamo, idioma) {
  var faltantes = [];
  if (!reclamo.nombre) faltantes.push('Nombre del pasajero');
  if (!reclamo.documento_numero) faltantes.push('Documento del pasajero (número)');
  if (!reclamo.email) faltantes.push('Email del pasajero');
  if (!reclamo.aerolinea) faltantes.push('Aerolínea');
  if (!reclamo.vuelo_nro) faltantes.push('Número de vuelo');
  if (!reclamo.fecha_vuelo) faltantes.push('Fecha del vuelo');
  if (!reclamo.origen || !reclamo.destino) faltantes.push('Origen y destino del vuelo');

  var data = {
    otorgante_nombre: reclamo.nombre || '',
    otorgante_documento: composeDocumento(reclamo.documento_tipo, reclamo.documento_numero),
    otorgante_email: reclamo.email || '',
    vuelo_aerolinea: reclamo.aerolinea || '',
    vuelo_numero: reclamo.vuelo_nro || '',
    vuelo_fecha: fmtFecha(reclamo.fecha_vuelo) || reclamo.fecha_vuelo || '',
    vuelo_ruta: [reclamo.origen, reclamo.destino].filter(Boolean).join(idioma === 'en' ? ' to ' : ' > '),
  };
  return { data: data, faltantes: faltantes };
}

function buildPatrocinioData(reclamo, abogado) {
  var faltantes = [];
  if (!abogado) {
    faltantes.push('Abogado asignado al caso');
  } else {
    if (!abogado.nombre) faltantes.push('Nombre del abogado');
    if (!abogado.matricula) faltantes.push('Matrícula del abogado');
    if (!abogado.colegio) faltantes.push('Colegio de matrícula del abogado');
    if (!abogado.domicilio) faltantes.push('Domicilio del abogado');
    if (!abogado.email) faltantes.push('Email del abogado');
  }
  if (!reclamo.nombre) faltantes.push('Nombre del cliente');
  if (!reclamo.documento_tipo) faltantes.push('Tipo de documento del cliente (DNI o pasaporte)');
  if (!reclamo.documento_numero) faltantes.push('Número de documento del cliente');
  if (reclamo.documento_tipo === 'pasaporte') {
    if (!reclamo.pais_emisor) faltantes.push('País emisor del pasaporte');
    if (!reclamo.id_fiscal_extranjero) faltantes.push('Identificación fiscal del país emisor');
  } else if (reclamo.documento_tipo === 'dni') {
    if (!reclamo.cuil) faltantes.push('CUIT/CUIL del cliente');
  }
  if (!reclamo.fecha_nacimiento) faltantes.push('Fecha de nacimiento del cliente');
  if (!reclamo.domicilio_real) faltantes.push('Domicilio real del cliente');
  if (!reclamo.telefono) faltantes.push('Celular del cliente');
  if (!reclamo.email) faltantes.push('Email del cliente');
  if (!reclamo.aerolinea) faltantes.push('Aerolínea');
  if (!reclamo.vuelo_nro) faltantes.push('Número de vuelo');

  var fecha = fechaLetras();
  var data = {
    abogado_nombre: abogado ? (abogado.nombre || '') : '',
    abogado_matricula: abogado ? (abogado.matricula || '') : '',
    abogado_colegio: abogado ? (abogado.colegio || '') : '',
    abogado_domicilio: abogado ? (abogado.domicilio || '') : '',
    abogado_email: abogado ? (abogado.email || '') : '',
    cliente_nombre: reclamo.nombre || '',
    cliente_identificacion: composeClienteIdentificacion(reclamo),
    cliente_fecha_nac: fmtFecha(reclamo.fecha_nacimiento) || reclamo.fecha_nacimiento || '',
    cliente_domicilio_real: reclamo.domicilio_real || '',
    cliente_celular: reclamo.telefono || '',
    cliente_email: reclamo.email || '',
    aerolinea: reclamo.aerolinea || '',
    vuelo_numero: reclamo.vuelo_nro || '',
    fecha_dia: fecha.dia,
    fecha_mes: fecha.mes,
    fecha_anio: fecha.anio,
  };
  return { data: data, faltantes: faltantes };
}

/**
 * Genera el PDF legal (poder o patrocinio) a partir del reclamo (+ abogado si
 * corresponde). Lanza un error con `.faltantes` (array de labels) si falta
 * algún campo requerido — nunca genera un PDF con blancos.
 */
export async function generarDocumentoLegal({ tipo, idioma, reclamo, abogado }) {
  var built, templateName;
  if (tipo === 'poder') {
    built = buildPoderData(reclamo, idioma);
    templateName = idioma === 'en' ? 'poder_en' : 'poder_es';
  } else if (tipo === 'patrocinio') {
    built = buildPatrocinioData(reclamo, abogado);
    templateName = 'patrocinio_es';
  } else {
    throw new Error('Tipo de documento inválido: ' + tipo);
  }

  if (built.faltantes.length) {
    var err = new Error('Faltan campos requeridos para generar el documento.');
    err.faltantes = built.faltantes;
    throw err;
  }

  var template = loadTemplate(templateName);
  var text = interpolate(template, built.data);
  var buffer = await renderLegalPdf(text, { refCode: reclamo.ref_code });
  var filename = (tipo === 'poder' ? ('Poder_' + idioma) : 'Patrocinio') + '_' + (reclamo.ref_code || 'caso') + '.pdf';
  return { buffer: buffer, filename: filename };
}
