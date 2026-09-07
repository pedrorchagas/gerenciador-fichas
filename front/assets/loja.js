/* =========================================================================
   loja.js — cardápio público, carrinho e ficha com o Pix.
   Rotas por hash: #/ (cardápio) · #/ficha/<orderId>
   ========================================================================= */
(function () {
  'use strict';

  var F = window.F;
  var view = document.getElementById('view');
  var catnav = document.getElementById('catnav');
  var cartbar = document.getElementById('cartbar');
  var topSub = document.getElementById('topSub');

  var CART_KEY = 'fichas:cart';
  var BUYER_KEY = 'fichas:buyer';
  var MINE_KEY = 'fichas:mine';

  var itemsById = {};          // catálogo carregado
  var groups = [];             // [{name, items}]
  var poll = null;             // timer da ficha
  var spy = null;              // IntersectionObserver das categorias

  /* ------------------------------------------------------------ storage */

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* modo privado */ }
  }

  function getCart() { return read(CART_KEY, {}); }
  function setCart(c) { write(CART_KEY, c); paintCartBar(); }

  function cartLines() {
    var c = getCart();
    var out = [];
    Object.keys(c).forEach(function (id) {
      var it = itemsById[id];
      if (!it || c[id] < 1) return;            // item desativado some sozinho
      out.push({ item: it, qty: c[id], sub: it.price * c[id] });
    });
    return out;
  }
  function cartTotal() {
    return cartLines().reduce(function (s, l) { return s + l.sub; }, 0);
  }
  function cartCount() {
    return cartLines().reduce(function (s, l) { return s + l.qty; }, 0);
  }

  function setQty(id, qty) {
    var c = getCart();
    if (qty > 0) c[id] = Math.min(qty, 99); else delete c[id];
    setCart(c);
  }

  function rememberOrder(order) {
    var mine = read(MINE_KEY, []).filter(function (m) { return m.orderId !== order.orderId; });
    mine.unshift({
      orderId: order.orderId,
      total: order.total,
      status: order.status,
      createdAt: order.createdAt
    });
    write(MINE_KEY, mine.slice(0, 20));
  }

  /* -------------------------------------------------------------- rotas */

  function route() {
    var h = location.hash.replace(/^#/, '');
    var m = h.match(/^\/ficha\/(.+)$/);
    stopPoll();
    if (m) { renderFicha(decodeURIComponent(m[1])); return; }
    renderMenu();
  }

  function go(hash) { location.hash = hash; }

  /* ----------------------------------------------------------- cardápio */

  async function renderMenu() {
    topSub.textContent = 'Cardápio';
    catnav.innerHTML = '';
    view.innerHTML = hero() + skeletonList();
    paintCartBar();

    var items;
    try {
      items = await F.api('/itens');
    } catch (err) {
      view.innerHTML = hero() +
        '<div class="state state--err">' +
          '<h3>O cardápio não carregou</h3>' +
          '<p>' + F.esc(err.message) + (err.details ? ' ' + F.esc(err.details) : '') + '</p>' +
          '<button class="btn" type="button" id="retry">Tentar de novo</button>' +
        '</div>';
      document.getElementById('retry').onclick = renderMenu;
      return;
    }

    itemsById = {};
    items.forEach(function (it) { itemsById[it.itemId] = it; });
    groups = F.groupByCategory(items);

    if (!items.length) {
      view.innerHTML = hero() +
        '<div class="state">' +
          '<h3>Cardápio ainda vazio</h3>' +
          '<p>Nenhum item foi liberado até agora. Volte daqui a pouco.</p>' +
          '<button class="btn" type="button" id="retry">Atualizar</button>' +
        '</div>';
      document.getElementById('retry').onclick = renderMenu;
      return;
    }

    catnav.innerHTML = groups.map(function (g) {
      return '<a href="#cat-' + slug(g.name) + '">' + F.esc(g.name) + '</a>';
    }).join('');

    view.innerHTML = hero() + groups.map(function (g, i) {
      return '<section class="cat" id="cat-' + slug(g.name) + '">' +
        '<div class="sec">' +
          '<span class="sec__n">' + pad(i + 1) + '</span>' +
          '<h2 class="sec__t">' + F.esc(g.name) + '</h2>' +
          '<span class="sec__c">' + g.items.length + '</span>' +
        '</div>' +
        '<div class="items">' + g.items.map(itemRow).join('') + '</div>' +
      '</section>';
    }).join('');

    startSpy();
    paintCartBar();
  }

  function hero() {
    return '<div class="hero">' +
      '<h1>Cardápio<br><em>feira da amizade 2026</em></h1>' +
      '<p>Escolha o que quiser das barracas, pague pelo Pix no celular e retire ' +
      'a ficha no caixa.</p>' +
      '<ul class="hero__steps">' +
        '<li><b>1</b> Monte o pedido</li>' +
        '<li><b>2</b> Pague no Pix</li>' +
        '<li><b>3</b> Retire suas fichas no caixa</li>' +
      '</ul>' +
    '</div>';
  }

  function skeletonList() {
    var row = '<div class="item"><div class="skel" style="width:74px;height:74px"></div>' +
      '<div><div class="skel" style="height:15px;width:62%;margin-bottom:8px"></div>' +
      '<div class="skel" style="height:12px;width:88%;margin-bottom:8px"></div>' +
      '<div class="skel" style="height:14px;width:34%"></div></div>' +
      '<div class="skel" style="width:38px;height:38px"></div></div>';
    return '<div class="sec"><span class="sec__n">01</span>' +
      '<h2 class="sec__t"><span class="skel" style="display:block;height:22px;width:170px"></span></h2></div>' +
      '<div class="items">' + row + row + row + '</div>';
  }

  function itemRow(it) {
    var c = getCart();
    var qty = c[it.itemId] || 0;
    var img = it.imageUrl
      ? '<img class="item__img" src="' + F.esc(it.imageUrl) + '" alt="" loading="lazy">'
      : '<div class="item__ph" aria-hidden="true">' + F.icon('image', 22) + '</div>';

    var ctrl = qty > 0
      ? '<div class="qty">' +
          '<button class="ib ib--sm" type="button" data-dec="' + it.itemId + '" aria-label="Remover uma unidade de ' + F.esc(it.label) + '">' + F.icon('minus', 16) + '</button>' +
          '<span class="qty__n" data-qty="' + it.itemId + '">' + qty + '</span>' +
          '<button class="ib ib--sm ib--go" type="button" data-inc="' + it.itemId + '" aria-label="Adicionar uma unidade de ' + F.esc(it.label) + '">' + F.icon('plus', 16) + '</button>' +
        '</div>'
      : '<button class="ib ib--go" type="button" data-inc="' + it.itemId + '" aria-label="Adicionar ' + F.esc(it.label) + ' ao pedido">' + F.icon('plus', 18) + '</button>';

    return '<article class="item' + (qty ? ' item--in' : '') + '" data-row="' + it.itemId + '">' +
      img +
      '<div class="item__b">' +
        '<h3 class="item__n">' + F.esc(it.label) + '</h3>' +
        (it.description ? '<p class="item__d">' + F.esc(it.description) + '</p>' : '') +
        '<div class="item__p">' + F.brl(it.price) + '</div>' +
      '</div>' +
      ctrl +
    '</article>';
  }

  // Delegação registrada uma vez só: `view` é reescrito a cada rota.
  view.addEventListener('click', function (e) {
    var inc = e.target.closest('[data-inc]');
    var dec = e.target.closest('[data-dec]');
    if (!inc && !dec) return;
    var id = (inc || dec).getAttribute(inc ? 'data-inc' : 'data-dec');
    setQty(id, (getCart()[id] || 0) + (inc ? 1 : -1));
    refreshRow(id);
  });

  // Só o card mexido é redesenhado — evita perder o scroll do cardápio.
  function refreshRow(id) {
    var el = view.querySelector('[data-row="' + id + '"]');
    if (!el || !itemsById[id]) return;
    var grouped = F.splitCategory(itemsById[id].name);
    var withLabel = Object.assign({}, itemsById[id], { label: grouped.label });
    el.outerHTML = itemRow(withLabel);
  }

  function startSpy() {
    if (spy) spy.disconnect();
    var links = Array.prototype.slice.call(catnav.querySelectorAll('a'));
    if (!links.length || !window.IntersectionObserver) return;
    spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) {
          var on = a.getAttribute('href') === '#' + en.target.id;
          a.setAttribute('aria-current', on ? 'true' : 'false');
          if (on) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
      });
    }, { rootMargin: '-124px 0px -62% 0px' });
    view.querySelectorAll('.cat').forEach(function (s) { spy.observe(s); });
  }

  /* --------------------------------------------------------- barra/carrinho */

  function paintCartBar() {
    var onMenu = !/^#\/ficha\//.test(location.hash);
    var n = cartCount();
    cartbar.hidden = !onMenu || n === 0;
    if (cartbar.hidden) return;
    document.getElementById('cartCount').textContent = n + (n === 1 ? ' item' : ' itens');
    document.getElementById('cartTotal').textContent = F.brl(cartTotal());
  }

  var dlgCart = document.getElementById('dlgCart');
  var cartBody = document.getElementById('cartBody');
  var cartFoot = document.getElementById('cartFoot');

  document.getElementById('btnCart').onclick = function () {
    renderCart();
    dlgCart.showModal();
  };

  function renderCart() {
    var lines = cartLines();
    if (!lines.length) {
      cartBody.innerHTML = '<div class="state state--sm">' +
        '<h3>Pedido vazio</h3><p>Volte ao cardápio e escolha alguma coisa.</p></div>';
      cartFoot.innerHTML = '<button class="btn" type="button" data-close>Voltar ao cardápio</button>';
      return;
    }

    var buyer = read(BUYER_KEY, { name: '', phone: '', email: '' });

    cartBody.innerHTML =
      lines.map(function (l) {
        var lbl = F.splitCategory(l.item.name).label;
        return '<div class="cl">' +
          '<div class="qty">' +
            '<button class="ib ib--sm" type="button" data-cdec="' + l.item.itemId + '" aria-label="Menos um ' + F.esc(lbl) + '">' + F.icon(l.qty === 1 ? 'trash' : 'minus', 15) + '</button>' +
            '<span class="qty__n">' + l.qty + '</span>' +
            '<button class="ib ib--sm" type="button" data-cinc="' + l.item.itemId + '" aria-label="Mais um ' + F.esc(lbl) + '">' + F.icon('plus', 15) + '</button>' +
          '</div>' +
          '<div class="cl__b"><div class="cl__n">' + F.esc(lbl) + '</div>' +
            '<div class="cl__m">' + F.brl(l.item.price) + ' cada</div></div>' +
          '<div class="cl__p">' + F.brl(l.sub) + '</div>' +
        '</div>';
      }).join('') +
      '<div class="tot"><span>Total</span><b>' + F.brl(cartTotal()) + '</b></div>' +
      '<div class="sec" style="margin-top:26px"><span class="sec__n">' + pad(groups.length + 1) + '</span>' +
        '<h2 class="sec__t">Seus dados</h2></div>' +
      '<form id="checkout" novalidate>' +
        field('name', 'Nome completo', 'text', buyer.name, 'Vai no caixa pra chamar você.') +
        '<div class="row">' +
          field('phone', 'Telefone', 'tel', buyer.phone, '') +
          field('email', 'E-mail', 'email', buyer.email, '') +
        '</div>' +
        '<p class="field__hint">O e-mail é exigido pelo Pix pra emitir a cobrança.</p>' +
      '</form>';

    cartFoot.innerHTML =
      '<button class="btn btn--ghost" type="button" data-close>Escolher mais</button>' +
      '<button class="btn btn--primary" type="submit" form="checkout" id="btnPay">' +
        F.icon('ticket', 18) + 'Gerar Pix' +
      '</button>';

    var phone = cartBody.querySelector('[name=phone]');
    phone.oninput = function () { phone.value = F.phoneMask(phone.value); };
    cartBody.querySelector('#checkout').onsubmit = submitOrder;
  }

  function field(name, label, type, value, hint) {
    return '<label class="field" data-f="' + name + '">' +
      '<span>' + label + '</span>' +
      '<input class="input" name="' + name + '" type="' + type + '" value="' + F.esc(value) + '" ' +
        'autocomplete="' + ({ name: 'name', phone: 'tel', email: 'email' }[name] || 'off') + '">' +
      (hint ? '<p class="field__hint">' + hint + '</p>' : '') +
      '<p class="field__err"></p>' +
    '</label>';
  }

  function validate(form) {
    var v = {
      name: form.name.value.trim(),
      phone: F.digits(form.phone.value),
      email: form.email.value.trim()
    };
    var errs = {};
    if (v.name.length < 2) errs.name = 'Escreva seu nome.';
    if (v.phone.length < 10 || v.phone.length > 11) errs.phone = 'Telefone com DDD, 10 ou 11 dígitos.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) errs.email = 'E-mail inválido.';

    ['name', 'phone', 'email'].forEach(function (k) {
      var wrap = form.querySelector('[data-f="' + k + '"]');
      wrap.classList.toggle('field--bad', !!errs[k]);
      wrap.querySelector('.field__err').textContent = errs[k] || '';
      form[k].setAttribute('aria-invalid', errs[k] ? 'true' : 'false');
    });

    var first = Object.keys(errs)[0];
    if (first) { form[first].focus(); return null; }
    return v;
  }

  async function submitOrder(e) {
    e.preventDefault();
    var form = e.target;
    var v = validate(form);
    if (!v) return;

    write(BUYER_KEY, { name: v.name, phone: F.phoneMask(v.phone), email: v.email });

    var lines = cartLines();
    if (!lines.length) return;

    var btn = document.getElementById('btnPay');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>Gerando Pix…';

    try {
      var order = await F.api('/pedidos', {
        method: 'POST',
        body: {
          buyerName: v.name,
          buyerPhone: v.phone,
          buyerEmail: v.email,
          items: lines.map(function (l) { return { itemId: l.item.itemId, quantity: l.qty }; })
        }
      });
      rememberOrder(order);
      setCart({});                              // pedido criado: carrinho zerado
      dlgCart.close();
      go('/ficha/' + encodeURIComponent(order.orderId));
    } catch (err) {
      // Falha ao gerar o Pix NÃO limpa o carrinho — a pessoa tenta de novo
      // sem remontar o pedido inteiro.
      F.toastError(err);
      btn.disabled = false;
      btn.innerHTML = F.icon('ticket', 18) + 'Gerar Pix';
    }
  }

  /* ---------------------------------------------------------------- ficha */

  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

  async function renderFicha(orderId) {
    topSub.textContent = 'Sua ficha';
    catnav.innerHTML = '';
    cartbar.hidden = true;
    view.innerHTML = '<div class="skel" style="height:230px;border-radius:6px"></div>';

    var order;
    try {
      order = await F.api('/pedidos/' + encodeURIComponent(orderId));
    } catch (err) {
      view.innerHTML = '<div class="state state--err">' +
        '<h3>Ficha não encontrada</h3><p>' + F.esc(err.message) + '</p>' +
        '<a class="btn" href="#/">Voltar ao cardápio</a></div>';
      return;
    }

    paintFicha(order);

    // Poll enquanto o Pix não confirma (contrato §Fluxo esperado — loja).
    // Pausa com a aba em segundo plano pra não torrar bateria na festa.
    if (order.status === 'pending') {
      poll = setInterval(async function () {
        if (document.hidden) return;
        try {
          var fresh = await F.api('/pedidos/' + encodeURIComponent(orderId));
          if (fresh.status !== order.status) {
            order = fresh;
            rememberOrder(fresh);
            paintFicha(fresh);
            if (fresh.status !== 'pending') {
              stopPoll();
              F.toast(fresh.status === 'cancelled'
                ? 'O pagamento não foi concluído.'
                : 'Pagamento confirmado! Retire no caixa.',
                fresh.status === 'cancelled' ? 'err' : 'ok');
            }
          }
        } catch (e) { /* rede oscilando na festa: tenta de novo no próximo tick */ }
      }, 5000);
    }
  }

  function paintFicha(o) {
    var code = F.ticketCode(o.orderId);
    var st = F.statusOf(o.status);

    var liveClass = o.status === 'pending' ? '' :
      (o.status === 'cancelled' ? ' live--bad' : ' live--ok');
    var liveMsg = {
      pending: 'Assim que o Pix cair, esta tela muda sozinha.',
      paid: 'Pagamento confirmado. Vá ao caixa com este número.',
      ready: 'Seu pedido já está separado, é só retirar.',
      delivered: 'Pedido entregue. Bom apetite!',
      cancelled: 'O pagamento não foi concluído. Refaça o pedido no cardápio.'
    }[o.status] || '';

    view.innerHTML =
      '<a class="btn btn--ghost btn--sm" href="#/" style="margin-bottom:16px">' + F.icon('back', 16) + 'Cardápio</a>' +

      '<div class="ticket">' +
        '<div class="ticket__top">' +
          '<div><span class="ticket__lbl">Nº da ficha</span>' + F.board(code, 'board--lg') + '</div>' +
          '<span class="ticket__st ticket__st--' + o.status + '">' + F.esc(st.label) + '</span>' +
        '</div>' +
        '<div class="ticket__rip" aria-hidden="true"></div>' +
        '<div class="ticket__body">' +
          '<div class="live' + liveClass + '">' +
            (o.status === 'pending' ? '<span class="spin"></span>' : F.icon('check', 18)) +
            '<span>' + F.esc(liveMsg) + '</span>' +
          '</div>' +

          (o.status === 'pending' && o.qrCodeBase64 ? pixBlock(o) : '') +

          '<div class="sec" style="margin-top:20px"><span class="sec__n">' + pad(1) + '</span>' +
            '<h2 class="sec__t">Itens</h2></div>' +
          (o.items || []).map(function (i) {
            return '<div class="cl">' +
              '<span class="qty__n">' + i.quantity + '×</span>' +
              '<div class="cl__b"><div class="cl__n">' + F.esc(F.splitCategory(i.name).label) + '</div>' +
                '<div class="cl__m">' + F.brl(i.unitPrice) + ' cada</div></div>' +
              '<div class="cl__p">' + F.brl(i.unitPrice * i.quantity) + '</div>' +
            '</div>';
          }).join('') +
          '<div class="tot"><span>Total</span><b>' + F.brl(o.total) + '</b></div>' +

          '<p class="field__hint" style="margin-top:16px">' +
            F.esc(o.buyerName) + ' · ' + F.esc(F.phoneMask(o.buyerPhone)) + ' · ' + F.esc(o.buyerEmail) +
            '<br>Pedido feito às ' + F.hhmm(o.createdAt) + '.' +
          '</p>' +
        '</div>' +
      '</div>' +

      (o.status === 'cancelled'
        ? '<a class="btn btn--primary btn--block" href="#/">Fazer outro pedido</a>' : '');

    var copy = document.getElementById('btnCopy');
    if (copy) copy.onclick = function () { copyPix(o.qrCode, copy); };
  }

  function pixBlock(o) {
    return '<div class="pix">' +
      '<img src="data:image/png;base64,' + F.esc(o.qrCodeBase64) + '" alt="QR code do Pix deste pedido" width="236" height="236">' +
      '<code class="pix__code">' + F.esc(o.qrCode) + '</code>' +
      '<button class="btn btn--go btn--block" type="button" id="btnCopy">' +
        F.icon('copy', 18) + 'Copiar código Pix' +
      '</button>' +
    '</div>';
  }

  async function copyPix(code, btn) {
    var done = function () {
      btn.innerHTML = F.icon('check', 18) + 'Código copiado';
      setTimeout(function () { btn.innerHTML = F.icon('copy', 18) + 'Copiar código Pix'; }, 2200);
    };
    try {
      await navigator.clipboard.writeText(code);
      done();
    } catch (e) {
      // clipboard bloqueado (http sem localhost, webview antiga): seleciona
      // o código pro usuário copiar na mão.
      var el = document.querySelector('.pix__code');
      var r = document.createRange();
      r.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      F.toast('Copie o código selecionado acima.');
    }
  }

  /* -------------------------------------------------------- minhas fichas */

  var dlgMine = document.getElementById('dlgMine');
  var btnMine = document.getElementById('btnMine');
  btnMine.onclick = function () {
    var mine = read(MINE_KEY, []);
    document.getElementById('mineBody').innerHTML = mine.length
      ? '<div class="mine">' + mine.map(function (m) {
          var st = F.statusOf(m.status);
          return '<a href="#/ficha/' + encodeURIComponent(m.orderId) + '" data-close>' +
            F.board(F.ticketCode(m.orderId), 'board--sm') +
            '<div class="mine__b"><div class="mine__t">' + F.brl(m.total) + '</div>' +
              '<div class="mine__m">' + F.esc(F.timeAgo(m.createdAt)) + '</div></div>' +
            '<span class="chip chip--' + m.status + '">' + F.esc(st.short) + '</span>' +
          '</a>';
        }).join('') + '</div>'
      : '<div class="state state--sm"><h3>Nenhuma ficha ainda</h3>' +
        '<p>Os pedidos feitos neste aparelho aparecem aqui.</p></div>';
    dlgMine.showModal();
  };

  /* ------------------------------------------------------------- utilidades */

  function slug(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sec';
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  // fecha qualquer <dialog> por [data-close] / clique no backdrop
  document.addEventListener('click', function (e) {
    var d = e.target.closest('dialog');
    if (!d) return;
    if (e.target.closest('[data-close]')) { d.close(); return; }
    if (e.target === d) d.close();               // backdrop
  });

  // +/- dentro do carrinho aberto
  cartBody.addEventListener('click', function (e) {
    var inc = e.target.closest('[data-cinc]');
    var dec = e.target.closest('[data-cdec]');
    if (!inc && !dec) return;
    var id = (inc || dec).getAttribute(inc ? 'data-cinc' : 'data-cdec');
    setQty(id, (getCart()[id] || 0) + (inc ? 1 : -1));
    renderCart();
    refreshRow(id);
  });

  window.addEventListener('hashchange', route);
  route();
})();
