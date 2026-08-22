// modules/api.js — router da API (/api). JSON, sessão obrigatória.
// Convenção de erro: HTTP 4xx/5xx + { ok:false, erro:'mensagem em português' }.

const express = require('express');
const db = require('./db');
const calc = require('./calculo');
const msgs = require('./mensagens');
const { requireAuth } = require('./auth');
const { error: logError } = require('./logger');

const router = express.Router();
router.use(express.json());
router.use(requireAuth);

// ── helpers ──────────────────────────────────────────────────────

function falha(res, code, erro) {
  return res.status(code).json({ ok: false, erro });
}

// wrapper: erros lançados viram resposta 400/500 em português
function h(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (e) {
      logError('api:', e.message);
      falha(res, e.statusCode || 400, e.message || 'Erro interno');
    }
  };
}

function toNum(v) {
  if (v === '' || v == null) return NaN;
  return Number(v);
}

function toInt(v) {
  const n = toNum(v);
  return Number.isInteger(n) ? n : NaN;
}

function dataISOouNull(v, campo) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new Error(`Data inválida em ${campo} (use AAAA-MM-DD)`);
  }
  return v;
}

function valorOuErro(v, campo, { min = 0 } = {}) {
  const n = toNum(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`Valor inválido em ${campo}`);
  return calc.round2(n);
}

function boolOuErro(v, campo) {
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return !!v;
  throw new Error(`Valor inválido em ${campo} (esperado true/false)`);
}

function anoMesDaRota(req) {
  const ano = toInt(req.params.ano);
  const mes = toInt(req.params.mes);
  if (Number.isNaN(ano) || Number.isNaN(mes) || mes < 1 || mes > 12) {
    throw new Error('Mês inválido');
  }
  return { ano, mes };
}

function mesPorId(id) {
  const m = db.prepare('SELECT * FROM meses WHERE id = ?').get(toInt(id));
  if (!m) { const e = new Error('Mês não encontrado'); e.statusCode = 404; throw e; }
  return m;
}

function exigirAberto(m) {
  if (m.fechado) throw new Error('Mês fechado — reabra o mês para alterar');
}

function mesCompleto(mesId) {
  const m = mesPorId(mesId);
  return calc.carregarMes(m.ano, m.mes);
}

// mês corrente do relógio (fuso do app), nunca antes do início do período
function mesAtualClock() {
  const hoje = calc.hojeISO();
  let ano = Number(hoje.slice(0, 4));
  let mes = Number(hoje.slice(5, 7));
  if (calc.antesPeriodo(ano, mes)) ({ ano, mes } = calc.INICIO_PERIODO);
  return { ano, mes };
}

// ── Bootstrap ────────────────────────────────────────────────────

router.get('/bootstrap', h((req, res) => {
  const ini = calc.INICIO_PERIODO;
  const meses = db.prepare(`
    SELECT ano, mes, fechado FROM meses
    WHERE (ano * 100 + mes) >= ? ORDER BY ano, mes
  `).all(ini.ano * 100 + ini.mes)
    .map((m) => ({ ano: m.ano, mes: m.mes, label: calc.labelMes(m.ano, m.mes), fechado: m.fechado }));
  const casas = db.prepare('SELECT * FROM casas ORDER BY numero').all();
  res.json({
    hoje: calc.hojeISO(),
    inicio: { ano: ini.ano, mes: ini.mes },
    mes_atual: mesAtualClock(),
    meses,
    casas,
  });
}));

// ── Casas ────────────────────────────────────────────────────────

const CAMPOS_CASA = ['numero', 'inquilino', 'inquilino_desde', 'telefone', 'aluguel',
  'moradores', 'relogio', 'peso_luz', 'ativa', 'observacoes'];

function validarCamposCasa(b, { exigirNumero = false } = {}) {
  const out = {};
  if (exigirNumero || b.numero !== undefined) {
    const n = toInt(b.numero);
    if (Number.isNaN(n) || n < 1) throw new Error('Número da casa inválido');
    out.numero = n;
  }
  if (b.inquilino !== undefined) out.inquilino = String(b.inquilino || '').trim();
  if (b.inquilino_desde !== undefined) {
    const v = String(b.inquilino_desde || '').trim();
    if (!v) {
      out.inquilino_desde = null;
    } else if (/^\d{4}-\d{2}$/.test(v) && Number(v.slice(5, 7)) >= 1 && Number(v.slice(5, 7)) <= 12) {
      out.inquilino_desde = v;
    } else {
      throw new Error('Mês de entrada inválido (use AAAA-MM)');
    }
  }
  if (b.telefone !== undefined) {
    const dig = String(b.telefone || '').replace(/\D/g, '');
    out.telefone = dig || null;
  }
  if (b.aluguel !== undefined) out.aluguel = valorOuErro(b.aluguel, 'aluguel');
  if (b.moradores !== undefined) {
    const n = toInt(b.moradores);
    if (Number.isNaN(n) || n < 0) throw new Error('Número de moradores inválido');
    out.moradores = n;
  }
  if (b.relogio !== undefined) {
    const n = toInt(b.relogio);
    if (Number.isNaN(n) || n < 1) throw new Error('Relógio inválido');
    out.relogio = n;
  }
  if (b.peso_luz !== undefined) {
    const n = toNum(b.peso_luz);
    if (!Number.isFinite(n) || n < 0) throw new Error('Peso da luz inválido');
    out.peso_luz = n;
  }
  if (b.ativa !== undefined) out.ativa = boolOuErro(b.ativa, 'ativa') ? 1 : 0;
  if (b.observacoes !== undefined) out.observacoes = String(b.observacoes || '').trim() || null;
  return out;
}

router.get('/casas', h((req, res) => {
  res.json(db.prepare('SELECT * FROM casas ORDER BY numero').all());
}));

router.post('/casas', h((req, res) => {
  const c = validarCamposCasa(req.body || {}, { exigirNumero: true });
  const jaExiste = db.prepare('SELECT id FROM casas WHERE numero = ?').get(c.numero);
  if (jaExiste) throw new Error(`Já existe uma casa com o número ${c.numero}`);
  const info = db.prepare(`
    INSERT INTO casas (numero, inquilino, inquilino_desde, telefone, aluguel, moradores, relogio, peso_luz, ativa, observacoes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(c.numero, c.inquilino ?? '', c.inquilino_desde ?? null, c.telefone ?? null, c.aluguel ?? 0,
    c.moradores ?? 1, c.relogio ?? 1, c.peso_luz ?? 1, c.ativa ?? 1, c.observacoes ?? null);
  res.json({ ok: true, id: info.lastInsertRowid });
}));

router.put('/casas/:id', h((req, res) => {
  const id = toInt(req.params.id);
  const casa = db.prepare('SELECT * FROM casas WHERE id = ?').get(id);
  if (!casa) return falha(res, 404, 'Casa não encontrada');
  const c = validarCamposCasa(req.body || {});
  const campos = Object.keys(c).filter((k) => CAMPOS_CASA.includes(k));
  if (!campos.length) throw new Error('Nada para atualizar');
  if (c.numero !== undefined && c.numero !== casa.numero) {
    const outra = db.prepare('SELECT id FROM casas WHERE numero = ? AND id != ?').get(c.numero, id);
    if (outra) throw new Error(`Já existe uma casa com o número ${c.numero}`);
  }
  const set = campos.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE casas SET ${set} WHERE id = ?`).run(...campos.map((k) => c[k]), id);

  // Reflete a mudança nos meses ainda abertos: sem isso, alterar moradores
  // (ou inquilino/aluguel/relógio) aqui não mexia no mês já criado.
  const RELEVANTES = ['inquilino', 'inquilino_desde', 'moradores', 'aluguel', 'relogio',
    'peso_luz', 'ativa'];
  const mudou = RELEVANTES.some((k) => c[k] !== undefined && c[k] !== casa[k]);
  let mesesSincronizados = 0;
  if (mudou) {
    const atualizada = db.prepare('SELECT * FROM casas WHERE id = ?').get(id);
    mesesSincronizados = calc.sincronizarCasa(casa, atualizada);
  }
  res.json({ ok: true, meses_sincronizados: mesesSincronizados });
}));

router.delete('/casas/:id', h((req, res) => {
  const id = toInt(req.params.id);
  const casa = db.prepare('SELECT * FROM casas WHERE id = ?').get(id);
  if (!casa) return falha(res, 404, 'Casa não encontrada');
  const temLanc = db.prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE casa_id = ?').get(id).n;
  if (temLanc > 0) {
    db.prepare('UPDATE casas SET ativa = 0 WHERE id = ?').run(id);
    return res.json({ ok: true, desativada: true });
  }
  db.prepare('DELETE FROM envios_wa WHERE casa_id = ?').run(id);
  db.prepare('DELETE FROM casas WHERE id = ?').run(id);
  res.json({ ok: true, removida: true });
}));

// ── Mês ──────────────────────────────────────────────────────────

router.get('/mes/:ano/:mes', h((req, res) => {
  const { ano, mes } = anoMesDaRota(req);
  res.json(calc.carregarMes(ano, mes));
}));

router.put('/mes/:id', h((req, res) => {
  const m = mesPorId(req.params.id);
  exigirAberto(m);
  const b = req.body || {};

  const upd = {};
  if (b.agua_total !== undefined) upd.agua_total = valorOuErro(b.agua_total, 'água (total)');
  if (b.agua_vencimento !== undefined) upd.agua_vencimento = dataISOouNull(b.agua_vencimento, 'vencimento da água');
  if (b.aluguel_vencimento !== undefined) upd.aluguel_vencimento = dataISOouNull(b.aluguel_vencimento, 'vencimento do aluguel');
  if (b.observacoes !== undefined) upd.observacoes = String(b.observacoes || '').trim() || null;

  let relogios = [];
  if (b.relogios !== undefined) {
    if (!Array.isArray(b.relogios)) throw new Error('Formato inválido em relógios');
    relogios = b.relogios.map((r) => {
      const num = toInt(r.relogio);
      if (Number.isNaN(num) || num < 1) throw new Error('Relógio inválido');
      return {
        relogio: num,
        valor_total: r.valor_total !== undefined ? valorOuErro(r.valor_total, `luz do relógio ${num}`) : undefined,
        vencimento: r.vencimento !== undefined ? dataISOouNull(r.vencimento, `vencimento da luz do relógio ${num}`) : undefined,
      };
    });
  }

  const tx = db.transaction(() => {
    const campos = Object.keys(upd);
    if (campos.length) {
      const set = campos.map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE meses SET ${set} WHERE id = ?`).run(...campos.map((k) => upd[k]), m.id);
    }
    for (const r of relogios) {
      db.prepare('INSERT OR IGNORE INTO contas_luz (mes_id, relogio) VALUES (?, ?)').run(m.id, r.relogio);
      if (r.valor_total !== undefined) {
        db.prepare('UPDATE contas_luz SET valor_total = ? WHERE mes_id = ? AND relogio = ?')
          .run(r.valor_total, m.id, r.relogio);
      }
      if (r.vencimento !== undefined) {
        db.prepare('UPDATE contas_luz SET vencimento = ? WHERE mes_id = ? AND relogio = ?')
          .run(r.vencimento, m.id, r.relogio);
      }
    }
  });
  tx();

  calc.recalcularMes(m.id);
  res.json({ ok: true, mes_completo: mesCompleto(m.id) });
}));

router.put('/lancamento/:id', h((req, res) => {
  const id = toInt(req.params.id);
  const lanc = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(id);
  if (!lanc) return falha(res, 404, 'Lançamento não encontrado');
  const m = mesPorId(lanc.mes_id);
  exigirAberto(m);
  const b = req.body || {};

  const upd = {};
  if (b.inquilino !== undefined) upd.inquilino = String(b.inquilino || '').trim();
  if (b.vazia !== undefined) upd.vazia = boolOuErro(b.vazia, 'vazia') ? 1 : 0;
  if (b.moradores !== undefined) {
    const n = toInt(b.moradores);
    if (Number.isNaN(n) || n < 0) throw new Error('Número de moradores inválido');
    upd.moradores = n;
  }
  if (b.outros_valor !== undefined) upd.outros_valor = valorOuErro(b.outros_valor, 'outros');
  if (b.outros_descricao !== undefined) upd.outros_descricao = String(b.outros_descricao || '').trim() || null;
  if (b.aluguel_valor !== undefined) upd.aluguel_valor = valorOuErro(b.aluguel_valor, 'aluguel');
  if (b.obs !== undefined) upd.obs = String(b.obs || '').trim() || null;

  // casa vazia não paga aluguel
  if (upd.vazia === 1) upd.aluguel_valor = 0;

  const campos = Object.keys(upd);
  if (!campos.length) throw new Error('Nada para atualizar');
  const set = campos.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE lancamentos SET ${set} WHERE id = ?`).run(...campos.map((k) => upd[k]), id);

  calc.recalcularMes(m.id); // rateio de água/luz pode ter mudado
  calc.atualizarQuitado(id);
  res.json({ ok: true, mes_completo: mesCompleto(m.id) });
}));

router.put('/lancamento/:id/pago', h((req, res) => {
  const id = toInt(req.params.id);
  const lanc = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(id);
  if (!lanc) return falha(res, 404, 'Lançamento não encontrado');
  const m = mesPorId(lanc.mes_id);
  exigirAberto(m);
  const b = req.body || {};
  const itensValidos = ['agua', 'luz', 'outros', 'aluguel', 'contas', 'tudo'];
  if (!itensValidos.includes(b.item)) {
    throw new Error('Item inválido (use agua, luz, outros, aluguel, contas ou tudo)');
  }
  const pago = boolOuErro(b.pago, 'pago');
  calc.marcarPago(id, b.item, pago);
  res.json({ ok: true, mes_completo: mesCompleto(m.id) });
}));

router.post('/mes/:id/limpar', h((req, res) => {
  const m = mesPorId(req.params.id);
  exigirAberto(m);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE meses SET agua_total = 0, agua_vencimento = NULL,
      aluguel_vencimento = NULL WHERE id = ?`).run(m.id);
    db.prepare('UPDATE contas_luz SET valor_total = 0, vencimento = NULL WHERE mes_id = ?').run(m.id);
    // mantém inquilino, vazia, moradores e aluguel_valor
    db.prepare(`UPDATE lancamentos SET
      agua_valor = 0, agua_pago = 0, agua_pago_em = NULL,
      luz_valor = 0, luz_pago = 0, luz_pago_em = NULL,
      outros_valor = 0, outros_descricao = NULL, outros_pago = 0, outros_pago_em = NULL,
      aluguel_pago = 0, aluguel_pago_em = NULL,
      quitado_em = NULL
      WHERE mes_id = ?`).run(m.id);
    db.prepare('DELETE FROM descontos_pais WHERE mes_id = ?').run(m.id);
    db.prepare('DELETE FROM pagamentos_pais WHERE mes_id = ?').run(m.id);
  });
  tx();
  res.json({ ok: true, mes_completo: mesCompleto(m.id) });
}));

router.put('/mes/:id/fechar', h((req, res) => {
  const m = mesPorId(req.params.id);
  const fechado = boolOuErro((req.body || {}).fechado, 'fechado') ? 1 : 0;
  db.prepare('UPDATE meses SET fechado = ? WHERE id = ?').run(fechado, m.id);
  res.json({ ok: true, mes_completo: mesCompleto(m.id) });
}));

// ── Mensagens de WhatsApp ────────────────────────────────────────

function modeloOuErro(v) {
  const modelo = v || 'cobranca';
  if (!msgs.MODELOS.includes(modelo)) throw new Error('Modelo de mensagem inválido');
  return modelo;
}

router.get('/mensagens/:ano/:mes', h((req, res) => {
  const { ano, mes } = anoMesDaRota(req);
  const modelo = modeloOuErro(req.query.modelo);
  res.json(msgs.gerarMensagensDoMes(ano, mes, modelo));
}));

router.post('/mensagens/:ano/:mes/marcar-enviado', h((req, res) => {
  const { ano, mes } = anoMesDaRota(req);
  const b = req.body || {};
  const modelo = modeloOuErro(b.modelo);
  if (!Array.isArray(b.casa_ids) || !b.casa_ids.length) {
    throw new Error('Informe as casas (casa_ids)');
  }
  const casaIds = b.casa_ids.map((v) => {
    const n = toInt(v);
    if (Number.isNaN(n)) throw new Error('Casa inválida em casa_ids');
    return n;
  });
  const mesRow = calc.garantirMes(ano, mes);
  const agora = new Date().toISOString();
  const up = db.prepare(`
    INSERT INTO envios_wa (mes_id, casa_id, enviado_em, modelo) VALUES (?, ?, ?, ?)
    ON CONFLICT(mes_id, casa_id, modelo) DO UPDATE SET enviado_em = excluded.enviado_em
  `);
  const tx = db.transaction(() => {
    for (const casaId of casaIds) {
      const casa = db.prepare('SELECT id FROM casas WHERE id = ?').get(casaId);
      if (!casa) throw new Error(`Casa ${casaId} não encontrada`);
      up.run(mesRow.id, casaId, agora, modelo);
    }
  });
  tx();
  res.json({ ok: true, enviados: casaIds.length });
}));

router.post('/mensagens/teste', h((req, res) => {
  const b = req.body || {};
  const ano = toInt(b.ano);
  const mes = toInt(b.mes);
  if (Number.isNaN(ano) || Number.isNaN(mes) || mes < 1 || mes > 12) throw new Error('Mês inválido');
  const modelo = modeloOuErro(b.modelo);

  let telefoneNormalizado = null;
  if (b.telefone !== undefined && b.telefone !== null && String(b.telefone).trim() !== '') {
    telefoneNormalizado = msgs.normalizarTelefone(b.telefone);
    if (!telefoneNormalizado) throw new Error('Telefone inválido');
  }

  let texto;
  if (b.casa_id !== undefined && b.casa_id !== null) {
    const payload = calc.carregarMes(ano, mes);
    const casa = payload.casas.find((c) => c.casa_id === toInt(b.casa_id));
    if (!casa) return falha(res, 404, 'Casa não encontrada no mês');
    if (casa.vazia) throw new Error('Casa vaga não gera mensagem');
    if (!telefoneNormalizado) telefoneNormalizado = msgs.normalizarTelefone(casa.telefone);
    texto = msgs.gerarMensagem(msgs.ctxDaCasa(casa, payload), modelo);
  } else {
    // casa fictícia de exemplo — nunca grava nada
    const ctx = {
      casa_str: '00',
      inquilino: 'Teste',
      label: calc.labelMes(ano, mes),
      moradores: 1,
      relogio: 1,
      itens: {
        agua: { valor: 45.9, pago: false, pago_em: null, vencimento: null },
        luz: { valor: 78.3, pago: false, pago_em: null, vencimento: null },
        aluguel: { valor: 350, pago: false, pago_em: null, vencimento: null },
        outros: { valor: 0, pago: false, pago_em: null, descricao: null },
      },
    };
    texto = msgs.gerarMensagem(ctx, modelo);
  }

  res.json({
    ok: true,
    texto,
    wa_url: msgs.waUrl(telefoneNormalizado, texto),
    telefone_normalizado: telefoneNormalizado,
  });
}));

// ── Cobrança consolidada por inquilino ───────────────────────────

router.get('/pendencias', h((req, res) => {
  res.json(msgs.listarPendencias());
}));

router.get('/pendencias/:casa_id', h((req, res) => {
  const casaId = toInt(req.params.casa_id);
  if (Number.isNaN(casaId)) throw new Error('Casa inválida');
  const casa = db.prepare('SELECT * FROM casas WHERE id = ?').get(casaId);
  if (!casa) return falha(res, 404, 'Casa não encontrada');
  const m = msgs.gerarMensagemPendencias(casaId);
  const tel = msgs.normalizarTelefone(casa.telefone);
  res.json({
    casa_id: casa.id,
    numero: casa.numero,
    casa_str: String(casa.numero).padStart(2, '0'),
    inquilino: casa.inquilino || '',
    telefone: tel,
    tem_telefone: !!tel,
    texto: m.texto,
    total_aberto: m.total_aberto,
    qtd_meses: m.qtd_meses,
    wa_url: msgs.waUrl(tel, m.texto),
  });
}));

// ── Histórico ────────────────────────────────────────────────────

function resumoDoMes(mesRow) {
  const lancs = db.prepare('SELECT * FROM lancamentos WHERE mes_id = ?').all(mesRow.id);
  const luzTotal = db.prepare(
    'SELECT COALESCE(SUM(valor_total), 0) AS s FROM contas_luz WHERE mes_id = ?').get(mesRow.id).s;
  const itens = ['agua', 'luz', 'outros', 'aluguel'];
  const CONTAS = ['agua', 'luz', 'outros'];
  let cobrado = 0; let recebido = 0;
  let contasCobrado = 0; let contasRecebido = 0;
  let aluguelCobrado = 0; let aluguelRecebido = 0;
  const porItem = { agua: 0, luz: 0, outros: 0, aluguel: 0 };
  let ocupadas = 0; let pagas = 0;
  for (const l of lancs) {
    for (const it of itens) {
      const v = l[`${it}_valor`];
      const p = l[`${it}_pago`] ? v : 0;
      cobrado += v;
      recebido += p;
      porItem[it] += v;
      if (CONTAS.includes(it)) { contasCobrado += v; contasRecebido += p; }
      else { aluguelCobrado += v; aluguelRecebido += p; }
    }
    if (!l.vazia) {
      ocupadas += 1;
      if (calc.totalmentePago(l)) pagas += 1;
    }
  }
  return {
    mes_id: mesRow.id,
    ano: mesRow.ano,
    mes: mesRow.mes,
    label: calc.labelMes(mesRow.ano, mesRow.mes),
    agua_total: calc.round2(mesRow.agua_total),
    luz_total: calc.round2(luzTotal),
    agua_cobrado: calc.round2(porItem.agua),
    luz_cobrado: calc.round2(porItem.luz),
    outros_cobrado: calc.round2(porItem.outros),
    aluguel_cobrado: calc.round2(porItem.aluguel),
    contas_cobrado: calc.round2(contasCobrado),
    contas_recebido: calc.round2(contasRecebido),
    contas_aberto: calc.round2(contasCobrado - contasRecebido),
    aluguel_recebido: calc.round2(aluguelRecebido),
    aluguel_aberto: calc.round2(aluguelCobrado - aluguelRecebido),
    total_cobrado: calc.round2(cobrado),
    total_recebido: calc.round2(recebido),
    total_aberto: calc.round2(cobrado - recebido),
    casas_ocupadas: ocupadas,
    casas_pagas: pagas,
    casas_devendo: ocupadas - pagas,
    fechado: mesRow.fechado,
  };
}

router.get('/historico', h((req, res) => {
  const ini = calc.INICIO_PERIODO;
  const mesesRows = db.prepare(`
    SELECT * FROM meses WHERE (ano * 100 + mes) >= ? ORDER BY ano, mes
  `).all(ini.ano * 100 + ini.mes);
  const meses = mesesRows.map(resumoDoMes);
  res.json({
    meses,
    totais: {
      total_cobrado: calc.round2(meses.reduce((s, m) => s + m.total_cobrado, 0)),
      total_recebido: calc.round2(meses.reduce((s, m) => s + m.total_recebido, 0)),
      total_aberto: calc.round2(meses.reduce((s, m) => s + m.total_aberto, 0)),
    },
  });
}));

router.get('/historico/casa/:numero', h((req, res) => {
  const numero = toInt(req.params.numero);
  const casa = db.prepare('SELECT * FROM casas WHERE numero = ?').get(numero);
  if (!casa) return falha(res, 404, 'Casa não encontrada');
  const ini = calc.INICIO_PERIODO;
  const rows = db.prepare(`
    SELECT l.*, m.ano, m.mes FROM lancamentos l
    JOIN meses m ON m.id = l.mes_id
    WHERE l.casa_id = ? AND (m.ano * 100 + m.mes) >= ?
    ORDER BY m.ano, m.mes
  `).all(casa.id, ini.ano * 100 + ini.mes);
  const itensNomes = ['agua', 'luz', 'outros', 'aluguel'];
  let cobrado = 0; let recebido = 0;
  const itens = rows.map((l) => {
    let totalMes = 0; let totalPago = 0;
    for (const it of itensNomes) {
      totalMes += l[`${it}_valor`];
      if (l[`${it}_pago`]) totalPago += l[`${it}_valor`];
    }
    cobrado += totalMes;
    recebido += totalPago;
    return {
      ano: l.ano,
      mes: l.mes,
      label: calc.labelMes(l.ano, l.mes),
      agua_valor: calc.round2(l.agua_valor),
      luz_valor: calc.round2(l.luz_valor),
      outros_valor: calc.round2(l.outros_valor),
      aluguel_valor: calc.round2(l.aluguel_valor),
      total_mes: calc.round2(totalMes),
      total_aberto: calc.round2(totalMes - totalPago),
      tudo_pago: calc.totalmentePago(l),
      quitado_em: l.quitado_em || null,
    };
  });
  res.json({
    casa,
    itens,
    totais: {
      cobrado: calc.round2(cobrado),
      recebido: calc.round2(recebido),
      aberto: calc.round2(cobrado - recebido),
    },
  });
}));

// ── Repasse pai/mãe ──────────────────────────────────────────────

function destinatarioOuErro(v) {
  if (v !== 'pai' && v !== 'mae') throw new Error("Destinatário inválido (use 'pai' ou 'mae')");
  return v;
}

router.post('/desconto', h((req, res) => {
  const b = req.body || {};
  const m = mesPorId(b.mes_id);
  const destinatario = destinatarioOuErro(b.destinatario);
  const descricao = String(b.descricao || '').trim();
  if (!descricao) throw new Error('Informe a descrição do desconto');
  const valor = valorOuErro(b.valor, 'valor do desconto');
  db.prepare('INSERT INTO descontos_pais (mes_id, destinatario, descricao, valor) VALUES (?, ?, ?, ?)')
    .run(m.id, destinatario, descricao, valor);
  res.json({ ok: true, mes_completo: mesCompleto(m.id) });
}));

router.delete('/desconto/:id', h((req, res) => {
  const id = toInt(req.params.id);
  const d = db.prepare('SELECT * FROM descontos_pais WHERE id = ?').get(id);
  if (!d) return falha(res, 404, 'Desconto não encontrado');
  db.prepare('DELETE FROM descontos_pais WHERE id = ?').run(id);
  res.json({ ok: true, mes_completo: mesCompleto(d.mes_id) });
}));

router.put('/pagamento-pai', h((req, res) => {
  const b = req.body || {};
  const m = mesPorId(b.mes_id);
  const destinatario = destinatarioOuErro(b.destinatario);
  const pago = boolOuErro(b.pago, 'pago') ? 1 : 0;
  const data = pago ? calc.hojeISO() : null;
  db.prepare(`
    INSERT INTO pagamentos_pais (mes_id, destinatario, pago, data_pagamento) VALUES (?, ?, ?, ?)
    ON CONFLICT(mes_id, destinatario) DO UPDATE SET pago = excluded.pago, data_pagamento = excluded.data_pagamento
  `).run(m.id, destinatario, pago, data);
  res.json({ ok: true, mes_completo: mesCompleto(m.id) });
}));

// ── Regras ───────────────────────────────────────────────────────

router.get('/regras', h((req, res) => {
  res.json({ regras: db.prepare('SELECT * FROM regras ORDER BY ordem, id').all() });
}));

router.get('/regras/texto', h((req, res) => {
  res.json({ texto: msgs.textoRegras() });
}));

router.post('/regras', h((req, res) => {
  const b = req.body || {};
  const titulo = String(b.titulo || '').trim();
  const texto = String(b.texto || '').trim();
  if (!titulo) throw new Error('Informe o título da regra');
  if (!texto) throw new Error('Informe o texto da regra');
  const categoria = String(b.categoria || '').trim() || 'convivencia';
  const ordem = (db.prepare('SELECT COALESCE(MAX(ordem), 0) AS m FROM regras').get().m) + 1;
  const info = db.prepare('INSERT INTO regras (ordem, categoria, titulo, texto) VALUES (?, ?, ?, ?)')
    .run(ordem, categoria, titulo, texto);
  res.json({ ok: true, id: info.lastInsertRowid });
}));

router.post('/regras/reordenar', h((req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || !ids.length) throw new Error('Informe a nova ordem (ids)');
  const upd = db.prepare('UPDATE regras SET ordem = ? WHERE id = ?');
  const tx = db.transaction(() => {
    ids.forEach((id, i) => {
      const n = toInt(id);
      if (Number.isNaN(n)) throw new Error('Id inválido em ids');
      upd.run(i + 1, n);
    });
  });
  tx();
  res.json({ ok: true });
}));

router.put('/regras/:id', h((req, res) => {
  const id = toInt(req.params.id);
  const regra = db.prepare('SELECT * FROM regras WHERE id = ?').get(id);
  if (!regra) return falha(res, 404, 'Regra não encontrada');
  const b = req.body || {};
  const upd = {};
  if (b.titulo !== undefined) {
    upd.titulo = String(b.titulo || '').trim();
    if (!upd.titulo) throw new Error('Informe o título da regra');
  }
  if (b.texto !== undefined) {
    upd.texto = String(b.texto || '').trim();
    if (!upd.texto) throw new Error('Informe o texto da regra');
  }
  if (b.categoria !== undefined) upd.categoria = String(b.categoria || '').trim() || 'convivencia';
  if (b.ativa !== undefined) upd.ativa = boolOuErro(b.ativa, 'ativa') ? 1 : 0;
  if (b.ordem !== undefined) {
    const n = toInt(b.ordem);
    if (Number.isNaN(n) || n < 0) throw new Error('Ordem inválida');
    upd.ordem = n;
  }
  const campos = Object.keys(upd);
  if (!campos.length) throw new Error('Nada para atualizar');
  const set = campos.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE regras SET ${set} WHERE id = ?`).run(...campos.map((k) => upd[k]), id);
  res.json({ ok: true });
}));

router.delete('/regras/:id', h((req, res) => {
  const id = toInt(req.params.id);
  const regra = db.prepare('SELECT * FROM regras WHERE id = ?').get(id);
  if (!regra) return falha(res, 404, 'Regra não encontrada');
  db.prepare('DELETE FROM regras WHERE id = ?').run(id);
  res.json({ ok: true });
}));

// ── fallback ─────────────────────────────────────────────────────

router.use((req, res) => falha(res, 404, 'Rota não encontrada'));

module.exports = router;
