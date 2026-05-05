// modules/calculo.js — regras de negócio para cálculo das contas mensais.
//
// REGRAS:
//
// ÁGUA:
//   valor_por_unidade = agua_total / agua_divisor
//   casa.agua_valor   = valor_por_unidade * casa.unidades_agua
//   (casa vazia ainda gera lançamento, mas com agua_valor=0 por padrão —
//    você pode editar manualmente se quiser cobrar do "ar".)
//
// LUZ (por relógio):
//   Para cada relógio com valor_total > 0:
//     casas_no_relogio = casas com relogio_luz=R que NÃO estão vazias no mês
//     soma_unidades    = sum(casa.unidades_luz para casas_no_relogio)
//     casa.luz_valor   = (valor_total / soma_unidades) * casa.unidades_luz
//   Casa vazia naquele relógio NÃO paga luz (o "ar" não consome).
//
// PAIS (split):
//   total_recebido_aluguel = soma de aluguel_valor onde aluguel_pago=1
//   bruto_pai = bruto_mae = total_recebido_aluguel * 0.5
//   liquido_pai = bruto_pai - soma(descontos do pai no mês)
//   liquido_mae = bruto_mae - soma(descontos da mae no mês)

const db = require('./db');
const { log } = require('./logger');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Recalcula e grava os valores de água e luz de todas as casas no mês.
 * Não mexe em "pago" nem em aluguel_valor (esses ficam manuais).
 */
function recalcularMes(mesId) {
  const mes = db.prepare('SELECT * FROM meses WHERE id = ?').get(mesId);
  if (!mes) throw new Error('Mês não encontrado: ' + mesId);
  if (mes.fechado) {
    log(`[CALC] mês ${mes.ano}-${mes.mes} está fechado, não recalculando`);
    return;
  }

  const lancs = db.prepare(`
    SELECT l.*, c.numero AS casa_numero, c.relogio_luz, c.unidades_luz, c.unidades_agua
      FROM lancamentos l JOIN casas c ON c.id = l.casa_id
     WHERE l.mes_id = ?
  `).all(mesId);

  // ─── ÁGUA ───
  const valorAguaPorUnidade = mes.agua_divisor > 0
    ? mes.agua_total / mes.agua_divisor
    : 0;

  // ─── LUZ por relógio ───
  const relogios = db.prepare('SELECT * FROM contas_luz_relogio WHERE mes_id = ?').all(mesId);
  const valorPorUnidadeLuz = {}; // { relogio: valor_por_unidade }
  for (const r of relogios) {
    const casasNoRelogio = lancs.filter(l => l.relogio_luz === r.relogio && !l.vazia);
    const somaUnidades = casasNoRelogio.reduce((s, l) => s + (l.unidades_luz || 0), 0);
    valorPorUnidadeLuz[r.relogio] = (somaUnidades > 0 && r.valor_total > 0)
      ? r.valor_total / somaUnidades
      : 0;
  }

  // ─── Atualiza cada lançamento ───
  const upd = db.prepare(`
    UPDATE lancamentos SET agua_valor = ?, luz_valor = ? WHERE id = ?
  `);
  const tx = db.transaction(() => {
    for (const l of lancs) {
      const aguaValor = l.vazia
        ? 0
        : round2(valorAguaPorUnidade * (l.unidades_agua || 0));

      const vpuLuz = valorPorUnidadeLuz[l.relogio_luz] || 0;
      const luzValor = l.vazia
        ? 0
        : round2(vpuLuz * (l.unidades_luz || 0));

      upd.run(aguaValor, luzValor, l.id);
    }
  });
  tx();

  log(`[CALC] mês ${mes.ano}-${mes.mes} recalculado: ${lancs.length} lançamentos`);
}

/**
 * Garante que o mês existe e tem 1 lançamento por casa ativa.
 * Se já existir, não duplica nada.
 */
function garantirMes(ano, mes) {
  let m = db.prepare('SELECT * FROM meses WHERE ano = ? AND mes = ?').get(ano, mes);
  if (!m) {
    const r = db.prepare('INSERT INTO meses (ano, mes) VALUES (?, ?)').run(ano, mes);
    m = db.prepare('SELECT * FROM meses WHERE id = ?').get(r.lastInsertRowid);
    log(`[CALC] Mês criado: ${ano}-${mes} (id=${m.id})`);
  }

  // Cria lançamentos faltantes (snapshot do inquilino e aluguel atuais).
  const casas = db.prepare('SELECT * FROM casas WHERE ativa = 1 ORDER BY numero').all();
  const ins = db.prepare(`
    INSERT OR IGNORE INTO lancamentos
      (mes_id, casa_id, inquilino, vazia, aluguel_valor)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const c of casas) {
      const vazia = !c.inquilino || !c.inquilino.trim() ? 1 : 0;
      ins.run(m.id, c.id, c.inquilino || '', vazia, vazia ? 0 : c.aluguel_padrao);
    }
  });
  tx();

  // Garante que há 1 linha por relógio_luz único usado pelas casas.
  const relogios = [...new Set(casas.map(c => c.relogio_luz))];
  const insR = db.prepare(`
    INSERT OR IGNORE INTO contas_luz_relogio (mes_id, relogio, valor_total)
    VALUES (?, ?, 0)
  `);
  const txR = db.transaction(() => relogios.forEach(r => insR.run(m.id, r)));
  txR();

  return m;
}

/**
 * Agrega tudo que o front precisa para mostrar o mês inteiro.
 */
function carregarMes(ano, mes) {
  const m = db.prepare('SELECT * FROM meses WHERE ano = ? AND mes = ?').get(ano, mes);
  if (!m) return null;

  const lancs = db.prepare(`
    SELECT l.*,
           c.numero        AS casa_numero,
           c.relogio_luz   AS casa_relogio_luz,
           c.unidades_luz  AS casa_unidades_luz,
           c.unidades_agua AS casa_unidades_agua,
           c.aluguel_padrao
      FROM lancamentos l JOIN casas c ON c.id = l.casa_id
     WHERE l.mes_id = ?
     ORDER BY c.numero
  `).all(m.id);

  const relogios = db.prepare(`
    SELECT * FROM contas_luz_relogio WHERE mes_id = ? ORDER BY relogio
  `).all(m.id);

  const descontos = db.prepare(`
    SELECT * FROM descontos_pais WHERE mes_id = ? ORDER BY id
  `).all(m.id);

  const pagamentos = db.prepare(`
    SELECT * FROM pagamentos_pais WHERE mes_id = ?
  `).all(m.id);

  // Totais derivados.
  const totalAluguelRecebido = lancs
    .filter(l => l.aluguel_pago)
    .reduce((s, l) => s + (l.aluguel_valor || 0), 0);

  const totalAguaCobrado = lancs.reduce((s, l) => s + (l.agua_valor || 0), 0);
  const totalLuzCobrado  = lancs.reduce((s, l) => s + (l.luz_valor  || 0), 0);

  const descPai = descontos.filter(d => d.destinatario === 'pai').reduce((s, d) => s + d.valor, 0);
  const descMae = descontos.filter(d => d.destinatario === 'mae').reduce((s, d) => s + d.valor, 0);

  const brutoPai = round2(totalAluguelRecebido * 0.5);
  const brutoMae = round2(totalAluguelRecebido * 0.5);

  return {
    mes: m,
    lancamentos: lancs,
    relogios,
    descontos,
    pagamentos,
    totais: {
      aluguel_recebido: round2(totalAluguelRecebido),
      agua_cobrado:     round2(totalAguaCobrado),
      luz_cobrado:      round2(totalLuzCobrado),
      bruto_pai: brutoPai,
      bruto_mae: brutoMae,
      desconto_pai: round2(descPai),
      desconto_mae: round2(descMae),
      liquido_pai: round2(brutoPai - descPai),
      liquido_mae: round2(brutoMae - descMae),
    },
  };
}

const NOMES_MES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO',
                   'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

function nomeMes(n) {
  return NOMES_MES[n - 1] || '';
}

module.exports = {
  garantirMes,
  recalcularMes,
  carregarMes,
  nomeMes,
  round2,
};
