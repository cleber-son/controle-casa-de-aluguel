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
  inquilino       TEXT,                       -- inquilino "padrão" atual
  aluguel_padrao  REAL NOT NULL DEFAULT 0,    -- valor de aluguel default
  relogio_luz     INTEGER NOT NULL DEFAULT 1, -- 1, 2, 3 ...
  unidades_luz    REAL NOT NULL DEFAULT 1,    -- peso na divisão da luz
  unidades_agua   REAL NOT NULL DEFAULT 1,    -- peso na divisão da água
  ativa           INTEGER NOT NULL DEFAULT 1, -- 1 = casa existente
  observacoes     TEXT
);

CREATE TABLE IF NOT EXISTS meses (
  id                INTEGER PRIMARY KEY,
  ano               INTEGER NOT NULL,
  mes               INTEGER NOT NULL,           -- 1..12
  agua_total        REAL NOT NULL DEFAULT 0,    -- valor total da conta de água
  agua_divisor      REAL NOT NULL DEFAULT 10,   -- divisor configurável
  fechado           INTEGER NOT NULL DEFAULT 0, -- 1 = mês fechado (não recalcula)
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
  inquilino           TEXT,                       -- snapshot do nome no mês
  vazia               INTEGER NOT NULL DEFAULT 0, -- 1 = sem inquilino nesse mês
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
// Seed: cria as 7 casas iniciais se a tabela estiver vazia.
// Valores baseados nas planilhas que você mandou (jan/2026):
//   - Casa 7 (Erivan) tem 2 unidades de água e 2 de luz (paga em dobro).
//   - Aluguéis a partir do print de janeiro 2026.
//   - Você ajusta tudo na aba "Casas" do dashboard depois.
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
