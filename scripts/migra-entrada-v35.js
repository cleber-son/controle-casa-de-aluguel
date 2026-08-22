/**
 * Migração v3.5 — idempotente.
 *
 * Marca o mês de entrada dos inquilinos que não estão aqui desde o começo do
 * controle e reaplica isso nos meses abertos: meses anteriores à entrada
 * viram casa vaga (sem cobrança e fora do rateio de água e luz).
 *
 * Uso: node scripts/migra-entrada-v35.js
 */
const db = require('../modules/db.js');
const calc = require('../modules/calculo.js');

const ENTRADAS = [
  { numero: 2, desde: '2026-08' },   // Marcelo entrou em agosto
];

for (const e of ENTRADAS) {
  const casa = db.prepare('SELECT * FROM casas WHERE numero = ?').get(e.numero);
  if (!casa) { console.log(`! casa ${e.numero} não encontrada`); continue; }
  db.prepare('UPDATE casas SET inquilino_desde = ? WHERE id = ?').run(e.desde, casa.id);
  const atualizada = db.prepare('SELECT * FROM casas WHERE id = ?').get(casa.id);
  const n = calc.sincronizarCasa(atualizada, atualizada);
  console.log(`= casa ${e.numero} (${casa.inquilino}): entrada em ${e.desde}, ${n} mês(es) aberto(s) sincronizado(s)`);
}

console.log('migração v3.5 concluída');
