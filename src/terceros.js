const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { db, transaccion, siguienteConsecutivo, registrarHistorial } = require('./db');
const CAMPOS = require('../public/shared/campos');

/** Normaliza el cuerpo del formulario: solo conserva campos conocidos y recorta espacios. */
function limpiarDatos(body) {
  const permitidos = new Set();
  for (const s of CAMPOS.SECCIONES) for (const c of s.campos) permitidos.add(c.name);
  for (const a of CAMPOS.AUTORIZACIONES) permitidos.add(a.name);
  const datos = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!permitidos.has(k)) continue;
    const valor = Array.isArray(v) ? v[0] : v;
    datos[k] = typeof valor === 'string' ? valor.trim().slice(0, 2000) : valor;
  }
  for (const a of CAMPOS.AUTORIZACIONES) datos[a.name] = ['on', 'true', '1', true].includes(datos[a.name]);
  return datos;
}

function nombreSeguro(nombre) {
  const ext = path.extname(nombre).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path.basename(nombre, path.extname(nombre))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'archivo';
  return base + ext;
}

/** Mueve los archivos temporales de multer a uploads/<carpeta>/<consecutivo>/ y los registra. */
function guardarAnexos(tercero, archivos, usuario) {
  const cat = CAMPOS.CATEGORIAS[tercero.categoria];
  const relDir = path.join(cat.carpeta, tercero.consecutivo);
  const absDir = path.join(config.uploadsDir, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const ins = db.prepare('INSERT INTO anexos (tercero_id, tipo, nombre_original, ruta, mime, tamano, subido_por) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const guardados = [];
  for (const f of archivos) {
    const destinoNombre = `${f.fieldname}_${Date.now()}_${nombreSeguro(f.originalname)}`;
    const rel = path.join(relDir, destinoNombre);
    fs.renameSync(f.path, path.join(config.uploadsDir, rel));
    ins.run(tercero.id, f.fieldname, f.originalname, rel, f.mimetype, f.size, usuario || null);
    guardados.push(f.fieldname);
  }
  return guardados;
}

function eliminarTemporales(archivos) {
  for (const f of archivos || []) fs.rm(f.path, { force: true }, () => {});
}

/**
 * Crea un tercero con su consecutivo y anexos.
 * @returns {{ok:true, tercero}|{ok:false, errores:string[]}}
 */
function crearTercero({ categoria, body, archivos, origen, usuario }) {
  const datos = limpiarDatos(body);
  const anexosValidos = new Set(CAMPOS.anexosPara(categoria, datos).map((a) => a.name));
  const archivosOk = (archivos || []).filter((f) => anexosValidos.has(f.fieldname));
  eliminarTemporales((archivos || []).filter((f) => !anexosValidos.has(f.fieldname)));

  const manual = origen === 'manual';
  const errores = CAMPOS.validar(categoria, datos, archivosOk.map((f) => f.fieldname), {
    omitirAnexos: manual,
    omitirAutorizaciones: manual,
  });
  if (errores.length) {
    eliminarTemporales(archivosOk);
    return { ok: false, errores };
  }

  const tercero = transaccion(() => {
    const consecutivo = siguienteConsecutivo(categoria);
    const r = db.prepare(`
      INSERT INTO terceros (consecutivo, categoria, origen, tipo_documento, numero_documento, nombre, email, celular, ciudad, datos, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      consecutivo, categoria, origen, datos.tipo_documento, datos.numero_documento, datos.nombre,
      datos.email, datos.celular, datos.ciudad, JSON.stringify(datos), usuario || null
    );
    const t = { id: Number(r.lastInsertRowid), consecutivo, categoria };
    registrarHistorial(t.id, 'Registro creado', manual ? 'Registro manual desde el aplicativo' : 'Recibido desde el formulario web', usuario || 'Formulario web');
    return t;
  });

  try {
    guardarAnexos(tercero, archivosOk, usuario || 'Formulario web');
  } catch (e) {
    registrarHistorial(tercero.id, 'Error al guardar anexos', e.message, 'Sistema');
  }
  return { ok: true, tercero: obtenerTercero(tercero.id) };
}

function obtenerTercero(id) {
  const t = db.prepare('SELECT * FROM terceros WHERE id = ?').get(id);
  if (!t) return null;
  t.datos = JSON.parse(t.datos);
  t.anexos = db.prepare('SELECT id, tipo, nombre_original, mime, tamano, subido_por, created_at FROM anexos WHERE tercero_id = ? ORDER BY id').all(id);
  t.historial = db.prepare('SELECT accion, detalle, usuario, created_at FROM historial WHERE tercero_id = ? ORDER BY id DESC').all(id);
  t.correos = db.prepare('SELECT destinatarios, asunto, estado, detalle, usuario, created_at FROM correos WHERE tercero_id = ? ORDER BY id DESC').all(id);
  return t;
}

function listarTerceros({ categoria, estado, q, limite = 500 }) {
  const where = [];
  const params = [];
  if (categoria) { where.push('categoria = ?'); params.push(categoria); }
  if (estado) { where.push('estado = ?'); params.push(estado); }
  if (q) {
    where.push('(consecutivo LIKE ? OR nombre LIKE ? OR numero_documento LIKE ? OR email LIKE ? OR ciudad LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const sql = `
    SELECT t.id, t.consecutivo, t.categoria, t.origen, t.estado, t.tipo_documento, t.numero_documento, t.nombre,
           t.email, t.celular, t.ciudad, t.created_at, t.fecha_validacion, t.fecha_envio,
           (SELECT COUNT(*) FROM anexos a WHERE a.tercero_id = t.id) AS num_anexos
    FROM terceros t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.id DESC LIMIT ?`;
  return db.prepare(sql).all(...params, Math.min(Number(limite) || 500, 5000));
}

function resumen() {
  const filas = db.prepare('SELECT categoria, estado, COUNT(*) AS n FROM terceros GROUP BY categoria, estado').all();
  const res = {};
  for (const cat of Object.keys(CAMPOS.CATEGORIAS)) {
    res[cat] = { total: 0 };
    for (const e of Object.keys(CAMPOS.ESTADOS)) res[cat][e] = 0;
  }
  for (const f of filas) {
    if (!res[f.categoria]) continue;
    res[f.categoria][f.estado] = f.n;
    res[f.categoria].total += f.n;
  }
  const recientes = db.prepare('SELECT id, consecutivo, categoria, nombre, estado, created_at FROM terceros ORDER BY id DESC LIMIT 8').all();
  return { porCategoria: res, recientes };
}

function actualizarDatos(id, body, usuario) {
  const actual = obtenerTercero(id);
  if (!actual) return { ok: false, errores: ['Tercero no encontrado'] };
  const nuevos = { ...actual.datos, ...limpiarDatos(body) };
  // Las autorizaciones las otorga el tercero; no se modifican desde el aplicativo.
  for (const a of CAMPOS.AUTORIZACIONES) nuevos[a.name] = actual.datos[a.name];
  const errores = CAMPOS.validar(actual.categoria, nuevos, [], { omitirAnexos: true, omitirAutorizaciones: true });
  if (errores.length) return { ok: false, errores };
  db.prepare(`UPDATE terceros SET datos = ?, tipo_documento = ?, numero_documento = ?, nombre = ?, email = ?, celular = ?, ciudad = ?,
              updated_at = datetime('now','localtime') WHERE id = ?`).run(
    JSON.stringify(nuevos), nuevos.tipo_documento, nuevos.numero_documento, nuevos.nombre, nuevos.email, nuevos.celular, nuevos.ciudad, id
  );
  const cambios = Object.keys(nuevos).filter((k) => String(nuevos[k] ?? '') !== String(actual.datos[k] ?? '')).map(CAMPOS.etiqueta);
  registrarHistorial(id, 'Información editada', cambios.length ? 'Campos: ' + cambios.join(', ') : 'Sin cambios', usuario);
  return { ok: true, tercero: obtenerTercero(id) };
}

function cambiarEstado(id, estado, observaciones, usuario) {
  if (!CAMPOS.ESTADOS[estado]) return { ok: false, errores: ['Estado no válido'] };
  const extra = estado === 'validado' ? ", validado_por = ?, fecha_validacion = datetime('now','localtime')" : '';
  const params = [estado, observaciones || null];
  if (extra) params.push(usuario);
  params.push(id);
  const r = db.prepare(`UPDATE terceros SET estado = ?, observaciones = COALESCE(?, observaciones)${extra}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...params);
  if (!r.changes) return { ok: false, errores: ['Tercero no encontrado'] };
  registrarHistorial(id, 'Estado: ' + CAMPOS.ESTADOS[estado], observaciones, usuario);
  return { ok: true, tercero: obtenerTercero(id) };
}

function rutaAnexo(anexoId) {
  const a = db.prepare('SELECT * FROM anexos WHERE id = ?').get(anexoId);
  if (!a) return null;
  const abs = path.resolve(config.uploadsDir, a.ruta);
  if (!abs.startsWith(config.uploadsDir + path.sep)) return null;
  return { ...a, abs };
}

function eliminarAnexo(anexoId, usuario) {
  const a = rutaAnexo(anexoId);
  if (!a) return false;
  db.prepare('DELETE FROM anexos WHERE id = ?').run(anexoId);
  fs.rm(a.abs, { force: true }, () => {});
  registrarHistorial(a.tercero_id, 'Anexo eliminado', `${CAMPOS.etiqueta(a.tipo)}: ${a.nombre_original}`, usuario);
  return true;
}

function eliminarTercero(id, usuario) {
  const t = db.prepare('SELECT * FROM terceros WHERE id = ?').get(id);
  if (!t) return false;
  db.prepare('DELETE FROM terceros WHERE id = ?').run(id);
  const dir = path.join(config.uploadsDir, CAMPOS.CATEGORIAS[t.categoria].carpeta, t.consecutivo);
  fs.rm(dir, { recursive: true, force: true }, () => {});
  console.log(`Tercero ${t.consecutivo} eliminado por ${usuario}`);
  return true;
}

module.exports = {
  crearTercero, obtenerTercero, listarTerceros, resumen, actualizarDatos, cambiarEstado,
  guardarAnexos, eliminarTemporales, rutaAnexo, eliminarAnexo, eliminarTercero,
};
