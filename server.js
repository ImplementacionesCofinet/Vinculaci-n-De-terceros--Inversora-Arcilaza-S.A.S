const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const config = require('./src/config');
const { db, registrarHistorial } = require('./src/db');
const T = require('./src/terceros');
const { enviarTercero, smtpConfigurado } = require('./src/mailer');
const CAMPOS = require('./public/shared/campos');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------- Carga de archivos ----------
const tmpDir = path.join(config.uploadsDir, '_tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const EXT_PERMITIDAS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];
const nombresAnexos = CAMPOS.ANEXOS.map((a) => a.name);
const upload = multer({
  dest: tmpDir,
  limits: { fileSize: config.maxFileMb * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => {
    // multer entrega el nombre en latin1; se corrige a UTF-8 para conservar tildes y ñ.
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!nombresAnexos.includes(file.fieldname)) return cb(null, false);
    if (!EXT_PERMITIDAS.includes(ext)) return cb(new Error(`Tipo de archivo no permitido: ${file.originalname}. Use PDF, imagen, Word o Excel.`));
    cb(null, true);
  },
}).any();

function conArchivos(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    T.eliminarTemporales(req.files);
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Cada archivo debe pesar máximo ${config.maxFileMb} MB` : err.message;
    res.status(400).json({ ok: false, errores: [msg] });
  });
}

// ---------- Middlewares generales ----------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: 'arcilaza.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 8 * 60 * 60 * 1000 },
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

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

// ---------- API pública (formulario de terceros) ----------
app.post('/api/public/registro', conArchivos, (req, res) => {
  const categoria = req.body.categoria;
  if (!CAMPOS.CATEGORIAS_PUBLICAS.includes(categoria)) {
    T.eliminarTemporales(req.files);
    return res.status(400).json({ ok: false, errores: ['Seleccione si es cliente, proveedor o contratista'] });
  }
  const r = T.crearTercero({ categoria, body: req.body, archivos: req.files, origen: 'formulario' });
  if (!r.ok) return res.status(400).json(r);
  res.json({ ok: true, consecutivo: r.tercero.consecutivo, categoria: CAMPOS.CATEGORIAS[categoria].nombre });
});

// ---------- Autenticación ----------
app.post('/api/auth/login', (req, res) => {
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
app.get('/api/auth/me', (req, res) => res.json({ ok: true, usuario: req.session.usuario || null, smtp: smtpConfigurado, correoPorDefecto: config.smtp.defaultTo, baseUrl: config.baseUrl }));
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

api.get('/terceros', (req, res) => {
  const { categoria, estado, q } = req.query;
  res.json({ ok: true, terceros: T.listarTerceros({ categoria, estado, q }) });
});

api.get('/terceros/exportar.csv', (req, res) => {
  const { categoria, estado, q } = req.query;
  const lista = T.listarTerceros({ categoria, estado, q, limite: 5000 });
  const filas = lista.map((t) => ({ ...t, ...JSON.parse(db.prepare('SELECT datos FROM terceros WHERE id = ?').get(t.id).datos) }));
  const base = ['consecutivo', 'categoria', 'estado', 'origen', 'created_at', 'fecha_validacion', 'fecha_envio', 'num_anexos'];
  const campos = [...new Set(CAMPOS.SECCIONES.flatMap((s) => s.campos.map((c) => c.name)))];
  const cols = [...base, ...campos];
  const csvCelda = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const cabecera = cols.map((c) => csvCelda(CAMPOS.etiqueta(c))).join(';');
  const cuerpo = filas.map((f) => cols.map((c) => csvCelda(c === 'estado' ? CAMPOS.ESTADOS[f[c]] : f[c])).join(';')).join('\r\n');
  const nombre = `terceros_${categoria || 'todos'}_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send('﻿' + cabecera + '\r\n' + cuerpo);
});

api.get('/terceros/:id', (req, res) => {
  const t = T.obtenerTercero(idParam(req));
  if (!t) return res.status(404).json({ ok: false, errores: ['Tercero no encontrado'] });
  res.json({ ok: true, tercero: t });
});

// Registro manual (p. ej. empleados) por el área contable
api.post('/terceros', conArchivos, (req, res) => {
  const categoria = req.body.categoria;
  if (!CAMPOS.CATEGORIAS[categoria]) {
    T.eliminarTemporales(req.files);
    return res.status(400).json({ ok: false, errores: ['Seleccione el tipo de tercero'] });
  }
  const r = T.crearTercero({ categoria, body: req.body, archivos: req.files, origen: 'manual', usuario: quien(req) });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

api.put('/terceros/:id', (req, res) => {
  const r = T.actualizarDatos(idParam(req), req.body, quien(req));
  res.status(r.ok ? 200 : 400).json(r);
});

api.post('/terceros/:id/estado', (req, res) => {
  const { estado, observaciones } = req.body || {};
  if (estado === 'rechazado' && !String(observaciones || '').trim()) {
    return res.status(400).json({ ok: false, errores: ['Indique el motivo del rechazo en observaciones'] });
  }
  const r = T.cambiarEstado(idParam(req), estado, observaciones, quien(req));
  res.status(r.ok ? 200 : 400).json(r);
});

api.post('/terceros/:id/anexos', conArchivos, (req, res) => {
  const t = T.obtenerTercero(idParam(req));
  if (!t) {
    T.eliminarTemporales(req.files);
    return res.status(404).json({ ok: false, errores: ['Tercero no encontrado'] });
  }
  if (!req.files?.length) return res.status(400).json({ ok: false, errores: ['Seleccione al menos un archivo'] });
  const tipos = T.guardarAnexos(t, req.files, quien(req));
  registrarHistorial(t.id, 'Anexos agregados', tipos.map(CAMPOS.etiqueta).join(', '), quien(req));
  res.json({ ok: true, tercero: T.obtenerTercero(t.id) });
});

api.get('/anexos/:id', (req, res) => {
  const a = T.rutaAnexo(idParam(req));
  if (!a || !fs.existsSync(a.abs)) return res.status(404).json({ ok: false, errores: ['Anexo no encontrado'] });
  const inline = req.query.ver === '1' && /^(application\/pdf|image\/(png|jpe?g))$/.test(a.mime || '');
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nombre_original)}`);
  fs.createReadStream(a.abs).pipe(res);
});

api.delete('/anexos/:id', (req, res) => {
  res.json({ ok: T.eliminarAnexo(idParam(req), quien(req)) });
});

api.post('/terceros/:id/enviar', async (req, res) => {
  const t = T.obtenerTercero(idParam(req));
  if (!t) return res.status(404).json({ ok: false, errores: ['Tercero no encontrado'] });
  if (!['validado', 'enviado'].includes(t.estado)) {
    return res.status(400).json({ ok: false, errores: ['Primero debe validar la información del tercero'] });
  }
  const r = await enviarTercero(t, req.body || {}, quien(req));
  res.status(r.ok ? 200 : 400).json({ ...r, tercero: T.obtenerTercero(t.id) });
});

api.delete('/terceros/:id', requiereAdmin, (req, res) => {
  res.json({ ok: T.eliminarTercero(idParam(req), quien(req)) });
});

// Usuarios del aplicativo
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
  app.listen(config.port, () => {
    console.log(`Vinculación de terceros – ${config.empresa}`);
    console.log(`  Formulario para terceros: ${config.baseUrl}/formulario/`);
    console.log(`  Aplicativo contable:      ${config.baseUrl}/app/`);
    if (!smtpConfigurado) console.log('  SMTP no configurado: los correos se guardarán como .eml en', config.correosDir);
  });
}

module.exports = app;
