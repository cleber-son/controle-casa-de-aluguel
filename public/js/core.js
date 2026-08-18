/* ==========================================================================
   Quintal — core.js
   API global window.App (contrato: SPEC seção 7). Vanilla, sem dependências.
   ========================================================================== */
(function (window, document) {
  'use strict';

  var INICIO = { ano: 2026, mes: 4 };

  var MESES = [
    'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'
  ];

  var CHAVE_MES = 'quintal.mes';
  var CHAVE_TEMA = 'quintal.tema';

  /* ----------------------------------------------------------------- tema */

  function temaAtual() {
    try {
      var t = window.localStorage.getItem(CHAVE_TEMA);
      if (t === 'claro' || t === 'escuro') return t;
    } catch (e) { /* ignora */ }
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'claro';
    } catch (e) { /* ignora */ }
    return 'escuro';
  }

  function aplicaTema(t) {
    var claro = t === 'claro';
    document.documentElement.setAttribute('data-theme', claro ? 'light' : 'dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', claro ? '#ffffff' : '#0b0f14');
    var btn = document.getElementById('tema-toggle');
    if (btn) {
      btn.textContent = claro ? '🌙' : '☀️';
      btn.setAttribute('title', claro ? 'Mudar para tema escuro' : 'Mudar para tema claro');
      btn.setAttribute('aria-label', btn.getAttribute('title'));
      btn.setAttribute('aria-pressed', claro ? 'true' : 'false');
    }
    return t;
  }

  function setTema(t) {
    t = t === 'claro' ? 'claro' : 'escuro';
    try { window.localStorage.setItem(CHAVE_TEMA, t); } catch (e) { /* ignora */ }
    return aplicaTema(t);
  }

  function alternaTema() {
    return setTema(temaAtual() === 'claro' ? 'escuro' : 'claro');
  }

  // aplica antes de qualquer render (o <html> já existe quando este script roda)
  aplicaTema(temaAtual());

  var NAV = [
    { chave: 'mes',       href: '/',          titulo: 'Mês',       icone: '📅' },
    { chave: 'casas',     href: '/casas',     titulo: 'Casas',     icone: '🏠' },
    { chave: 'whatsapp',  href: '/whatsapp',  titulo: 'WhatsApp',  icone: '💬' },
    { chave: 'historico', href: '/historico', titulo: 'Histórico', icone: '📊' },
    { chave: 'repasse',   href: '/repasse',   titulo: 'Repasse',   icone: '🤝' },
    { chave: 'regras',    href: '/regras',    titulo: 'Regras',    icone: '📋' }
  ];

  /* ---------------------------------------------------------------- texto */

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nomeMes(m) {
    var i = Number(m);
    return MESES[i - 1] || '';
  }

  function mesLabel(ano, mes) {
    return nomeMes(mes) + '/' + ano;
  }

  /* -------------------------------------------------------------- números */

  function toNum(n) {
    if (typeof n === 'number') return isFinite(n) ? n : 0;
    if (n === null || n === undefined || n === '') return 0;
    var v = Number(String(n).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
    return isFinite(v) ? v : 0;
  }

  function num(n) {
    return toNum(n).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function money(n) {
    return 'R$ ' + num(n);
  }

  /* ---------------------------------------------------------------- datas */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 'YYYY-MM-DD' -> Date local (evita o deslocamento de fuso do Date.parse ISO)
  function isoParaDate(iso) {
    if (!iso) return null;
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function hoje() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dataBR(iso) {
    var d = isoParaDate(iso);
    if (!d) return '—';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function dataCurta(iso) {
    var d = isoParaDate(iso);
    if (!d) return '—';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
  }

  function diasAte(iso) {
    var d = isoParaDate(iso);
    if (!d) return null;
    var h = new Date();
    h.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - h.getTime()) / 86400000);
  }

  function statusVenc(iso) {
    var dias = diasAte(iso);
    if (dias === null) return { classe: 'badge-dim', texto: '', dias: null };
    if (dias < 0) {
      var n = Math.abs(dias);
      return { classe: 'badge-err', texto: 'venceu há ' + n + (n === 1 ? ' dia' : ' dias'), dias: dias };
    }
    if (dias === 0) return { classe: 'badge-warn', texto: 'vence hoje', dias: 0 };
    if (dias === 1) return { classe: 'badge-warn', texto: 'vence amanhã', dias: 1 };
    if (dias <= 3) return { classe: 'badge-warn', texto: 'vence em ' + dias + ' dias', dias: dias };
    return { classe: 'badge-ok', texto: 'vence em ' + dias + ' dias', dias: dias };
  }

  /* ------------------------------------------------------------------ DOM */

  function qs(sel, raiz) { return (raiz || document).querySelector(sel); }

  function qsa(sel, raiz) {
    return Array.prototype.slice.call((raiz || document).querySelectorAll(sel));
  }

  // App.on(el, evt, sel, fn) — delegação. Também aceita App.on(evt, sel, fn) (document).
  function on(el, evt, sel, fn) {
    if (typeof el === 'string') { fn = sel; sel = evt; evt = el; el = document; }
    if (typeof sel === 'function') {          // sem delegação: App.on(el, evt, fn)
      var direto = sel;
      el.addEventListener(evt, direto);
      return function () { el.removeEventListener(evt, direto); };
    }
    var handler = function (ev) {
      var alvo = ev.target && ev.target.closest ? ev.target.closest(sel) : null;
      if (alvo && el.contains(alvo)) fn.call(alvo, ev, alvo);
    };
    el.addEventListener(evt, handler);
    return function () { el.removeEventListener(evt, handler); };
  }

  function debounce(fn, ms) {
    var t = null;
    ms = ms || 250;
    return function () {
      var ctx = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(ctx, args); }, ms);
    };
  }

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  /* ---------------------------------------------------------------- toast */

  function toastWrap() {
    var w = document.getElementById('app-toasts');
    if (!w) {
      w = el('div', { id: 'app-toasts', class: 'toast-wrap', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(w);
    }
    return w;
  }

  function toast(msg, tipo) {
    var t = tipo === 'ok' || tipo === 'err' || tipo === 'info' ? tipo : 'info';
    var no = el('div', { class: 'toast toast-' + t });
    no.textContent = msg === null || msg === undefined ? '' : String(msg);
    toastWrap().appendChild(no);
    var fim = setTimeout(function () { sair(); }, t === 'err' ? 5200 : 3200);
    function sair() {
      clearTimeout(fim);
      if (!no.parentNode) return;
      no.classList.add('is-out');
      setTimeout(function () { if (no.parentNode) no.parentNode.removeChild(no); }, 200);
    }
    no.addEventListener('click', sair);
    return no;
  }

  /* ---------------------------------------------------------------- modal */

  var modaisAbertos = [];

  function modal(opts) {
    opts = opts || {};
    var backdrop = el('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' });
    var cx = el('div', { class: 'modal' + (opts.classe ? ' ' + opts.classe : '') });

    if (opts.titulo) {
      var head = el('div', { class: 'modal-head' });
      var h = el('span', { class: 'modal-title' });
      h.textContent = opts.titulo;
      head.appendChild(h);
      var x = el('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Fechar' }, '✕');
      x.addEventListener('click', function () { fechar(false); });
      head.appendChild(x);
      cx.appendChild(head);
      backdrop.setAttribute('aria-label', opts.titulo);
    }

    var body = el('div', { class: 'modal-body' });
    if (opts.html instanceof window.Node) body.appendChild(opts.html);
    else body.innerHTML = opts.html || '';
    cx.appendChild(body);

    if (opts.foot) {
      var foot = el('div', { class: 'modal-foot' });
      if (opts.foot instanceof window.Node) foot.appendChild(opts.foot);
      else foot.innerHTML = opts.foot;
      cx.appendChild(foot);
    }

    backdrop.appendChild(cx);
    document.body.appendChild(backdrop);
    document.body.classList.add('modal-aberto');

    var antesFoco = document.activeElement;
    var fechado = false;

    function fechar(motivo) {
      if (fechado) return;
      fechado = true;
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      var i = modaisAbertos.indexOf(ref);
      if (i >= 0) modaisAbertos.splice(i, 1);
      if (!modaisAbertos.length) document.body.classList.remove('modal-aberto');
      if (antesFoco && antesFoco.focus) { try { antesFoco.focus(); } catch (e) { /* ignora */ } }
      if (typeof opts.aoFechar === 'function') opts.aoFechar(motivo);
    }

    function onKey(ev) {
      if (ev.key === 'Escape' && modaisAbertos[modaisAbertos.length - 1] === ref) {
        ev.stopPropagation();
        if (opts.travado !== true) fechar(false);
      }
    }

    backdrop.addEventListener('mousedown', function (ev) {
      if (ev.target === backdrop && opts.travado !== true) fechar(false);
    });
    document.addEventListener('keydown', onKey, true);

    var ref = { el: cx, backdrop: backdrop, body: body, fechar: fechar };
    modaisAbertos.push(ref);

    // foco inicial: primeiro campo/botão do modal
    setTimeout(function () {
      var alvo = cx.querySelector('[autofocus]') ||
                 cx.querySelector('input,select,textarea,.btn-primary,button');
      if (alvo && alvo.focus) { try { alvo.focus(); } catch (e) { /* ignora */ } }
    }, 30);

    return ref;
  }

  function confirmar(opts) {
    opts = opts || {};
    var titulo = opts.titulo || 'Confirmar';
    var texto = opts.texto || 'Tem certeza?';
    var okTxt = opts.ok || 'Confirmar';
    var cancelarTxt = opts.cancelar || 'Cancelar';
    var perigo = opts.perigo === true;

    return new Promise(function (resolve) {
      var respondido = false;
      function responder(v) {
        if (respondido) return;
        respondido = true;
        m.fechar(v);
        resolve(v);
      }

      var foot = el('div');
      var bCancela = el('button', { type: 'button', class: 'btn btn-ghost' });
      bCancela.textContent = cancelarTxt;
      var bOk = el('button', { type: 'button', class: 'btn ' + (perigo ? 'btn-danger' : 'btn-primary') });
      bOk.textContent = okTxt;
      foot.appendChild(bCancela);
      foot.appendChild(bOk);
      bCancela.addEventListener('click', function () { responder(false); });
      bOk.addEventListener('click', function () { responder(true); });

      var corpo = el('div');
      if (opts.html) corpo.innerHTML = opts.html;
      else {
        var p = el('p', { class: 'muted' });
        p.textContent = texto;
        corpo.appendChild(p);
      }

      var m = modal({
        titulo: titulo,
        html: corpo,
        foot: foot,
        aoFechar: function () { if (!respondido) { respondido = true; resolve(false); } }
      });

      setTimeout(function () { try { bOk.focus(); } catch (e) { /* ignora */ } }, 30);
    });
  }

  /* ------------------------------------------------------------------ api */

  function api(path, opts) {
    opts = opts || {};
    var p = String(path || '');
    if (p.charAt(0) !== '/') p = '/' + p;
    if (p.indexOf('/api') !== 0) p = '/api' + p;

    var init = {
      method: (opts.method || 'GET').toUpperCase(),
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    };
    if (opts.headers) for (var k in opts.headers) if (Object.prototype.hasOwnProperty.call(opts.headers, k)) init.headers[k] = opts.headers[k];
    if (opts.body !== undefined && opts.body !== null) {
      if (typeof opts.body === 'string') {
        init.body = opts.body;
        if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
      } else {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
      if (init.method === 'GET') init.method = 'POST';
    }

    return window.fetch(p, init).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/login';
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      return res.text().then(function (txt) {
        var dados = null;
        if (txt) { try { dados = JSON.parse(txt); } catch (e) { dados = null; } }
        if (!res.ok || (dados && dados.ok === false)) {
          var msg = (dados && (dados.erro || dados.error || dados.mensagem)) ||
                    ('Erro ' + res.status + ' ao falar com o servidor.');
          toast(msg, 'err');
          var err = new Error(msg);
          err.status = res.status;
          err.dados = dados;
          throw err;
        }
        return dados === null ? {} : dados;
      });
    }, function (e) {
      if (e && e.status) throw e;                 // erro já tratado acima
      var msg = 'Sem conexão com o servidor.';
      toast(msg, 'err');
      var err2 = new Error(msg);
      err2.rede = true;
      throw err2;
    });
  }

  /* ------------------------------------------------------------- clipboard */

  function copiarFallback(texto) {
    var ta = document.createElement('textarea');
    ta.value = texto === null || texto === undefined ? '' : String(texto);
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var sel = document.getSelection();
    var antes = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (antes && sel) { sel.removeAllRanges(); sel.addRange(antes); }
    return ok;
  }

  function copiar(texto) {
    var txt = texto === null || texto === undefined ? '' : String(texto);
    function fim(ok) {
      toast(ok ? 'Copiado!' : 'Não consegui copiar. Selecione o texto e copie na mão.', ok ? 'ok' : 'err');
      return ok;
    }
    if (window.navigator && window.navigator.clipboard && window.isSecureContext) {
      return window.navigator.clipboard.writeText(txt)
        .then(function () { return fim(true); })
        .catch(function () { return fim(copiarFallback(txt)); });
    }
    return Promise.resolve(fim(copiarFallback(txt)));
  }

  /* --------------------------------------------------------------- whatsapp */

  function soDigitos(t) { return String(t === null || t === undefined ? '' : t).replace(/\D+/g, ''); }

  function waUrl(tel, txt) {
    var d = soDigitos(tel);
    if (d && d.length >= 10 && d.indexOf('55') !== 0) d = '55' + d;
    var q = '?text=' + encodeURIComponent(txt === null || txt === undefined ? '' : String(txt));
    return d ? 'https://wa.me/' + d + q : 'https://wa.me/' + q;
  }

  /* ------------------------------------------------------------------ mês */

  function normalizaMes(ano, mes) {
    var a = Number(ano), m = Number(mes);
    if (!a || !m || m < 1 || m > 12) return { ano: INICIO.ano, mes: INICIO.mes };
    if (a < INICIO.ano || (a === INICIO.ano && m < INICIO.mes)) return { ano: INICIO.ano, mes: INICIO.mes };
    return { ano: a, mes: m };
  }

  function mesCorrente() {
    var d = new Date();
    return normalizaMes(d.getFullYear(), d.getMonth() + 1);
  }

  function mesAtual() {
    try {
      var bruto = window.localStorage.getItem(CHAVE_MES);
      if (bruto) {
        var o = JSON.parse(bruto);
        if (o && o.ano && o.mes) return normalizaMes(o.ano, o.mes);
      }
    } catch (e) { /* localStorage indisponível */ }
    return mesCorrente();
  }

  function setMes(ano, mes) {
    var n = normalizaMes(ano, mes);
    try { window.localStorage.setItem(CHAVE_MES, JSON.stringify(n)); } catch (e) { /* ignora */ }
    return n;
  }

  /* ---------------------------------------------------------------- header */

  function mount(pagina) {
    var alvo = document.getElementById('app-header');
    if (!alvo) return null;

    var links = NAV.map(function (item) {
      var ativo = item.chave === pagina ? ' is-active' : '';
      var aria = item.chave === pagina ? ' aria-current="page"' : '';
      return '<a class="nav-link' + ativo + '" href="' + item.href + '"' + aria + '>' +
             '<span class="nav-ico" aria-hidden="true">' + item.icone + '</span>' +
             '<span>' + escapeHtml(item.titulo) + '</span></a>';
    }).join('');

    alvo.innerHTML =
      '<header class="app-header">' +
        '<div class="app-header-inner">' +
          '<a class="brand" href="/">' +
            '<span class="brand-logo" aria-hidden="true">🏡</span>' +
            '<span>Quintal<small>controle das casas</small></span>' +
          '</a>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="nav-toggle" id="nav-toggle" aria-label="Abrir menu" aria-expanded="false" aria-controls="nav-principal">' +
            '<span class="bars" aria-hidden="true"></span>' +
          '</button>' +
          '<nav class="nav" id="nav-principal" aria-label="Navegação principal">' + links + '</nav>' +
          '<div class="header-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm btn-icon" id="tema-toggle">☀️</button>' +
            '<form method="POST" action="/logout">' +
              '<button type="submit" class="btn btn-ghost btn-sm" title="Sair">Sair</button>' +
            '</form>' +
          '</div>' +
        '</div>' +
      '</header>';

    var btnTema = alvo.querySelector('#tema-toggle');
    if (btnTema) btnTema.addEventListener('click', function () { alternaTema(); });
    aplicaTema(temaAtual());   // acerta ícone/aria do botão recém-criado

    var botao = alvo.querySelector('#nav-toggle');
    var nav = alvo.querySelector('#nav-principal');
    if (botao && nav) {
      botao.addEventListener('click', function () {
        var aberto = nav.classList.toggle('is-open');
        botao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        botao.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
      });
      // fecha ao clicar num link ou fora do header
      nav.addEventListener('click', function (ev) {
        if (ev.target.closest('.nav-link')) fecharNav();
      });
      document.addEventListener('click', function (ev) {
        if (!nav.classList.contains('is-open')) return;
        if (alvo.contains(ev.target)) return;
        fecharNav();
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') fecharNav();
      });
    }
    function fecharNav() {
      if (!nav || !nav.classList.contains('is-open')) return;
      nav.classList.remove('is-open');
      botao.setAttribute('aria-expanded', 'false');
      botao.setAttribute('aria-label', 'Abrir menu');
    }

    document.body.setAttribute('data-pagina', pagina || '');
    return alvo;
  }

  /* ----------------------------------------------------------------- API  */

  var App = {
    INICIO: INICIO,
    MESES: MESES,
    NAV: NAV,

    mesLabel: mesLabel,
    nomeMes: nomeMes,

    api: api,

    money: money,
    num: num,
    toNum: toNum,

    dataBR: dataBR,
    dataCurta: dataCurta,
    hoje: hoje,
    diasAte: diasAte,
    statusVenc: statusVenc,

    escapeHtml: escapeHtml,
    toast: toast,
    confirmar: confirmar,
    modal: modal,
    copiar: copiar,
    waUrl: waUrl,

    mount: mount,
    tema: temaAtual,
    setTema: setTema,
    alternaTema: alternaTema,
    mesAtual: mesAtual,
    setMes: setMes,

    debounce: debounce,
    qs: qs,
    qsa: qsa,
    on: on,
    el: el
  };

  window.App = App;
})(window, document);
