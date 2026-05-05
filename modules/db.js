// modules/db.js — banco SQLite (better-sqlite3, síncrono).
// O arquivo do banco fica em /app/data/aluguel.db (volume persistente).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { log } = require('./logger');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, 'aluguel.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ──────────────────────────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS casas (
  id              INTEGER PRIMARY KEY,
  numero          INTEGER UNIQUE NOT NULL,
  inquilino       TEXT,
  aluguel_padrao  REAL NOT NULL DEFAULT 0,
  relogio_luz     INTEGER NOT NULL DEFAULT 1,
  unidades_luz    REAL NOT NULL DEFAULT 1,
  unidades_agua   REAL NOT NULL DEFAULT 1,
  ativa           INTEGER NOT NULL DEFAULT 1,
  observacoes     TEXT
);

CREATE TABLE IF NOT EXISTS meses (
  id                INTEGER PRIMARY KEY,
  ano               INTEGER NOT NULL,
  mes               INTEGER NOT NULL,
  agua_total        REAL NOT NULL DEFAULT 0,
  agua_divisor      REAL NOT NULL DEFAULT 10,
  fechado           INTEGER NOT NULL DEFAULT 0,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ano, mes)
);

CREATE TABLE IF NOT EXISTS contas_luz_relogio (
  id          INTEGER PRIMARY KEY,
  mes_id      INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  relogio     INTEGER NOT NULL,
  valor_total REAL NOT NULL DEFAULT 0,
  UNIQUE(mes_id, relogio)
);

CREATE TABLE IF NOT EXISTS lancamentos (
  id                  INTEGER PRIMARY KEY,
  mes_id              INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  casa_id             INTEGER NOT NULL REFERENCES casas(id),
  inquilino           TEXT,
  vazia               INTEGER NOT NULL DEFAULT 0,
  agua_valor          REAL NOT NULL DEFAULT 0,
  agua_pago           INTEGER NOT NULL DEFAULT 0,
  luz_valor           REAL NOT NULL DEFAULT 0,
  luz_pago            INTEGER NOT NULL DEFAULT 0,
  outros_valor        REAL NOT NULL DEFAULT 0,
  outros_descricao    TEXT,
  outros_pago         INTEGER NOT NULL DEFAULT 0,
  aluguel_valor       REAL NOT NULL DEFAULT 0,
  aluguel_pago        INTEGER NOT NULL DEFAULT 0,
  UNIQUE(mes_id, casa_id)
);

CREATE TABLE IF NOT EXISTS descontos_pais (
  id            INTEGER PRIMARY KEY,
  mes_id        INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  destinatario  TEXT NOT NULL CHECK(destinatario IN ('pai', 'mae')),
  descricao     TEXT NOT NULL,
  valor         REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pagamentos_pais (
  id              INTEGER PRIMARY KEY,
  mes_id          INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  destinatario    TEXT NOT NULL CHECK(destinatario IN ('pai', 'mae')),
  pago            INTEGER NOT NULL DEFAULT 0,
  data_pagamento  TEXT,
  UNIQUE(mes_id, destinatario)
);

CREATE INDEX IF NOT EXISTS idx_lancamentos_mes ON lancamentos(mes_id);
CREATE INDEX IF NOT EXISTS idx_descontos_mes   ON descontos_pais(mes_id);
`);

// ──────────────────────────────────────────────────────────────────
// Migrations: ALTER TABLE idempotentes (rodam toda vez na boot, mas
// só fazem mudança se a coluna ainda não existir).
// ──────────────────────────────────────────────────────────────────
function colunaExiste(tabela, coluna) {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all();
  return cols.some(c => c.name === coluna);
}
function addCol(tabela, coluna, tipoEdefault) {
  if (!colunaExiste(tabela, coluna)) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipoEdefault}`);
    log(`[DB-MIGRATE] ${tabela}.${coluna} adicionada`);
  }
}

// vencimento_agua e vencimento_luz: dia do mês (1-31) — null = não definido
addCol('meses', 'vencimento_agua', 'INTEGER');
addCol('meses', 'vencimento_luz',  'INTEGER');

// pago_em: data ISO (YYYY-MM-DD) preenchida automaticamente quando o
// lançamento da casa é totalmente quitado (água + luz + outros + aluguel).
addCol('lancamentos', 'pago_em', 'TEXT');

// observação livre de cobrança (ex: "ligar segunda")
addCol('lancamentos', 'cobrar_obs', 'TEXT');

// telefone do inquilino, pra montar link wa.me na hora de cobrar
addCol('casas', 'telefone', 'TEXT');

// ──────────────────────────────────────────────────────────────────
// Seed: cria as 7 casas iniciais se a tabela estiver vazia.
// ──────────────────────────────────────────────────────────────────
const count = db.prepare('SELECT COUNT(*) AS n FROM casas').get().n;
if (count === 0) {
  const stmt = db.prepare(`
    INSERT INTO casas (numero, inquilino, aluguel_padrao, relogio_luz, unidades_luz, unidades_agua)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const seed = [
    [1, 'Vicente', 350,   2, 1, 1],
    [2, '',         0,    2, 1, 1],
    [3, 'Micaelly', 350,  2, 1, 1],
    [4, 'Jair',     350,  3, 1, 1],
    [5, 'Claudio',  500,  3, 1, 1],
    [6, 'Erick',    700,  3, 1, 1],
    [7, 'Erivan',   500,  3, 2, 2],
  ];
  const tx = db.transaction((rows) => rows.forEach(r => stmt.run(...r)));
  tx(seed);
  log(`[DB] Seed inicial: ${seed.length} casas criadas`);
}

log(`[DB] Banco pronto em ${DB_PATH}`);

module.exports = db;
