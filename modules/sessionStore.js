// modules/sessionStore.js — sessões guardadas no SQLite.
//
// O express-session usa MemoryStore por padrão: as sessões vivem só na RAM do
// processo. Na prática, todo deploy (ou qualquer restart do container) apagava
// tudo e exigia senha + código de e-mail de novo. Guardando no banco, o
// dispositivo continua logado entre reinícios.
//
// Sem dependência nova: reaproveita o better-sqlite3 que já está no projeto.

const session = require('express-session');
const db = require('./db');
const { log } = require('./logger');

db.exec(`
CREATE TABLE IF NOT EXISTS sessoes (
  sid        TEXT PRIMARY KEY,
  dados      TEXT NOT NULL,
  expira_em  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessoes_exp ON sessoes(expira_em);
`);

const UMA_HORA = 60 * 60 * 1000;

class SQLiteStore extends session.Store {
  constructor(opcoes = {}) {
    super(opcoes);
    this.ttlPadrao = opcoes.ttl || 1000 * 60 * 60 * 24 * 365;

    this.stmtGet = db.prepare('SELECT dados, expira_em FROM sessoes WHERE sid = ?');
    this.stmtSet = db.prepare(`
      INSERT INTO sessoes (sid, dados, expira_em) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET dados = excluded.dados, expira_em = excluded.expira_em
    `);
    this.stmtDel = db.prepare('DELETE FROM sessoes WHERE sid = ?');
    this.stmtTouch = db.prepare('UPDATE sessoes SET expira_em = ? WHERE sid = ?');
    this.stmtLimpa = db.prepare('DELETE FROM sessoes WHERE expira_em <= ?');

    this.limpar();
    // faxina de hora em hora; unref para não segurar o processo no ar
    this.timer = setInterval(() => this.limpar(), UMA_HORA);
    if (this.timer.unref) this.timer.unref();
  }

  limpar() {
    try {
      const r = this.stmtLimpa.run(Date.now());
      if (r.changes) log(`sessoes: ${r.changes} expirada(s) removida(s)`);
    } catch (e) {
      log(`sessoes: falha ao limpar (${e.message})`);
    }
  }

  // validade da sessão: o que o cookie disser, senão o padrão
  _expiraEm(sess) {
    const c = sess && sess.cookie;
    if (c && c.expires) {
      const t = new Date(c.expires).getTime();
      if (Number.isFinite(t)) return t;
    }
    if (c && Number.isFinite(c.maxAge)) return Date.now() + c.maxAge;
    return Date.now() + this.ttlPadrao;
  }

  get(sid, cb) {
    let row;
    try {
      row = this.stmtGet.get(sid);
    } catch (e) {
      return cb(e);
    }
    if (!row) return cb(null, null);
    if (row.expira_em <= Date.now()) {
      try { this.stmtDel.run(sid); } catch { /* já foi */ }
      return cb(null, null);
    }
    try {
      return cb(null, JSON.parse(row.dados));
    } catch (e) {
      // registro corrompido não pode derrubar o login: descarta e segue
      try { this.stmtDel.run(sid); } catch { /* ignora */ }
      return cb(null, null);
    }
  }

  set(sid, sess, cb) {
    try {
      this.stmtSet.run(sid, JSON.stringify(sess), this._expiraEm(sess));
      return cb(null);
    } catch (e) {
      return cb(e);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.stmtTouch.run(this._expiraEm(sess), sid);
      return cb(null);
    } catch (e) {
      return cb(e);
    }
  }

  destroy(sid, cb) {
    try {
      this.stmtDel.run(sid);
      return cb(null);
    } catch (e) {
      return cb(e);
    }
  }

  length(cb) {
    try {
      cb(null, db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE expira_em > ?').get(Date.now()).n);
    } catch (e) {
      cb(e);
    }
  }

  clear(cb) {
    try {
      db.prepare('DELETE FROM sessoes').run();
      return cb(null);
    } catch (e) {
      return cb(e);
    }
  }

  all(cb) {
    try {
      const rows = db.prepare('SELECT sid, dados FROM sessoes WHERE expira_em > ?').all(Date.now());
      const out = {};
      for (const r of rows) {
        try { out[r.sid] = JSON.parse(r.dados); } catch { /* ignora corrompido */ }
      }
      return cb(null, out);
    } catch (e) {
      return cb(e);
    }
  }
}

module.exports = SQLiteStore;
