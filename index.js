// index.js — Quintal · Controle das casas de aluguel
//
// Servidor Express: login (senha + Turnstile + 2FA por e-mail), API em /api
// e as páginas do painel. O cálculo e o banco ficam em modules/.

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const express = require('express');
const session = require('express-session');

const { log, warn, error } = require('./modules/logger');
const { verificarSenha, requireAuth } = require('./modules/auth');
const apiRouter = require('./modules/api');

const PORT = parseInt(process.env.PORT || '3002', 10);
const SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
const VERSION = '3.0.0';

if (!SECRET) warn('SESSION_SECRET não definido. Gere com: openssl rand -hex 32');
if (!process.env.APP_PASSWORD) warn('APP_PASSWORD não definido — ninguém consegue entrar.');

const app = express();
app.set('trust proxy', 1); // Caddy/Cloudflare à frente
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: SECRET || 'fallback-trocar-em-producao',
  name: 'quintal.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 dias
  },
}));

// ─── Saúde (sem auth) ────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now(), version: VERSION }));

// ─── 2FA por e-mail ──────────────────────────────────────────────
const TWOFA_TTL_MS = 5 * 60 * 1000;
const TWOFA_MAX_ATTEMPTS = 5;
const TWOFA_DEST = process.env.ALERT_EMAIL_TO || process.env.SMTP_USER || '';

function twoFAReady() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && TWOFA_DEST);
}

async function send2FACode(code, dest) {
  const tr = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
  });
  const html = `<div style="font-family:system-ui,sans-serif;background:#0b0f14;color:#e6edf3;padding:28px;border-radius:16px;max-width:480px;margin:auto">
    <div style="font-size:18px;font-weight:700">🏡 Quintal — código de acesso</div>
    <div style="color:#93a1b3;font-size:13px;margin:6px 0 18px">Use o código abaixo para entrar.</div>
    <div style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;background:#151c26;border:1px solid #25303f;border-radius:12px;padding:18px;color:#22c58b">${code}</div>
    <div style="color:#64748b;font-size:12px;margin-top:16px">Válido por 5 minutos. Se não foi você, troque a senha (APP_PASSWORD).</div>
  </div>`;
  await tr.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: dest,
    subject: '🏡 Quintal — código de acesso',
    html,
  });
}

// ─── Turnstile + rate-limit do login ─────────────────────────────
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_ENABLED = !!TURNSTILE_SECRET;

function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.ip || 'unknown');
}

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_ENABLED) return true; // fail-open se não configurado
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.append('secret', TURNSTILE_SECRET);
    form.append('response', token);
    if (ip && ip !== 'unknown') form.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const data = await r.json();
    return !!data.success;
  } catch {
    return true; // erro de rede com a Cloudflare não pode travar o login
  }
}

// 8 falhas em 15min por IP → bloqueia por 15min
const _loginFails = new Map();
function _loginBlocked(ip) {
  const r = _loginFails.get(ip);
  return !!(r && r.blockedUntil > Date.now());
}
function _loginFail(ip) {
  const now = Date.now();
  let r = _loginFails.get(ip);
  if (!r || now - r.first > 15 * 60 * 1000) r = { count: 0, first: now, blockedUntil: 0 };
  r.count++;
  if (r.count >= 8) r.blockedUntil = now + 15 * 60 * 1000;
  _loginFails.set(ip, r);
}
function _loginOk(ip) { _loginFails.delete(ip); }

// ─── Login ───────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/login', (req, res) => {
  if (req.session && req.session.autenticado) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/login', async (req, res) => {
  const ip = clientIp(req);
  if (_loginBlocked(ip)) {
    log(`[AUTH] Login BLOQUEADO (rate-limit) ip=${ip}`);
    return res.redirect('/login?erro=bloqueado');
  }

  const token = (req.body && req.body['cf-turnstile-response']) || '';
  if (TURNSTILE_ENABLED && !(await verifyTurnstile(token, ip))) {
    _loginFail(ip);
    log(`[AUTH] Captcha falhou ip=${ip}`);
    return res.redirect('/login?erro=captcha');
  }

  const senha = (req.body && req.body.senha) || '';
  if (!verificarSenha(senha)) {
    _loginFail(ip);
    log(`[AUTH] Login FALHOU ip=${ip}`);
    return setTimeout(() => res.redirect('/login?erro=1'), 800);
  }

  _loginOk(ip);

  if (twoFAReady()) {
    const code = String(crypto.randomInt(100000, 1000000));
    req.session.pending2fa = { code, expires: Date.now() + TWOFA_TTL_MS, attempts: 0 };
    req.session.autenticado = false;
    try {
      await send2FACode(code, TWOFA_DEST);
    } catch (e) {
      log(`[AUTH] falha ao enviar 2FA ip=${ip}: ${e.message}`);
      delete req.session.pending2fa;
      return res.redirect('/login?erro=email');
    }
    log(`[AUTH] 2FA enviado ip=${ip}`);
    return res.redirect('/login?step=2fa');
  }

  req.session.autenticado = true;
  req.session.loginAt = Date.now();
  log(`[AUTH] Login OK ip=${ip}`);
  res.redirect('/');
});

app.post('/login/verify-2fa', (req, res) => {
  const p = req.session && req.session.pending2fa;
  if (!p || p.expires < Date.now()) {
    if (req.session) delete req.session.pending2fa;
    return res.redirect('/login?erro=expirou');
  }
  p.attempts = (p.attempts || 0) + 1;
  if (p.attempts > TWOFA_MAX_ATTEMPTS) {
    delete req.session.pending2fa;
    return res.redirect('/login?erro=tentativas');
  }
  const code = (req.body && req.body.codigo) || '';
  const a = Buffer.from(String(code));
  const b = Buffer.from(String(p.code));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.redirect('/login?step=2fa&erro=codigo');

  delete req.session.pending2fa;
  req.session.autenticado = true;
  req.session.loginAt = Date.now();
  log('[AUTH] Login 2FA confirmado');
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ─── API ─────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ─── Páginas (exigem sessão) ─────────────────────────────────────
const PAGINAS = {
  '/':          'index.html',
  '/casas':     'casas.html',
  '/whatsapp':  'whatsapp.html',
  '/historico': 'historico.html',
  '/repasse':   'repasse.html',
  '/regras':    'regras.html',
};

for (const [rota, arquivo] of Object.entries(PAGINAS)) {
  app.get(rota, requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, arquivo)));
}

// Assets (o conteúdo é genérico; o que é sensível vive só na API)
// no-cache = o navegador sempre revalida (ETag devolve 304, é barato).
// Sem isso o browser segurava CSS/JS antigos depois de um deploy.
const ESTATICO = {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
};
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), ESTATICO));
app.use('/js',  express.static(path.join(PUBLIC_DIR, 'js'), ESTATICO));

app.use((req, res) => res.status(404).send('Não encontrado'));

app.use((err, req, res, next) => {
  error('Express error:', err.message);
  res.status(500).json({ ok: false, erro: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  log('═══════════════════════════════════════════════');
  log(`🏡 Quintal — Controle de Aluguel v${VERSION} ONLINE`);
  log(`   http://0.0.0.0:${PORT}`);
  log(`   COOKIE_SECURE=${COOKIE_SECURE}  2FA=${twoFAReady() ? 'on' : 'off'}  Turnstile=${TURNSTILE_ENABLED ? 'on' : 'off'}`);
  log('═══════════════════════════════════════════════');
});

process.on('uncaughtException', e => error('uncaughtException:', e.message));
process.on('unhandledRejection', e => error('unhandledRejection:', e));
