const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const config = require('./src/config');
const { db, registrarHistorial, verSiguienteConsecutivo } = require('./src/db');
const T = require('./src/terceros');
const correo = require('./src/mailer');
const sharepoint = require('./src/sharepoint');
const AlmacenSqlite = require('./src/sesiones');
const CAMPOS = require('./public/shared/campos');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------- Carga de archivos ----------
const tmpDir = path.join(path.dirname(config.dbPath), 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({
  dest: tmpDir,
  limits: { fileSize: CAMPOS.MAX_MB * 1024 * 1024, files: 40 },
  fileFilter: (req, file, cb) => {
    // multer entrega el nombre en latin1; se corrige a UTF-8 para conservar tildes y ñ.
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, true);
  },
}).any();

function conArchivos(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    T.eliminarTemporales(req.files);
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Cada archivo debe pesar máximo ${CAMPOS.MAX_MB} MB` : err.message;
    res.status(400).json({ ok: false, errores: [msg] });
  });
}

// ---------- Middlewares ----------
app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'arcilaza.sid',
  store: new AlmacenSqlite(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 10 * 60 * 60 * 1000 },
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

/** Límite simple de intentos por IP (p. ej. para el ingreso y el portal público). */
function limite(maximo, ventanaMin, mensaje) {
  const intentos = new Map();
  setInterval(() => { const ahora = Date.now(); for (const [k, v] of intentos) if (v.hasta < ahora) intentos.delete(k); }, 60_000).unref();
  return (req, res, next) => {
    const ahora = Date.now();
    const v = intentos.get(req.ip) || { n: 0, hasta: ahora + ventanaMin * 60_000 };
    if (v.hasta < ahora) { v.n = 0; v.hasta = ahora + ventanaMin * 60_000; }
    v.n += 1;
    intentos.set(req.ip, v);
    if (v.n > maximo) {
      T.eliminarTemporales(req.files);
      return res.status(429).json({ ok: false, errores: [mensaje] });
    }
    next();
  };
}
const limiteIngreso = limite(10, 15, 'Demasiados intentos de ingreso. Espere 15 minutos.');
const limitePortal = limite(30, 60, 'Demasiados envíos desde esta conexión. Intente más tarde.');

const requiereSesion = (req, res, next) =>
  req.session.usuario ? next() : res.status(401).json({ ok: false, errores: ['Sesión expirada. Ingrese nuevamente.'] });
const requiereAdmin = (req, res, next) =>
  req.session.usuario?.rol === 'admin' ? next() : res.status(403).json({ ok: false, errores: ['Solo el administrador puede realizar esta acción'] });
const quien = (req) => req.session.usuario?.nombre || 'Sistema';
const idParam = (req) => Number.parseInt(req.params.id, 10);

// ---------- Páginas ----------
app.use('/shared', express.static(path.join(__dirname, 'public/shared')));
app.use('/formulario', express.static(path.join(__dirname, 'public/formulario')));
app.use('/app', express.static(path.join(__dirname, 'public/app')));
app.get('/', (req, res) => res.redirect('/formulario/'));
app.get('/salud', (req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

app.get('/documentos/FOR-DCF-001.docx', (req, res) => {
  if (!fs.existsSync(config.formularioWord)) {
    return res.status(404).type('html').send('<p style="font-family:sans-serif;padding:24px">El formulario FOR-DCF-001 aún no está disponible para descarga. Escríbanos a ' +
      config.empresa.correo + '.</p>');
  }
  res.download(config.formularioWord, 'FOR-DCF-001 Formulario de vinculacion de terceros.docx');
});

// ---------- Portal público ----------
app.get('/api/public/config', (req, res) => {
  res.json({ ok: true, empresa: config.empresa, formularioDisponible: fs.existsSync(config.formularioWord) });
});

app.post('/api/public/registro', limitePortal, conArchivos, async (req, res) => {
  const { categoria, persona } = req.body;
  if (!CAMPOS.CATEGORIAS_PUBLICAS.includes(categoria)) {
    T.eliminarTemporales(req.files);
    return res.status(400).json({ ok: false, errores: ['Seleccione el tipo de contraparte'] });
  }
  const r = T.crearExpediente({ categoria, persona, body: req.body, archivos: req.files, origen: 'portal' });
  if (!r.ok) return res.status(400).json(r);
  const envio = await correo.confirmarRadicado(r.tercero);
  if (!envio.ok) registrarHistorial(r.tercero.id, 'No se pudo enviar la confirmación del radicado: ' + envio.error, 'Sistema');
  res.json({ ok: true, consecutivo: r.tercero.consecutivo, email: r.tercero.email });
});

// Expediente devuelto: el tercero corrige desde el enlace que recibió por correo
app.get('/api/public/expediente/:token', (req, res) => {
  const e = T.publicoPorToken(req.params.token);
  if (!e) return res.status(404).json({ ok: false, errores: ['El enlace no es válido'] });
  delete e.id;
  res.json({ ok: true, expediente: e });
});

app.post('/api/public/expediente/:token', limitePortal, conArchivos, (req, res) => {
  const e = T.publicoPorToken(req.params.token);
  if (!e) { T.eliminarTemporales(req.files); return res.status(404).json({ ok: false, errores: ['El enlace no es válido'] }); }
  if (e.estado !== 'devuelto') { T.eliminarTemporales(req.files); return res.status(400).json({ ok: false, errores: ['Este expediente ya no está pendiente de correcciones'] }); }
  const { validos, errores } = T.revisarArchivos(e.categoria, e.persona, req.files);
  if (Object.keys(errores).length) { T.eliminarTemporales(validos); return res.status(400).json({ ok: false, errores: Object.values(errores), archivos: errores }); }
  if (!validos.length) return res.status(400).json({ ok: false, errores: ['Adjunte al menos un documento corregido'] });
  const t = T.obtener(e.id);
  T.guardarArchivos(t, validos, 'Portal');
  T.cambiarEstado(t.id, 'pendiente');
  registrarHistorial(t.id, `El tercero envió correcciones desde el portal: ${[...new Set(validos.map((f) => CAMPOS.etiquetaAnexo(f.fieldname)))].join(', ')}.`, null);
  res.json({ ok: true, consecutivo: t.consecutivo });
});

// ---------- Autenticación ----------
app.post('/api/auth/login', limiteIngreso, (req, res) => {
  const { usuario, password } = req.body || {};
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(String(usuario || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    return res.status(401).json({ ok: false, errores: ['Usuario o contraseña incorrectos'] });
  }
  req.session.regenerate(() => {
    req.session.usuario = { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
    res.json({ ok: true, usuario: req.session.usuario });
  });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', (req, res) => res.json({
  ok: true, usuario: req.session.usuario || null, smtp: correo.smtpConfigurado, sharepoint: sharepoint.configurado,
  oficial: config.oficial.email ? `${config.oficial.nombre} <${config.oficial.email}>` : null, mesesActualizacion: config.mesesActualizacion,
}));
app.post('/api/auth/password', requiereSesion, (req, res) => {
  const { actual, nueva } = req.body || {};
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.usuario.id);
  if (!bcrypt.compareSync(String(actual || ''), u.password_hash)) return res.status(400).json({ ok: false, errores: ['La contraseña actual no es correcta'] });
  if (String(nueva || '').length < 8) return res.status(400).json({ ok: false, errores: ['La nueva contraseña debe tener al menos 8 caracteres'] });
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(nueva, 10), u.id);
  res.json({ ok: true });
});

// ---------- API del aplicativo contable ----------
const api = express.Router();
api.use(requiereSesion);

api.get('/resumen', (req, res) => res.json({ ok: true, ...T.resumen() }));
api.get('/por-actualizar', (req, res) => res.json({ ok: true, terceros: T.porActualizar() }));
api.get('/reportes', (req, res) => res.json({ ok: true, ...T.reportes(req.query.anio) }));
api.get('/consecutivo', (req, res) => {
  const cat = CAMPOS.CATEGORIAS[req.query.categoria] || CAMPOS.CATEGORIAS.proveedor;
  res.json({ ok: true, consecutivo: verSiguienteConsecutivo(cat.prefijo, new Date().getFullYear()) });
});

api.get('/terceros', (req, res) => {
  const { categoria, estado, anio, q } = req.query;
  res.json({ ok: true, terceros: T.listar({ categoria, estado, anio, q }) });
});

api.get('/terceros/exportar.csv', (req, res) => {
  const { categoria, estado, anio, q } = req.query;
  const filas = T.listar({ categoria, estado, anio, q, limite: 10000 }).map((f) => T.obtener(f.id));
  const revision = Object.values(CAMPOS.REVISION).flat();
  const cols = [
    ['Consecutivo', (t) => t.consecutivo], ['Tipo', (t) => CAMPOS.CATEGORIAS[t.categoria].nombre], ['Persona', (t) => CAMPOS.PERSONAS[t.persona]],
    ['Estado', (t) => CAMPOS.ESTADOS[t.estado]], ['Nombre o razón social', (t) => t.nombre], ['Tipo de documento', (t) => t.tipo_documento],
    ['Número de documento', (t) => t.numero_documento], ['País', (t) => t.pais], ['Ciudad', (t) => t.ciudad], ['Persona de contacto', (t) => t.contacto],
    ['Teléfono', (t) => t.telefono], ['Correo', (t) => t.email],
    ...revision.map((c) => [c.label, (t) => t.datos[c.name]]),
    ['Anexos', (t) => `${new Set(t.anexos.map((a) => a.tipo)).size} / ${CAMPOS.anexosPara(t.categoria, t.persona).length}`],
    ['Origen', (t) => (t.origen === 'portal' ? 'Portal' : 'Manual')], ['Recibido', (t) => t.created_at], ['Revisado por', (t) => t.revisado_por],
    ['Fecha de aprobación', (t) => t.fecha_aprobacion], ['Enviado a Cumplimiento', (t) => t.fecha_cumplimiento], ['Carpeta', (t) => t.carpeta],
  ];
  const celda = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [cols.map((c) => celda(c[0])).join(';'), ...filas.map((t) => cols.map((c) => celda(c[1](t))).join(';'))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="base_terceros_${categoria || 'todos'}_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

api.get('/terceros/:id', (req, res) => {
  if (!T.obtener(idParam(req))) return res.status(404).json({ ok: false, errores: ['Expediente no encontrado'] });
  T.abrirRevision(idParam(req), quien(req));
  res.json({ ok: true, tercero: T.obtener(idParam(req)) });
});

api.post('/terceros', conArchivos, (req, res) => {
  const { categoria, persona } = req.body;
  if (!CAMPOS.CATEGORIAS_MANUALES.includes(categoria)) {
    T.eliminarTemporales(req.files);
    return res.status(400).json({ ok: false, errores: ['Seleccione el tipo de tercero'] });
  }
  const r = T.crearExpediente({ categoria, persona, body: req.body, archivos: req.files, origen: 'manual', usuario: quien(req) });
  res.status(r.ok ? 200 : 400).json(r);
});

api.put('/terceros/:id', (req, res) => {
  const r = T.actualizar(idParam(req), req.body, quien(req));
  res.status(r.ok ? 200 : 400).json(r);
});

api.put('/terceros/:id/observaciones', (req, res) => {
  T.guardarObservaciones(idParam(req), req.body?.observaciones);
  res.json({ ok: true });
});

api.post('/terceros/:id/devolver', async (req, res) => {
  const t = T.obtener(idParam(req));
  if (!t) return res.status(404).json({ ok: false, errores: ['Expediente no encontrado'] });
  const obs = String(req.body?.observaciones || '').trim();
  if (!obs) return res.status(400).json({ ok: false, errores: ['Escriba en "Observaciones de la revisión" qué debe corregir el tercero'] });
  if (t.categoria === 'empleado') return res.status(400).json({ ok: false, errores: ['Los empleados no se devuelven por el portal'] });
  T.guardarObservaciones(t.id, obs);
  T.cambiarEstado(t.id, 'devuelto');
  const envio = await correo.devolverAlTercero(T.obtener(t.id), T.tokenDe(t.id), obs, req.body?.pendientes || []);
  registrarHistorial(t.id, envio.ok
    ? `${quien(req)} devolvió el expediente al tercero. Se notificó a ${t.email}${envio.estado === 'simulado' ? ' (correo simulado)' : ''}.`
    : `${quien(req)} devolvió el expediente, pero el correo al tercero falló: ${envio.error}`, quien(req));
  res.json({ ok: true, correo: envio, tercero: T.obtener(t.id) });
});

async function enviarCumplimiento(t, req) {
  const envio = await correo.enviarACumplimiento(t, T.rutaAnexo);
  if (envio.ok) {
    T.cambiarEstado(t.id, 'en_cumplimiento', { fecha_cumplimiento: 'ahora' });
    registrarHistorial(t.id, `Expediente enviado al Oficial de Cumplimiento${envio.estado === 'simulado' ? ' (correo simulado: SMTP no configurado)' : ''}.`, quien(req));
  } else {
    registrarHistorial(t.id, 'No se pudo enviar el correo al Oficial de Cumplimiento: ' + envio.error, quien(req));
  }
  return envio;
}

api.post('/terceros/:id/aprobar', async (req, res) => {
  const t = T.obtener(idParam(req));
  if (!t) return res.status(404).json({ ok: false, errores: ['Expediente no encontrado'] });
  if (['aprobado', 'en_cumplimiento'].includes(t.estado)) return res.status(400).json({ ok: false, errores: ['El expediente ya fue aprobado'] });
  if (req.body?.observaciones !== undefined) T.guardarObservaciones(t.id, req.body.observaciones);
  T.cambiarEstado(t.id, 'aprobado', { revisado_por: quien(req), fecha_aprobacion: 'ahora' });
  registrarHistorial(t.id, `${quien(req)} aprobó la documentación.`, quien(req));
  let envio = null;
  if (CAMPOS.CATEGORIAS[t.categoria].sagrilaft) envio = await enviarCumplimiento(T.obtener(t.id), req);
  res.json({ ok: true, correo: envio, tercero: T.obtener(t.id) });
});

api.post('/terceros/:id/reenviar-cumplimiento', async (req, res) => {
  const t = T.obtener(idParam(req));
  if (!t) return res.status(404).json({ ok: false, errores: ['Expediente no encontrado'] });
  if (!['aprobado', 'en_cumplimiento'].includes(t.estado)) return res.status(400).json({ ok: false, errores: ['Primero apruebe el expediente'] });
  const envio = await enviarCumplimiento(t, req);
  res.status(envio.ok ? 200 : 400).json({ ok: envio.ok, errores: envio.ok ? undefined : [envio.error], correo: envio, tercero: T.obtener(t.id) });
});

// Reversar: devuelve a revisión un expediente aprobado, enviado a Cumplimiento, devuelto o rechazado por error.
const REVERSIBLES = ['aprobado', 'en_cumplimiento', 'devuelto', 'rechazado'];
api.post('/terceros/:id/reversar', async (req, res) => {
  const t = T.obtener(idParam(req));
  if (!t) return res.status(404).json({ ok: false, errores: ['Expediente no encontrado'] });
  if (!REVERSIBLES.includes(t.estado)) return res.status(400).json({ ok: false, errores: ['Este expediente no tiene una acción que reversar'] });
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) return res.status(400).json({ ok: false, errores: ['Indique el motivo del reverso'] });
  const anterior = t.estado;
  T.cambiarEstado(t.id, 'en_revision', { revisado_por: null, fecha_aprobacion: null, fecha_cumplimiento: null });
  registrarHistorial(t.id, `${quien(req)} reversó el expediente (estaba "${CAMPOS.ESTADOS[anterior]}") y lo devolvió a revisión. Motivo: ${motivo}`, quien(req));
  let aviso = null;
  if (anterior === 'en_cumplimiento') {
    aviso = await correo.avisarReverso(t, motivo, quien(req));
    registrarHistorial(t.id, aviso.ok
      ? `Se avisó al Oficial de Cumplimiento que no tenga en cuenta el envío anterior${aviso.estado === 'simulado' ? ' (correo simulado)' : ''}.`
      : 'No se pudo avisar al Oficial de Cumplimiento: ' + aviso.error, quien(req));
  }
  res.json({ ok: true, correo: aviso, tercero: T.obtener(t.id) });
});

api.post('/terceros/:id/rechazar', (req, res) => {
  const t = T.obtener(idParam(req));
  if (!t) return res.status(404).json({ ok: false, errores: ['Expediente no encontrado'] });
  const obs = String(req.body?.observaciones || '').trim();
  if (!obs) return res.status(400).json({ ok: false, errores: ['Escriba en "Observaciones de la revisión" el motivo del rechazo'] });
  T.guardarObservaciones(t.id, obs);
  T.cambiarEstado(t.id, 'rechazado', { revisado_por: quien(req) });
  registrarHistorial(t.id, `${quien(req)} rechazó el expediente.`, quien(req));
  res.json({ ok: true, tercero: T.obtener(t.id) });
});

api.post('/terceros/:id/anexos', conArchivos, (req, res) => {
  const t = T.obtener(idParam(req));
  if (!t) { T.eliminarTemporales(req.files); return res.status(404).json({ ok: false, errores: ['Expediente no encontrado'] }); }
  const { validos, errores } = T.revisarArchivos(t.categoria, t.persona, req.files);
  if (Object.keys(errores).length) { T.eliminarTemporales(validos); return res.status(400).json({ ok: false, errores: Object.values(errores) }); }
  if (!validos.length) return res.status(400).json({ ok: false, errores: ['Seleccione al menos un archivo'] });
  const g = T.guardarArchivos(t, validos, quien(req));
  registrarHistorial(t.id, `${quien(req)} agregó ${g.map((x) => x.nombre).join(', ')}.`, quien(req));
  res.json({ ok: true, tercero: T.obtener(t.id) });
});

api.get('/anexos/:id', (req, res) => {
  const a = T.rutaAnexo(idParam(req));
  if (!a || !fs.existsSync(a.abs)) return res.status(404).json({ ok: false, errores: ['Anexo no encontrado'] });
  const inline = req.query.ver === '1' && /^(application\/pdf|image\/(png|jpe?g))$/.test(a.mime || '');
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nombre_archivo)}`);
  fs.createReadStream(a.abs).pipe(res);
});

api.delete('/anexos/:id', (req, res) => res.json({ ok: T.eliminarAnexo(idParam(req), quien(req)) }));
api.delete('/terceros/:id', requiereAdmin, (req, res) => res.json({ ok: T.eliminarExpediente(idParam(req), quien(req)) }));

// Usuarios
api.get('/usuarios', requiereAdmin, (req, res) => {
  res.json({ ok: true, usuarios: db.prepare('SELECT id, usuario, nombre, rol, activo, created_at FROM usuarios ORDER BY id').all() });
});
api.post('/usuarios', requiereAdmin, (req, res) => {
  const { usuario, nombre, password, rol } = req.body || {};
  const u = String(usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) return res.status(400).json({ ok: false, errores: ['Usuario no válido (3-40 caracteres: letras, números, . _ -)'] });
  if (!String(nombre || '').trim()) return res.status(400).json({ ok: false, errores: ['Indique el nombre'] });
  if (String(password || '').length < 8) return res.status(400).json({ ok: false, errores: ['La contraseña debe tener al menos 8 caracteres'] });
  try {
    db.prepare('INSERT INTO usuarios (usuario, nombre, password_hash, rol) VALUES (?, ?, ?, ?)')
      .run(u, String(nombre).trim(), bcrypt.hashSync(password, 10), rol === 'admin' ? 'admin' : 'contabilidad');
  } catch {
    return res.status(400).json({ ok: false, errores: ['Ese usuario ya existe'] });
  }
  res.json({ ok: true });
});
api.post('/usuarios/:id/activo', requiereAdmin, (req, res) => {
  if (idParam(req) === req.session.usuario.id) return res.status(400).json({ ok: false, errores: ['No puede desactivar su propio usuario'] });
  db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, idParam(req));
  res.json({ ok: true });
});
api.post('/usuarios/:id/password', requiereAdmin, (req, res) => {
  const nueva = String(req.body?.password || '');
  if (nueva.length < 8) return res.status(400).json({ ok: false, errores: ['La contraseña debe tener al menos 8 caracteres'] });
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(nueva, 10), idParam(req));
  res.json({ ok: true });
});

app.use('/api', api);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, errores: ['Error interno del servidor'] });
});

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && config.sessionSecret === 'cambie-este-secreto') {
    console.error('Configure SESSION_SECRET con una cadena larga y aleatoria antes de publicar el aplicativo.');
    process.exit(1);
  }
  const servidor = app.listen(config.port, () => {
    console.log(`Vinculación de terceros – ${config.empresa.nombre}`);
    console.log(`  Portal para terceros: ${config.baseUrl}/formulario/`);
    console.log(`  Aplicativo contable:  ${config.baseUrl}/app/`);
    console.log(`  Archivo de expedientes: ${config.archivoDir}`);
    if (!correo.smtpConfigurado) console.log('  SMTP no configurado: los correos se guardan como .eml en', config.correosDir);
    if (!config.oficial.email) console.log('  Falta OFICIAL_CUMPLIMIENTO_EMAIL: no se podrá enviar a Cumplimiento.');
    if (!fs.existsSync(config.formularioWord)) console.log('  Falta el formulario Word en', config.formularioWord);
  });
  // Docker envía SIGTERM al detener el contenedor: se cierran conexiones y la base de datos ordenadamente.
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.on(senal, () => servidor.close(() => { db.close(); process.exit(0); }));
  }
}

module.exports = app;
