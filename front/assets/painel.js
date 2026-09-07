/* =========================================================================
   painel.js — área logada do operador.
   Fila: quadro kanban de 4 colunas em tempo real (Socket.IO), setas movendo
   pela esteira pending → paid → ready → delivered. Cancelados ficam FORA do
   quadro (spec §6.2), num bloco separado, só pra o operador não perder de
   vista um Pix que expirou.
   Cardápio: CRUD de itens (multipart, contrato §Itens).
   ========================================================================= */
(function () {
  'use strict';

  var F = window.F;
  var $ = function (id) { return document.getElementById(id); };

  var elLogin = $('login'), elApp = $('app');
  var orders = {};            // orderId -> pedido
  var items = [];             // catálogo (inclui só ativos: GET /itens)
  var query = '';
  var shown = {};             // quantos cards já renderizados por coluna
  var PAGE = 60;
  var socket = null;
  var pollTimer = null;
  var justMoved = {};         // orderId -> true, pra destacar o card que mudou

  /* ====================================================== 1. sessão/login */

  function showLogin(msg) {
    stopRealtime();
    elApp.hidden = true;
    elLogin.hidden = false;
    if (msg) F.toast(msg, 'err', 'Sessão');
    var e = $('loginForm').email;
    if (e) e.focus();
  }

  window.addEventListener('fichas:unauthorized', function () {
    if (!elApp.hidden) showLogin('Sua sessão expirou. Entre de novo.');
  });

  var mode = 'login';   // 'login' | 'register'

  $('btnToggleMode').onclick = function () {
    mode = mode === 'login' ? 'register' : 'login';
    $('btnLogin').textContent = mode === 'login' ? 'Entrar' : 'Criar conta e entrar';
    $('altText').textContent = mode === 'login' ? 'Ainda não tem acesso?' : 'Já tem uma conta?';
    $('btnToggleMode').textContent = mode === 'login' ? 'Criar conta de operador' : 'Voltar pro login';
    $('loginForm').password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('fieldSecret').hidden = mode === 'login';
  };

  $('loginForm').onsubmit = async function (e) {
    e.preventDefault();
    var form = e.target;
    var email = form.email.value.trim();
    var password = form.password.value;

    var errs = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errs.email = 'E-mail inválido.';
    if (password.length < 6) errs.password = 'A senha precisa de pelo menos 6 caracteres.';
    if (mode === 'register' && !form.secret.value) errs.secret = 'Informe a senha de cadastro.';
    ['email', 'password', 'secret'].forEach(function (k) {
      var w = form.querySelector('[data-f="' + k + '"]');
      w.classList.toggle('field--bad', !!errs[k]);
      w.querySelector('.field__err').textContent = errs[k] || '';
      form[k].setAttribute('aria-invalid', errs[k] ? 'true' : 'false');
    });
    var first = Object.keys(errs)[0];
    if (first) { form[first].focus(); return; }

    var btn = $('btnLogin');
    btn.disabled = true;
    var was = btn.textContent;
    btn.innerHTML = '<span class="spin"></span>Entrando…';

    try {
      if (mode === 'register') {
        await F.api('/auth/register', {
          method: 'POST',
          body: { email: email, password: password, registerSecret: form.secret.value }
        });
      }
      var r = await F.api('/auth/login', { method: 'POST', body: { email: email, password: password } });
      F.auth.set(r.token);
      form.password.value = '';
      form.secret.value = '';
      boot();
    } catch (err) {
      F.toastError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  };

  $('btnLogout').onclick = async function () {
    if (!await confirmDlg('Sair do painel', 'A fila para de atualizar neste aparelho até você entrar de novo.', 'Sair')) return;
    F.auth.clear();
    showLogin();
  };

  /* ============================================================ 2. abas */

  function tab(which) {
    var fila = which === 'fila';
    $('tabFila').setAttribute('aria-selected', fila);
    $('tabMenu').setAttribute('aria-selected', !fila);
    $('paneFila').hidden = !fila;
    $('paneMenu').hidden = fila;
    if (!fila) renderMenu();
  }
  $('tabFila').onclick = function () { tab('fila'); };
  $('tabMenu').onclick = function () { tab('menu'); };

  /* ========================================================== 3. boot */

  async function boot() {
    if (!F.auth.get()) { showLogin(); return; }
    elLogin.hidden = true;
    elApp.hidden = false;
    renderKanban(true);
    await Promise.all([loadOrders(), loadItems()]);
    startRealtime();
  }

  async function loadOrders() {
    try {
      var list = await F.api('/pedidos', { authed: true });
      orders = {};
      list.forEach(function (o) { orders[o.orderId] = o; });
      renderKanban();
    } catch (err) {
      if (err.status !== 401) {
        $('kanban').innerHTML = '<div class="state state--err" style="grid-column:1/-1">' +
          '<h3>A fila não carregou</h3><p>' + F.esc(err.message) + '</p>' +
          '<button class="btn" type="button" id="retryOrders">Tentar de novo</button></div>';
        $('retryOrders').onclick = loadOrders;
      }
    }
  }

  async function loadItems() {
    try { items = await F.api('/itens'); } catch (e) { items = []; }
  }

  /* ================================================== 4. tempo real (WS) */

  function setLive(state, text) {
    var el = $('live');
    el.className = 'brand__s is-' + state;
    el.textContent = text;
  }

  function startRealtime() {
    // O próprio servidor serve o cliente na versão certa — sem CDN,
    // sem risco de versão trocada (contrato §Tempo real).
    if (window.io) return connectSocket();
    var s = document.createElement('script');
    s.src = F.API_BASE + '/socket.io/socket.io.js';
    s.onload = connectSocket;
    s.onerror = function () { startPolling('cliente do Socket.IO indisponível'); };
    document.head.appendChild(s);
  }

  function connectSocket() {
    try {
      socket = window.io(F.API_BASE, { auth: { token: F.auth.get() }, transports: ['websocket', 'polling'] });
    } catch (e) {
      startPolling('não deu pra abrir o WebSocket');
      return;
    }

    socket.on('connect', function () {
      stopPolling();
      setLive('live', 'ao vivo');
    });

    socket.on('pedidoAtualizado', function (order) {
      if (!order || !order.orderId) return;
      var before = orders[order.orderId];
      orders[order.orderId] = order;                       // upsert por orderId
      if (!before || before.status !== order.status) {
        justMoved[order.orderId] = true;
        setTimeout(function () { delete justMoved[order.orderId]; }, 2600);
      }
      if (!before) F.toast('Pedido novo de ' + order.buyerName + '.', 'ok', 'Ficha ' + F.ticketCode(order.orderId));
      renderKanban();
    });

    socket.on('connect_error', function (err) {
      // "Token não informado." / "Token inválido ou expirado." → sessão morta.
      if (/[Tt]oken/.test(err && err.message || '')) {
        socket.close();
        socket = null;
        F.auth.clear();
        showLogin('Sua sessão expirou. Entre de novo.');
        return;
      }
      startPolling('servidor de tempo real fora');
    });

    socket.on('disconnect', function () { setLive('off', 'reconectando…'); });
  }

  // Rede da festa cai. Sem WS o painel continua servindo — só mais devagar.
  function startPolling(why) {
    setLive('poll', 'sem tempo real');
    if (why) console.warn('[painel] fallback pra poll:', why);
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (!document.hidden && F.auth.get()) loadOrders();
    }, 10000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function stopRealtime() {
    stopPolling();
    if (socket) { socket.close(); socket = null; }
    setLive('off', 'desconectado');
  }

  /* ============================================================ 5. busca */

  $('q').addEventListener('input', function () {
    query = this.value;
    $('qClear').hidden = !query;
    shown = {};
    renderKanban();
  });
  $('qClear').onclick = function () {
    $('q').value = ''; query = ''; this.hidden = true; shown = {}; renderKanban(); $('q').focus();
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !elApp.hidden) {
      e.preventDefault(); $('q').focus();
    }
  });

  /* =========================================================== 6. kanban */

  function visible(status) {
    return Object.keys(orders)
      .map(function (k) { return orders[k]; })
      .filter(function (o) { return o.status === status && F.orderMatches(o, query); })
      .sort(F.byNewest);                     // mais recente primeiro (spec §6.1)
  }

  function renderKanban(loading) {
    var box = $('kanban');
    var total = 0;

    box.innerHTML = F.COLUMNS.map(function (col, i) {
      var list = loading ? [] : visible(col.key);
      total += list.length;
      var cap = shown[col.key] || PAGE;
      var page = list.slice(0, cap);

      var body = loading
        ? '<div class="skel" style="height:118px"></div><div class="skel" style="height:118px"></div>'
        : (page.length
            ? page.map(card).join('') +
              (list.length > cap
                ? '<button class="btn btn--ghost btn--sm" type="button" data-more="' + col.key + '">' +
                  'Mostrar mais ' + Math.min(PAGE, list.length - cap) + '</button>'
                : '')
            : emptyCol(col, query));

      return '<section class="col col--' + col.key + '" aria-label="' + F.esc(col.title) + '">' +
        '<div class="col__head">' +
          '<span class="col__n">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<h2 class="col__t">' + F.esc(col.title) + '</h2>' +
          '<span class="col__c">' + (loading ? '·' : list.length) + '</span>' +
        '</div>' +
        '<div class="col__hint">' + F.esc(col.hint) + '</div>' +
        '<div class="col__body">' + body + '</div>' +
      '</section>';
    }).join('');

    if (!loading) {
      $('qCount').textContent = query
        ? total + (total === 1 ? ' pedido encontrado' : ' pedidos encontrados')
        : total + ' no fluxo';
      renderCancelled();
    }
  }

  // Vazio é a tela que o operador mais vê no começo da festa — e nunca é
  // um beco sem saída.
  function emptyCol(col, q) {
    if (q) {
      return '<div class="state state--sm"><h3>Nada aqui</h3>' +
        '<p>Nenhum pedido nesta coluna bate com “' + F.esc(q) + '”.</p></div>';
    }
    var msg = {
      pending:   'Assim que alguém finalizar um pedido no cardápio, ele cai aqui.',
      paid:      'Os pedidos aparecem aqui sozinhos quando o Pix confirma.',
      ready:     'Separou o pedido? Use a seta → na coluna Pagos.',
      delivered: 'Entregou? Use a seta → na coluna Separados.'
    }[col.key];
    return '<div class="state state--sm"><h3>Coluna vazia</h3><p>' + F.esc(msg) + '</p></div>';
  }

  function card(o) {
    var code = F.ticketCode(o.orderId);
    var prev = F.prevStatus(o.status);
    var next = F.nextStatus(o.status);
    var st = F.statusOf(o.status);

    // Ação desabilitada sempre diz por quê (title + aria-label).
    var out = o.status === 'cancelled';
    var whyPrev = prev ? 'Voltar para ' + F.statusOf(prev).short
      : (out ? 'Pedido cancelado — fora da esteira' : 'Primeira coluna do fluxo — não há para onde voltar');
    var whyNext = next ? 'Mover para ' + F.statusOf(next).short
      : (out ? 'Pedido cancelado — fora da esteira' : 'Última coluna do fluxo — o pedido já foi entregue');

    var lines = (o.items || []).map(function (i) {
      return '<b>' + i.quantity + '×</b> ' + F.esc(F.splitCategory(i.name).label);
    }).join(' · ');

    return '<article class="o' + (justMoved[o.orderId] ? ' is-new' : '') + '" data-o="' + F.esc(o.orderId) + '">' +
      '<div class="o__top">' +
        F.board(code, 'board--sm') +
        '<span class="chip chip--' + o.status + '">' + F.esc(st.short) + '</span>' +
        '<span class="o__when" title="' + F.esc(o.createdAt || '') + '">' + F.hhmm(o.createdAt) + '</span>' +
      '</div>' +

      '<h3 class="o__name">' + F.esc(o.buyerName || '—') + '</h3>' +
      '<div class="o__contact">' +
        '<a href="tel:' + F.esc(F.digits(o.buyerPhone)) + '">' + F.esc(F.phoneMask(o.buyerPhone)) + '</a>' +
        '<a href="mailto:' + F.esc(o.buyerEmail) + '">' + F.esc(o.buyerEmail || '—') + '</a>' +
      '</div>' +

      (lines ? '<p class="o__items">' + lines + '</p>' : '') +

      '<div class="o__foot">' +
        '<button class="ib ib--sm" type="button" data-move="prev" data-id="' + F.esc(o.orderId) + '" ' +
          (prev ? '' : 'disabled ') + 'title="' + F.esc(whyPrev) + '" aria-label="' + F.esc(whyPrev) + '">' + F.icon('arrowL', 16) + '</button>' +
        '<span class="o__total">' + F.brl(o.total) + '</span>' +
        '<button class="ib ib--sm' + (next ? ' ib--go' : '') + '" type="button" data-move="next" data-id="' + F.esc(o.orderId) + '" ' +
          (next ? '' : 'disabled ') + 'title="' + F.esc(whyNext) + '" aria-label="' + F.esc(whyNext) + '">' + F.icon('arrowR', 16) + '</button>' +
      '</div>' +
    '</article>';
  }

  $('kanban').addEventListener('click', function (e) {
    var more = e.target.closest('[data-more]');
    if (more) {
      var k = more.getAttribute('data-more');
      shown[k] = (shown[k] || PAGE) + PAGE;
      renderKanban();
      return;
    }
    var btn = e.target.closest('[data-move]');
    if (btn) move(btn, btn.getAttribute('data-id'), btn.getAttribute('data-move'));
  });

  async function move(btn, orderId, dir) {
    var o = orders[orderId];
    if (!o) return;
    var to = dir === 'next' ? F.nextStatus(o.status) : F.prevStatus(o.status);
    if (!to) return;

    // Única confirmação da esteira: marcar pago na mão é dizer que o dinheiro
    // entrou sem o webhook do Pix ter confirmado.
    if (o.status === 'pending' && to === 'paid') {
      var ok = await confirmDlg(
        'Marcar como pago?',
        'O Pix desta ficha ainda não foi confirmado pelo Mercado Pago. Só confirme se você viu o pagamento.',
        'Marcar pago');
      if (!ok) return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    try {
      var updated = await F.api('/pedidos/' + encodeURIComponent(orderId) + '/status', {
        method: 'PATCH', authed: true, body: { status: to }
      });
      orders[orderId] = updated;          // não depende do socket pra refletir
      justMoved[orderId] = true;
      setTimeout(function () { delete justMoved[orderId]; }, 2600);
      renderKanban();
    } catch (err) {
      F.toastError(err);
      renderKanban();
    }
  }

  /* Cancelados saem do quadro (spec §6.2). Ficam num bloco recolhido só pra
     o operador não perder de vista um Pix que expirou sozinho. */
  function renderCancelled() {
    var list = Object.keys(orders).map(function (k) { return orders[k]; })
      .filter(function (o) { return o.status === 'cancelled' && F.orderMatches(o, query); })
      .sort(F.byNewest);

    var btn = $('btnCancelled');
    btn.hidden = !list.length;
    btn.innerHTML = F.icon('close', 14) + list.length + ' cancelado' + (list.length === 1 ? '' : 's');

    var open = btn.getAttribute('aria-pressed') === 'true' && list.length > 0;
    $('cancelledBox').hidden = !open;
    if (!open) return;
    $('cancelledCount').textContent = list.length;
    $('cancelledList').innerHTML = list.map(card).join('');
  }

  $('btnCancelled').onclick = function () {
    this.setAttribute('aria-pressed', this.getAttribute('aria-pressed') !== 'true');
    renderCancelled();
  };

  /* ========================================================= 7. cardápio */

  function renderMenu() {
    var groups = F.groupByCategory(items);
    $('menuCount').textContent = items.length + (items.length === 1 ? ' item ativo' : ' itens ativos');
    $('cats').innerHTML = groups
      .filter(function (g) { return g.name !== 'Outros'; })
      .map(function (g) { return '<option value="' + F.esc(g.name) + '">'; }).join('');

    if (!items.length) {
      $('menuList').innerHTML = '<div class="state"><h3>Nenhum item cadastrado</h3>' +
        '<p>O cardápio público está vazio. Crie o primeiro item pra abrir a festa.</p></div>';
      return;
    }

    $('menuList').innerHTML = groups.map(function (g) {
      return '<div class="mitem__c" style="margin:18px 0 7px">' + F.esc(g.name) + '</div>' +
        g.items.map(function (it) {
          return '<div class="mitem">' +
            (it.imageUrl
              ? '<img src="' + F.esc(it.imageUrl) + '" alt="" loading="lazy">'
              : '<div class="item__ph">' + F.icon('image', 20) + '</div>') +
            '<div class="mitem__b">' +
              '<div class="mitem__n">' + F.esc(it.label) + '</div>' +
              (it.description ? '<div class="field__hint" style="margin:3px 0 0">' + F.esc(it.description) + '</div>' : '') +
              '<div class="mitem__p">' + F.brl(it.price) + '</div>' +
            '</div>' +
            '<div class="mitem__a">' +
              '<button class="ib ib--sm" type="button" data-edit="' + F.esc(it.itemId) + '" title="Editar" aria-label="Editar ' + F.esc(it.label) + '">' + F.icon('pencil', 15) + '</button>' +
              '<button class="ib ib--sm" type="button" data-del="' + F.esc(it.itemId) + '" title="Desativar" aria-label="Desativar ' + F.esc(it.label) + '">' + F.icon('trash', 15) + '</button>' +
            '</div>' +
          '</div>';
        }).join('');
    }).join('');
  }

  $('menuList').addEventListener('click', async function (e) {
    var ed = e.target.closest('[data-edit]');
    var de = e.target.closest('[data-del]');
    if (ed) return openItem(find(ed.getAttribute('data-edit')));
    if (!de) return;

    var it = find(de.getAttribute('data-del'));
    if (!it) return;
    var lbl = F.splitCategory(it.name).label;
    if (!await confirmDlg('Desativar “' + lbl + '”?',
      'Ele some do cardápio público na hora. Pedidos antigos continuam intactos, e dá pra recriar depois.',
      'Desativar')) return;
    try {
      await F.api('/itens/' + encodeURIComponent(it.itemId), { method: 'DELETE', authed: true });
      items = items.filter(function (x) { return x.itemId !== it.itemId; });
      renderMenu();
      F.toast('“' + lbl + '” saiu do cardápio.', 'ok');
    } catch (err) { F.toastError(err); }
  });

  function find(id) {
    for (var i = 0; i < items.length; i++) if (items[i].itemId === id) return items[i];
    return null;
  }

  /* ------------------------------------------------- formulário de item */

  var dlgItem = $('dlgItem'), itemForm = $('itemForm');
  var editing = null;
  var dirty = false;

  $('btnNewItem').onclick = function () { openItem(null); };

  function openItem(it) {
    editing = it;
    dirty = false;
    $('dlgItemTitle').textContent = it ? 'Editar item' : 'Novo item';
    $('itemSave').textContent = it ? 'Salvar alterações' : 'Criar item';

    var s = it ? F.splitCategory(it.name) : { category: '', label: '' };
    itemForm.category.value = s.category === 'Outros' ? '' : s.category;
    itemForm.label.value = s.label;
    itemForm.description.value = (it && it.description) || '';
    itemForm.price.value = it ? F.centsToReais(it.price) : '';
    $('imgInput').value = '';
    setPreview(it && it.imageUrl ? it.imageUrl : null);
    $('imgHint').textContent = it
      ? 'Deixe em branco pra manter a foto atual.'
      : 'Sem foto, o cardápio mostra um espaço reservado.';

    itemForm.querySelectorAll('.field').forEach(function (f) {
      f.classList.remove('field--bad');
      var p = f.querySelector('.field__err');
      if (p) p.textContent = '';
    });

    dlgItem.showModal();
    itemForm.category.focus();
  }

  function setPreview(url) {
    var img = $('imgPreview'), empty = $('imgEmpty');
    if (url) { img.src = url; img.hidden = false; empty.hidden = true; }
    else {
      img.removeAttribute('src'); img.hidden = true; empty.hidden = false;
      empty.innerHTML = F.icon('image', 26) + '<span>Toque pra escolher uma foto</span>';
    }
  }

  itemForm.addEventListener('input', function () { dirty = true; });

  $('imgInput').onchange = function () {
    var f = this.files && this.files[0];
    dirty = true;
    if (!f) { setPreview(editing && editing.imageUrl ? editing.imageUrl : null); return; }
    // A API ignora silenciosamente arquivo >5MB ou não-imagem (contrato §POST
    // /itens) — o item seria criado sem foto e sem aviso. Avisamos aqui.
    if (!/^image\//.test(f.type) || f.size > 5 * 1024 * 1024) {
      this.value = '';
      setPreview(editing && editing.imageUrl ? editing.imageUrl : null);
      F.toast('A foto precisa ser uma imagem de até 5 MB.', 'err');
      return;
    }
    setPreview(URL.createObjectURL(f));
  };

  async function closeItem() {
    if (dirty && !await confirmDlg('Descartar alterações?',
      'O que você digitou neste item ainda não foi salvo.', 'Descartar')) return;
    dlgItem.close();
  }
  $('itemCancel').onclick = closeItem;
  $('itemCancel2').onclick = closeItem;
  dlgItem.addEventListener('cancel', function (e) { e.preventDefault(); closeItem(); });

  itemForm.onsubmit = async function (e) {
    e.preventDefault();
    var label = itemForm.label.value.trim();
    var cents = F.reaisToCents(itemForm.price.value);

    var errs = {};
    if (!label) errs.label = 'O item precisa de um nome.';
    if (isNaN(cents) || cents <= 0) errs.price = 'Preço em reais, ex: 6,00.';
    if (itemForm.category.value.indexOf(':') >= 0) errs.category = 'A categoria não pode ter “:”.';
    ['label', 'price', 'category'].forEach(function (k) {
      var w = itemForm.querySelector('[data-f="' + k + '"]');
      w.classList.toggle('field--bad', !!errs[k]);
      w.querySelector('.field__err').textContent = errs[k] || '';
      itemForm[k].setAttribute('aria-invalid', errs[k] ? 'true' : 'false');
    });
    var first = Object.keys(errs)[0];
    if (first) { itemForm[first].focus(); return; }

    // multipart/form-data — sem Content-Type manual (contrato §POST /itens).
    var fd = new FormData();
    fd.append('name', F.joinCategory(itemForm.category.value, label));
    fd.append('description', itemForm.description.value.trim());
    fd.append('price', String(cents));           // centavos, como texto
    var file = $('imgInput').files[0];
    if (file) fd.append('image', file);

    var btn = $('itemSave');
    btn.disabled = true;
    var was = btn.textContent;
    btn.innerHTML = '<span class="spin"></span>Salvando…';

    try {
      var saved = editing
        ? await F.api('/itens/' + encodeURIComponent(editing.itemId), { method: 'PUT', authed: true, body: fd })
        : await F.api('/itens', { method: 'POST', authed: true, body: fd });

      items = items.filter(function (x) { return x.itemId !== saved.itemId; }).concat([saved]);
      dirty = false;
      dlgItem.close();
      renderMenu();
      F.toast(editing ? 'Item atualizado.' : 'Item no cardápio.', 'ok');
    } catch (err) {
      F.toastError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  };

  /* ======================================================== 8. confirmar */

  var dlgCf = $('dlgConfirm');
  function confirmDlg(title, body, yes) {
    return new Promise(function (resolve) {
      $('cfTitle').textContent = title;
      $('cfBody').textContent = body;
      $('cfYes').textContent = yes || 'Confirmar';
      // Esc e backdrop também fecham o <dialog>, então a resposta é sempre
      // lida no evento 'close' — nunca no clique.
      var answer = false;
      var onClose = function () {
        dlgCf.removeEventListener('close', onClose);
        $('cfYes').onclick = $('cfNo').onclick = null;
        resolve(answer);
      };
      $('cfYes').onclick = function () { answer = true; dlgCf.close(); };
      $('cfNo').onclick = function () { answer = false; dlgCf.close(); };
      dlgCf.addEventListener('close', onClose);
      dlgCf.showModal();
      $('cfNo').focus();
    });
  }

  boot();
})();
