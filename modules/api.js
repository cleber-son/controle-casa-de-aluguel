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
      INSERT INTO casas (numero, inquilino, aluguel_padrao, relogio_luz, unidades_luz, unidades_agua, ativa, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.numero,
      b.inquilino || '',
      Number(b.aluguel_padrao) || 0,
      Number(b.relogio_luz) || 1,
      Number(b.unidades_luz) || 1,
      Number(b.unidades_agua) || 1,
      b.ativa === false || b.ativa === 0 ? 0 : 1,
      b.observacoes || null,
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
        observacoes = COALESCE(?, observacoes)
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
      // Não apaga — só desativa, pra preservar histórico
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
  const list = db.prepare('SELECT * FROM meses ORDER BY ano DESC, mes DESC').all();
  res.json(list);
});

router.get('/mes/:ano/:mes', (req, res) => {
  const ano = parseInt(req.params.ano, 10);
  const mes = parseInt(req.params.mes, 10);
  calc.garantirMes(ano, mes); // cria se não existir
  const data = calc.carregarMes(ano, mes);
  if (!data) return res.status(404).json({ error: 'Mês não encontrado' });
  res.json(data);
});

// Salva valores do header do mês (água total, divisor, contas de luz por relógio)
router.put('/mes/:id/header', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  try {
    const tx = db.transaction(() => {
      if (b.agua_total !== undefined || b.agua_divisor !== undefined) {
        db.prepare(`
          UPDATE meses SET
            agua_total   = COALESCE(?, agua_total),
            agua_divisor = COALESCE(?, agua_divisor)
          WHERE id = ?
        `).run(b.agua_total ?? null, b.agua_divisor ?? null, id);
      }
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
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`);
      // booleans → 0/1
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

    // Se mudou "vazia", precisa recalcular o mês inteiro (afeta divisão da luz).
    if (b.vazia !== undefined) {
      const r = db.prepare('SELECT mes_id FROM lancamentos WHERE id = ?').get(id);
      if (r) calc.recalcularMes(r.mes_id);
    }
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
      b.pago ? (b.data_pagamento || new Date().toISOString().slice(0, 10)) : null,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── RECIBOS / TEXTO PRA WHATSAPP ───────────────────────────────
router.get('/recibos/:ano/:mes', (req, res) => {
  const data = calc.carregarMes(parseInt(req.params.ano, 10), parseInt(req.params.mes, 10));
  if (!data) return res.status(404).json({ error: 'Mês não encontrado' });

  const nomeMes = calc.nomeMes(data.mes.mes);
  const recibos = data.lancamentos.map(l => {
    const total = (l.agua_valor || 0) + (l.luz_valor || 0) + (l.outros_valor || 0);
    const inquilino = l.inquilino || '—';
    return {
      casa: l.casa_numero,
      inquilino,
      vazia: !!l.vazia,
      ref: `${nomeMes}/${data.mes.ano}`,
      agua: l.agua_valor,
      luz: l.luz_valor,
      outros: l.outros_valor,
      outros_descricao: l.outros_descricao,
      total: calc.round2(total),
      mensagem_whatsapp: gerarMensagemWA(inquilino, nomeMes, data.mes.ano, l),
    };
  });

  res.json({ mes: data.mes, recibos });
});

function brl(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function gerarMensagemWA(inquilino, nomeMes, ano, l) {
  const linhas = [];
  linhas.push(`Olá ${inquilino || ''}, segue a conta de ${nomeMes}/${ano}:`);
  linhas.push('');
  if (l.agua_valor > 0)   linhas.push(`💧 Água:    ${brl(l.agua_valor)}`);
  if (l.luz_valor > 0)    linhas.push(`💡 Luz:     ${brl(l.luz_valor)}`);
  if (l.outros_valor > 0) linhas.push(`📦 ${l.outros_descricao || 'Outros'}: ${brl(l.outros_valor)}`);
  const total = (l.agua_valor || 0) + (l.luz_valor || 0) + (l.outros_valor || 0);
  linhas.push('');
  linhas.push(`💰 *TOTAL: ${brl(total)}*`);
  return linhas.join('\n');
}

module.exports = router;
