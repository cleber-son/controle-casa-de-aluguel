// modules/mensagens.js — textos prontos para WhatsApp (*negrito*, _itálico_).
//
// Regra central: item pago aparece como pago e NÃO entra no TOTAL;
// o TOTAL é sempre o que está em aberto.
//
// O aluguel NÃO entra nas mensagens (é cobrado à parte, ver INCLUIR_ALUGUEL).
// Por isso, no payload de /api/mensagens, `total_aberto` e `tudo_pago`
// significam "só as contas" — água, luz e outros.

const db = require('./db');
const calc = require('./calculo');

const MODELOS = ['cobranca', 'lembrete', 'recibo'];

// O aluguel é combinado/cobrado à parte das contas, então NÃO entra nas
// mensagens. Para voltar a incluí-lo, basta trocar esta constante para true.
const INCLUIR_ALUGUEL = false;

const ITENS_MSG = [
  { chave: 'agua',    emoji: '💧', nome: 'Água' },
  { chave: 'luz',     emoji: '💡', nome: 'Luz' },
  { chave: 'aluguel', emoji: '🏠', nome: 'Aluguel' },
  { chave: 'outros',  emoji: '📦', nome: 'Outros' },
];

function moeda(n) {
  const [int, dec] = calc.round2(n).toFixed(2).split('.');
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

function ddmm(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// '(11) 98765-4321' -> '5511987654321'; null se inválido.
function normalizarTelefone(tel) {
  if (tel == null) return null;
  const dig = String(tel).replace(/\D/g, '');
  if (!dig) return null;
  let n = dig;
  if (n.length === 10 || n.length === 11) n = `55${n}`; // DDD + número, sem país
  if ((n.length === 12 || n.length === 13) && n.startsWith('55')) return n;
  return null;
}

function waUrl(telefone, texto) {
  const tel = normalizarTelefone(telefone);
  const base = tel ? `https://wa.me/${tel}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(texto || '')}`;
}

// ── ctx de mensagem ──────────────────────────────────────────────
// {
//   casa_str, inquilino, label, moradores, relogio,
//   itens: {
//     agua:    { valor, pago, pago_em, vencimento, nome? },
//     luz:     { valor, pago, pago_em, vencimento },
//     aluguel: { valor, pago, pago_em, vencimento },
//     outros:  { valor, pago, pago_em, descricao }
//   }
// }

// Monta o ctx a partir de uma casa do payload de mês (seção 4).
function ctxDaCasa(casa, payload) {
  const relogio = (payload.relogios || []).find((r) => r.relogio === casa.relogio);
  return {
    casa_str: casa.casa_str,
    inquilino: casa.inquilino,
    label: payload.mes.label,
    moradores: casa.moradores,
    relogio: casa.relogio,
    itens: {
      agua: { valor: casa.agua_valor, pago: casa.agua_pago, pago_em: casa.agua_pago_em,
              vencimento: payload.mes.agua_vencimento },
      luz: { valor: casa.luz_valor, pago: casa.luz_pago, pago_em: casa.luz_pago_em,
             vencimento: relogio ? relogio.vencimento : null },
      aluguel: { valor: casa.aluguel_valor, pago: casa.aluguel_pago, pago_em: casa.aluguel_pago_em,
                 vencimento: payload.mes.aluguel_vencimento },
      outros: { valor: casa.outros_valor, pago: casa.outros_pago, pago_em: casa.outros_pago_em,
                descricao: casa.outros_descricao },
    },
  };
}

function itensDoCtx(ctx) {
  return ITENS_MSG
    .filter((def) => INCLUIR_ALUGUEL || def.chave !== 'aluguel')
    .map((def) => {
      const it = ctx.itens[def.chave] || {};
      const nome = def.chave === 'outros'
        ? (String(it.descricao || '').trim() || 'Outros')
        : def.nome;
      return {
        chave: def.chave,
        emoji: def.emoji,
        nome,
        valor: calc.round2(it.valor || 0),
        pago: !!it.pago,
        pago_em: it.pago_em || null,
        vencimento: it.vencimento || null,
      };
    })
    .filter((it) => it.valor > 0);
}

function linhaCobranca(it) {
  if (it.pago) return `✅ ${it.nome}: ${moeda(it.valor)} (pago)`;
  const venc = it.vencimento ? ` — vence ${ddmm(it.vencimento)}` : '';
  return `${it.emoji} ${it.nome}: *${moeda(it.valor)}*${venc}`;
}

function msgCobranca(ctx) {
  const itens = itensDoCtx(ctx);
  const cab = `🏠 *Casa ${ctx.casa_str} — ${ctx.inquilino}*\nContas de *${ctx.label}*`;
  if (!itens.length) {
    return `${cab}\n\nNenhuma conta lançada para este mês.\nQualquer dúvida é só chamar 🙏`;
  }
  const aberto = itens.filter((it) => !it.pago);
  const totalAberto = calc.round2(aberto.reduce((s, it) => s + it.valor, 0));
  const linhas = itens.map(linhaCobranca).join('\n');
  if (!aberto.length) {
    return `${cab}\n\n${linhas}\n\n🎉 *Tudo pago! Muito obrigado, ${ctx.inquilino}!* 🙏`;
  }
  return `${cab}\n\n${linhas}\n\n💰 *TOTAL DAS CONTAS: ${moeda(totalAberto)}*\n\nQualquer dúvida é só chamar 🙏`;
}

function msgLembrete(ctx) {
  const itens = itensDoCtx(ctx);
  const aberto = itens.filter((it) => !it.pago);
  const cab = `🔔 *Lembrete — Casa ${ctx.casa_str} (${ctx.inquilino})*\nContas de *${ctx.label}*`;
  if (!aberto.length) {
    return `${cab}\n\nTudo em dia por aqui, nada em aberto. Obrigado! 🙏`;
  }
  const totalAberto = calc.round2(aberto.reduce((s, it) => s + it.valor, 0));
  const linhas = aberto.map((it) => {
    const venc = it.vencimento ? ` — vence ${ddmm(it.vencimento)}` : '';
    return `${it.emoji} ${it.nome}: *${moeda(it.valor)}*${venc}`;
  }).join('\n');
  return `${cab}\n\n${linhas}\n\n💰 Em aberto: *${moeda(totalAberto)}*\n\nSe já pagou, pode ignorar esta mensagem 🙏`;
}

function msgRecibo(ctx) {
  const itens = itensDoCtx(ctx);
  const pagos = itens.filter((it) => it.pago);
  const cab = `🧾 *Recibo — Casa ${ctx.casa_str} — ${ctx.inquilino}*\n*${ctx.label}*`;
  if (!pagos.length) {
    return `${cab}\n\nNenhum pagamento registrado neste mês.`;
  }
  const totalPago = calc.round2(pagos.reduce((s, it) => s + it.valor, 0));
  const linhas = pagos.map((it) => {
    const data = it.pago_em ? ` — pago em ${ddmm(it.pago_em)}` : ' — pago';
    return `✅ ${it.nome}: ${moeda(it.valor)}${data}`;
  }).join('\n');
  const rodape = pagos.length === itens.length
    ? 'Mês quitado. Muito obrigado! 🙏'
    : 'Obrigado pelo pagamento! 🙏';
  return `${cab}\n\n${linhas}\n\n💰 Total pago: *${moeda(totalPago)}*\n\n${rodape}`;
}

function gerarMensagem(ctx, modelo) {
  if (!MODELOS.includes(modelo)) throw new Error('Modelo de mensagem inválido');
  if (modelo === 'lembrete') return msgLembrete(ctx);
  if (modelo === 'recibo') return msgRecibo(ctx);
  return msgCobranca(ctx);
}

// Payload de /api/mensagens/:ano/:mes (seção 4 da spec). Casas vazias omitidas.
function gerarMensagensDoMes(ano, mes, modelo) {
  if (!MODELOS.includes(modelo)) throw new Error('Modelo de mensagem inválido');
  const payload = calc.carregarMes(ano, mes);
  const envios = db.prepare(
    'SELECT casa_id, enviado_em FROM envios_wa WHERE mes_id = ? AND modelo = ?')
    .all(payload.mes.id, modelo);
  const enviadoPorCasa = Object.fromEntries(envios.map((e) => [e.casa_id, e.enviado_em]));

  const mensagens = payload.casas
    .filter((c) => !c.vazia)
    .map((c) => {
      const texto = gerarMensagem(ctxDaCasa(c, payload), modelo);
      const tel = normalizarTelefone(c.telefone);
      return {
        casa_id: c.casa_id,
        numero: c.numero,
        casa_str: c.casa_str,
        inquilino: c.inquilino,
        telefone: tel,
        tem_telefone: !!tel,
        texto,
        wa_url: waUrl(tel, texto),
        // aqui "aberto/pago" = só as contas (o aluguel não entra na mensagem)
        total_aberto: c.contas_aberto,
        tudo_pago: c.contas_quitadas,
        enviado_em: enviadoPorCasa[c.casa_id] || null,
      };
    });

  return {
    mes: {
      id: payload.mes.id,
      ano: payload.mes.ano,
      mes: payload.mes.mes,
      label: payload.mes.label,
    },
    modelo,
    mensagens,
    resumo: {
      qtd: mensagens.length,
      total_aberto: calc.round2(mensagens.reduce((s, m) => s + m.total_aberto, 0)),
      sem_telefone: mensagens.filter((m) => !m.tem_telefone).length,
      ja_enviados: mensagens.filter((m) => m.enviado_em).length,
    },
  };
}

// ── Repasse: mensagens do grupo da família ───────────────────────
//
// Quanto de aluguel entrou no mês, como ficou a divisão meio a meio e o que
// foi descontado de cada um. Só o aluguel EFETIVAMENTE PAGO entra na divisão
// — é dinheiro que existe.

function nomeDestinatario(d) {
  return d === 'pai' ? 'Pai' : 'Mãe';
}

// Dois modelos:
//   'prestacao'   → o relatório completo do mês (de onde saiu cada centavo).
//   'comprovante' → o texto curto que vai junto com o comprovante do PIX:
//                   mês de referência, quanto foi para cada um e os descontos.
const MODELOS_REPASSE = ['comprovante', 'prestacao'];

// Tudo o que os dois textos precisam, lido uma vez só.
function dadosRepasse(ano, mes) {
  const payload = calc.carregarMes(ano, mes);
  const t = payload.totais;
  const ocupadas = payload.casas.filter((c) => !c.vazia);
  const descontos = payload.descontos || [];
  const pagamentos = Object.fromEntries(
    (payload.pagamentos_pais || []).map((p) => [p.destinatario, p]));

  return {
    payload,
    t,
    r: t.repasse,
    label: payload.mes.label,
    recebido: t.aluguel_recebido,
    pagas: ocupadas.filter((c) => c.aluguel_pago && c.aluguel_valor > 0),
    devendo: ocupadas.filter((c) => !c.aluguel_pago && c.aluguel_valor > 0),
    descontos,
    pagamentos,
    totalRepasse: calc.round2(t.repasse.liquido_pai + t.repasse.liquido_mae),
  };
}

// Uma linha por casa que ainda não pagou — usada nos dois modelos.
function linhaEmAberto(x, curta) {
  if (!x.devendo.length) return null;
  const emAberto = calc.round2(x.devendo.reduce((s, c) => s + c.aluguel_valor, 0));
  if (curta) {
    const quais = x.devendo.map((c) => `Casa ${c.casa_str}`).join(', ');
    return `⏳ _Falta o aluguel de ${quais} (${moeda(emAberto)}) — entra no próximo repasse._`;
  }
  return emAberto;
}

// Texto curto para mandar no grupo junto com o comprovante do pagamento.
function msgRepasseComprovante(x) {
  const linhas = [];
  linhas.push('🏡 *REPASSE DO ALUGUEL*');
  linhas.push(`📅 Referente a *${x.label}*`);

  if (x.totalRepasse <= 0 && x.recebido <= 0) {
    linhas.push('');
    linhas.push('_Nenhum aluguel foi recebido neste mês ainda, então não há repasse._');
    const aberto = linhaEmAberto(x, true);
    if (aberto) { linhas.push(''); linhas.push(aberto); }
    return linhas.join('\n');
  }

  linhas.push('_Segue o comprovante em anexo_ 📎');
  linhas.push('');
  linhas.push(`💰 Aluguel recebido no mês: *${moeda(x.recebido)}*`);
  linhas.push(`➗ Metade para cada: ${moeda(x.r.bruto_pai)}`);

  for (const dest of ['pai', 'mae']) {
    const meus = x.descontos.filter((d) => d.destinatario === dest);
    const pg = x.pagamentos[dest];

    linhas.push('');
    linhas.push(`*${nomeDestinatario(dest).toUpperCase()}*`);
    if (meus.length) {
      for (const d of meus) linhas.push(`➖ ${d.descricao}: ${moeda(d.valor)}`);
      linhas.push(`_Descontos: ${moeda(x.r[`desconto_${dest}`])}_`);
    } else {
      linhas.push('_Sem descontos._');
    }
    const selo = pg && pg.pago && pg.data_pagamento ? ` ✅ _em ${ddmm(pg.data_pagamento)}_` : '';
    linhas.push(`👉 *Repassado: ${moeda(x.r[`liquido_${dest}`])}*${selo}`);
  }

  linhas.push('');
  linhas.push(`💸 *TOTAL REPASSADO: ${moeda(x.totalRepasse)}*`);

  const aberto = linhaEmAberto(x, true);
  if (aberto) { linhas.push(''); linhas.push(aberto); }

  linhas.push('');
  linhas.push('Qualquer dúvida é só chamar 🙏');
  return linhas.join('\n');
}

// Relatório completo: quanto entrou por casa, a divisão e os descontos.
function msgRepassePrestacao(x) {
  const linhas = [];
  linhas.push(`🏡 *QUINTAL — ${x.label}*`);
  linhas.push('_Prestação de contas do aluguel_');
  linhas.push('');

  // o que entrou
  if (!x.pagas.length) {
    linhas.push('💰 *Aluguel recebido: R$ 0,00*');
    linhas.push('_Nenhum aluguel pago até agora neste mês._');
  } else {
    linhas.push(`💰 *Aluguel recebido: ${moeda(x.recebido)}*`);
    for (const c of x.pagas) {
      linhas.push(`✅ Casa ${c.casa_str} — ${c.inquilino || 'sem nome'}: ${moeda(c.aluguel_valor)}`);
    }
  }

  const emAberto = linhaEmAberto(x, false);
  if (emAberto !== null) {
    linhas.push('');
    linhas.push(`⏳ *Ainda em aberto: ${moeda(emAberto)}*`);
    for (const c of x.devendo) {
      linhas.push(`• Casa ${c.casa_str} — ${c.inquilino || 'sem nome'}: ${moeda(c.aluguel_valor)}`);
    }
    linhas.push('_Entra na divisão assim que for pago._');
  }

  // divisão
  linhas.push('');
  linhas.push('➗ *Divisão (metade para cada)*');

  for (const dest of ['pai', 'mae']) {
    const meus = x.descontos.filter((d) => d.destinatario === dest);

    linhas.push('');
    linhas.push(`*${nomeDestinatario(dest)}*`);
    linhas.push(`Metade: ${moeda(x.r[`bruto_${dest}`])}`);
    if (meus.length) {
      for (const d of meus) linhas.push(`➖ ${d.descricao}: ${moeda(d.valor)}`);
      linhas.push(`_Descontos: ${moeda(x.r[`desconto_${dest}`])}_`);
    }
    const pg = x.pagamentos[dest];
    const selo = pg && pg.pago
      ? ` ✅ _pago${pg.data_pagamento ? ' em ' + ddmm(pg.data_pagamento) : ''}_`
      : '';
    linhas.push(`👉 *A receber: ${moeda(x.r[`liquido_${dest}`])}*${selo}`);
  }

  linhas.push('');
  linhas.push(`📊 _Total a repassar: ${moeda(x.totalRepasse)}_`);

  // contas do mês entram só como informação — não saem do aluguel
  linhas.push('');
  linhas.push(`_Água, luz e outros do mês (${moeda(x.t.contas_cobrado)}) são cobrados à parte dos inquilinos e não entram nesta divisão._`);

  return linhas.join('\n');
}

function gerarMensagemRepasse(ano, mes, modelo) {
  const qual = MODELOS_REPASSE.includes(modelo) ? modelo : 'prestacao';
  const x = dadosRepasse(ano, mes);
  const texto = qual === 'comprovante' ? msgRepasseComprovante(x) : msgRepassePrestacao(x);

  return {
    texto,
    modelo: qual,
    label: x.label,
    recebido: x.recebido,
    total_repasse: x.totalRepasse,
  };
}

// ── Cobrança consolidada por inquilino ───────────────────────────
//
// Junta TODOS os meses em que a casa ainda deve contas, num texto só.
// Lê direto dos lançamentos (valores já rateados), sem recalcular nada.
// Igual ao resto: o aluguel não entra (é cobrado à parte).

const ITENS_CONTAS_MSG = [
  { chave: 'agua',   emoji: '💧', nome: 'Água' },
  { chave: 'luz',    emoji: '💡', nome: 'Luz' },
  { chave: 'outros', emoji: '📦', nome: 'Outros' },
];

const ITEM_ALUGUEL_MSG = { chave: 'aluguel', emoji: '🔑', nome: 'Aluguel' };

// [{ ano, mes, label, itens:[{nome,valor}], subtotal, contas, aluguel }]
// — só meses com saldo. `comAluguel` decide se o aluguel entra na conta.
function mesesEmAberto(casaId, comAluguel) {
  const ini = calc.INICIO_PERIODO;
  const rows = db.prepare(`
    SELECT l.*, m.ano, m.mes
    FROM lancamentos l JOIN meses m ON m.id = l.mes_id
    WHERE l.casa_id = ? AND (m.ano * 100 + m.mes) >= ?
    ORDER BY m.ano, m.mes
  `).all(casaId, ini.ano * 100 + ini.mes);

  const defs = comAluguel ? ITENS_CONTAS_MSG.concat([ITEM_ALUGUEL_MSG]) : ITENS_CONTAS_MSG;

  const out = [];
  for (const l of rows) {
    if (l.vazia) continue;
    const itens = [];
    let contas = 0;
    let aluguel = 0;
    for (const def of defs) {
      const valor = calc.round2(l[`${def.chave}_valor`]);
      if (!(valor > 0) || l[`${def.chave}_pago`]) continue;
      const nome = def.chave === 'outros'
        ? (String(l.outros_descricao || '').trim() || 'Outros')
        : def.nome;
      itens.push({ chave: def.chave, emoji: def.emoji, nome, valor });
      if (def.chave === 'aluguel') aluguel += valor; else contas += valor;
    }
    if (!itens.length) continue;
    out.push({
      ano: l.ano,
      mes: l.mes,
      label: calc.labelMes(l.ano, l.mes),
      itens,
      contas: calc.round2(contas),
      aluguel: calc.round2(aluguel),
      subtotal: calc.round2(contas + aluguel),
    });
  }
  return out;
}

// Resumo de todas as casas, para montar a lista de seleção na tela.
function listarPendencias(opcoes) {
  const comAluguel = !opcoes || opcoes.comAluguel !== false;
  const casas = db.prepare('SELECT * FROM casas ORDER BY numero').all();
  const itens = casas.map((c) => {
    const meses = mesesEmAberto(c.id, comAluguel);
    const tel = normalizarTelefone(c.telefone);
    const msg = gerarMensagemPendencias(c.id, { comAluguel });
    return {
      casa_id: c.id,
      numero: c.numero,
      casa_str: String(c.numero).padStart(2, '0'),
      inquilino: c.inquilino || '',
      telefone: tel,
      tem_telefone: !!tel,
      qtd_meses: meses.length,
      meses: meses.map((m) => ({ label: m.label, valor: m.subtotal,
        contas: m.contas, aluguel: m.aluguel })),
      mes_mais_antigo: meses.length ? meses[0].label : null,
      total_aberto: calc.round2(meses.reduce((s, m) => s + m.subtotal, 0)),
      contas_aberto: calc.round2(meses.reduce((s, m) => s + m.contas, 0)),
      aluguel_aberto: calc.round2(meses.reduce((s, m) => s + m.aluguel, 0)),
      // texto já montado: a tela de devedores abre pronta, sem uma volta por casa
      texto: msg.texto,
      wa_url: waUrl(tel, msg.texto),
    };
  }).filter((c) => c.inquilino);

  const devedores = itens.filter((c) => c.total_aberto > 0)
    .sort((a, b) => b.total_aberto - a.total_aberto);
  const emDia = itens.filter((c) => c.total_aberto <= 0);

  return {
    casas: itens,
    devedores,
    em_dia: emDia,
    resumo: {
      devendo: devedores.length,
      em_dia: emDia.length,
      sem_telefone: devedores.filter((c) => !c.tem_telefone).length,
      total_aberto: calc.round2(devedores.reduce((s, c) => s + c.total_aberto, 0)),
      contas_aberto: calc.round2(devedores.reduce((s, c) => s + c.contas_aberto, 0)),
      aluguel_aberto: calc.round2(devedores.reduce((s, c) => s + c.aluguel_aberto, 0)),
      com_aluguel: comAluguel,
      pior_mes: devedores.reduce((acc, c) => acc || c.mes_mais_antigo, null),
    },
  };
}

function gerarMensagemPendencias(casaId, opcoes) {
  const comAluguel = !opcoes || opcoes.comAluguel !== false;
  const casa = db.prepare('SELECT * FROM casas WHERE id = ?').get(casaId);
  if (!casa) { const e = new Error('Casa não encontrada'); e.statusCode = 404; throw e; }

  const casaStr = String(casa.numero).padStart(2, '0');
  const nome = casa.inquilino || 'morador';
  const meses = mesesEmAberto(casa.id, comAluguel);
  const cab = `🏠 *Casa ${casaStr} — ${nome}*`;

  if (!meses.length) {
    return {
      texto: `${cab}\n\n✅ *Nenhuma conta em aberto.* Está tudo em dia por aqui — obrigado! 🙏`,
      total_aberto: 0,
      qtd_meses: 0,
    };
  }

  const total = calc.round2(meses.reduce((s, m) => s + m.subtotal, 0));
  const totalContas = calc.round2(meses.reduce((s, m) => s + m.contas, 0));
  const totalAluguel = calc.round2(meses.reduce((s, m) => s + m.aluguel, 0));

  const blocos = meses.map((m) => {
    const linhas = m.itens.map((i) => `${i.emoji} ${i.nome}: ${moeda(i.valor)}`).join('\n');
    const sub = m.itens.length > 1 ? `\n_subtotal: ${moeda(m.subtotal)}_` : '';
    return `📅 *${m.label}*\n${linhas}${sub}`;
  }).join('\n\n');

  const oQue = comAluguel ? 'Em aberto' : 'Contas em aberto';
  const intro = meses.length === 1 ? `${oQue}:` : `${oQue} (${meses.length} meses):`;

  // com aluguel na conta, vale repetir a quebra no fim — são cobranças separadas
  const quebra = (comAluguel && totalContas > 0 && totalAluguel > 0)
    ? `\n_Contas ${moeda(totalContas)} · Aluguel ${moeda(totalAluguel)}_`
    : '';

  return {
    texto: `${cab}\n${intro}\n\n${blocos}\n\n💰 *TOTAL EM ABERTO: ${moeda(total)}*${quebra}\n\nQualquer dúvida é só chamar 🙏`,
    total_aberto: total,
    contas_aberto: totalContas,
    aluguel_aberto: totalAluguel,
    qtd_meses: meses.length,
  };
}

const ICONE_CATEGORIA = {
  convivencia: '🤝',
  contas: '💰',
  limpeza: '🧹',
  seguranca: '🔒',
  animais: '🐾',
};

/**
 * Regras do quintal prontas para colar no WhatsApp.
 *
 * Formatação pensada para o app do WhatsApp: *negrito* no título de cada regra,
 * numeração contínua, linha em branco entre as regras (senão o app cola tudo
 * num parágrafo só) e um rodapé curto. Sem markdown que o WhatsApp não entenda.
 */
function textoRegras() {
  const regras = db.prepare('SELECT * FROM regras WHERE ativa = 1 ORDER BY ordem, id').all();
  if (!regras.length) {
    return '📋 *REGRAS DO QUINTAL*\n\n_Nenhuma regra cadastrada ainda._';
  }
  const corpo = regras
    .map((r, i) => {
      const ico = ICONE_CATEGORIA[r.categoria] || '📌';
      return `${ico} *${i + 1}. ${r.titulo}*\n${r.texto}`;
    })
    .join('\n\n');
  return [
    '📋 *REGRAS DO QUINTAL* 🏡',
    '',
    '_As combinações da casa, pra todo mundo viver bem aqui._',
    '',
    corpo,
    '',
    '— — —',
    '_Qualquer dúvida ou situação diferente, é só chamar que a gente combina._ 🙏',
  ].join('\n');
}

module.exports = {
  MODELOS,
  gerarMensagem,
  gerarMensagensDoMes,
  listarPendencias,
  gerarMensagemPendencias,
  MODELOS_REPASSE,
  gerarMensagemRepasse,
  textoRegras,
  normalizarTelefone,
  waUrl,
  // usado internamente pela API (mensagem de teste com casa real)
  ctxDaCasa,
};
