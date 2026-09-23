const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const sharepoint = require('./sharepoint');
const { db, transaccion, reservarConsecutivo, registrarHistorial } = require('./db');
const CAMPOS = require('../public/shared/campos');

const ahora = () => new Date();

// ---------- Archivos ----------

/** Revisa un archivo recibido por multer leyendo sus primeros y últimos bytes. */
function revisarArchivoEnDisco(f) {
  const fd = fs.openSync(f.path, 'r');
  try {
    const inicio = Buffer.alloc(Math.min(16, f.size));
    fs.readSync(fd, inicio, 0, inicio.length, 0);
    const n = Math.min(2048, f.size);
    const final = Buffer.alloc(n);
    fs.readSync(fd, final, 0, n, f.size - n);
    return CAMPOS.revisarArchivo(f.originalname, f.size, inicio, final);
  } finally {
    fs.closeSync(fd);
  }
}

/** Mueve un archivo aunque el temporal esté en otro disco. */
function mover(desde, hacia) {
  try {
    fs.renameSync(desde, hacia);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(desde, hacia);
    fs.rmSync(desde, { force: true });
  }
}

function eliminarTemporales(archivos) {
  for (const f of archivos || []) fs.rm(f.path, { force: true }, () => {});
}

/** Quita caracteres que no admiten Windows/SharePoint en nombres de carpeta o archivo. */
const nombreSeguro = (s) => String(s).replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 120);

function carpetaExpediente(categoria, anio, consecutivo, nombre) {
  const cat = CAMPOS.CATEGORIAS[categoria];
  const partes = [cat.carpeta];
  if (cat.porAnio) partes.push(String(anio));
  partes.push(nombreSeguro(`${consecutivo} ${nombre.toUpperCase()}`));
  return partes.join('/');
}

/**
 * Revisa los archivos recibidos contra los anexos que aplican.
 * @returns {{validos: object[], errores: object}} errores: { tipo: 'mensaje' }
 */
function revisarArchivos(categoria, persona, archivos) {
  const tipos = new Map(CAMPOS.anexosPara(categoria, persona).map((a) => [a.name, a]));
  const validos = [];
  const errores = {};
  for (const f of archivos || []) {
    const def = tipos.get(f.fieldname);
    if (!def) { eliminarTemporales([f]); continue; }
    const err = revisarArchivoEnDisco(f);
    if (err) {
      errores[f.fieldname] = `${f.originalname}: ${err}${def.ayudaError && err.includes('dañado') ? ' ' + def.ayudaError : ''}`;
      eliminarTemporales([f]);
    } else {
      validos.push(f);
    }
  }
  return { validos, errores };
}

/**
 * Mueve los archivos al expediente con el nombre estándar ("PRO-2026-0042 - RUT.pdf").
 * Los anexos de un solo archivo reemplazan al anterior; los múltiples se numeran.
 */
function guardarArchivos(t, archivos, usuario) {
  const defs = new Map(CAMPOS.anexosPara(t.categoria, t.persona).map((a) => [a.name, a]));
  const dir = path.join(config.archivoDir, t.carpeta);
  fs.mkdirSync(dir, { recursive: true });
  const guardados = [];
  const reemplazados = [];

  const porTipo = new Map();
  for (const f of archivos) porTipo.set(f.fieldname, [...(porTipo.get(f.fieldname) || []), f]);

  for (const [tipo, lista] of porTipo) {
    const def = defs.get(tipo);
    const existentes = db.prepare('SELECT * FROM anexos WHERE tercero_id = ? AND tipo = ? ORDER BY id').all(t.id, tipo);
    let n = existentes.length;
    if (!def.multiple) {
      for (const e of existentes) { borrarArchivoAnexo(t, e); reemplazados.push(e.nombre_archivo); }
      n = 0;
    }
    const numerar = def.multiple && existentes.length + lista.length > 1;
    if (numerar && existentes.length === 1 && !/\(\d+\)\.[^.]+$/.test(existentes[0].nombre_archivo)) {
      // El primero se guardó sin número; se renombra a (1) para mantener la serie.
      const e = existentes[0];
      const nuevo = e.nombre_archivo.replace(/(\.[^.]+)$/, ' (1)$1');
      fs.renameSync(path.join(dir, e.nombre_archivo), path.join(dir, nuevo));
      db.prepare('UPDATE anexos SET nombre_archivo = ? WHERE id = ?').run(nuevo, e.id);
      if (sharepoint.configurado) sincronizar(t, [{ nombre: nuevo, abs: path.join(dir, nuevo), mime: e.mime }], [e.nombre_archivo]);
    }
    for (const f of lista) {
      n += 1;
      const ext = path.extname(f.originalname).toLowerCase();
      let nombre = `${t.consecutivo} - ${def.archivo}${numerar ? ` (${n})` : ''}${ext}`;
      while (fs.existsSync(path.join(dir, nombre))) nombre = nombre.replace(/(\.[^.]+)$/, `_${Date.now() % 10000}$1`);
      mover(f.path, path.join(dir, nombre));
      db.prepare('INSERT INTO anexos (tercero_id, tipo, nombre_original, nombre_archivo, mime, tamano, subido_por) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(t.id, tipo, f.originalname, nombre, f.mimetype, f.size, usuario || null);
      guardados.push({ tipo, nombre, abs: path.join(dir, nombre), mime: f.mimetype });
    }
  }
  if (sharepoint.configurado) sincronizar(t, guardados, reemplazados);
  return guardados;
}

function borrarArchivoAnexo(t, anexo) {
  fs.rmSync(path.join(config.archivoDir, t.carpeta, anexo.nombre_archivo), { force: true });
  db.prepare('DELETE FROM anexos WHERE id = ?').run(anexo.id);
}

/** Copia a SharePoint en segundo plano; los errores quedan en el historial. */
function sincronizar(t, archivos, eliminar = []) {
  (async () => {
    for (const nombre of eliminar) await sharepoint.eliminar(t.carpeta, nombre);
    let url = null;
    for (const a of archivos) url = (await sharepoint.subir(t.carpeta, a.nombre, a.abs, a.mime)) || url;
    if (url) db.prepare('UPDATE terceros SET sharepoint_url = ? WHERE id = ?').run(url, t.id);
  })().catch((e) => registrarHistorial(t.id, 'No se pudo copiar a SharePoint: ' + e.message, 'Sistema'));
}

// ---------- Expedientes ----------

function limpiarBasicos(categoria, body) {
  const datos = {};
  for (const c of CAMPOS.basicosPara(categoria)) datos[c.name] = String(body?.[c.name] ?? '').trim().slice(0, 300);
  if (categoria === 'empleado') { datos.tipo_documento = 'C.C.'; datos.pais = datos.pais || 'Colombia'; }
  return datos;
}

/**
 * Crea un expediente con consecutivo, carpeta y anexos.
 * @returns {{ok:true, tercero}|{ok:false, errores:string[], archivos?:object}}
 */
function crearExpediente({ categoria, persona, body, archivos, origen, usuario }) {
  const cat = CAMPOS.CATEGORIAS[categoria];
  if (!cat) { eliminarTemporales(archivos); return { ok: false, errores: ['Seleccione el tipo de tercero'] }; }
  if (categoria === 'empleado') persona = 'natural';
  if (!CAMPOS.PERSONAS[persona]) { eliminarTemporales(archivos); return { ok: false, errores: ['Indique si es persona jurídica o natural'] }; }

  const datos = limpiarBasicos(categoria, body);
  const errores = CAMPOS.validarBasicos(categoria, datos);
  const { validos, errores: erroresArchivos } = revisarArchivos(categoria, persona, archivos);
  errores.push(...Object.values(erroresArchivos));

  if (origen === 'portal') {
    const recibidos = new Set(validos.map((f) => f.fieldname));
    for (const a of CAMPOS.anexosPara(categoria, persona)) {
      if (a.req && !recibidos.has(a.name) && !erroresArchivos[a.name]) errores.push(`Falta el documento: ${a.label}`);
    }
    if (!['on', 'true', '1', true].includes(body?.acepta_tratamiento)) errores.push('Debe autorizar el tratamiento de datos personales');
  }
  if (errores.length) {
    eliminarTemporales(validos);
    return { ok: false, errores, archivos: erroresArchivos };
  }

  const anio = ahora().getFullYear();
  const t = transaccion(() => {
    const consecutivo = reservarConsecutivo(cat.prefijo, anio);
    const carpeta = carpetaExpediente(categoria, anio, consecutivo, datos.nombre);
    const r = db.prepare(`
      INSERT INTO terceros (consecutivo, anio, categoria, persona, origen, nombre, tipo_documento, numero_documento, pais, ciudad,
                            contacto, telefono, email, carpeta, token, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      consecutivo, anio, categoria, persona, origen, datos.nombre, datos.tipo_documento, datos.numero_documento, datos.pais,
      datos.ciudad, datos.contacto || null, datos.telefono || null, datos.email, carpeta, crypto.randomBytes(24).toString('base64url'), usuario || null
    );
    return { id: Number(r.lastInsertRowid), consecutivo, categoria, persona, carpeta };
  });

  guardarArchivos(t, validos, usuario || 'Portal');
  const n = validos.length;
  registrarHistorial(t.id, origen === 'portal'
    ? `El tercero envió el registro desde el portal. ${n} archivo${n === 1 ? '' : 's'} validado${n === 1 ? '' : 's'} automáticamente.`
    : `${usuario} registró el expediente manualmente con ${n} archivo${n === 1 ? '' : 's'}.`, origen === 'portal' ? null : usuario);
  registrarHistorial(t.id, `Expediente creado en ${t.carpeta.split('/').join(' / ')}`, null);
  return { ok: true, tercero: obtener(t.id) };
}

function obtener(id) {
  const t = db.prepare('SELECT * FROM terceros WHERE id = ?').get(id);
  if (!t) return null;
  t.datos = JSON.parse(t.datos || '{}');
  t.anexos = db.prepare('SELECT id, tipo, nombre_original, nombre_archivo, mime, tamano, subido_por, created_at FROM anexos WHERE tercero_id = ? ORDER BY tipo, id').all(id);
  t.historial = db.prepare('SELECT texto, usuario, created_at FROM historial WHERE tercero_id = ? ORDER BY id').all(id);
  t.correos = db.prepare('SELECT tipo, destinatarios, asunto, estado, detalle, created_at FROM correos WHERE tercero_id = ? ORDER BY id DESC').all(id);
  delete t.token;
  return t;
}

function tokenDe(id) {
  return db.prepare('SELECT token FROM terceros WHERE id = ?').get(id)?.token;
}

const GRUPOS_ESTADO = {
  pendientes: ['pendiente', 'en_revision'],
};

function listar({ categoria, estado, anio, q, limite = 1000 }) {
  const where = [];
  const params = [];
  if (categoria) { where.push('t.categoria = ?'); params.push(categoria); }
  if (estado) {
    const lista = GRUPOS_ESTADO[estado] || [estado];
    where.push(`t.estado IN (${lista.map(() => '?').join(',')})`);
    params.push(...lista);
  }
  if (anio) { where.push('t.anio = ?'); params.push(Number(anio)); }
  if (q) {
    const like = `%${q}%`;
    where.push('(t.consecutivo LIKE ? OR t.nombre LIKE ? OR t.numero_documento LIKE ? OR REPLACE(t.numero_documento, \'.\', \'\') LIKE ? OR t.email LIKE ?)');
    params.push(like, like, like, `%${q.replace(/\./g, '')}%`, like);
  }
  const filas = db.prepare(`
    SELECT t.id, t.consecutivo, t.anio, t.categoria, t.persona, t.origen, t.estado, t.nombre, t.tipo_documento, t.numero_documento,
           t.ciudad, t.email, t.created_at, t.fecha_aprobacion, t.revisado_por,
           (SELECT COUNT(DISTINCT a.tipo) FROM anexos a WHERE a.tercero_id = t.id) AS anexos_tipos
    FROM terceros t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.id DESC LIMIT ?`).all(...params, Math.min(Number(limite) || 1000, 10000));
  for (const f of filas) f.anexos_total = CAMPOS.anexosPara(f.categoria, f.persona).length;
  return filas;
}

function resumen() {
  const cuenta = (sql, ...p) => db.prepare(sql).get(...p).n;
  const mes = ahora().toISOString().slice(0, 7);
  return {
    total: cuenta('SELECT COUNT(*) AS n FROM terceros'),
    pendientes: cuenta("SELECT COUNT(*) AS n FROM terceros WHERE estado IN ('pendiente','en_revision')"),
    devueltos: cuenta("SELECT COUNT(*) AS n FROM terceros WHERE estado = 'devuelto'"),
    en_cumplimiento: cuenta("SELECT COUNT(*) AS n FROM terceros WHERE estado = 'en_cumplimiento'"),
    aprobados_mes: cuenta("SELECT COUNT(*) AS n FROM terceros WHERE fecha_aprobacion LIKE ? AND estado IN ('aprobado','en_cumplimiento')", mes + '%'),
    por_actualizar: porActualizar().length,
    por_categoria: Object.fromEntries(Object.keys(CAMPOS.CATEGORIAS).map((c) => [c, cuenta('SELECT COUNT(*) AS n FROM terceros WHERE categoria = ?', c)])),
    anios: db.prepare('SELECT DISTINCT anio FROM terceros ORDER BY anio DESC').all().map((r) => r.anio),
  };
}

/** Terceros aprobados hace más de N meses: deben actualizar su información (SAGRILAFT). */
function porActualizar() {
  const limite = ahora();
  limite.setMonth(limite.getMonth() - config.mesesActualizacion);
  const corte = limite.toISOString().slice(0, 10);
  return db.prepare(`
    SELECT id, consecutivo, categoria, persona, nombre, tipo_documento, numero_documento, email, estado, fecha_aprobacion
    FROM terceros WHERE estado IN ('aprobado','en_cumplimiento') AND categoria <> 'empleado' AND fecha_aprobacion IS NOT NULL
      AND substr(fecha_aprobacion, 1, 10) <= ? ORDER BY fecha_aprobacion`).all(corte);
}

function reportes(anio) {
  const a = Number(anio) || ahora().getFullYear();
  const matriz = db.prepare('SELECT categoria, estado, COUNT(*) AS n FROM terceros WHERE anio = ? GROUP BY categoria, estado').all(a);
  const meses = db.prepare("SELECT CAST(substr(created_at, 6, 2) AS INTEGER) AS mes, COUNT(*) AS n FROM terceros WHERE anio = ? GROUP BY mes").all(a);
  const tiempo = db.prepare(`SELECT AVG(julianday(fecha_aprobacion) - julianday(created_at)) AS dias, COUNT(*) AS n
    FROM terceros WHERE anio = ? AND fecha_aprobacion IS NOT NULL`).get(a);
  const origen = db.prepare('SELECT origen, COUNT(*) AS n FROM terceros WHERE anio = ? GROUP BY origen').all(a);
  return { anio: a, matriz, meses, promedioDiasAprobacion: tiempo.dias, aprobados: tiempo.n, origen };
}

const CAMPOS_REVISION = Object.values(CAMPOS.REVISION).flat().map((c) => c.name);

function actualizar(id, body, usuario) {
  const t = obtener(id);
  if (!t) return { ok: false, errores: ['Expediente no encontrado'] };
  const basicos = { ...limpiarBasicos(t.categoria, { ...t, ...body }) };
  const errores = CAMPOS.validarBasicos(t.categoria, basicos);
  if (errores.length) return { ok: false, errores };
  const datos = { ...t.datos };
  for (const k of CAMPOS_REVISION) if (body && k in body) datos[k] = String(body[k] ?? '').trim().slice(0, 300);
  db.prepare(`UPDATE terceros SET nombre = ?, tipo_documento = ?, numero_documento = ?, pais = ?, ciudad = ?, contacto = ?, telefono = ?,
              email = ?, datos = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(
    basicos.nombre, basicos.tipo_documento || t.tipo_documento, basicos.numero_documento, basicos.pais || t.pais, basicos.ciudad,
    basicos.contacto ?? t.contacto, basicos.telefono ?? t.telefono, basicos.email, JSON.stringify(datos), id
  );
  registrarHistorial(id, `${usuario} actualizó la información del expediente.`, usuario);
  return { ok: true, tercero: obtener(id) };
}

function guardarObservaciones(id, texto) {
  db.prepare("UPDATE terceros SET observaciones = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(String(texto || '').slice(0, 5000), id);
}

function cambiarEstado(id, estado, extra = {}) {
  const sets = ['estado = ?', "updated_at = datetime('now','localtime')"];
  const params = [estado];
  for (const [k, v] of Object.entries(extra)) {
    if (v === 'ahora') sets.push(`${k} = datetime('now','localtime')`);
    else { sets.push(`${k} = ?`); params.push(v); }
  }
  db.prepare(`UPDATE terceros SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}

/** Marca "En revisión" la primera vez que alguien de Contabilidad abre un expediente pendiente. */
function abrirRevision(id, usuario) {
  const r = db.prepare("UPDATE terceros SET estado = 'en_revision' WHERE id = ? AND estado = 'pendiente'").run(id);
  if (r.changes) registrarHistorial(id, `${usuario} abrió la revisión.`, usuario);
}

function rutaAnexo(anexoId) {
  const a = db.prepare('SELECT a.*, t.carpeta FROM anexos a JOIN terceros t ON t.id = a.tercero_id WHERE a.id = ?').get(anexoId);
  if (!a) return null;
  const abs = path.resolve(config.archivoDir, a.carpeta, a.nombre_archivo);
  if (!abs.startsWith(config.archivoDir + path.sep)) return null;
  return { ...a, abs };
}

function eliminarAnexo(anexoId, usuario) {
  const a = rutaAnexo(anexoId);
  if (!a) return false;
  const t = db.prepare('SELECT * FROM terceros WHERE id = ?').get(a.tercero_id);
  borrarArchivoAnexo(t, a);
  if (sharepoint.configurado) sincronizar(t, [], [a.nombre_archivo]);
  registrarHistorial(a.tercero_id, `${usuario} eliminó el anexo ${a.nombre_archivo}.`, usuario);
  return true;
}

function eliminarExpediente(id, usuario) {
  const t = db.prepare('SELECT * FROM terceros WHERE id = ?').get(id);
  if (!t) return false;
  db.prepare('DELETE FROM terceros WHERE id = ?').run(id);
  fs.rmSync(path.join(config.archivoDir, t.carpeta), { recursive: true, force: true });
  console.log(`Expediente ${t.consecutivo} eliminado por ${usuario}`);
  return true;
}

/** Datos que ve el tercero cuando abre el enlace de un expediente devuelto. */
function publicoPorToken(token) {
  const t = db.prepare('SELECT id FROM terceros WHERE token = ?').get(String(token || ''));
  if (!t) return null;
  const x = obtener(t.id);
  return {
    id: x.id, consecutivo: x.consecutivo, nombre: x.nombre, categoria: x.categoria, persona: x.persona, estado: x.estado,
    observaciones: x.estado === 'devuelto' ? x.observaciones : null,
    anexos: x.anexos.map((a) => ({ tipo: a.tipo, nombre: a.nombre_archivo, tamano: a.tamano })),
  };
}

module.exports = {
  revisarArchivos, guardarArchivos, eliminarTemporales, crearExpediente, obtener, tokenDe, listar, resumen, porActualizar,
  reportes, actualizar, guardarObservaciones, cambiarEstado, abrirRevision, rutaAnexo, eliminarAnexo, eliminarExpediente,
  publicoPorToken,
};
