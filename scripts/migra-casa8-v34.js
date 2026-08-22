/**
 * Migração v3.4 — idempotente.
 *
 *  - cadastra a casa 08 (Erick): aluguel 700, mora sozinho, relógio de luz
 *    PRÓPRIO (relógio 3 = conta separada só dele) e água rateada junto com
 *    todas as outras casas, por cabeça;
 *  - atualiza a regra da luz, que citava só os relógios 1 e 2.
 *
 * Uso: node scripts/migra-casa8-v34.js
 */
const db = require('../modules/db.js');

const CASA = {
  numero: 8,
  inquilino: 'Erick',
  telefone: null,
  aluguel: 700,
  moradores: 1,
  relogio: 3,   // conta de luz separada, só desta casa
  peso_luz: 1,
  ativa: 1,
  observacoes: 'Relógio de luz próprio — a conta do relógio 3 é só desta casa.',
};

const REGRA_LUZ = {
  titulo: 'Luz é dividida por relógio',
  texto: 'Cada relógio tem a sua própria conta de luz, e o valor é dividido entre as casas ocupadas ' +
    'daquele relógio. Casa que tem relógio só dela paga a conta inteira do próprio relógio. ' +
    'Quem está no mesmo relógio divide entre si.',
};

const tx = db.transaction(() => {
  const ja = db.prepare('SELECT * FROM casas WHERE numero = ?').get(CASA.numero);
  if (ja) {
    db.prepare(`UPDATE casas SET inquilino = ?, aluguel = ?, moradores = ?, relogio = ?,
                peso_luz = ?, ativa = ?, observacoes = ? WHERE id = ?`)
      .run(CASA.inquilino, CASA.aluguel, CASA.moradores, CASA.relogio,
           CASA.peso_luz, CASA.ativa, CASA.observacoes, ja.id);
    console.log(`= casa ${CASA.numero} atualizada (${CASA.inquilino})`);
  } else {
    db.prepare(`INSERT INTO casas (numero, inquilino, telefone, aluguel, moradores, relogio, peso_luz, ativa, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(CASA.numero, CASA.inquilino, CASA.telefone, CASA.aluguel, CASA.moradores,
           CASA.relogio, CASA.peso_luz, CASA.ativa, CASA.observacoes);
    console.log(`+ casa ${CASA.numero} criada (${CASA.inquilino})`);
  }

  const r = db.prepare('SELECT id FROM regras WHERE titulo = ?').get(REGRA_LUZ.titulo);
  if (r) {
    db.prepare('UPDATE regras SET texto = ? WHERE id = ?').run(REGRA_LUZ.texto, r.id);
    console.log('= regra da luz atualizada (não cita mais só os relógios 1 e 2)');
  }

  // Meses ABERTOS ganham o lançamento e a conta de luz do relógio novo.
  // (Mês fechado é histórico e fica como está.)
  const casa = db.prepare('SELECT * FROM casas WHERE numero = ?').get(CASA.numero);
  const abertos = db.prepare('SELECT id, ano, mes FROM meses WHERE fechado = 0 ORDER BY ano, mes').all();
  for (const m of abertos) {
    db.prepare(`INSERT OR IGNORE INTO lancamentos (mes_id, casa_id, inquilino, vazia, moradores, aluguel_valor)
                VALUES (?, ?, ?, 0, ?, ?)`)
      .run(m.id, casa.id, casa.inquilino, casa.moradores, casa.aluguel);
    db.prepare('INSERT OR IGNORE INTO contas_luz (mes_id, relogio) VALUES (?, ?)').run(m.id, casa.relogio);
    console.log(`  · ${m.mes}/${m.ano}: lançamento e relógio ${casa.relogio} garantidos`);
  }
  return abertos;
});

const abertos = tx();

// recalcula fora da transação de escrita (recalcularMes abre a sua própria)
const calc = require('../modules/calculo.js');
for (const m of abertos) calc.recalcularMes(m.id);
console.log(`rateio recalculado em ${abertos.length} mês(es) aberto(s)`);
console.log('migração v3.4 concluída');
