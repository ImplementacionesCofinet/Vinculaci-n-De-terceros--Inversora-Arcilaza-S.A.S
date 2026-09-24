const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');
const config = require('./config');
const { db } = require('./db');
const CAMPOS = require('../public/shared/campos');

const smtpConfigurado = Boolean(config.smtp.host);
const transporte = smtpConfigurado
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

const LOGO = path.join(__dirname, '..', 'public', 'shared', 'logo-cofinet.png');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lista = (s) => String(s || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);

// Colores de la paleta oficial (los correos no admiten variables CSS)
const C = { verde: '#1D3B37', texto: '#2D3733', suave: '#4E5D59', borde: '#EFDDC9', crema: '#F0E7DF', fondo: '#F0E7DF', fucsia: '#932553', cobre: '#B37956', oxido: '#8D321D' };

function plantilla(contenido) {
  return `<div style="background:${C.fondo};padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:${C.texto}">
  <div style="max-width:780px;margin:0 auto;background:#fff;border:1px solid ${C.borde};border-radius:4px;padding:28px 28px 22px">
    <table role="presentation" style="border-collapse:collapse;width:100%;border-bottom:2px solid ${C.verde}"><tr>
      <td style="padding:0 16px 16px 0;width:1%;white-space:nowrap"><img src="cid:logo" alt="Cofinet" height="26" style="display:block;height:26px"></td>
      <td style="padding:0 0 16px 16px;border-left:1px solid ${C.borde};font-size:13px;color:${C.suave};line-height:1.45">${esc(config.empresa.nombre)}<br>SAGRILAFT / SARLAFT / PTEE</td>
    </tr></table>
    ${contenido}
    <p style="font-size:12px;color:${C.suave};line-height:1.6;border-top:1px solid ${C.borde};padding-top:14px;margin:24px 0 0">
      Correo generado automáticamente por el sistema de Vinculación de terceros. ${esc(config.empresa.nombre)} · ${esc(config.empresa.direccion)}.</p>
  </div></div>`;
}

function tablaDatos(filas) {
  return `<table role="presentation" style="border-collapse:separate;border-spacing:0;width:100%;border:1px solid ${C.borde};border-radius:4px;font-size:14px;margin:18px 0">
    ${filas.filter(([, v]) => v).map(([k, v], i) => `<tr>
      <td style="background:${C.crema};color:${C.suave};padding:11px 15px;width:34%;${i ? `border-top:1px solid ${C.borde}` : ''}">${esc(k)}</td>
      <td style="padding:11px 15px;font-weight:600;${i ? `border-top:1px solid ${C.borde}` : ''}">${esc(v)}</td></tr>`).join('')}
  </table>`;
}

const boton = (texto, url) =>
  `<a href="${esc(url)}" style="display:inline-block;background:${C.verde};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 22px;border-radius:4px">${esc(texto)}</a>`;

async function enviar(t, { tipo, para, cc, asunto, html, texto, adjuntos = [] }) {
  const destinatarios = lista(para);
  const copia = lista(cc);
  if (!destinatarios.length) {
    const detalle = tipo === 'cumplimiento' ? 'No hay correo del Oficial de Cumplimiento configurado (OFICIAL_CUMPLIMIENTO_EMAIL)' : 'Sin destinatario';
    db.prepare('INSERT INTO correos (tercero_id, tipo, destinatarios, asunto, estado, detalle) VALUES (?, ?, ?, ?, ?, ?)').run(t.id, tipo, '—', asunto, 'error', detalle);
    return { ok: false, error: detalle };
  }
  let estado = 'enviado';
  let detalle = adjuntos.length ? `${adjuntos.length} adjunto(s)` : null;
  try {
    const info = await transporte.sendMail({
      from: config.smtp.from, to: destinatarios, cc: copia.length ? copia : undefined, subject: asunto, text: texto, html: plantilla(html),
      attachments: [{ filename: 'logo.png', path: LOGO, cid: 'logo' }, ...adjuntos],
    });
    if (!smtpConfigurado) {
      fs.mkdirSync(config.correosDir, { recursive: true });
      const archivo = path.join(config.correosDir, `${t.consecutivo}_${tipo}_${Date.now()}.eml`);
      fs.writeFileSync(archivo, info.message);
      estado = 'simulado';
      detalle = `SMTP no configurado; guardado como ${path.basename(archivo)}`;
    }
  } catch (e) {
    estado = 'error';
    detalle = e.message;
  }
  db.prepare('INSERT INTO correos (tercero_id, tipo, destinatarios, asunto, estado, detalle) VALUES (?, ?, ?, ?, ?, ?)')
    .run(t.id, tipo, [...destinatarios, ...copia].join(', '), asunto, estado, detalle);
  return estado === 'error' ? { ok: false, error: detalle } : { ok: true, estado, detalle };
}

const tipoContraparte = (t) => `${CAMPOS.CATEGORIAS[t.categoria].nombre} · ${CAMPOS.PERSONAS[t.persona]}`;
const etiquetaDoc = (t) => (t.tipo_documento === 'NIT' ? 'NIT' : 'Documento');

/** Confirmación al tercero de que su registro quedó radicado. */
function confirmarRadicado(t) {
  const asunto = `[${t.consecutivo}] Recibimos su registro — ${config.empresa.nombre}`;
  const html = `
    <p style="font-size:15px;line-height:1.65;margin:20px 0 0">Hola${t.contacto ? ' ' + esc(t.contacto) : ''},</p>
    <p style="font-size:15px;line-height:1.65">Recibimos el registro de <b>${esc(t.nombre)}</b> como ${esc(CAMPOS.CATEGORIAS[t.categoria].nombre.toLowerCase())} de ${esc(config.empresa.nombre)}.
      Su número de radicado es:</p>
    <p style="font-family:Georgia,serif;font-size:30px;font-weight:bold;color:${C.verde};margin:8px 0 18px">${esc(t.consecutivo)}</p>
    <p style="font-size:14px;line-height:1.65;color:${C.suave}">El área de Contabilidad revisará la información y los ${t.anexos.length} documentos adjuntos. Si falta algo, le escribiremos a este correo con las indicaciones para completarlo.</p>`;
  return enviar(t, { tipo: 'radicado', para: t.email, asunto, html, texto: `Su registro fue radicado con el número ${t.consecutivo}.` });
}

/** Devuelve el expediente al tercero con las observaciones y el enlace para corregir. */
function devolverAlTercero(t, token, observaciones, pendientes) {
  const url = `${config.baseUrl}/formulario/?expediente=${encodeURIComponent(token)}`;
  const asunto = `[${t.consecutivo}] Su registro requiere ajustes — ${config.empresa.nombre}`;
  const html = `
    <p style="font-size:15px;line-height:1.65;margin:20px 0 0">Hola${t.contacto ? ' ' + esc(t.contacto) : ''},</p>
    <p style="font-size:15px;line-height:1.65">Contabilidad revisó el registro <b>${esc(t.consecutivo)}</b> de <b>${esc(t.nombre)}</b> y necesita que ajuste lo siguiente:</p>
    <div style="background:${C.crema};border-left:3px solid ${C.fucsia};padding:14px 16px;font-size:14.5px;line-height:1.65;white-space:pre-line;margin:14px 0">${esc(observaciones)}</div>
    ${pendientes.length ? `<p style="font-size:13px;color:${C.suave};margin:0 0 6px;letter-spacing:.08em;font-weight:bold">DOCUMENTOS POR REVISAR</p>
      <ul style="font-size:14px;line-height:1.7;margin:0 0 16px;padding-left:18px">${pendientes.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    <p style="margin:20px 0">${boton('Corregir mi registro', url)}</p>
    <p style="font-size:13px;color:${C.suave}">Si el botón no funciona, copie este enlace en su navegador:<br>${esc(url)}</p>`;
  return enviar(t, { tipo: 'devolucion', para: t.email, asunto, html, texto: `${observaciones}\n\nCorrija su registro en: ${url}` });
}

/** Correo automático al Oficial de Cumplimiento cuando Contabilidad aprueba el expediente. */
function enviarACumplimiento(t, rutaAnexo) {
  const asunto = `[${t.consecutivo}] Tercero aprobado por Contabilidad — ${t.nombre}`;
  const orden = CAMPOS.anexosPara(t.categoria, t.persona).map((d) => d.name);
  const adjuntos = [...t.anexos].sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo) || a.nombre_archivo.localeCompare(b.nombre_archivo))
    .map((a) => rutaAnexo(a.id)).filter((a) => a && fs.existsSync(a.abs))
    .map((a) => ({ filename: a.nombre_archivo.replace(`${t.consecutivo} - `, ''), path: a.abs, contentType: a.mime }));
  const carpeta = t.carpeta.split('/');
  const html = `
    <p style="font-size:15px;line-height:1.65;margin:20px 0 0">Contabilidad revisó y aprobó la documentación del siguiente tercero. Queda pendiente la verificación en listas restrictivas y la debida diligencia de su parte.</p>
    ${tablaDatos([
      ['Consecutivo', t.consecutivo],
      [t.persona === 'juridica' ? 'Razón social' : 'Nombre', t.nombre],
      ['Tipo de contraparte', tipoContraparte(t)],
      [etiquetaDoc(t), CAMPOS.documento(t.tipo_documento, t.numero_documento)],
      ['Ciudad', [t.ciudad, t.pais && t.pais !== 'Colombia' ? t.pais : ''].filter(Boolean).join(', ')],
      ['Representante legal', t.datos.representante_legal],
      ['Revisado por', `${t.revisado_por} · ${String(t.fecha_aprobacion || '').slice(0, 10).split('-').reverse().join('/')}`],
    ])}
    <p style="font-size:12.5px;color:${C.suave};letter-spacing:.1em;font-weight:bold;margin:0 0 8px">DOCUMENTOS ADJUNTOS · ${adjuntos.length} ARCHIVO${adjuntos.length === 1 ? '' : 'S'}</p>
    <table role="presentation" style="width:100%;font-size:13.5px;line-height:1.75;border-collapse:collapse">
      ${adjuntos.reduce((filas, a, i) => (i % 2 ? filas[filas.length - 1].push(a) : filas.push([a]), filas), [])
        .map((fila) => `<tr>${fila.map((a) => `<td style="width:50%;padding:0 8px 0 0"><span style="color:${C.cobre}">·</span> ${esc(a.filename)}</td>`).join('')}</tr>`).join('')}
    </table>
    <table role="presentation" style="margin-top:22px;border-collapse:collapse"><tr>
      ${t.sharepoint_url ? `<td style="padding-right:14px">${boton('Abrir expediente en SharePoint', t.sharepoint_url)}</td>` : ''}
      <td style="font-size:12.5px;color:${C.suave};line-height:1.5">${esc(carpeta.slice(0, -1).join(' / '))} /<br>${esc(carpeta[carpeta.length - 1])}</td>
    </tr></table>`;
  return enviar(t, {
    tipo: 'cumplimiento', para: config.oficial.email, cc: config.oficial.cc, asunto, html, adjuntos,
    texto: `Contabilidad aprobó el tercero ${t.consecutivo} – ${t.nombre}\nSe adjuntan ${adjuntos.length} documentos.`,
  });
}


/** Avisa al Oficial de Cumplimiento que un expediente que se le envió fue reversado por Contabilidad. */
function avisarReverso(t, motivo, usuario) {
  const asunto = `[${t.consecutivo}] Aprobación reversada por Contabilidad — ${t.nombre}`;
  const html = `
    <p style="font-size:15px;line-height:1.65;margin:20px 0 0">Contabilidad <b>reversó la aprobación</b> del expediente <b>${esc(t.consecutivo)}</b> de <b>${esc(t.nombre)}</b>,
      que se le había enviado para verificación. Por favor no tenga en cuenta el envío anterior; el expediente volvió a revisión y se le enviará de nuevo cuando quede aprobado.</p>
    <div style="background:${C.crema};border-left:3px solid ${C.oxido};padding:14px 16px;font-size:14.5px;line-height:1.65;white-space:pre-line;margin:14px 0"><b>Motivo:</b> ${esc(motivo)}</div>
    ${tablaDatos([['Consecutivo', t.consecutivo], ['Tipo de contraparte', tipoContraparte(t)], ['Reversado por', usuario]])}`;
  return enviar(t, { tipo: 'reverso', para: config.oficial.email, cc: config.oficial.cc, asunto, html, texto: `Contabilidad reversó la aprobación de ${t.consecutivo}. Motivo: ${motivo}` });
}

module.exports = { smtpConfigurado, confirmarRadicado, devolverAlTercero, enviarACumplimiento, avisarReverso };
