// modules/auth.js — login com senha única (env APP_PASSWORD) + sessão.

const bcrypt = require('bcryptjs');
const { log, warn } = require('./logger');

const RAW_PASS = process.env.APP_PASSWORD || '';
let HASH = '';

if (!RAW_PASS) {
  warn('APP_PASSWORD não definido — qualquer login será REJEITADO até você configurar.');
} else {
  HASH = bcrypt.hashSync(RAW_PASS, 10);
  log('[AUTH] Senha do app carregada (hash bcrypt em memória)');
}

function verificarSenha(senha) {
  if (!HASH) return false;
  if (!senha) return false;
  try {
    return bcrypt.compareSync(String(senha), HASH);
  } catch {
    return false;
  }
}

// Middleware: bloqueia rotas se não estiver logado.
function requireAuth(req, res, next) {
  if (req.session && req.session.autenticado) return next();

  // Para chamadas API → 401 JSON. Para navegação → redirect ao login.
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }
  return res.redirect('/login');
}

module.exports = { verificarSenha, requireAuth };
