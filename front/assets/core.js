/* =========================================================================
   core.js — acesso à API + helpers compartilhados (loja e painel).
   Script clássico, sem módulos e sem build step: expõe window.F.
   Contrato seguido à risca: docs/api-contract.md
   ========================================================================= */
(function () {
  'use strict';

  var hasWindow = typeof document !== 'undefined';

  /* Servido pela própria API (express.static) → mesma origem, sem CORS.
     Pra apontar pra outro host sem editar arquivo, no console do navegador:
       localStorage.setItem('fichas:apiBase', 'https://api.suafesta.org')      */
  var API_BASE = localStorage.getItem('fichas:apiBase') ||
    (hasWindow && /^https?:$/.test(location.protocol) ? location.origin : 'http://localhost:3000');

  var TOKEN_KEY = 'fichas:token';

  var auth = {
    get: function () { return localStorage.getItem(TOKEN_KEY); },
    set: function (t) { localStorage.setItem(TOKEN_KEY, t); },
    clear: function () { localStorage.removeItem(TOKEN_KEY); }
  };

  function ApiError(status, message, details) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.status = status;
    e.details = details;
    return e;
  }

  /* Único ponto de fetch. `authed: true` injeta o Bearer; 401 em rota logada
     dispara 'fichas:unauthorized' pro painel devolver o operador ao login. */
  async function api(path, opts) {
    opts = opts || {};
    var headers = {};
    var body = opts.body;
    var isForm = typeof FormData !== 'undefined' && body instanceof FormData;

    if (opts.authed) {
      var t = auth.get();
      if (!t) {
        window.dispatchEvent(new CustomEvent('fichas:unauthorized'));
        throw ApiError(401, 'Sessão expirada. Entre de novo.');
      }
      headers.Authorization = 'Bearer ' + t;
    }
    // multipart: NÃO setar Content-Type — o browser precisa definir o boundary.
    if (body && !isForm) headers['Content-Type'] = 'application/json';

    var res;
    try {
      res = await fetch(API_BASE + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: isForm ? body : (body ? JSON.stringify(body) : undefined)
      });
    } catch (e) {
      throw ApiError(0, 'Não foi possível falar com o servidor.',
        'Confira se a API está no ar em ' + API_BASE + '.');
    }

    if (res.status === 401 && opts.authed) {
      auth.clear();
      window.dispatchEvent(new CustomEvent('fichas:unauthorized'));
    }
    if (res.status === 204) return null;

    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw ApiError(res.status, data.message || ('Erro ' + res.status + '.'), data.details);
    return data;
  }

  /* --------------------------------------------------------------- formato */

  // price/total vêm em CENTAVOS (contrato §Itens).
  function brl(cents) {
    return ((Number(cents) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // "12,50" / "12.50" / "1.234,50" → centavos
  function reaisToCents(v) {
    var s = String(v == null ? '' : v).trim().replace(/[R$\s]/g, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s);
    return isNaN(n) ? NaN : Math.round(n * 100);
  }

  function centsToReais(cents) {
    return ((Number(cents) || 0) / 100).toFixed(2).replace('.', ',');
  }

  /* A API não tem número sequencial de pedido — o "nº da ficha" é um recorte
     do orderId (uuid). 5 caracteres: curto pra gritar no balcão, e espaço
     grande o bastante (~1M) pra não repetir numa festa. */
  function ticketCode(orderId) {
    return String(orderId || '').replace(/-/g, '').slice(-5).toUpperCase();
  }

  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  function phoneMask(v) {
    var d = digits(v).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  function timeAgo(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'agora';
    var m = Math.floor(s / 60);
    if (m < 60) return 'há ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'há ' + h + 'h';
    return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  function hhmm(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? '--:--' : new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------------ categorias */
  /* A API não tem campo de categoria (ver README §Categorias). A convenção
     acordada é o prefixo no próprio `name`: "Bebidas: Guaraná Lata".
     O painel escreve esse prefixo por você (campo "Categoria" no form). */

  function splitCategory(name) {
    var raw = String(name == null ? '' : name).trim();
    var i = raw.indexOf(':');
    if (i < 0) return { category: 'Outros', label: raw };
    var cat = raw.slice(0, i).trim();
    var label = raw.slice(i + 1).trim();
    if (!cat || !label) return { category: 'Outros', label: raw };
    return { category: cat, label: label };
  }

  function joinCategory(category, label) {
    var c = String(category || '').replace(/:/g, '').trim();
    var l = String(label || '').trim();
    return c ? c + ': ' + l : l;
  }

  /* [{name, items:[item + {label, category}]}] — "Outros" sempre por último. */
  function groupByCategory(items) {
    var order = [];
    var map = {};
    (items || []).forEach(function (it) {
      var s = splitCategory(it.name);
      if (!map[s.category]) { map[s.category] = []; order.push(s.category); }
      var copy = {};
      for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) copy[k] = it[k];
      copy.label = s.label;
      copy.category = s.category;
      map[s.category].push(copy);
    });
    order.sort(function (a, b) {
      if (a === 'Outros') return 1;
      if (b === 'Outros') return -1;
      return a.localeCompare(b, 'pt-BR');
    });
    return order.map(function (c) { return { name: c, items: map[c] }; });
  }

  /* ---------------------------------------------------------------- status */

  var STATUS = {
    pending:   { label: 'Aguardando Pix', short: 'Na fila' },
    paid:      { label: 'Pago',           short: 'Pago' },
    ready:     { label: 'Separado',       short: 'Separado' },
    delivered: { label: 'Entregue',       short: 'Entregue' },
    cancelled: { label: 'Cancelado',      short: 'Cancelado' }
  };

  function statusOf(s) { return STATUS[s] || { label: s || '—', short: s || '—' }; }

  /* Esteira linear única do quadro (spec §6.2). `cancelled` fica FORA do
     quadro — não é coluna e não entra na esteira.
     A API aceita qualquer transição (contrato §PATCH); é o front que só
     oferece as coerentes. */
  var FLOW = ['pending', 'paid', 'ready', 'delivered'];

  var COLUMNS = [
    { key: 'pending',   title: 'Fila total', hint: 'Aguardando pagamento' },
    { key: 'paid',      title: 'Pagos',      hint: 'Pix confirmado' },
    { key: 'ready',     title: 'Separados',  hint: 'Prontos pra entrega' },
    { key: 'delivered', title: 'Entregues',  hint: 'Fim do fluxo' }
  ];

  function nextStatus(status) {
    var i = FLOW.indexOf(status);
    return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null;
  }

  function prevStatus(status) {
    var i = FLOW.indexOf(status);
    return i > 0 ? FLOW[i - 1] : null;
  }

  /* Busca do quadro (spec §6.4): nome, e-mail e telefone. O nº da ficha entra
     de brinde porque é o que gritam no balcão. */
  function orderMatches(o, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    var qd = digits(q);
    return String(o.buyerName || '').toLowerCase().indexOf(q) >= 0
      || String(o.buyerEmail || '').toLowerCase().indexOf(q) >= 0
      || (qd.length >= 3 && digits(o.buyerPhone).indexOf(qd) >= 0)
      || ticketCode(o.orderId).toLowerCase().indexOf(q.replace('#', '')) >= 0;
  }

  function byNewest(a, b) {
    return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
  }

  /* ---------------------------------------------------------------- toasts */

  function toast(message, kind, title) {
    if (!hasWindow) return;
    var box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.innerHTML = title
      ? '<b>' + esc(title) + '</b><span>' + esc(message) + '</span>'
      : '<span>' + esc(message) + '</span>';
    box.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 320);
    }, kind === 'err' ? 6000 : 3600);
  }

  function toastError(err) {
    toast((err && err.message) || 'Algo deu errado.', 'err', err && err.details ? err.details : '');
  }

  /* ------------------------------------------------------------ ícones SVG */
  /* Traço grosso arredondado (família Phosphor), inline: 14 ícones não pagam
     uma dependência de CDN — e a festa pode estar sem internet boa. */
  var ICONS = {
    cart:    '<path d="M3 5h2.2l2.3 10.2A2 2 0 0 0 9.45 17H18a2 2 0 0 0 1.95-1.55L21.5 8.5H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
    arrowR:  '<path d="M5 12h13"/><path d="M13 6.5 18.5 12 13 17.5"/>',
    arrowL:  '<path d="M19 12H6"/><path d="M11 17.5 5.5 12 11 6.5"/>',
    search:  '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    close:   '<path d="M6 6l12 12M18 6 6 18"/>',
    plus:    '<path d="M12 5v14M5 12h14"/>',
    minus:   '<path d="M5 12h14"/>',
    trash:   '<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>',
    pencil:  '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 6.5 3 3"/>',
    copy:    '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
    check:   '<path d="m5 12.5 5 5L19 7"/>',
    ticket:  '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.6a2.4 2.4 0 0 0 0 4.8V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.6a2.4 2.4 0 0 0 0-4.8V8Z"/><path d="M13 6v2m0 3v2m0 3v2" stroke-dasharray="2 2"/>',
    logout:  '<path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8 6 12l4 4"/><path d="M6 12h9"/>',
    image:   '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4.5 4 2.5-2 4.5 4"/>',
    box:     '<path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    back:    '<path d="M15 5 8 12l7 7"/>'
  };

  function icon(name, size) {
    var s = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  }

  /* Wildcard da identidade: nº da ficha em dígitos de placar mecânico. */
  function board(code, cls) {
    return '<span class="board ' + (cls || '') + '" aria-label="Ficha ' + esc(code) + '">' +
      String(code).split('').map(function (c) { return '<b>' + esc(c) + '</b>'; }).join('') +
      '</span>';
  }

  /* Ícone declarado no próprio HTML: <button data-icon="close" data-icon-size="15">
     Evita esquecer um botão vazio e some com meia dúzia de innerHTML soltos. */
  function paintIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      el.insertAdjacentHTML('afterbegin', icon(el.getAttribute('data-icon'), Number(el.getAttribute('data-icon-size')) || 20));
      el.removeAttribute('data-icon');
    });
  }

  window.F = {
    API_BASE: API_BASE,
    api: api,
    auth: auth,
    brl: brl,
    reaisToCents: reaisToCents,
    centsToReais: centsToReais,
    ticketCode: ticketCode,
    digits: digits,
    phoneMask: phoneMask,
    timeAgo: timeAgo,
    hhmm: hhmm,
    esc: esc,
    splitCategory: splitCategory,
    joinCategory: joinCategory,
    groupByCategory: groupByCategory,
    STATUS: STATUS,
    statusOf: statusOf,
    FLOW: FLOW,
    COLUMNS: COLUMNS,
    nextStatus: nextStatus,
    prevStatus: prevStatus,
    orderMatches: orderMatches,
    byNewest: byNewest,
    toast: toast,
    toastError: toastError,
    icon: icon,
    board: board,
    paintIcons: paintIcons
  };

  if (hasWindow) paintIcons();     // scripts ficam no fim do <body>: DOM pronto
})();
