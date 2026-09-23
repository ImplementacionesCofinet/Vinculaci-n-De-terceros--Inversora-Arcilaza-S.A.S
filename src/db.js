const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { CATEGORIAS } = require('../public/shared/campos');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS consecutivos (
  categoria TEXT PRIMARY KEY,
  prefijo   TEXT NOT NULL,
  ultimo    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS terceros (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  consecutivo      TEXT NOT NULL UNIQUE,
  categoria        TEXT NOT NULL,
  origen           TEXT NOT NULL,           -- formulario | manual
  estado           TEXT NOT NULL DEFAULT 'pendiente',
  tipo_documento   TEXT,
  numero_documento TEXT,
  nombre           TEXT NOT NULL,
  email            TEXT,
  celular          TEXT,
  ciudad           TEXT,
  datos            TEXT NOT NULL,           -- JSON con toda la información del formulario
  observaciones    TEXT,
  validado_por     TEXT,
  fecha_validacion TEXT,
  fecha_envio      TEXT,
  creado_por       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_terceros_categoria ON terceros(categoria, estado);
CREATE INDEX IF NOT EXISTS idx_terceros_documento ON terceros(numero_documento);

CREATE TABLE IF NOT EXISTS anexos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id      INTEGER NOT NULL REFERENCES terceros(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  nombre_original TEXT NOT NULL,
  ruta            TEXT NOT NULL,            -- relativa a la carpeta de anexos
  mime            TEXT,
  tamano          INTEGER,
  subido_por      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS historial (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id INTEGER NOT NULL REFERENCES terceros(id) ON DELETE CASCADE,
  accion     TEXT NOT NULL,
  detalle    TEXT,
  usuario    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS correos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id    INTEGER NOT NULL REFERENCES terceros(id) ON DELETE CASCADE,
  destinatarios TEXT NOT NULL,
  asunto        TEXT NOT NULL,
  estado        TEXT NOT NULL,              -- enviado | simulado | error
  detalle       TEXT,
  usuario       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario       TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'contabilidad',   -- admin | contabilidad
  activo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

const insCons = db.prepare('INSERT OR IGNORE INTO consecutivos (categoria, prefijo, ultimo) VALUES (?, ?, 0)');
for (const [cat, info] of Object.entries(CATEGORIAS)) insCons.run(cat, info.prefijo);

if (!db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n) {
  db.prepare('INSERT INTO usuarios (usuario, nombre, password_hash, rol) VALUES (?, ?, ?, ?)').run(
    config.adminUser,
    'Administrador',
    bcrypt.hashSync(config.adminPassword, 10),
    'admin'
  );
  console.log(`Usuario administrador creado: "${config.adminUser}". Cambie la contraseña después del primer ingreso.`);
}

/** Ejecuta fn dentro de una transacción. */
function transaccion(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Reserva el siguiente consecutivo de la categoría, p. ej. PRO-00012. Debe llamarse dentro de una transacción. */
function siguienteConsecutivo(categoria) {
  const row = db.prepare('UPDATE consecutivos SET ultimo = ultimo + 1 WHERE categoria = ? RETURNING prefijo, ultimo').get(categoria);
  if (!row) throw new Error('Categoría sin consecutivo: ' + categoria);
  return `${row.prefijo}-${String(row.ultimo).padStart(5, '0')}`;
}

function registrarHistorial(terceroId, accion, detalle, usuario) {
  db.prepare('INSERT INTO historial (tercero_id, accion, detalle, usuario) VALUES (?, ?, ?, ?)').run(terceroId, accion, detalle || null, usuario || null);
}

module.exports = { db, transaccion, siguienteConsecutivo, registrarHistorial };
