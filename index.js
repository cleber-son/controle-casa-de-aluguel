// index.js — Controle Casa de Aluguel
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');

const { log, warn, error } = require('./modules/logger');
const { verificarSenha, requireAuth } = require('./modules/auth');
const apiRouter = require('./modules/api');

const PORT = parseInt(process.env.PORT || '3002', 10);
const SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';

if (!SECRET) {
  warn('SESSION_SECRET não definido. Use:  openssl rand -hex 32  e coloque no .env');
}
if (!process.env.APP_PASSWORD) {
  warn('APP_PASSWORD não definido. Ninguém vai conseguir entrar até você configurar.');
}

const app = express();
app.set('trust proxy', 1); // Caddy à frente
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: SECRET || 'fallback-trocar-em-producao',
  name: 'aluguel.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true, // renova cookie a cada request
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 dias
  },
}));

// ─── Saúde (sem auth) ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), version: '1.0.0' });
});

// ─── Login ────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session && req.session.autenticado) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const senha = (req.body && req.body.senha) || '';
  if (verificarSenha(senha)) {
    req.session.autenticado = true;
    req.session.loginAt = Date.now();
    log(`[AUTH] Login OK de ip=${req.ip}`);
    return res.redirect('/');
  }
  log(`[AUTH] Login FALHOU de ip=${req.ip}`);
  // Pequeno delay pra desincentivar brute-force.
  setTimeout(() => {
    res.redirect('/login?erro=1');
  }, 800);
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ─── API (com auth) ───────────────────────────────────────────
app.use('/api', apiRouter);

// ─── Páginas estáticas (com auth) ─────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.get('/recibos', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'recibos.html'));
});
app.get('/casas', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'casas.html'));
});
app.get('/devedores', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'devedores.html'));
});

// Assets (css, js) – públicos
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js',  express.static(path.join(PUBLIC_DIR, 'js')));

// 404
app.use((req, res) => res.status(404).send('Não encontrado'));

// Error handler
app.use((err, req, res, next) => {
  error('Express error:', err.message);
  res.status(500).json({ ok: false, error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  log('═══════════════════════════════════════════════');
  log(`🏠 Controle Casa de Aluguel — ONLINE`);
  log(`   http://0.0.0.0:${PORT}`);
  log(`   COOKIE_SECURE=${COOKIE_SECURE}`);
  log('═══════════════════════════════════════════════');
});

process.on('uncaughtException',  e => error('uncaughtException:', e.message));
process.on('unhandledRejection', e => error('unhandledRejection:', e));
