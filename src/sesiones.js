/*
 * Sesiones guardadas en la misma base SQLite: sobreviven a reinicios del servidor o del
 * contenedor (el almacén en memoria de express-session no sirve para producción).
 */
const session = require('express-session');
const { db } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS sesiones (
  sid    TEXT PRIMARY KEY,
  datos  TEXT NOT NULL,
  expira INTEGER NOT NULL
)`);

const DIA = 24 * 60 * 60 * 1000;
const vence = (s) => Date.now() + (s?.cookie?.maxAge || DIA);

class AlmacenSqlite extends session.Store {
  constructor() {
    super();
    this.limpiar();
    setInterval(() => this.limpiar(), 60 * 60 * 1000).unref();
  }

  limpiar() {
    db.prepare('DELETE FROM sesiones WHERE expira < ?').run(Date.now());
  }

  get(sid, cb) {
    try {
      const fila = db.prepare('SELECT datos, expira FROM sesiones WHERE sid = ?').get(sid);
      cb(null, fila && fila.expira > Date.now() ? JSON.parse(fila.datos) : null);
    } catch (e) {
      cb(e);
    }
  }

  set(sid, s, cb) {
    try {
      db.prepare('INSERT INTO sesiones (sid, datos, expira) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET datos = excluded.datos, expira = excluded.expira')
        .run(sid, JSON.stringify(s), vence(s));
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }

  touch(sid, s, cb) {
    try {
      db.prepare('UPDATE sesiones SET expira = ? WHERE sid = ?').run(vence(s), sid);
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sesiones WHERE sid = ?').run(sid);
      cb?.(null);
    } catch (e) {
      cb?.(e);
    }
  }
}

module.exports = AlmacenSqlite;
