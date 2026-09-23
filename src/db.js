const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
-- Un solo consecutivo por año para todos los tipos: PRO-2026-0042, CLI-2026-0043, EMP-2026-0044…
CREATE TABLE IF NOT EXISTS consecutivos (
  anio   INTEGER PRIMARY KEY,
  ultimo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS terceros (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  consecutivo      TEXT NOT NULL UNIQUE,
  anio             INTEGER NOT NULL,
  categoria        TEXT NOT NULL,
  persona          TEXT NOT NULL,            -- juridica | natural
  origen           TEXT NOT NULL,            -- portal | manual
  estado           TEXT NOT NULL DEFAULT 'pendiente',
  nombre           TEXT NOT NULL,
  tipo_documento   TEXT,
  numero_documento TEXT,
  pais             TEXT,
  ciudad           TEXT,
  contacto         TEXT,
  telefono         TEXT,
  email            TEXT,
  datos            TEXT NOT NULL DEFAULT '{}',  -- datos de revisión (bancarios, SAGRILAFT…)
  observaciones    TEXT,
  carpeta          TEXT NOT NULL,            -- ruta relativa del expediente
  sharepoint_url   TEXT,
  token            TEXT NOT NULL UNIQUE,     -- acceso del tercero para corregir un expediente devuelto
  revisado_por     TEXT,
  fecha_aprobacion TEXT,
  fecha_cumplimiento TEXT,
  creado_por       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_terceros_estado ON terceros(estado, categoria, anio);
CREATE INDEX IF NOT EXISTS idx_terceros_documento ON terceros(numero_documento);

CREATE TABLE IF NOT EXISTS anexos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id      INTEGER NOT NULL REFERENCES terceros(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  nombre_original TEXT NOT NULL,
  nombre_archivo  TEXT NOT NULL,             -- "PRO-2026-0042 - RUT.pdf"
  mime            TEXT,
  tamano          INTEGER,
  subido_por      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS historial (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id INTEGER NOT NULL REFERENCES terceros(id) ON DELETE CASCADE,
  texto      TEXT NOT NULL,
  usuario    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS correos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id    INTEGER NOT NULL REFERENCES terceros(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,               -- radicado | devolucion | cumplimiento
  destinatarios TEXT NOT NULL,
  asunto        TEXT NOT NULL,
  estado        TEXT NOT NULL,               -- enviado | simulado | error
  detalle       TEXT,
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

if (!db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n) {
  db.prepare('INSERT INTO usuarios (usuario, nombre, password_hash, rol) VALUES (?, ?, ?, ?)').run(
    config.adminUser, config.adminNombre, bcrypt.hashSync(config.adminPassword, 10), 'admin'
  );
  console.log(`Usuario administrador creado: "${config.adminUser}". Cambie la contraseña después del primer ingreso.`);
}

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

const formatoConsecutivo = (prefijo, anio, n) => `${prefijo}-${anio}-${String(n).padStart(4, '0')}`;

/** Reserva el siguiente consecutivo del año. Debe llamarse dentro de una transacción. */
function reservarConsecutivo(prefijo, anio) {
  db.prepare('INSERT OR IGNORE INTO consecutivos (anio, ultimo) VALUES (?, 0)').run(anio);
  const { ultimo } = db.prepare('UPDATE consecutivos SET ultimo = ultimo + 1 WHERE anio = ? RETURNING ultimo').get(anio);
  return formatoConsecutivo(prefijo, anio, ultimo);
}

/** El consecutivo que se asignaría ahora (solo para mostrar; no lo reserva). */
function verSiguienteConsecutivo(prefijo, anio) {
  const row = db.prepare('SELECT ultimo FROM consecutivos WHERE anio = ?').get(anio);
  return formatoConsecutivo(prefijo, anio, (row ? row.ultimo : 0) + 1);
}

function registrarHistorial(terceroId, texto, usuario) {
  db.prepare('INSERT INTO historial (tercero_id, texto, usuario) VALUES (?, ?, ?)').run(terceroId, texto, usuario || null);
}

module.exports = { db, transaccion, reservarConsecutivo, verSiguienteConsecutivo, registrarHistorial };
