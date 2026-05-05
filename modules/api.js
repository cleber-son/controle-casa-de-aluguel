// modules/api.js — rotas da API.

const express = require('express');
const db = require('./db');
const calc = require('./calculo');
const { requireAuth } = require('./auth');
const { log, error } = require('./logger');

const router = express.Router();
router.use(requireAuth);

// ─── CASAS (configuração) ────────────────────────────────────────
router.get('/casas', (req, res) => {
  const list = db.prepare('SELECT * FROM casas ORDER BY numero').all();
  res.json(list);
});

router.post('/casas', (req, res) => {
  const b = req.body || {};
  if (!b.numero) return res.status(400).json({ ok: false, error: 'numero obrigatório' });
  try {
    db.prepare(`
      INSERT INTO casas (numero, inquilino, aluguel_padrao, relogio_luz, unidades_luz, unidades_agua, ativa, observacoes, telefone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.numero,
      b.inquilino || '',
      Number(b.aluguel_padrao) || 0,
      Number(b.relogio_luz) || 1,
      Number(b.unidades_luz) || 1,
      Number(b.unidades_agua) || 1,
      b.ativa === false || b.ativa === 0 ? 0 : 1,
      b.observacoes || null,
      b.telefone || null,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.put('/casas/:id', (req, res) => {
  const b = req.body || {};
  try {
    db.prepare(`
      UPDATE casas SET
        numero = COALESCE(?, numero),
        inquilino = COALESCE(?, inquilino),
        aluguel_padrao = COALESCE(?, aluguel_padrao),
        relogio_luz = COALESCE(?, relogio_luz),
        unidades_luz = COALESCE(?, unidades_luz),
        unidades_agua = COALESCE(?, unidades_agua),
        ativa = COALESCE(?, ativa),
        observacoes = COALESCE(?, observacoes),
        telefone = COALESCE(?, telefone)
      WHERE id = ?
    `).run(
      b.numero ?? null,
      b.inquilino ?? null,
      b.aluguel_padrao ?? null,
      b.relogio_luz ?? null,
      b.unidades_luz ?? null,
      b.unidades_agua ?? null,
      b.ativa ?? null,
      b.observacoes ?? null,
      b.telefone ?? null,
      req.params.id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/casas/:id', (req, res) => {
  try {
    const usada = db.prepare('SELECT 1 FROM lancamentos WHERE casa_id = ? LIMIT 1').get(req.params.id);
    if (usada) {
      db.prepare('UPDATE casas SET ativa = 0 WHERE id = ?').run(req.params.id);
      return res.json({ ok: true, desativada: true });
    }
    db.prepare('DELETE FROM casas WHERE id = ?').run(req.params.id);
    res.json({ ok: true, deletada: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── MESES / LANÇAMENTOS ────────────────────────────────────────
router.get('/meses', (req, res) => {
  const ini = calc.INICIO_PERIODO;
  const list = db.prepare(`
    SELECT * FROM meses
     WHERE (ano > ?) OR (ano = ? AND mes >= ?)
     ORDER BY ano DESC, mes DESC
  `).all(ini.ano, ini.ano, ini.mes);
  res.json(list);
});

router.get('/mes/:ano/:mes', (req, res) => {
  const ano = parseInt(req.params.ano, 10);
  const mes = parseInt(req.params.mes, 10);
  if (calc.antesPeriodo(ano, mes)) {
    return res.status(400).json({ error: 'período fora do controle (inicia em abril/2026)' });
  }
  calc.garantirMes(ano, mes);
  const data = calc.carregarMes(ano, mes);
  if (!data) return res.status(404).json({ error: 'Mês não encontrado' });
  res.json(data);
});

// Salva valores do header do mês (água total, divisor, vencimentos, contas de luz)
router.put('/mes/:id/header', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE meses SET
          agua_total      = COALESCE(?, agua_total),
          agua_divisor    = COALESCE(?, agua_divisor),
          vencimento_agua = COALESCE(?, vencimento_agua),
          vencimento_luz  = COALESCE(?, vencimento_luz)
        WHERE id = ?
      `).run(
        b.agua_total ?? null,
        b.agua_divisor ?? null,
        b.vencimento_agua === null ? null : (b.vencimento_agua ?? null),
        b.vencimento_luz === null  ? null : (b.vencimento_luz  ?? null),
        id,
      );

      if (Array.isArray(b.relogios)) {
        const upd = db.prepare(`
          INSERT INTO contas_luz_relogio (mes_id, relogio, valor_total)
          VALUES (?, ?, ?)
          ON CONFLICT(mes_id, relogio) DO UPDATE SET valor_total = excluded.valor_total
        `);
        for (const r of b.relogios) {
          upd.run(id, Number(r.relogio), Number(r.valor_total) || 0);
        }
      }
    });
    tx();
    calc.recalcularMes(id);
    res.json({ ok: true });
  } catch (e) {
    error('[API] PUT /mes/:id/header:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Edita um lançamento (inquilino, vazia, valores manuais, pago/não pago)
router.put('/lancamento/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const allowed = [
    'inquilino', 'vazia',
    'agua_valor', 'agua_pago',
    'luz_valor', 'luz_pago',
    'outros_valor', 'outros_descricao', 'outros_pago',
    'aluguel_valor', 'aluguel_pago',
    'cobrar_obs',
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`);
      if (['vazia','agua_pago','luz_pago','outros_pago','aluguel_pago'].includes(k)) {
        vals.push(b[k] ? 1 : 0);
      } else {
        vals.push(b[k]);
      }
    }
  }
  if (!sets.length) return res.json({ ok: true, noop: true });
  vals.push(id);

  try {
    db.prepare(`UPDATE lancamentos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    // Se mudou algum *_pago, atualiza pago_em automaticamente.
    const mudouFlagPago = ['agua_pago','luz_pago','outros_pago','aluguel_pago']
      .some(k => b[k] !== undefined);
    if (mudouFlagPago) {
      calc.atualizarPagoEm(id);
    }

    // Se mudou "vazia", precisa recalcular o mês inteiro.
    if (b.vazia !== undefined) {
      const r = db.prepare('SELECT mes_id FROM lancamentos WHERE id = ?').get(id);
      if (r) calc.recalcularMes(r.mes_id);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Toggle "Pago tudo" — marca/desmarca todos os 4 flags de uma vez
router.put('/lancamento/:id/tudo-pago', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pago = !!(req.body && req.body.pago);
  try {
    calc.marcarTudoPago(id, pago);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/mes/:id/recalcular', (req, res) => {
  try {
    calc.recalcularMes(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Limpa todos os dados de UM mês: zera valores, flags de pagamento,
// vencimentos, contas de luz, descontos e pagamentos dos pais.
// MANTÉM: inquilino, vazia, aluguel_valor (esses são "estruturais" da casa).
router.post('/mes/:id/limpar', (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const tx = db.transaction(() => {
      // Zera campos do mês
      db.prepare(`
        UPDATE meses SET
          agua_total = 0,
          agua_divisor = 10,
          vencimento_agua = NULL,
          vencimento_luz = NULL
        WHERE id = ?
      `).run(id);

      // Zera contas de luz por relógio
      db.prepare(`UPDATE contas_luz_relogio SET valor_total = 0 WHERE mes_id = ?`).run(id);

      // Zera valores calculados e todas as flags de pagamento.
      // Mantém: inquilino, vazia, aluguel_valor (config da casa).
      db.prepare(`
        UPDATE lancamentos SET
          agua_valor = 0, agua_pago = 0,
          luz_valor  = 0, luz_pago  = 0,
          outros_valor = 0, outros_descricao = NULL, outros_pago = 0,
          aluguel_pago = 0,
          pago_em = NULL,
          cobrar_obs = NULL
        WHERE mes_id = ?
      `).run(id);

      // Apaga descontos e pagamentos dos pais deste mês
      db.prepare(`DELETE FROM descontos_pais WHERE mes_id = ?`).run(id);
      db.prepare(`DELETE FROM pagamentos_pais WHERE mes_id = ?`).run(id);
    });
    tx();
    log(`[API] mês id=${id} limpo (zerado)`);
    res.json({ ok: true });
  } catch (e) {
    error('[API] POST /mes/:id/limpar:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── DESCONTOS DOS PAIS ─────────────────────────────────────────
router.post('/desconto', (req, res) => {
  const b = req.body || {};
  if (!b.mes_id || !b.destinatario || !b.descricao) {
    return res.status(400).json({ ok: false, error: 'mes_id, destinatario, descricao obrigatórios' });
  }
  if (!['pai','mae'].includes(b.destinatario)) {
    return res.status(400).json({ ok: false, error: 'destinatario deve ser pai ou mae' });
  }
  try {
    const r = db.prepare(`
      INSERT INTO descontos_pais (mes_id, destinatario, descricao, valor)
      VALUES (?, ?, ?, ?)
    `).run(b.mes_id, b.destinatario, b.descricao, Number(b.valor) || 0);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/desconto/:id', (req, res) => {
  db.prepare('DELETE FROM descontos_pais WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/pagamento-pai', (req, res) => {
  const b = req.body || {};
  if (!b.mes_id || !b.destinatario) {
    return res.status(400).json({ ok: false, error: 'mes_id e destinatario obrigatórios' });
  }
  try {
    db.prepare(`
      INSERT INTO pagamentos_pais (mes_id, destinatario, pago, data_pagamento)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(mes_id, destinatario) DO UPDATE SET
        pago = excluded.pago,
        data_pagamento = excluded.data_pagamento
    `).run(
      b.mes_id, b.destinatario,
      b.pago ? 1 : 0,
      b.pago ? (b.data_pagamento || calc.hojeISO()) : null,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── DEVEDORES (relatório consolidado) ─────────────────────────
// Lista todas as casas com lançamentos NÃO totalmente pagos,
// agrupado por casa, com soma do que devem.
router.get('/devedores', (req, res) => {
  try {
    const ini = calc.INICIO_PERIODO;
    // Pega todos lançamentos com casa info
    const todos = db.prepare(`
      SELECT l.*,
             m.ano, m.mes, m.vencimento_agua, m.vencimento_luz,
             c.numero AS casa_numero, c.telefone
        FROM lancamentos l
        JOIN meses m ON m.id = l.mes_id
        JOIN casas c ON c.id = l.casa_id
       WHERE l.vazia = 0
         AND ((m.ano > ?) OR (m.ano = ? AND m.mes >= ?))
       ORDER BY c.numero, m.ano DESC, m.mes DESC
    `).all(ini.ano, ini.ano, ini.mes);

    // Filtra só os pendentes (que não estão totalmente pagos)
    const pendentes = todos.filter(l => !calc.totalmentePago(l));

    // Agrupa por casa
    const porCasa = new Map();
    for (const l of pendentes) {
      const chave = l.casa_numero;
      if (!porCasa.has(chave)) {
        porCasa.set(chave, {
          casa_numero: l.casa_numero,
          inquilino_atual: l.inquilino,
          telefone: l.telefone,
          total_devido: 0,
          meses: [],
        });
      }
      const g = porCasa.get(chave);
      // Soma só o que está em aberto
      const aberto = (
        (!l.agua_pago    ? (l.agua_valor    || 0) : 0) +
        (!l.luz_pago     ? (l.luz_valor     || 0) : 0) +
        (!l.outros_pago  ? (l.outros_valor  || 0) : 0) +
        (!l.aluguel_pago ? (l.aluguel_valor || 0) : 0)
      );
      g.total_devido += aberto;
      g.meses.push({
        lancamento_id: l.id,
        ano: l.ano,
        mes: l.mes,
        nome_mes: calc.nomeMes(l.mes),
        agua: { valor: l.agua_valor || 0,    pago: !!l.agua_pago },
        luz:  { valor: l.luz_valor  || 0,    pago: !!l.luz_pago  },
        outros: {
          valor: l.outros_valor || 0,
          descricao: l.outros_descricao,
          pago: !!l.outros_pago,
        },
        aluguel: { valor: l.aluguel_valor || 0, pago: !!l.aluguel_pago },
        total_aberto: calc.round2(aberto),
        cobrar_obs: l.cobrar_obs,
      });
    }

    const lista = [...porCasa.values()].map(g => ({
      ...g,
      total_devido: calc.round2(g.total_devido),
    }));

    // Ordena por valor devido (maior primeiro)
    lista.sort((a, b) => b.total_devido - a.total_devido);

    res.json({ devedores: lista });
  } catch (e) {
    error('[API] GET /devedores:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── RECIBOS (com vencimentos, telefone e mensagem WA) ─────────
router.get('/recibos/:ano/:mes', (req, res) => {
  const data = calc.carregarMes(parseInt(req.params.ano, 10), parseInt(req.params.mes, 10));
  if (!data) return res.status(404).json({ error: 'Mês não encontrado' });

  const nomeMesStr = calc.nomeMes(data.mes.mes);
  const recibos = data.lancamentos.map(l => {
    const total = (l.agua_valor || 0) + (l.luz_valor || 0) + (l.outros_valor || 0);
    const inquilino = l.inquilino || '—';
    return {
      casa: l.casa_numero,
      casa_str: String(l.casa_numero).padStart(2, '0'),
      inquilino,
      vazia: !!l.vazia,
      ref: `${nomeMesStr}/${data.mes.ano}`,
      agua: l.agua_valor,
      agua_pago: !!l.agua_pago,
      luz: l.luz_valor,
      luz_pago: !!l.luz_pago,
      outros: l.outros_valor,
      outros_descricao: l.outros_descricao,
      outros_pago: !!l.outros_pago,
      total: calc.round2(total),
      tudo_pago: !!l.tudo_pago,
      pago_em: l.pago_em,
      telefone: l.casa_telefone,
      vencimento_agua: data.mes.vencimento_agua,
      vencimento_luz:  data.mes.vencimento_luz,
      mensagem_whatsapp: gerarMensagemWA(l, nomeMesStr, data.mes),
    };
  });

  res.json({ mes: data.mes, recibos });
});

// ─── HISTÓRICO (relatório consolidado por filtros) ─────────────
router.get('/historico', (req, res) => {
  try {
    const ini = calc.INICIO_PERIODO;
    const ano = req.query.ano ? parseInt(req.query.ano, 10) : null;
    const casa = req.query.casa ? parseInt(req.query.casa, 10) : null;
    const status = (req.query.status || 'todos').toLowerCase();

    const where = ['((m.ano > ?) OR (m.ano = ? AND m.mes >= ?))'];
    const params = [ini.ano, ini.ano, ini.mes];
    if (Number.isFinite(ano) && ano) {
      where.push('m.ano = ?');
      params.push(ano);
    }
    if (Number.isFinite(casa) && casa) {
      where.push('c.numero = ?');
      params.push(casa);
    }

    const rows = db.prepare(`
      SELECT l.*,
             m.ano, m.mes, m.vencimento_agua, m.vencimento_luz,
             c.numero AS casa_numero
        FROM lancamentos l
        JOIN meses m ON m.id = l.mes_id
        JOIN casas c ON c.id = l.casa_id
       WHERE ${where.join(' AND ')}
       ORDER BY m.ano DESC, m.mes DESC, c.numero ASC
    `).all(...params);

    const itens = [];
    let recebido = 0, em_aberto = 0, total_cobrado = 0;
    for (const l of rows) {
      const tudoPago = calc.totalmentePago(l);
      if (status === 'pagos' && !tudoPago) continue;
      if (status === 'devendo' && (l.vazia || tudoPago)) continue;

      const cobrado = (l.agua_valor || 0) + (l.luz_valor || 0)
                    + (l.outros_valor || 0) + (l.aluguel_valor || 0);
      const aberto = (
        (!l.agua_pago    ? (l.agua_valor    || 0) : 0) +
        (!l.luz_pago     ? (l.luz_valor     || 0) : 0) +
        (!l.outros_pago  ? (l.outros_valor  || 0) : 0) +
        (!l.aluguel_pago ? (l.aluguel_valor || 0) : 0)
      );
      const pago = cobrado - aberto;

      total_cobrado += cobrado;
      recebido      += pago;
      if (!l.vazia) em_aberto += aberto;

      itens.push({
        mes_id: l.mes_id,
        ano: l.ano,
        mes: l.mes,
        nome_mes: calc.nomeMes(l.mes),
        ref: `${calc.nomeMes(l.mes)}/${l.ano}`,
        casa_numero: l.casa_numero,
        casa_str: String(l.casa_numero).padStart(2, '0'),
        inquilino: l.inquilino || '',
        vazia: !!l.vazia,
        agua_valor: calc.round2(l.agua_valor || 0),
        agua_pago: !!l.agua_pago,
        luz_valor: calc.round2(l.luz_valor || 0),
        luz_pago: !!l.luz_pago,
        outros_valor: calc.round2(l.outros_valor || 0),
        outros_descricao: l.outros_descricao,
        outros_pago: !!l.outros_pago,
        aluguel_valor: calc.round2(l.aluguel_valor || 0),
        aluguel_pago: !!l.aluguel_pago,
        total_cobrado: calc.round2(cobrado),
        total_aberto: calc.round2(aberto),
        tudo_pago: tudoPago,
        pago_em: l.pago_em,
        vencimento_agua: l.vencimento_agua,
        vencimento_luz: l.vencimento_luz,
      });
    }

    res.json({
      itens,
      totais: {
        recebido: calc.round2(recebido),
        em_aberto: calc.round2(em_aberto),
        total_cobrado: calc.round2(total_cobrado),
        qtd_lancamentos: itens.length,
      },
    });
  } catch (e) {
    error('[API] GET /historico:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function brl(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function gerarMensagemWA(l, nomeMes, mes) {
  const inquilino = l.inquilino || '';
  const casaStr = String(l.casa_numero).padStart(2, '0');
  const linhas = [];
  linhas.push(`Olá ${inquilino} (Casa ${casaStr}) 🏠`);
  linhas.push(`Segue a conta de *${nomeMes}/${mes.ano}*:`);
  linhas.push('');
  if (l.agua_valor > 0) {
    let s = `💧 Água: *${brl(l.agua_valor)}*`;
    if (mes.vencimento_agua) s += ` — pagar até dia ${mes.vencimento_agua}`;
    linhas.push(s);
  }
  if (l.luz_valor > 0) {
    let s = `💡 Luz: *${brl(l.luz_valor)}*`;
    if (mes.vencimento_luz) s += ` — pagar até dia ${mes.vencimento_luz}`;
    linhas.push(s);
  }
  if (l.outros_valor > 0) {
    linhas.push(`📦 ${l.outros_descricao || 'Outros'}: *${brl(l.outros_valor)}*`);
  }
  const total = (l.agua_valor || 0) + (l.luz_valor || 0) + (l.outros_valor || 0);
  linhas.push('');
  linhas.push(`💰 TOTAL: *${brl(total)}*`);
  linhas.push('');
  linhas.push('Obrigado! 🙏');
  return linhas.join('\n');
}

module.exports = router;
