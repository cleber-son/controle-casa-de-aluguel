// modules/db.js — banco SQLite do Quintal (better-sqlite3, síncrono).
// Banco NOVO em data/quintal.db (o antigo aluguel.db fica intocado).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { log } = require('./logger');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, 'quintal.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema (idempotente) ─────────────────────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS casas (
  id           INTEGER PRIMARY KEY,
  numero       INTEGER UNIQUE NOT NULL,
  inquilino    TEXT    NOT NULL DEFAULT '',
  telefone     TEXT,
  aluguel      REAL    NOT NULL DEFAULT 0,
  moradores    INTEGER NOT NULL DEFAULT 1,
  relogio      INTEGER NOT NULL DEFAULT 1,
  peso_luz     REAL    NOT NULL DEFAULT 1,
  ativa        INTEGER NOT NULL DEFAULT 1,
  observacoes  TEXT,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meses (
  id                  INTEGER PRIMARY KEY,
  ano                 INTEGER NOT NULL,
  mes                 INTEGER NOT NULL,
  agua_total          REAL NOT NULL DEFAULT 0,
  agua_vencimento     TEXT,
  aluguel_vencimento  TEXT,
  observacoes         TEXT,
  fechado             INTEGER NOT NULL DEFAULT 0,
  criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ano, mes)
);

CREATE TABLE IF NOT EXISTS contas_luz (
  id          INTEGER PRIMARY KEY,
  mes_id      INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  relogio     INTEGER NOT NULL,
  valor_total REAL NOT NULL DEFAULT 0,
  vencimento  TEXT,
  UNIQUE(mes_id, relogio)
);

CREATE TABLE IF NOT EXISTS lancamentos (
  id                INTEGER PRIMARY KEY,
  mes_id            INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  casa_id           INTEGER NOT NULL REFERENCES casas(id),
  inquilino         TEXT,
  vazia             INTEGER NOT NULL DEFAULT 0,
  moradores         INTEGER NOT NULL DEFAULT 1,
  agua_valor        REAL NOT NULL DEFAULT 0,
  agua_pago         INTEGER NOT NULL DEFAULT 0,
  agua_pago_em      TEXT,
  luz_valor         REAL NOT NULL DEFAULT 0,
  luz_pago          INTEGER NOT NULL DEFAULT 0,
  luz_pago_em       TEXT,
  outros_valor      REAL NOT NULL DEFAULT 0,
  outros_descricao  TEXT,
  outros_pago       INTEGER NOT NULL DEFAULT 0,
  outros_pago_em    TEXT,
  aluguel_valor     REAL NOT NULL DEFAULT 0,
  aluguel_pago      INTEGER NOT NULL DEFAULT 0,
  aluguel_pago_em   TEXT,
  quitado_em        TEXT,
  obs               TEXT,
  UNIQUE(mes_id, casa_id)
);

CREATE TABLE IF NOT EXISTS envios_wa (
  id          INTEGER PRIMARY KEY,
  mes_id      INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  casa_id     INTEGER NOT NULL REFERENCES casas(id),
  enviado_em  TEXT NOT NULL,
  modelo      TEXT NOT NULL DEFAULT 'cobranca',
  UNIQUE(mes_id, casa_id, modelo)
);

CREATE TABLE IF NOT EXISTS descontos_pais (
  id           INTEGER PRIMARY KEY,
  mes_id       INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  destinatario TEXT NOT NULL CHECK(destinatario IN ('pai','mae')),
  descricao    TEXT NOT NULL,
  valor        REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pagamentos_pais (
  id             INTEGER PRIMARY KEY,
  mes_id         INTEGER NOT NULL REFERENCES meses(id) ON DELETE CASCADE,
  destinatario   TEXT NOT NULL CHECK(destinatario IN ('pai','mae')),
  pago           INTEGER NOT NULL DEFAULT 0,
  data_pagamento TEXT,
  UNIQUE(mes_id, destinatario)
);

CREATE TABLE IF NOT EXISTS regras (
  id        INTEGER PRIMARY KEY,
  ordem     INTEGER NOT NULL DEFAULT 0,
  categoria TEXT NOT NULL DEFAULT 'convivencia',
  titulo    TEXT NOT NULL,
  texto     TEXT NOT NULL,
  ativa     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_lanc_mes ON lancamentos(mes_id);
CREATE INDEX IF NOT EXISTS idx_luz_mes  ON contas_luz(mes_id);
CREATE INDEX IF NOT EXISTS idx_env_mes  ON envios_wa(mes_id);
`);

// ── Migrações de coluna (idempotentes) ───────────────────────────
// "inquilino_desde" ('AAAA-MM'): mês em que o inquilino entrou. Meses
// anteriores a isso a casa conta como vaga — ele não paga conta de antes
// de morar aqui.
const colunasCasas = db.prepare('PRAGMA table_info(casas)').all().map((c) => c.name);
if (!colunasCasas.includes('inquilino_desde')) {
  db.exec('ALTER TABLE casas ADD COLUMN inquilino_desde TEXT');
  log('db: coluna casas.inquilino_desde criada');
}

// "dia_vencimento_aluguel" (1..31): dia do mês em que o aluguel daquela casa
// vence. Padrão 20 para todas — inclusive nas casas que já existiam. Se o dia
// não existe no mês (31 em fevereiro), o cálculo usa o último dia do mês.
if (!colunasCasas.includes('dia_vencimento_aluguel')) {
  db.exec('ALTER TABLE casas ADD COLUMN dia_vencimento_aluguel INTEGER NOT NULL DEFAULT 20');
  log('db: coluna casas.dia_vencimento_aluguel criada (padrão dia 20)');
}

// ── Seed de regras (só se a tabela estiver vazia) ────────────────
// Antes esta lista era inserida com um INSERT INTO casas — os objetos são
// regras, então um banco novo quebrava no boot ("Missing named parameter
// numero"). Agora vai para a tabela certa.

const totalRegras = db.prepare('SELECT COUNT(*) AS n FROM regras').get().n;
if (totalRegras === 0) {
  const ins = db.prepare(`
    INSERT INTO regras (ordem, categoria, titulo, texto, ativa)
    VALUES (@ordem, @categoria, @titulo, @texto, 1)
  `);
  const seed = db.transaction((regras) => { for (const r of regras) ins.run(r); });
  seed([
    { ordem: 1,  categoria: 'seguranca',   titulo: 'Silêncio das 22h às 7h',
      texto: 'Som, TV e conversa em volume baixo depois das 22h. Domingo e feriado, silêncio a partir das 21h.' },
    { ordem: 2,  categoria: 'convivencia', titulo: 'Festa só combinando antes',
      texto: 'Reunião ou festa precisa ser avisada com pelo menos 2 dias de antecedência e encerrar até 23h.' },
    { ordem: 3,  categoria: 'contas',      titulo: 'Água é dividida por pessoa',
      texto: 'O valor da conta de água é rateado pelo número de moradores de cada casa. Quem tem mais gente na casa paga mais.' },
    { ordem: 4,  categoria: 'contas',      titulo: 'Luz é dividida por relógio',
      texto: 'São duas contas: um relógio atende as casas 1, 2 e 3 e o outro as casas 4, 5, 6 e 7. O valor é dividido entre as casas ocupadas daquele relógio.' },
    { ordem: 5,  categoria: 'contas',      titulo: 'Pagar até a data combinada',
      texto: 'O aluguel e as contas têm data de vencimento informada na mensagem do mês. Se for atrasar, avise antes — atraso sem aviso complica pra todo mundo.' },
    { ordem: 6,  categoria: 'limpeza',     titulo: 'Manter o ambiente limpo',
      texto: 'Quintal, corredor, área comum e lavanderia sempre limpos. Usou, limpou. Sujou, limpou na hora — ninguém limpa a bagunça do outro.' },
    { ordem: 7,  categoria: 'limpeza',     titulo: 'Cada um cuida da sua frente',
      texto: 'Varrer e manter limpa a área na frente da sua casa é responsabilidade do morador.' },
    { ordem: 8,  categoria: 'limpeza',     titulo: 'Lixo só em saco fechado',
      texto: 'Nada de sacola solta no chão do quintal. Lixo sempre fechado e na lixeira, senão atrai rato, barata e bicho.' },
    { ordem: 9,  categoria: 'seguranca',   titulo: 'Nada de objetos no corredor',
      texto: 'O corredor e a passagem do quintal ficam sempre livres. Não deixe móvel, entulho, bicicleta, caixa, material de obra nem nada parado ali — é passagem de todo mundo e saída de emergência.' },
    { ordem: 10, categoria: 'convivencia', titulo: 'Área comum e varal são de todos',
      texto: 'Use e libere. Não deixe roupa esquecida no varal por dias nem ocupe a área comum por tempo demais.' },
    { ordem: 11, categoria: 'animais',     titulo: 'Animais são proibidos',
      texto: 'Não é permitido ter animal nas casas. A única exceção é com autorização do dono da casa, combinada antes. Sem essa autorização, não pode — nem "por uns dias", nem animal de visita.' },
    { ordem: 12, categoria: 'animais',     titulo: 'Cuidados com o animal autorizado',
      texto: 'Se o dono da casa autorizou, o morador é o único responsável pelo animal: na coleira sempre que sair da casa, nunca solto no quintal, fezes recolhidas na hora, comida e água só dentro da casa (ração no quintal atrai bicho), vacina em dia, e latido ou barulho controlado — principalmente das 22h às 7h. Qualquer estrago que o animal fizer é o morador quem paga, e a autorização pode ser cancelada se as combinações não forem cumpridas.' },
    { ordem: 13, categoria: 'convivencia', titulo: 'Visita é responsabilidade do morador',
      texto: 'Visitas são bem-vindas, mas quem responde por elas é o morador. Hóspede por mais de 7 dias precisa ser combinado.' },
    { ordem: 14, categoria: 'seguranca',   titulo: 'Nada de gambiarra elétrica nem fogo',
      texto: 'Proibido puxar energia de outra casa, fazer ligação improvisada ou acender fogueira/churrasqueira sem combinar antes.' },
  ]);
  log('db: seed de regras aplicado (14 regras)');
}

log(`db: quintal.db pronto em ${DB_PATH}`);

module.exports = db;
