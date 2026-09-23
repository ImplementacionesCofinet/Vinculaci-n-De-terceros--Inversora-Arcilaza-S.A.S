const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');
const config = require('./config');
const { db, registrarHistorial } = require('./db');
const CAMPOS = require('../public/shared/campos');
const { rutaAnexo } = require('./terceros');

const smtpConfigurado = Boolean(config.smtp.host);

const transporte = smtpConfigurado
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cuerpoHtml(t, mensaje) {
  const cat = CAMPOS.CATEGORIAS[t.categoria];
  let html = `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:760px">
    <div style="background:#0f3d3e;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">Vinculación de terceros – ${esc(config.empresa)}</div>
      <div style="font-size:20px;font-weight:bold;margin-top:4px">${esc(cat.nombre)} ${esc(t.consecutivo)} · ${esc(t.nombre)}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:0;padding:18px 22px;border-radius:0 0 8px 8px">`;
  if (mensaje) html += `<p style="white-space:pre-line">${esc(mensaje)}</p>`;
  html += `<p style="margin:0 0 12px"><b>Estado:</b> ${esc(CAMPOS.ESTADOS[t.estado])}${t.validado_por ? ` · Validado por ${esc(t.validado_por)} (${esc(t.fecha_validacion)})` : ''}</p>`;
  for (const s of CAMPOS.seccionesPara(t.categoria, t.datos)) {
    const filas = s.campos.filter((c) => t.datos[c.name]);
    if (!filas.length) continue;
    html += `<h3 style="font-size:14px;color:#0f3d3e;border-bottom:2px solid #c9a227;padding-bottom:4px;margin:18px 0 8px">${esc(s.titulo)}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">`;
    for (const c of filas) {
      html += `<tr><td style="padding:4px 8px;width:40%;color:#6b7280;border-bottom:1px solid #f3f4f6">${esc(c.label)}</td>
               <td style="padding:4px 8px;border-bottom:1px solid #f3f4f6">${esc(t.datos[c.name])}</td></tr>`;
    }
    html += '</table>';
  }
  if (t.anexos.length) {
    html += `<h3 style="font-size:14px;color:#0f3d3e;border-bottom:2px solid #c9a227;padding-bottom:4px;margin:18px 0 8px">Anexos adjuntos</h3><ul style="font-size:13px">`;
    for (const a of t.anexos) html += `<li>${esc(CAMPOS.etiqueta(a.tipo))}: ${esc(a.nombre_original)}</li>`;
    html += '</ul>';
  }
  if (t.observaciones) html += `<p style="font-size:13px"><b>Observaciones de validación:</b> ${esc(t.observaciones)}</p>`;
  html += `<p style="font-size:11px;color:#9ca3af;margin-top:24px">Mensaje generado por el aplicativo Vinculación de terceros – ${esc(config.empresa)}</p></div></div>`;
  return html;
}

/**
 * Envía la información del tercero y sus anexos.
 * Si no hay SMTP configurado, guarda el mensaje como .eml (modo simulado).
 */
async function enviarTercero(t, { destinatarios, cc, asunto, mensaje, anexosIds }, usuario) {
  const para = String(destinatarios || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const copia = String(cc || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const invalido = [...para, ...copia].find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!para.length) return { ok: false, errores: ['Indique al menos un destinatario'] };
  if (invalido) return { ok: false, errores: [`Correo no válido: ${invalido}`] };

  const seleccion = Array.isArray(anexosIds) ? new Set(anexosIds.map(Number)) : null;
  const attachments = t.anexos
    .filter((a) => !seleccion || seleccion.has(a.id))
    .map((a) => rutaAnexo(a.id))
    .filter((a) => a && fs.existsSync(a.abs))
    .map((a) => ({ filename: `${a.tipo}_${a.nombre_original}`, path: a.abs, contentType: a.mime }));

  const subject = asunto || `Vinculación ${CAMPOS.CATEGORIAS[t.categoria].nombre} ${t.consecutivo} – ${t.nombre}`;
  const texto = `${mensaje ? mensaje + '\n\n' : ''}${CAMPOS.CATEGORIAS[t.categoria].nombre} ${t.consecutivo} – ${t.nombre}\nDocumento: ${t.tipo_documento} ${t.numero_documento}\n`;

  let estado = 'enviado';
  let detalle = `${attachments.length} anexo(s)`;
  try {
    const info = await transporte.sendMail({
      from: config.smtp.from, to: para, cc: copia.length ? copia : undefined,
      subject, text: texto, html: cuerpoHtml(t, mensaje), attachments,
    });
    if (!smtpConfigurado) {
      fs.mkdirSync(config.correosDir, { recursive: true });
      const archivo = path.join(config.correosDir, `${t.consecutivo}_${Date.now()}.eml`);
      fs.writeFileSync(archivo, info.message);
      estado = 'simulado';
      detalle += ` · SMTP no configurado, guardado como ${path.basename(archivo)}`;
    }
  } catch (e) {
    estado = 'error';
    detalle = e.message;
  }

  db.prepare('INSERT INTO correos (tercero_id, destinatarios, asunto, estado, detalle, usuario) VALUES (?, ?, ?, ?, ?, ?)')
    .run(t.id, [...para, ...copia].join(', '), subject, estado, detalle, usuario);
  if (estado === 'error') {
    registrarHistorial(t.id, 'Error al enviar correo', detalle, usuario);
    return { ok: false, errores: ['No se pudo enviar el correo: ' + detalle] };
  }
  db.prepare("UPDATE terceros SET estado = 'enviado', fecha_envio = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?").run(t.id);
  registrarHistorial(t.id, estado === 'simulado' ? 'Correo generado (simulado)' : 'Correo enviado', `Para: ${para.join(', ')} · ${detalle}`, usuario);
  return { ok: true, estado, detalle };
}

module.exports = { enviarTercero, smtpConfigurado };
