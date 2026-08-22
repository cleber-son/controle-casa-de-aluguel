// modules/calculo.js — regras de cálculo do Quintal.
//
// ÁGUA  — por cabeça: agua_total / moradores das casas ocupadas.
// LUZ   — por relógio (2 contas), dividida por peso entre casas ocupadas do relógio.
// Casa vazia: não entra em nenhum rateio e não paga nada.

const db = require('./db');

const INICIO_PERIODO = { ano: 2026, mes: 4 };

const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];

function antesPeriodo(ano, mes) {
  return ano < INICIO_PERIODO.ano ||
    (ano === INICIO_PERIODO.ano && mes < INICIO_PERIODO.mes);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// 'YYYY-MM-DD' no fuso de São Paulo (o do app).
function hojeISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function nomeMes(n) {
  return MESES[n - 1] || '';
}

function labelMes(ano, mes) {
  return `${nomeMes(mes)}/${ano}`;
}

function validarAnoMes(ano, mes) {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12 ||
      ano < 2000 || ano > 2100) {
    throw new Error('Mês inválido');
  }
  if (antesPeriodo(ano, mes)) {
    throw new Error(`Período anterior ao início do controle (${labelMes(INICIO_PERIODO.ano, INICIO_PERIODO.mes)})`);
  }
}

// Cria o mês (se preciso) + 1 lançamento por casa ativa + 1 conta de luz
// por relógio existente. Lançamento já existente não é sobrescrito (histórico).
const garantirMes = db.transaction((ano, mes) => {
  validarAnoMes(ano, mes);

  db.prepare('INSERT OR IGNORE INTO meses (ano, mes) VALUES (?, ?)').run(ano, mes);
  const mesRow = db.prepare('SELECT * FROM meses WHERE ano = ? AND mes = ?').get(ano, mes);

  const casas = db.prepare('SELECT * FROM casas WHERE ativa = 1 ORDER BY numero').all();
  const insLanc = db.prepare(`
    INSERT OR IGNORE INTO lancamentos (mes_id, casa_id, inquilino, vazia, moradores, aluguel_valor)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const c of casas) {
    const vazia = !String(c.inquilino || '').trim() ? 1 : 0;
    insLanc.run(mesRow.id, c.id, c.inquilino || '', vazia, c.moradores, vazia ? 0 : c.aluguel);
  }

  const relogios = db.prepare('SELECT DISTINCT relogio FROM casas WHERE ativa = 1 ORDER BY relogio').all();
  const insLuz = db.prepare('INSERT OR IGNORE INTO contas_luz (mes_id, relogio) VALUES (?, ?)');
  for (const r of relogios) insLuz.run(mesRow.id, r.relogio);

  return mesRow;
});

// Recalcula agua_valor e luz_valor de todos os lançamentos do mês.
// Mês fechado não é recalculado.
const recalcularMes = db.transaction((mesId) => {
  const mes = db.prepare('SELECT * FROM meses WHERE id = ?').get(mesId);
  if (!mes) throw new Error('Mês não encontrado');
  if (mes.fechado) return;

  const lancs = db.prepare(`
    SELECT l.*, c.relogio, c.peso_luz
    FROM lancamentos l JOIN casas c ON c.id = l.casa_id
    WHERE l.mes_id = ?
  `).all(mesId);

  // Água por cabeça (só casas ocupadas).
  const moradoresTotal = lancs.reduce((s, l) => s + (l.vazia ? 0 : l.moradores), 0);
  const agua = ratear(mes.agua_total, lancs.filter((l) => !l.vazia), (l) => l.moradores);

  // Luz por relógio, dividida por peso entre casas ocupadas.
  const contas = db.prepare('SELECT * FROM contas_luz WHERE mes_id = ?').all(mesId);
  const luz = {};
  for (const conta of contas) {
    const doRelogio = lancs.filter((l) => !l.vazia && l.relogio === conta.relogio);
    Object.assign(luz, ratear(conta.valor_total, doRelogio, (l) => l.peso_luz));
  }

  const upd = db.prepare('UPDATE lancamentos SET agua_valor = ?, luz_valor = ? WHERE id = ?');
  for (const l of lancs) {
    upd.run(agua[l.id] || 0, luz[l.id] || 0, l.id);
    atualizarQuitado(l.id);
  }
});

/**
 * Divide `total` entre `itens` conforme o peso de cada um, arredondando a 2 casas.
 * A sobra do arredondamento (uns poucos centavos) vai para a maior parcela, para
 * que a soma do que os inquilinos pagam feche exatamente com o valor da conta —
 * senão faltariam centavos na hora de repassar para a concessionária.
 */
function ratear(total, itens, peso) {
  const out = {};
  const pesoTotal = itens.reduce((s, i) => s + (peso(i) || 0), 0);
  if (!(total > 0) || pesoTotal <= 0) {
    for (const i of itens) out[i.id] = 0;
    return out;
  }
  for (const i of itens) out[i.id] = round2((total / pesoTotal) * (peso(i) || 0));

  const sobra = round2(total - Object.values(out).reduce((s, v) => s + v, 0));
  if (sobra !== 0) {
    // maior parcela (empate: menor id) absorve a diferença
    const alvo = itens.slice().sort((a, b) => (out[b.id] - out[a.id]) || (a.id - b.id))[0];
    if (alvo) out[alvo.id] = round2(out[alvo.id] + sobra);
  }
  return out;
}

const ITENS = ['agua', 'luz', 'outros', 'aluguel'];

// O dono cobra o aluguel separado das contas: água, luz e "outros" andam juntos
// (é isso que vai nas mensagens de WhatsApp), o aluguel é combinado à parte.
const ITENS_CONTAS = ['agua', 'luz', 'outros'];

// true se a casa está vazia OU se todo item com valor > 0 está pago.
function totalmentePago(l) {
  if (l.vazia) return true;
  return ITENS.every((it) => !(l[`${it}_valor`] > 0) || !!l[`${it}_pago`]);
}

// Mantém quitado_em coerente: data em que ficou tudo pago; NULL se algo abriu.
function atualizarQuitado(lancId) {
  const l = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(lancId);
  if (!l) throw new Error('Lançamento não encontrado');
  const temCobranca = ITENS.some((it) => l[`${it}_valor`] > 0);
  if (!l.vazia && temCobranca && totalmentePago(l)) {
    if (!l.quitado_em) {
      db.prepare('UPDATE lancamentos SET quitado_em = ? WHERE id = ?').run(hojeISO(), lancId);
    }
  } else if (l.quitado_em) {
    db.prepare('UPDATE lancamentos SET quitado_em = NULL WHERE id = ?').run(lancId);
  }
}

// item: 'agua' | 'luz' | 'outros' | 'aluguel' | 'tudo'
const marcarPago = db.transaction((lancId, item, pago) => {
  if (item !== 'tudo' && !ITENS.includes(item)) throw new Error('Item inválido');
  const l = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(lancId);
  if (!l) throw new Error('Lançamento não encontrado');

  const hoje = hojeISO();
  const alvos = item === 'tudo' ? ITENS : [item];
  for (const it of alvos) {
    if (pago) {
      // "quitar tudo" não marca itens sem valor.
      if (item === 'tudo' && !(l[`${it}_valor`] > 0)) continue;
      db.prepare(`UPDATE lancamentos SET ${it}_pago = 1, ${it}_pago_em = COALESCE(${it}_pago_em, ?) WHERE id = ?`)
        .run(hoje, lancId);
    } else {
      db.prepare(`UPDATE lancamentos SET ${it}_pago = 0, ${it}_pago_em = NULL WHERE id = ?`)
        .run(lancId);
    }
  }
  atualizarQuitado(lancId);
});

/**
 * Aplica uma alteração do cadastro da casa nos lançamentos dos meses ABERTOS.
 *
 * Sem isso, mudar "moradores" (ou o inquilino, ou o aluguel padrão) em /casas
 * não tinha efeito nenhum no mês já criado: `garantirMes` usa INSERT OR IGNORE,
 * então o lançamento existente ficava com o número antigo e o rateio da água
 * continuava errado. Era exatamente o que acontecia com a casa 07.
 *
 * O que sincroniza, e por quê:
 *  - moradores / inquilino / vazia → sempre. São dados de cadastro; a tela do
 *    mês não permite editá-los por lançamento, logo não há ajuste manual a perder.
 *  - aluguel_valor → só se ainda estiver no valor padrão ANTIGO da casa e não
 *    estiver marcado como pago. Se estiver diferente, alguém ajustou o aluguel
 *    daquele mês na mão e esse ajuste tem prioridade.
 *
 * Mês fechado nunca é tocado — ele é a fotografia do histórico.
 */
const sincronizarCasa = db.transaction((casaAntiga, casaNova) => {
  const abertos = db.prepare('SELECT id FROM meses WHERE fechado = 0').all();
  if (!abertos.length) return 0;

  const vazia = !String(casaNova.inquilino || '').trim() || !casaNova.ativa ? 1 : 0;
  const padraoAntigo = round2(casaAntiga.aluguel);
  let tocados = 0;

  for (const mes of abertos) {
    const l = db.prepare('SELECT * FROM lancamentos WHERE mes_id = ? AND casa_id = ?')
      .get(mes.id, casaNova.id);
    if (!l) continue;

    const upd = {
      inquilino: casaNova.inquilino || '',
      vazia,
      moradores: casaNova.moradores,
    };

    if (vazia) {
      upd.aluguel_valor = 0;                                 // casa vaga não paga aluguel
    } else if (!l.aluguel_pago &&
               (round2(l.aluguel_valor) === padraoAntigo || round2(l.aluguel_valor) === 0)) {
      upd.aluguel_valor = round2(casaNova.aluguel);          // ainda no padrão → acompanha
    }

    const campos = Object.keys(upd);
    db.prepare(`UPDATE lancamentos SET ${campos.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...campos.map((k) => upd[k]), l.id);

    // garante a conta de luz do relógio novo, caso a casa tenha mudado de relógio
    db.prepare('INSERT OR IGNORE INTO contas_luz (mes_id, relogio) VALUES (?, ?)')
      .run(mes.id, casaNova.relogio);

    tocados += 1;
  }

  // rateio de água (moradores) e de luz (relógio/peso) muda junto
  for (const mes of abertos) recalcularMes(mes.id);

  return tocados;
});

// ── PAYLOAD DE MÊS (contrato da seção 4 da spec) ─────────────────

function carregarMes(ano, mes) {
  const m = garantirMes(ano, mes);
  recalcularMes(m.id);
  const mesRow = db.prepare('SELECT * FROM meses WHERE id = ?').get(m.id);

  const lancs = db.prepare(`
    SELECT l.*, c.numero, c.telefone, c.relogio, c.peso_luz, c.aluguel AS aluguel_padrao
    FROM lancamentos l JOIN casas c ON c.id = l.casa_id
    WHERE l.mes_id = ? ORDER BY c.numero
  `).all(m.id);
  const contasLuz = db.prepare('SELECT * FROM contas_luz WHERE mes_id = ? ORDER BY relogio').all(m.id);
  const envios = db.prepare(
    "SELECT casa_id, enviado_em FROM envios_wa WHERE mes_id = ? AND modelo = 'cobranca'").all(m.id);
  const enviadoPorCasa = Object.fromEntries(envios.map((e) => [e.casa_id, e.enviado_em]));

  const moradoresTotal = lancs.reduce((s, l) => s + (l.vazia ? 0 : l.moradores), 0);

  const relogios = contasLuz.map((conta) => {
    const doRelogio = lancs.filter((l) => l.relogio === conta.relogio);
    const ocupadas = doRelogio.filter((l) => !l.vazia);
    const pesoTotal = ocupadas.reduce((s, l) => s + l.peso_luz, 0);
    return {
      relogio: conta.relogio,
      nome: `Relógio ${conta.relogio}`,
      casas: doRelogio.map((l) => l.numero),
      casas_ocupadas: ocupadas.length,
      valor_total: round2(conta.valor_total),
      vencimento: conta.vencimento || null,
      peso_total: round2(pesoTotal),
      valor_por_peso: pesoTotal > 0 ? round2(conta.valor_total / pesoTotal) : 0,
    };
  });

  const casas = lancs.map((l) => {
    const totalMes = round2(l.agua_valor + l.luz_valor + l.outros_valor + l.aluguel_valor);
    const totalPago = round2(ITENS.reduce(
      (s, it) => s + (l[`${it}_pago`] ? l[`${it}_valor`] : 0), 0));
    // "contas" = agua + luz + outros (o que vai nas mensagens de WhatsApp).
    const contasValor = round2(l.agua_valor + l.luz_valor + l.outros_valor);
    const contasPago = round2(ITENS_CONTAS.reduce(
      (s, it) => s + (l[`${it}_pago`] ? l[`${it}_valor`] : 0), 0));
    return {
      lancamento_id: l.id,
      casa_id: l.casa_id,
      numero: l.numero,
      casa_str: String(l.numero).padStart(2, '0'),
      inquilino: l.inquilino || '',
      telefone: l.telefone || null,
      moradores: l.moradores,
      relogio: l.relogio,
      vazia: !!l.vazia,
      aluguel_padrao: round2(l.aluguel_padrao),
      agua_valor: round2(l.agua_valor),
      agua_pago: !!l.agua_pago,
      agua_pago_em: l.agua_pago_em || null,
      luz_valor: round2(l.luz_valor),
      luz_pago: !!l.luz_pago,
      luz_pago_em: l.luz_pago_em || null,
      outros_valor: round2(l.outros_valor),
      outros_descricao: l.outros_descricao || null,
      outros_pago: !!l.outros_pago,
      outros_pago_em: l.outros_pago_em || null,
      aluguel_valor: round2(l.aluguel_valor),
      aluguel_pago: !!l.aluguel_pago,
      aluguel_pago_em: l.aluguel_pago_em || null,
      total_mes: totalMes,
      total_pago: totalPago,
      total_aberto: round2(totalMes - totalPago),
      contas_valor: contasValor,
      contas_pago: contasPago,
      contas_aberto: round2(contasValor - contasPago),
      contas_quitadas: ITENS_CONTAS.every((it) => !(l[`${it}_valor`] > 0) || !!l[`${it}_pago`]),
      tudo_pago: totalmentePago(l),
      quitado_em: l.quitado_em || null,
      obs: l.obs || null,
      wa_enviado_em: enviadoPorCasa[l.casa_id] || null,
    };
  });

  const soma = (fn) => round2(casas.reduce((s, c) => s + fn(c), 0));
  const ocupadas = casas.filter((c) => !c.vazia);
  const pagas = ocupadas.filter((c) => c.tudo_pago);

  const totalRecebidoAluguel = soma((c) => (c.aluguel_pago ? c.aluguel_valor : 0));
  const bruto = round2(totalRecebidoAluguel * 0.5);
  const descontos = db.prepare(
    'SELECT id, destinatario, descricao, valor FROM descontos_pais WHERE mes_id = ? ORDER BY id').all(m.id);
  const descPai = round2(descontos.filter((d) => d.destinatario === 'pai')
    .reduce((s, d) => s + d.valor, 0));
  const descMae = round2(descontos.filter((d) => d.destinatario === 'mae')
    .reduce((s, d) => s + d.valor, 0));

  // "Contas" = agua + luz + outros. O aluguel e cobrado a parte (e nao entra
  // nas mensagens de WhatsApp), por isso os dois lados andam separados aqui.
  const contasCobrado = soma((c) => c.contas_valor);
  const contasRecebido = soma((c) => c.contas_pago);
  const aluguelCobrado = soma((c) => c.aluguel_valor);

  const totais = {
    agua_cobrado: soma((c) => c.agua_valor),
    luz_cobrado: soma((c) => c.luz_valor),
    outros_cobrado: soma((c) => c.outros_valor),
    aluguel_cobrado: aluguelCobrado,
    contas_cobrado: contasCobrado,
    contas_recebido: contasRecebido,
    contas_aberto: round2(contasCobrado - contasRecebido),
    aluguel_recebido: totalRecebidoAluguel,
    aluguel_aberto: round2(aluguelCobrado - totalRecebidoAluguel),
    total_cobrado: soma((c) => c.total_mes),
    total_recebido: soma((c) => c.total_pago),
    total_aberto: soma((c) => c.total_aberto),
    casas_ocupadas: ocupadas.length,
    casas_vagas: casas.length - ocupadas.length,
    casas_pagas: pagas.length,
    casas_devendo: ocupadas.length - pagas.length,
    repasse: {
      bruto_pai: bruto,
      bruto_mae: bruto,
      desconto_pai: descPai,
      desconto_mae: descMae,
      liquido_pai: round2(bruto - descPai),
      liquido_mae: round2(bruto - descMae),
    },
  };

  const pagamentosPais = db.prepare(
    'SELECT destinatario, pago, data_pagamento FROM pagamentos_pais WHERE mes_id = ? ORDER BY destinatario').all(m.id);

  return {
    mes: {
      id: mesRow.id,
      ano: mesRow.ano,
      mes: mesRow.mes,
      label: labelMes(mesRow.ano, mesRow.mes),
      agua_total: round2(mesRow.agua_total),
      agua_vencimento: mesRow.agua_vencimento || null,
      aluguel_vencimento: mesRow.aluguel_vencimento || null,
      observacoes: mesRow.observacoes || null,
      fechado: mesRow.fechado,
    },
    agua: {
      total: round2(mesRow.agua_total),
      moradores_total: moradoresTotal,
      valor_por_cabeca: moradoresTotal > 0 ? round2(mesRow.agua_total / moradoresTotal) : 0,
    },
    relogios,
    casas,
    totais,
    descontos,
    pagamentos_pais: pagamentosPais,
  };
}

module.exports = {
  INICIO_PERIODO,
  antesPeriodo,
  round2,
  hojeISO,
  nomeMes,
  labelMes,
  garantirMes,
  recalcularMes,
  totalmentePago,
  atualizarQuitado,
  marcarPago,
  sincronizarCasa,
  carregarMes,
};
