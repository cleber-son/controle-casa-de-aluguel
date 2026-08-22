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

function fraseRateio(ctx) {
  const m = ctx.moradores;
  const pessoas = m === 1 ? '1 morador' : `${m} moradores`;
  return `_Água dividida por pessoa (${pessoas} no mês) e luz dividida entre as casas do relógio ${ctx.relogio}._`;
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
  return `${cab}\n\n${linhas}\n\n💰 *TOTAL DAS CONTAS: ${moeda(totalAberto)}*\n\n${fraseRateio(ctx)}\n_O aluguel é combinado à parte._\nQualquer dúvida é só chamar 🙏`;
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
  textoRegras,
  normalizarTelefone,
  waUrl,
  // usado internamente pela API (mensagem de teste com casa real)
  ctxDaCasa,
};
