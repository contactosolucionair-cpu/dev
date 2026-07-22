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
  var s = String(v);
  /* Fechas ISO (solo día o con hora) se formatean por sus componentes, sin pasar por
     new Date(), que interpreta 'YYYY-MM-DD' como UTC y correría el día en AR (UTC-3). */
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  var d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

function fechaLetras() {
  var d = new Date();
  return { dia: String(d.getDate()), mes: MESES[d.getMonth()], anio: String(d.getFullYear()) };
}

/* documento_tipo convive con dos convenciones de casing en la app (los forms de carga
   guardan 'DNI'/'Pasaporte'/'ID'; el modal de patrocinio guarda 'dni'/'pasaporte' en
   minúscula) — comparar siempre normalizado para no depender de cuál se usó. */
function esPasaporte(tipo) {
  return String(tipo || '').trim().toLowerCase() === 'pasaporte';
}
function esDni(tipo) {
  return String(tipo || '').trim().toLowerCase() === 'dni';
}

/* Con DNI: "DNI N° 12.345.678" · Con pasaporte: "Pasaporte N° AB1234567" (o el
   equivalente en inglés si el poder se genera en ese idioma). */
function composeDocumento(tipo, numero, idioma) {
  if (!numero) return '';
  var en = idioma === 'en';
  if (esPasaporte(tipo)) return (en ? 'Passport No. ' : 'Pasaporte N° ') + numero;
  return (en ? 'DNI No. ' : 'DNI N° ') + numero;
}

/* Apellido para el nombre de archivo: última palabra del nombre completo
   (no hay un campo de apellido separado en el modelo de datos). */
function apellidoDe(nombre) {
  var partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : '';
}

function sanitizeFilenamePart(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
}

/* Residente/argentino con DNI: "DNI X, CUIT/CUIL Y" · Extranjero con pasaporte:
   "Pasaporte X (emitido por <país>), identificación fiscal: <id>" */
function composeClienteIdentificacion(r) {
  if (esPasaporte(r.documento_tipo)) {
    if (!r.documento_numero || !r.pais_emisor || !r.id_fiscal_extranjero) return '';
    return 'Pasaporte ' + r.documento_numero + ' (emitido por ' + r.pais_emisor + '), identificación fiscal: ' + r.id_fiscal_extranjero;
  }
  if (!r.documento_numero || !r.cuil) return '';
  return 'DNI ' + r.documento_numero + ', CUIT/CUIL ' + r.cuil;
}

function buildPoderData(persona, idioma) {
  var faltantes = [];
  if (!persona.nombre) faltantes.push('Nombre del pasajero');
  if (!persona.documento_numero) faltantes.push('Documento del pasajero (número)');
  if (!persona.email) faltantes.push('Email del pasajero');
  if (!persona.aerolinea) faltantes.push('Aerolínea');
  if (!persona.vuelo_nro) faltantes.push('Número de vuelo');
  if (!persona.fecha_vuelo) faltantes.push('Fecha del vuelo');
  if (!persona.origen || !persona.destino) faltantes.push('Origen y destino del vuelo');

  var data = {
    otorgante_nombre: persona.nombre || '',
    otorgante_documento: composeDocumento(persona.documento_tipo, persona.documento_numero, idioma),
    otorgante_email: persona.email || '',
    vuelo_aerolinea: persona.aerolinea || '',
    vuelo_numero: persona.vuelo_nro || '',
    vuelo_fecha: fmtFecha(persona.fecha_vuelo) || persona.fecha_vuelo || '',
    vuelo_ruta: [persona.origen, persona.destino].filter(Boolean).join(idioma === 'en' ? ' to ' : ' > '),
  };
  return { data: data, faltantes: faltantes };
}

function buildPatrocinioData(persona, abogado) {
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
  if (!persona.nombre) faltantes.push('Nombre del cliente');
  if (!persona.documento_tipo) faltantes.push('Tipo de documento del cliente (DNI o pasaporte)');
  if (!persona.documento_numero) faltantes.push('Número de documento del cliente');
  if (esPasaporte(persona.documento_tipo)) {
    if (!persona.pais_emisor) faltantes.push('País emisor del pasaporte');
    if (!persona.id_fiscal_extranjero) faltantes.push('Identificación fiscal del país emisor');
  } else if (esDni(persona.documento_tipo)) {
    if (!persona.cuil) faltantes.push('CUIT/CUIL del cliente');
  }
  if (!persona.fecha_nacimiento) faltantes.push('Fecha de nacimiento del cliente');
  if (!persona.domicilio_real) faltantes.push('Domicilio real del cliente');
  if (!persona.telefono) faltantes.push('Celular del cliente');
  if (!persona.email) faltantes.push('Email del cliente');
  if (!persona.aerolinea) faltantes.push('Aerolínea');
  if (!persona.vuelo_nro) faltantes.push('Número de vuelo');

  var data = {
    cliente_nombre: persona.nombre || '',
    cliente_identificacion: composeClienteIdentificacion(persona),
    cliente_fecha_nac: fmtFecha(persona.fecha_nacimiento) || persona.fecha_nacimiento || '',
    cliente_domicilio_real: persona.domicilio_real || '',
    cliente_celular: persona.telefono || '',
    cliente_email: persona.email || '',
  };
  return { data: data, faltantes: faltantes };
}

/* Datos del abogado + fecha, compartidos por todos los clientes de un patrocinio. */
function buildAbogadoData(abogado) {
  var fecha = fechaLetras();
  return {
    abogado_nombre: abogado ? (abogado.nombre || '') : '',
    abogado_matricula: abogado ? (abogado.matricula || '') : '',
    abogado_colegio: abogado ? (abogado.colegio || '') : '',
    abogado_domicilio: abogado ? (abogado.domicilio || '') : '',
    abogado_email: abogado ? (abogado.email || '') : '',
    fecha_dia: fecha.dia,
    fecha_mes: fecha.mes,
    fecha_anio: fecha.anio,
  };
}

/* Antepone el nombre del pasajero a cada faltante cuando el documento es conjunto,
   para que el operador sepa a quién le falta cada dato. */
function etiquetarFaltantes(nombre, faltantes) {
  var quien = (nombre || '').trim() || 'Pasajero sin nombre';
  return faltantes.map(function (f) { return quien + ': ' + f; });
}

/* Bloque de otorgantes (poder conjunto): un párrafo numerado por otorgante, más el
   cierre que los define colectivamente. */
function buildOtorgantesBloque(personas, idioma) {
  var en = idioma === 'en';
  var titulo = en ? '**Grantors:**' : '**Otorgantes:**';
  var lineas = personas.map(function (p, i) {
    var doc = composeDocumento(p.documento_tipo, p.documento_numero, idioma);
    if (en) {
      return '(' + (i + 1) + ') Mr./Ms. ' + (p.nombre || '') + ', ' + doc + ', with electronic domicile (e-mail) at ' + (p.email || '') + ';';
    }
    return '(' + (i + 1) + ') Sr./Sra. ' + (p.nombre || '') + ', ' + doc + ', con domicilio electrónico (correo) en ' + (p.email || '') + ';';
  });
  var cierre = en
    ? 'jointly and severally, the "Grantors",'
    : 'en adelante, en forma conjunta e indistinta, los «Otorgantes»,';
  return titulo + '\n\n' + lineas.join('\n\n') + '\n\n' + cierre;
}

/* Bloque de firmas (poder conjunto): un bloque por otorgante. */
function buildFirmasBloque(personas, idioma) {
  var en = idioma === 'en';
  var head = en ? '**SIGNATURES**' : '**FIRMAS**';
  var bloques = personas.map(function (p, i) {
    var doc = composeDocumento(p.documento_tipo, p.documento_numero, idioma);
    if (en) {
      return '**Grantor ' + (i + 1) + '**\n'
        + 'Signature: __________________________________________\n'
        + 'Full name: ' + (p.nombre || '') + '\n'
        + 'ID/Passport: ' + doc;
    }
    return '**Otorgante ' + (i + 1) + '**\n'
      + 'Firma: __________________________________________\n'
      + 'Aclaración: ' + (p.nombre || '') + '\n'
      + 'DNI/Pasaporte: ' + doc;
  });
  return head + '\n\n' + bloques.join('\n\n');
}

/* Bloque de clientes (patrocinio conjunto): un párrafo numerado por cliente. */
function buildClientesBloque(personas) {
  return personas.map(function (p, i) {
    return '(' + (i + 1) + ') Sr./Sra. ' + (p.nombre || '') + ', por derecho propio, '
      + composeClienteIdentificacion(p) + ', fecha de nacimiento ' + (fmtFecha(p.fecha_nacimiento) || p.fecha_nacimiento || '')
      + ', con domicilio real en ' + (p.domicilio_real || '') + ', celular ' + (p.telefono || '')
      + ' y correo electrónico ' + (p.email || '') + ';';
  }).join('\n\n');
}

function throwFaltantes(faltantes) {
  var err = new Error('Faltan campos requeridos para generar el documento.');
  err.faltantes = faltantes;
  throw err;
}

/**
 * Genera el PDF legal (poder o patrocinio) para uno o varios pasajeros.
 *
 * @param {Object}   opts
 * @param {string}   opts.tipo      'poder' | 'patrocinio'
 * @param {string}   opts.idioma    'es' | 'en' (solo aplica al poder)
 * @param {Object[]} opts.personas  1..N pasajeros, cada uno con sus datos personales
 *                                   ya combinados con los datos compartidos del vuelo/caso.
 * @param {Object}   [opts.abogado] abogado asignado (requerido para patrocinio)
 * @param {Object}   [opts.reclamo] caso, usado solo para ref_code del pie de página
 * @returns {{buffer: Buffer, filename: string}}
 * @throws  error con `.faltantes` (array de labels) si falta algún dato requerido.
 */
export async function generarDocumentoLegal({ tipo, idioma, personas, abogado, reclamo }) {
  var lista = Array.isArray(personas) && personas.length ? personas : (reclamo ? [reclamo] : []);
  if (!lista.length) throw new Error('No se indicó ningún pasajero para el documento.');
  var multi = lista.length > 1;
  var refCode = (reclamo && reclamo.ref_code) || lista[0].ref_code || '';

  var templateName, data, titulo;

  if (tipo === 'poder') {
    if (multi) {
      var faltPoder = [];
      lista.forEach(function (p) {
        var b = buildPoderData(p, idioma);
        if (b.faltantes.length) faltPoder = faltPoder.concat(etiquetarFaltantes(p.nombre, b.faltantes));
      });
      if (faltPoder.length) throwFaltantes(faltPoder);
      var flight = buildPoderData(lista[0], idioma).data;
      data = {
        otorgantes_bloque: buildOtorgantesBloque(lista, idioma),
        vuelo_aerolinea: flight.vuelo_aerolinea,
        vuelo_numero: flight.vuelo_numero,
        vuelo_fecha: flight.vuelo_fecha,
        vuelo_ruta: flight.vuelo_ruta,
        firmas_bloque: buildFirmasBloque(lista, idioma),
      };
      templateName = idioma === 'en' ? 'poder_en_conjunto' : 'poder_es_conjunto';
    } else {
      var builtP = buildPoderData(lista[0], idioma);
      if (builtP.faltantes.length) throwFaltantes(builtP.faltantes);
      data = builtP.data;
      templateName = idioma === 'en' ? 'poder_en' : 'poder_es';
    }
    titulo = idioma === 'en' ? 'Claim Management Authorization' : 'Autorización de Gestión de Reclamos';

  } else if (tipo === 'patrocinio') {
    if (multi) {
      var faltPat = [];
      var abogadoFaltantes = null;
      lista.forEach(function (p, i) {
        var b = buildPatrocinioData(p, abogado);
        /* Los faltantes del abogado son compartidos: reportarlos una sola vez, sin etiqueta. */
        var abog = [], cliente = [];
        b.faltantes.forEach(function (f) { (/abogado/i.test(f) ? abog : cliente).push(f); });
        if (i === 0) abogadoFaltantes = abog;
        if (cliente.length) faltPat = faltPat.concat(etiquetarFaltantes(p.nombre, cliente));
      });
      if (abogadoFaltantes && abogadoFaltantes.length) faltPat = abogadoFaltantes.concat(faltPat);
      if (faltPat.length) throwFaltantes(faltPat);
      data = buildAbogadoData(abogado);
      data.clientes_bloque = buildClientesBloque(lista);
      data.aerolinea = lista[0].aerolinea || '';
      data.vuelo_numero = lista[0].vuelo_nro || '';
      templateName = 'patrocinio_es_conjunto';
    } else {
      var builtPat = buildPatrocinioData(lista[0], abogado);
      if (builtPat.faltantes.length) throwFaltantes(builtPat.faltantes);
      data = Object.assign({}, buildAbogadoData(abogado), builtPat.data, {
        aerolinea: lista[0].aerolinea || '',
        vuelo_numero: lista[0].vuelo_nro || '',
      });
      templateName = 'patrocinio_es';
    }
    titulo = 'Designación de Patrocinio Letrado';

  } else {
    throw new Error('Tipo de documento inválido: ' + tipo);
  }

  var template = loadTemplate(templateName);
  var text = interpolate(template, data);

  var apellido = sanitizeFilenamePart(apellidoDe(lista[0].nombre)) || (refCode || 'Caso');
  if (multi) apellido = apellido + ' y otros';
  var tituloCompleto = apellido + ' - ' + titulo;

  var buffer = await renderLegalPdf(text, { refCode: refCode, title: tituloCompleto });
  var filename = tituloCompleto + '.pdf';
  return { buffer: buffer, filename: filename };
}
