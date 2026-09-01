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
const SQLiteStore = require('./modules/sessionStore');
const db = require('./modules/db');

const PORT = parseInt(process.env.PORT || '3002', 10);
const SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
const VERSION = '3.12.0';

// Quanto tempo um dispositivo lembrado continua logado (renovado a cada visita).
const DIAS_LEMBRAR = parseInt(process.env.SESSAO_DIAS || '365', 10);
const SESSAO_MS = 1000 * 60 * 60 * 24 * DIAS_LEMBRAR;

if (!SECRET) warn('SESSION_SECRET não definido. Gere com: openssl rand -hex 32');
if (!process.env.APP_PASSWORD) warn('APP_PASSWORD não definido — ninguém consegue entrar.');

const app = express();
app.set('trust proxy', 1); // Caddy/Cloudflare à frente
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// leitor de cookies enxuto — só precisamos ler o token de dispositivo
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    for (const parte of raw.split(';')) {
      const i = parte.indexOf('=');
      if (i < 0) continue;
      const k = parte.slice(0, i).trim();
      if (!k) continue;
      try { req.cookies[k] = decodeURIComponent(parte.slice(i + 1).trim()); } catch { /* ignora */ }
    }
  }
  next();
});

// Sessão no SQLite: sem isso, todo restart do container deslogava todo mundo
// (o MemoryStore do express-session vive só na RAM do processo).
app.use(session({
  store: new SQLiteStore({ ttl: SESSAO_MS }),
  secret: SECRET || 'fallback-trocar-em-producao',
  name: 'quintal.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true, // cada visita renova o prazo: quem usa toda semana nunca cai
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: SESSAO_MS,
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

// ─── Dispositivos confiáveis ─────────────────────────────────────
// Depois de confirmar o código por e-mail uma vez, o aparelho recebe um token
// próprio. Enquanto ele valer, o login não pede 2FA de novo — é o "lembrar
// deste dispositivo". Guardamos só o hash do token: vazar o banco não permite
// forjar um cookie válido.
const COOKIE_DISPOSITIVO = 'quintal.dev';
const DIAS_DISPOSITIVO = parseInt(process.env.DISPOSITIVO_DIAS || '365', 10);
const DISPOSITIVO_MS = 1000 * 60 * 60 * 24 * DIAS_DISPOSITIVO;

db.exec(`
CREATE TABLE IF NOT EXISTS dispositivos (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  apelido    TEXT,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  usado_em   TEXT,
  expira_em  INTEGER NOT NULL
);`);

function hashToken(t) {
  return crypto.createHash('sha256').update(String(t)).digest('hex');
}

function dispositivoConfiavel(req) {
  const t = req.cookies ? req.cookies[COOKIE_DISPOSITIVO] : null;
  if (!t) return null;
  const row = db.prepare('SELECT * FROM dispositivos WHERE token_hash = ?').get(hashToken(t));
  if (!row) return null;
  if (row.expira_em <= Date.now()) {
    db.prepare('DELETE FROM dispositivos WHERE id = ?').run(row.id);
    return null;
  }
  db.prepare("UPDATE dispositivos SET usado_em = datetime('now') WHERE id = ?").run(row.id);
  return row;
}

function confiarDispositivo(res, apelido) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO dispositivos (token_hash, apelido, expira_em) VALUES (?, ?, ?)')
    .run(hashToken(token), apelido || null, Date.now() + DISPOSITIVO_MS);
  res.cookie(COOKIE_DISPOSITIVO, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: DISPOSITIVO_MS,
  });
  db.prepare('DELETE FROM dispositivos WHERE expira_em <= ?').run(Date.now());
}

function esquecerDispositivo(req, res) {
  const t = req.cookies ? req.cookies[COOKIE_DISPOSITIVO] : null;
  if (t) db.prepare('DELETE FROM dispositivos WHERE token_hash = ?').run(hashToken(t));
  res.clearCookie(COOKIE_DISPOSITIVO, { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE });
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

  const lembrar = String((req.body && req.body.lembrar) || '') !== '';

  // aparelho já confirmado por e-mail antes entra direto
  if (dispositivoConfiavel(req)) {
    req.session.autenticado = true;
    req.session.loginAt = Date.now();
    if (!lembrar) req.session.cookie.expires = false; // só até fechar o navegador
    log(`[AUTH] Login OK (dispositivo confiável, sem 2FA) ip=${ip}`);
    return res.redirect('/');
  }

  if (twoFAReady()) {
    req.session.lembrar = lembrar;
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
  if (lembrar) confiarDispositivo(res, 'sem 2FA');
  else req.session.cookie.expires = false;
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

  const lembrar = req.session.lembrar !== false;
  delete req.session.pending2fa;
  delete req.session.lembrar;
  req.session.autenticado = true;
  req.session.loginAt = Date.now();
  if (lembrar) confiarDispositivo(res, 'confirmado por e-mail');
  else req.session.cookie.expires = false;
  log(`[AUTH] Login 2FA confirmado (lembrar=${lembrar ? 'sim' : 'nao'})`);
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  // "Sair" mantém o aparelho confiável (não pede código de novo).
  // "Sair e esquecer" apaga o token: o próximo login volta a exigir 2FA.
  if (String((req.body && req.body.esquecer) || '') !== '') esquecerDispositivo(req, res);
  req.session.destroy(() => res.redirect('/login'));
});

// ─── API ─────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ─── Páginas (exigem sessão) ─────────────────────────────────────
const PAGINAS = {
  '/':          'index.html',
  '/casas':     'casas.html',
  '/whatsapp':  'whatsapp.html',
  '/devedores': 'devedores.html',
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
  log(`   sessão no SQLite · lembra o dispositivo por ${DIAS_LEMBRAR} dias`);
  log('═══════════════════════════════════════════════');
});

process.on('uncaughtException', e => error('uncaughtException:', e.message));
process.on('unhandledRejection', e => error('unhandledRejection:', e));
