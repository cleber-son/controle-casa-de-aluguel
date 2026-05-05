// Logger minimalista com prefixo de timestamp.
function ts() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function log(...args)   { console.log(`[${ts()}]`, ...args); }
function warn(...args)  { console.warn(`[${ts()}] ⚠️ `, ...args); }
function error(...args) { console.error(`[${ts()}] ❌`, ...args); }
function debug(...args) { if (process.env.DEBUG) console.log(`[${ts()}] 🐛`, ...args); }

module.exports = { log, warn, error, debug };
