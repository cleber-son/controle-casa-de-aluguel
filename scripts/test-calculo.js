// scripts/test-calculo.js — Valida a lógica de cálculo contra
// os números reais das planilhas que o usuário enviou.
//
// Roda com:  DB_DIR=/tmp/test-aluguel node scripts/test-calculo.js
// (usa um banco isolado, NÃO mexe no banco de produção).

process.env.DB_DIR = process.env.DB_DIR || '/tmp/test-aluguel-' + Date.now();
process.env.APP_PASSWORD = 'test'; // só pra evitar warning do auth

const fs = require('fs');
const path = require('path');
fs.mkdirSync(process.env.DB_DIR, { recursive: true });

const db   = require('../modules/db');
const calc = require('../modules/calculo');

// Limpa tudo (caso o seed tenha rodado).
db.exec(`DELETE FROM lancamentos; DELETE FROM contas_luz_relogio; DELETE FROM meses; DELETE FROM descontos_pais; DELETE FROM pagamentos_pais; DELETE FROM casas;`);

// ──────────────────────────────────────────────────────────
// CENÁRIO REAL — JANEIRO 2026
// (extraído da imagem 3 que o usuário enviou)
// ──────────────────────────────────────────────────────────
//
// Casas e inquilinos:
//   1 Vicente   relógio 2  unid_luz=1  unid_agua=1   aluguel 350
//   2 (vazia)              relógio 2  unid_luz=1  unid_agua=1   aluguel 0
//   3 Micaelly  relógio 2  unid_luz=1  unid_agua=1   aluguel 350
//   4 Jair      relógio 3  unid_luz=1  unid_agua=1   aluguel 350
//   5 Claudio   relógio 3  unid_luz=1  unid_agua=1   aluguel 500
//   6 Erick     relógio 3  unid_luz=1  unid_agua=1   aluguel 700
//   7 Erivan    relógio 3  unid_luz=2  unid_agua=2   aluguel 500
//
// Contas:
//   Água:   total 1.137,61   divisor 10  → R$ 113,76 / unidade
//   Luz relógio 2: 180,00  → 2 casas (1 e 3, casa 2 vazia), 1+1 = 2 unidades → 90 cada
//   Luz relógio 3: 286,59  → 4 casas com 1+1+1+2 = 5 unidades → 57,318/unidade
//
// Esperado da planilha:
//   Vicente   água 113,76  luz —      (planilha mostra branco no luz, mas relógio 2 = 90)
//   (vazia)   água 113,76  luz 90,38  (Sim — a planilha cobra agua/luz mesmo vazia? não!
//                                       MAS na imagem 3 ela mostra valores com PAGO=NÃO.
//                                       O usuário pode estar lançando pra controle.)
//   Micaelly  água 113,76  luz 90 também
//   Jair      água 113,76  luz 57,32
//   Claudio   água 113,76  luz 57,32
//   Erick     água 113,76  luz 57,32
//   Erivan    água 227,52  luz 114,64
//
// O sistema considera vazia = não paga. Então no teste vou marcar
// casa 2 como NÃO vazia pra reproduzir o cenário da planilha
// (onde o usuário ainda lança pra controle).

const ins = db.prepare(`
  INSERT INTO casas (numero, inquilino, aluguel_padrao, relogio_luz, unidades_luz, unidades_agua)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const seed = [
  [1, 'Vicente',  350, 2, 1, 1],
  [2, '',           0, 2, 1, 1],
  [3, 'Micaelly', 350, 2, 1, 1],
  [4, 'Jair',     350, 3, 1, 1],
  [5, 'Claudio',  500, 3, 1, 1],
  [6, 'Erick',    700, 3, 1, 1],
  [7, 'Erivan',   500, 3, 2, 2],
];
seed.forEach(r => ins.run(...r));

// Cria mês jan/2026 + lançamentos
const mes = calc.garantirMes(2026, 1);

// Configura água total e divisor
db.prepare('UPDATE meses SET agua_total = 1137.61, agua_divisor = 10 WHERE id = ?').run(mes.id);

// Configura contas de luz dos relógios
const upR = db.prepare(`
  INSERT INTO contas_luz_relogio (mes_id, relogio, valor_total)
  VALUES (?, ?, ?)
  ON CONFLICT(mes_id, relogio) DO UPDATE SET valor_total = excluded.valor_total
`);
upR.run(mes.id, 2, 180);
upR.run(mes.id, 3, 286.59);

// Recalcula
calc.recalcularMes(mes.id);

// ─── Teste 1: cenário com casa 2 vazia (como a planilha de DEZEMBRO) ───
console.log('\n=== Teste 1: casa 2 VAZIA (cenário "dezembro") ===');
console.log('Esperado: agua 0 e luz 0 na casa 2; luz das outras do relógio 2 = 90 cada');

const dados = calc.carregarMes(2026, 1);
dados.lancamentos.forEach(l => {
  console.log(`  Casa ${l.casa_numero} (${l.inquilino || 'vazia'}): vazia=${l.vazia}  agua=${l.agua_valor.toFixed(2)}  luz=${l.luz_valor.toFixed(2)}`);
});

// Asserts
function expect(actual, expected, msg) {
  const ok = Math.abs(actual - expected) < 0.02;
  console.log(`  ${ok ? '✅' : '❌'} ${msg}: esperado ${expected}, recebeu ${actual.toFixed(2)}`);
  if (!ok) process.exitCode = 1;
}

const get = (n) => dados.lancamentos.find(l => l.casa_numero === n);
expect(get(1).agua_valor, 113.76, 'Vicente água');
expect(get(2).agua_valor, 0,      'Casa 2 (vazia) água');
expect(get(2).luz_valor,  0,      'Casa 2 (vazia) luz');
expect(get(3).agua_valor, 113.76, 'Micaelly água');
expect(get(7).agua_valor, 227.52, 'Erivan água (2 unid)');
expect(get(7).luz_valor,  114.64, 'Erivan luz (2 unid)'); // 286.59/5 * 2 = 114.636

// Quando casa 2 está vazia, casa 1 e 3 dividem 180 entre 2 unidades
expect(get(1).luz_valor, 90.00, 'Vicente luz (relógio 2 sem casa 2)');
expect(get(3).luz_valor, 90.00, 'Micaelly luz (relógio 2 sem casa 2)');

// Casa 4, 5, 6 com 1 unidade cada e Erivan 2 = total 5 unidades → 57.318 cada unidade
expect(get(4).luz_valor, 57.32, 'Jair luz');
expect(get(5).luz_valor, 57.32, 'Claudio luz');
expect(get(6).luz_valor, 57.32, 'Erick luz');

// ─── Teste 2: marca casa 2 como NÃO vazia (cenário JANEIRO da planilha) ───
console.log('\n=== Teste 2: casa 2 NÃO vazia (cenário "janeiro") ===');
console.log('Esperado: casa 1, 2, 3 dividem o relógio 2 (180 / 3 = 60 cada)');

db.prepare(`UPDATE lancamentos SET vazia = 0 WHERE mes_id = ? AND casa_id = (SELECT id FROM casas WHERE numero = 2)`).run(mes.id);
calc.recalcularMes(mes.id);
const d2 = calc.carregarMes(2026, 1);
const get2 = (n) => d2.lancamentos.find(l => l.casa_numero === n);

console.log(`  Casa 1 luz: ${get2(1).luz_valor.toFixed(2)} (esperado 60)`);
console.log(`  Casa 2 luz: ${get2(2).luz_valor.toFixed(2)} (esperado 60)`);
console.log(`  Casa 3 luz: ${get2(3).luz_valor.toFixed(2)} (esperado 60)`);
expect(get2(1).luz_valor, 60.00, 'Vicente luz com casa 2 ocupada');
expect(get2(2).luz_valor, 60.00, 'Casa 2 luz quando ocupada');
expect(get2(3).luz_valor, 60.00, 'Micaelly luz com casa 2 ocupada');

// ─── Teste 3: split pais com descontos ───
console.log('\n=== Teste 3: split 50/50 entre pai/mãe com descontos ===');

// Marca aluguéis pagos: Vicente + Micaelly + Erick = 350 + 350 + 700 = 1400
db.prepare(`UPDATE lancamentos SET aluguel_pago = 1 WHERE mes_id = ? AND casa_id IN (
  SELECT id FROM casas WHERE numero IN (1,3,6)
)`).run(mes.id);

// Adiciona descontos:
//   Pai: Seguro Carro 131,48 + Peças (1/9) 150,56 = 282,04
//   Mãe: Boleto 305,00
db.prepare('INSERT INTO descontos_pais (mes_id, destinatario, descricao, valor) VALUES (?,?,?,?)').run(mes.id, 'pai', 'Seguro Carro', 131.48);
db.prepare('INSERT INTO descontos_pais (mes_id, destinatario, descricao, valor) VALUES (?,?,?,?)').run(mes.id, 'pai', 'Peças do Carro (1/9)', 150.56);
db.prepare('INSERT INTO descontos_pais (mes_id, destinatario, descricao, valor) VALUES (?,?,?,?)').run(mes.id, 'mae', 'Boleto', 305.00);

const d3 = calc.carregarMes(2026, 1);
console.log(`  Aluguel recebido: ${d3.totais.aluguel_recebido} (esperado 1400)`);
console.log(`  Bruto pai/mãe:    ${d3.totais.bruto_pai} / ${d3.totais.bruto_mae} (esperado 700 cada)`);
console.log(`  Líquido pai:      ${d3.totais.liquido_pai} (esperado 417.96)`);
console.log(`  Líquido mãe:      ${d3.totais.liquido_mae} (esperado 395.00)`);

expect(d3.totais.aluguel_recebido, 1400.00, 'Aluguel total recebido');
expect(d3.totais.bruto_pai, 700.00, 'Bruto pai 50%');
expect(d3.totais.bruto_mae, 700.00, 'Bruto mãe 50%');
expect(d3.totais.desconto_pai, 282.04, 'Desconto pai');
expect(d3.totais.desconto_mae, 305.00, 'Desconto mãe');
expect(d3.totais.liquido_pai, 417.96, 'Líquido pai');
expect(d3.totais.liquido_mae, 395.00, 'Líquido mãe');

console.log('\n' + (process.exitCode ? '❌ FALHOU' : '✅ TODOS OS TESTES PASSARAM'));
