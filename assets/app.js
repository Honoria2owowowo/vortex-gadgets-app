/* ============================================================
   VÓRTEX Gadgets — app.js v3 (PWA catálogo + pedidos WhatsApp)
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Configuración ---------- */
  var CONFIG = {
    waNumber: '573181738642',              // WhatsApp de pedidos
    waDisplay: '+57 318 173 8642',
    storeUrl: 'https://vortexgadgets.com.co',
    shopDomain: 'kvrfbn-n1.myshopify.com', // dominio de la API
    storefrontToken: 'd93566827739f74089b5b9933113035c', // token público (catálogo)
    apiVersion: '2026-01',
    currency: 'COP',
    couponCode: 'VORTEX10',                // cupón 10% OFF
    couponPct: 10,
    flashMinutes: 15                       // duración del contador flash
  };

  /* ---------- Utilidades ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  var moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: CONFIG.currency, maximumFractionDigits: 0 });
  function money(n) { return moneyFmt.format(Math.round(Number(n) || 0)); }
  function pctOff(price, compare) {
    if (!compare || compare <= price) return 0;
    return Math.round(((compare - price) / compare) * 100);
  }
  function stripHtml(h) {
    var d = document.createElement('div');
    d.innerHTML = h || '';
    return (d.textContent || '').trim();
  }
  function toast(msg, err) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!err);
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.hidden = true; }, 300); }, 3000);
  }
  function spinner() { return '<div class="spin"></div>'; }
  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  /* ---------- Estado ---------- */
  var state = {
    products: [], collections: [], loading: true, searchTerm: ''
  };
  function loadCart() {
    try { return JSON.parse(localStorage.getItem('vx_cart')) || []; } catch (e) { return []; }
  }
  function saveCart(c) { localStorage.setItem('vx_cart', JSON.stringify(c)); state.cart = c; renderBadge(); }
  state.cart = loadCart();
  function cartCount() { return state.cart.reduce(function (a, b) { return a + b.qty; }, 0); }
  function renderBadge() {
    var b = $('#cartBadge'), n = cartCount();
    b.hidden = n === 0;
    b.textContent = n;
  }

  /* ---------- Cupón VORTEX10 ---------- */
  function loadCoupon() {
    try {
      var c = JSON.parse(localStorage.getItem('vx_coupon'));
      if (c && c.code) return c;
    } catch (e) {}
    return null;
  }
  var coupon = loadCoupon();
  function couponCode() { return (coupon && coupon.code) ? coupon.code : ''; }
  function couponPct() { return (coupon && coupon.pct) ? coupon.pct : 0; }
  function saveCoupon(c) {
    coupon = c;
    if (c) localStorage.setItem('vx_coupon', JSON.stringify(c));
    else localStorage.removeItem('vx_coupon');
    renderRoute();
  }
  function applyCoupon(raw) {
    var code = String(raw || '').trim().toUpperCase();
    if (code === CONFIG.couponCode) {
      saveCoupon({ code: code, pct: CONFIG.couponPct });
      toast('Cupón VORTEX10 aplicado: 10% OFF');
    } else {
      toast('Cupón inválido. Prueba con VORTEX10', true);
    }
  }
  function cartSubtotal() { return state.cart.reduce(function (a, l) { return a + (l.price || 0) * l.qty; }, 0); }
  function cartDiscount() { return Math.round(cartSubtotal() * couponPct() / 100); }
  function cartTotal() { return cartSubtotal() - cartDiscount(); }

  /* ---------- Datos: Storefront (vivo) + respaldo local ---------- */
  function normSnap(p) {
    return {
      title: p.title, handle: p.handle, vendor: p.vendor,
      price: Number(p.price) || 0, compare: Number(p.compare_at) || 0,
      image: p.image || (p.images && p.images[0]) || '', images: p.images || [],
      desc: p.body ? stripHtml(p.body) : '', available: p.available !== false,
      url: CONFIG.storeUrl + p.url
    };
  }
  function loadFallback() {
    return fetch('datos-tienda.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
      state.products = (d.products || []).map(normSnap);
      state.collections = (d.collections || []).map(function (c) { return { handle: c.handle, title: c.title }; });
      try { localStorage.setItem('vx_cache', JSON.stringify({ products: state.products, collections: state.collections, ts: Date.now() })); } catch (e) {}
    });
  }
  function tryCache() {
    try {
      var c = JSON.parse(localStorage.getItem('vx_cache'));
      if (c && c.products && c.products.length) { state.products = c.products; state.collections = c.collections || []; return true; }
    } catch (e) {}
    return false;
  }
  function loadStorefront() {
    var q = '{ products(first: 60) { edges { node { id title handle description availableForSale priceRange { minVariantPrice { amount } } compareAtPriceRange { minVariantPrice { amount } } images(first: 6) { edges { node { url } } } } } } collections(first: 25) { edges { node { handle title } } } }';
    return fetch('https://' + CONFIG.shopDomain + '/api/' + CONFIG.apiVersion + '/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': CONFIG.storefrontToken },
      body: JSON.stringify({ query: q })
    }).then(function (r) { return r.json(); }).then(function (d) {
      var prods = (d.data && d.data.products && d.data.products.edges) || [];
      var colls = (d.data && d.data.collections && d.data.collections.edges) || [];
      if (!prods.length) throw new Error('vacio');
      state.products = prods.map(function (e) {
        var n = e.node;
        var img = (n.images && n.images.edges && n.images.edges.length) ? n.images.edges[0].node.url : '';
        var images = ((n.images && n.images.edges) || []).map(function (i) { return i.node.url; });
        var cmp = (n.compareAtPriceRange && n.compareAtPriceRange.minVariantPrice) ? n.compareAtPriceRange.minVariantPrice.amount : 0;
        return {
          title: n.title, handle: n.handle,
          price: Number(n.priceRange.minVariantPrice.amount) || 0,
          compare: Number(cmp) || 0,
          image: img, images: images,
          desc: n.description || '', available: !!n.availableForSale,
          url: CONFIG.storeUrl + '/products/' + n.handle
        };
      });
      state.collections = colls.map(function (e) { return e.node; });
      try { localStorage.setItem('vx_cache', JSON.stringify({ products: state.products, collections: state.collections, ts: Date.now() })); } catch (e) {}
    });
  }
  function loadData() {
    if (tryCache()) { state.loading = false; renderRoute(); }
    loadStorefront().then(function () {
      state.loading = false; renderRoute();
    }).catch(function () {
      return loadFallback().then(function () { state.loading = false; renderRoute(); })
        .catch(function () { state.loading = false; if (!state.products.length) toast('Sin conexión y sin catálogo guardado', true); renderRoute(); });
    });
  }

  /* ---------- Urgencia ---------- */
  function viewersNow(handle) { return 18 + (hashStr(handle || 'x') % 46); } // 18-63 personas viendo
  function flashEnd() {
    var k = 'vx_flash_end';
    var t = Number(sessionStorage.getItem(k));
    if (!t || t < Date.now()) { t = Date.now() + CONFIG.flashMinutes * 60000; sessionStorage.setItem(k, t); }
    return t;
  }
  function fmtClock(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600);
    s %= 3600;
    var m = Math.floor(s / 60); s %= 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(h) + ':' + p(m) + ':' + p(s);
  }
  function tickFlash() {
    $$('[data-flash]').forEach(function (el) {
      var end = Number(el.getAttribute('data-end')) || 0;
      if (end <= 0) end = flashEnd();
      var rem = end - Date.now();
      if (rem <= 0) { end = flashEnd(); el.setAttribute('data-end', end); rem = end - Date.now(); }
      el.textContent = fmtClock(rem);
    });
  }

  /* ---------- WhatsApp ---------- */
  function waLink(text) { return 'https://wa.me/' + CONFIG.waNumber + '?text=' + encodeURIComponent(text); }
  function productWaText(p, qty) {
    qty = qty || 1;
    var sub = (p.price || 0) * qty;
    var disc = couponPct() > 0 ? Math.round(sub * couponPct() / 100) : 0;
    var t = 'Hola VÓRTEX Gadgets, quiero pedir:\n';
    t += '- ' + qty + 'x ' + p.title + ' (' + money(p.price) + ')\n';
    if (disc > 0) t += 'Cupón ' + couponCode() + ' aplicado: -' + money(disc) + ' (' + couponPct() + '% OFF)\n';
    t += '\nTotal: ' + money(sub - disc) + '\n';
    t += 'Envío: GRATIS a Colombia\nPago: contra entrega\n';
    t += '\nMi nombre: __\nCiudad: __';
    return t;
  }
  function cartWaText() {
    var t = 'Hola VÓRTEX Gadgets, quiero pedir:\n';
    state.cart.forEach(function (l) { t += '- ' + l.qty + 'x ' + l.title + ' (' + money(l.price * l.qty) + ')\n'; });
    if (cartDiscount() > 0) t += 'Cupón ' + couponCode() + ' aplicado: -' + money(cartDiscount()) + ' (' + couponPct() + '% OFF)\n';
    t += '\nTotal: ' + money(cartTotal()) + '\nEnvío: GRATIS a Colombia\nPago: contra entrega\n';
    t += '\nMi nombre: __\nCiudad: __';
    return t;
  }
  function openWa(text) { window.open(waLink(text), '_blank'); }

  /* ---------- Plantillas de producto ---------- */
  function prodCard(p) {
    var off = pctOff(p.price, p.compare);
    return '<article class="pcard">' +
      '<div class="pimg">' +
      '<a href="#/producto/' + esc(p.handle) + '">' + (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.title) + '" loading="lazy">' : '') + '</a>' +
      (off > 0 ? '<span class="pbadge">-' + off + '%</span>' : '') +
      (!p.available ? '<span class="pbadge agotado">AGOTADO</span>' : '') +
      '</div>' +
      '<div class="pbody">' +
      '<a class="ptitle" href="#/producto/' + esc(p.handle) + '">' + esc(p.title) + '</a>' +
      (p.vendor ? '<span class="pvendor">' + esc(p.vendor) + '</span>' : '') +
      '<div><span class="pprice">' + money(p.price) + '</span>' +
      (off > 0 ? ' <span class="pold">' + money(p.compare) + '</span>' : '') + '</div>' +
      '<div class="pbtns">' +
      (p.available
        ? '<button class="btn btn-accent btn-sm" data-action="add-cart" data-handle="' + esc(p.handle) + '">Añadir</button>'
        : '<button class="btn btn-ghost btn-sm" disabled>Agotado</button>') +
      '<button class="btn btn-wa btn-sm" data-action="wa-product" data-handle="' + esc(p.handle) + '">WhatsApp</button>' +
      '</div></div></article>';
  }
  function gridHtml(list) {
    if (!list.length) return '<div class="empty-state"><p>No encontramos productos.</p></div>';
    return '<div class="grid-products">' + list.map(prodCard).join('') + '</div>';
  }

  /* ---------- Vistas ---------- */
  function vHome() {
    var dest = state.products.filter(function (p) { return p.available; }).slice(0, 8);
    return '' +
      '<section class="hero-card">' +
      '<span class="hero-chip">● PAGA CONTRA ENTREGA · ENVÍO GRATIS</span>' +
      '<h1>Tecnología y gadgets, <span style="color:#4CE0D6">pagas al recibir</span></h1>' +
      '<p>Catálogo oficial de VÓRTEX Gadgets. Revisas tu pedido y pagas en efectivo cuando llega. Sin tarjeta ni anticipo.</p>' +
      '<div class="hero-cta">' +
      '<a class="btn btn-accent" href="#/catalogo">Ver catálogo</a>' +
      '<a class="btn btn-wa" href="' + waLink('Hola VÓRTEX Gadgets, quiero información de sus productos') + '" target="_blank" rel="noopener">Pedir por WhatsApp</a>' +
      '</div>' +
      '<div class="hero-cupon">Cupón <b>VORTEX10</b> = 10% OFF en tu primer pedido</div>' +
      '</section>' +
      '<div class="trust-row">' +
      '<span class="chip"><span class="ck">✓</span> Envío <b>GRATIS</b></span>' +
      '<span class="chip"><span class="ck">✓</span> Paga <b>contra entrega</b></span>' +
      '<span class="chip"><span class="ck">✓</span> Revisa antes de pagar</span>' +
      '<span class="chip"><span class="ck">✓</span> Garantía</span>' +
      '</div>' +
      '<h2 class="section-title">Destacados de la semana</h2>' +
      '<p class="section-sub">Elige, pide por WhatsApp y paga al recibir</p>' + gridHtml(dest) +
      '<h2 class="section-title">Así de fácil compras</h2>' +
      '<div class="steps">' +
      stepHtml('1', 'Elige tu producto', 'Explora el catálogo y añade al carrito.') +
      stepHtml('2', 'Aplica tu cupón', 'Usa VORTEX10 y obtén 10% OFF.') +
      stepHtml('3', 'Pide por WhatsApp', 'Te enviamos el resumen con guía de envío.') +
      stepHtml('4', 'Pagas al recibir', 'Revisas tu pedido y pagas en efectivo.') +
      '</div>' +
      '<div class="wa-float-big">' +
      '<div><b style="color:#fff">¿Dudas o pedido especial?</b><div class="muted" style="font-size:13px">Escríbenos: ' + esc(CONFIG.waDisplay) + '</div></div>' +
      '<a class="btn btn-wa" href="' + waLink('Hola VÓRTEX, tengo una consulta') + '" target="_blank" rel="noopener">Chatear ahora</a>' +
      '</div>';
  }
  function stepHtml(n, t, d) {
    return '<div class="step"><div class="n">' + n + '</div><b>' + t + '</b><p>' + d + '</p></div>';
  }

  function vCatalog() {
    var q = (state.searchTerm || '').toLowerCase().trim();
    var list = state.products.filter(function (p) {
      if (!q) return true;
      return (p.title + ' ' + (p.vendor || '') + ' ' + p.desc).toLowerCase().indexOf(q) > -1;
    });
    return '<h1 style="font-size:22px;font-weight:900">Catálogo</h1>' +
      '<p class="muted" style="font-size:13px;margin:2px 0 14px">' + list.length + ' productos · Envío gratis · Contra entrega · Cupón VORTEX10 (-10%)</p>' +
      (list.length ? '' : '<div class="empty-state"><p>Sin resultados para “' + esc(state.searchTerm) + '”.</p></div>') +
      gridHtml(list);
  }

  function vProduct(handle) {
    var p = state.products.filter(function (x) { return x.handle === handle; })[0];
    if (!p) return '<div class="empty-state"><p>Producto no encontrado.</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/catalogo">Ver catálogo</a></p></div>';
    var off = pctOff(p.price, p.compare);
    var imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
    var main = imgs[0] || '';
    var viewers = viewersNow(p.handle);
    var flashEndT = flashEnd();
    var couponOn = couponCode() === CONFIG.couponCode;
    return '<div class="pdp" data-handle="' + esc(p.handle) + '">' +
      '<div class="detail">' +
      /* ---- Galería ---- */
      '<div class="gallery">' +
      '<div class="gmain">' + (off > 0 ? '<span class="pbadge" style="top:12px;left:12px">-' + off + '%</span>' : '') +
      '<span class="gzoom"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg> Toca para ver</span>' +
      (main ? '<img data-gmain src="' + esc(main) + '" alt="' + esc(p.title) + '" data-action="open-gallery" data-idx="0">' : '') + '</div>' +
      (imgs.length > 1 ? '<div class="gthumbs">' + imgs.map(function (im, i) {
        return '<button class="gthumb' + (i === 0 ? ' active' : '') + '" data-action="open-gallery" data-idx="' + i + '" data-full="' + esc(im) + '" aria-label="Foto ' + (i + 1) + ' de ' + imgs.length + '"><img src="' + esc(im) + '" alt=""></button>';
      }).join('') + '<span class="gcount">' + imgs.length + ' fotos</span></div>' : '') +
      '</div>' +
      /* ---- Info ---- */
      '<div class="pdp-info">' +
      '<div class="d-rating"><span class="stars">★★★★★</span> <b>4.9</b> · 1.060+ vendidos · <span style="color:#4CE0D6;font-weight:800">' + viewers + ' viendo ahora</span></div>' +
      '<h1 class="d-title">' + esc(p.title) + '</h1>' +
      '<div class="d-meta">Vendido por VÓRTEX Gadgets · Envío gratis a toda Colombia · Despacho 24-72h</div>' +
      '<div class="d-price"><span class="d-now">' + money(p.price) + '</span>' +
      (off > 0 ? '<span class="d-old">' + money(p.compare) + '</span><span class="d-pct">-' + off + '%</span>' : '') + '</div>' +
      '<div class="d-save">Ahorras ' + money(p.compare - p.price) + ' hoy · Oferta de lanzamiento</div>' +
      /* contador urgencia */
      '<div class="flashbar"><span class="flash-ico">!</span><div class="flash-txt">OFERTA FLASH — este precio termina en<br><b data-flash data-end="' + flashEndT + '">' + fmtClock(flashEndT - Date.now()) + '</b></div></div>' +
      /* cupón */
      (couponOn
        ? '<div class="coupon-on">✓ Cupón <b>VORTEX10</b> activo en tu carrito (-10%)</div>'
        : '<div class="coupon-strip">Cupón <b>VORTEX10</b> = <b>10% OFF</b> — aplícalo en el carrito</div>') +
      /* COD */
      '<div class="d-cod"><b>PAGA CONTRA ENTREGA</b><ul>' +
      '<li>Pagas en efectivo cuando recibes tu pedido</li>' +
      '<li>Sin tarjeta ni anticipos</li>' +
      '<li>Revisas el producto antes de pagar</li>' +
      '</ul><span class="d-check">✓ Envío GRATIS a toda Colombia</span></div>' +
      (p.available
        ? '<div class="d-buy">' +
          '<div class="d-qtyrow"><span class="lbl">Cantidad</span><div class="qty"><button data-action="qty-dec" aria-label="Menos">−</button>' +
          '<input data-qty-input value="1" inputmode="numeric">' +
          '<button data-action="qty-inc" aria-label="Más">+</button></div></div>' +
          '<div class="d-btns">' +
          '<button class="btn btn-wa btn-block" data-action="wa-product" data-handle="' + esc(p.handle) + '">Pedir por WhatsApp</button>' +
          '<button class="btn btn-accent btn-block" data-action="add-cart" data-handle="' + esc(p.handle) + '">Añadir al carrito</button>' +
          '</div>' +
          '<a class="d-store" href="' + esc(p.url) + '" target="_blank" rel="noopener">También disponible en la tienda online (pago con PSE / tarjeta)</a>' +
          '</div>'
        : '<button class="btn btn-ghost btn-block" disabled>Producto agotado</button>') +
      '<div class="d-trust">' +
      '<div class="dt"><span class="ck">✓</span><span>Envío GRATIS a toda Colombia</span></div>' +
      '<div class="dt"><span class="ck">✓</span><span>Pago contra entrega: revisas antes de pagar</span></div>' +
      '<div class="dt"><span class="ck">✓</span><span>Garantía de funcionamiento y soporte</span></div>' +
      '<div class="dt"><span class="ck">✓</span><span>Pedido protegido: devolución si llega dañado</span></div>' +
      '</div>' +
      '<div class="acc">' +
      '<button class="acc-h" data-action="acc-toggle">Descripción <span class="chev">▾</span></button>' +
      '<div class="acc-b">' + (p.desc || 'Producto disponible en la tienda VÓRTEX Gadgets.') + '</div>' +
      '<button class="acc-h" data-action="acc-toggle">Envío y contra entrega <span class="chev">▾</span></button>' +
      '<div class="acc-b">Despachamos a toda Colombia en 24-72 horas hábiles con número de guía (3-7 días según tu ciudad).\n\nPagas CONTRA ENTREGA: en efectivo al recibir tu pedido, después de revisarlo. También puedes pagar en línea (PSE o tarjeta) desde nuestra tienda web.</div>' +
      '<button class="acc-h" data-action="acc-toggle">Garantía y devoluciones <span class="chev">▾</span></button>' +
      '<div class="acc-b">Todos nuestros productos tienen garantía de funcionamiento. Si algo llega dañado o no funciona, te lo cambiamos o devolvemos tu dinero. Escríbenos por WhatsApp y te atendemos.</div>' +
      '</div>' +
      '</div></div>' +
      /* barra fija móvil */
      (p.available
        ? '<div class="buybar">' +
          '<div class="bb-price"><span class="bb-now">' + money(p.price) + '</span>' +
          (off > 0 ? '<span class="bb-old">' + money(p.compare) + '</span>' : '') + '</div>' +
          '<button class="btn btn-wa" data-action="wa-product" data-handle="' + esc(p.handle) + '">WhatsApp</button>' +
          '<button class="btn btn-accent" data-action="add-cart" data-handle="' + esc(p.handle) + '">Carrito</button>' +
          '</div>' : '') +
      '</div>';
  }

  function vCart() {
    if (!state.cart.length) {
      return '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 7h16l-1.5 12h-13L4 7Z"/><path d="M8 7a4 4 0 0 1 8 0"/></svg>' +
        '<p>Tu carrito está vacío</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/catalogo">Ir al catálogo</a></p></div>';
    }
    var couponOn = couponCode() === CONFIG.couponCode;
    var lines = state.cart.map(function (l) {
      return '<div class="cartline">' +
        (l.image ? '<img src="' + esc(l.image) + '" alt="">' : '<div class="cl-title" style="display:grid;place-items:center">V</div>') +
        '<div><div class="cl-title">' + esc(l.title) + '</div>' +
        '<div class="cl-price">' + money(l.price) + ' c/u</div>' +
        '<div class="qty small" style="margin-top:6px"><button data-action="qty-dec" data-line="' + esc(l.handle) + '">−</button>' +
        '<input data-qty-input data-line="' + esc(l.handle) + '" value="' + l.qty + '" inputmode="numeric">' +
        '<button data-action="qty-inc" data-line="' + esc(l.handle) + '">+</button></div></div>' +
        '<div class="cl-right"><span class="cl-total">' + money(l.price * l.qty) + '</span>' +
        '<button class="cl-del" data-action="cart-del" data-line="' + esc(l.handle) + '">Quitar</button></div>' +
        '</div>';
    }).join('');
    var sub = cartSubtotal(), disc = cartDiscount(), total = cartTotal();
    return '<h1 style="font-size:22px;font-weight:900;margin-bottom:12px">Tu carrito</h1>' +
      '<div class="cart-cupon">' +
      (couponOn
        ? '<div class="coupon-applied">✓ Cupón <b>VORTEX10</b> aplicado (-10%) <button class="link" data-action="remove-coupon">Quitar</button></div>'
        : '<div class="coupon-box"><input id="couponInput" placeholder="Cupón de descuento (ej. VORTEX10)" autocomplete="off">' +
          '<button class="btn btn-accent btn-sm" data-action="apply-coupon">Aplicar</button></div>') +
      '<p class="muted" style="font-size:11.5px;margin-top:6px">Prueba el cupón <b>VORTEX10</b> = 10% OFF</p></div>' +
      lines +
      '<div class="totals">' +
      '<div class="trow"><span>Subtotal</span><span>' + money(sub) + '</span></div>' +
      (disc > 0 ? '<div class="trow discount"><span>Cupón ' + couponCode() + ' (-' + couponPct() + '%)</span><span>-' + money(disc) + '</span></div>' : '') +
      '<div class="trow"><span>Envío</span><span class="free">GRATIS</span></div>' +
      '<div class="trow total"><span>Total a pagar</span><span>' + money(total) + '</span></div>' +
      '<p class="muted" style="font-size:12px;margin-top:8px">Pago contra entrega: pagas en efectivo al recibir y revisas tu pedido antes.</p>' +
      '<div style="display:grid;gap:9px;margin-top:12px">' +
      '<button class="btn btn-wa btn-block" data-action="wa-cart">Pedir todo por WhatsApp</button>' +
      '<a class="btn btn-ghost btn-block" href="' + esc(CONFIG.storeUrl) + '/collections/all" target="_blank" rel="noopener">Pagar en línea en la tienda</a>' +
      '</div></div>';
  }

  function vComo() {
    return '<h1 style="font-size:22px;font-weight:900">Cómo comprar (contra entrega)</h1>' +
      '<p class="muted" style="margin:4px 0 14px">Sin tarjeta, sin riesgo: pagas cuando recibes.</p>' +
      '<div class="steps" style="grid-template-columns:1fr">' +
      stepHtml('1', 'Elige y pide', 'Añade al carrito o pide directo por WhatsApp el producto que quieras.') +
      stepHtml('2', 'Aplica tu cupón', 'En el carrito usa VORTEX10 y obtén 10% OFF.') +
      stepHtml('3', 'Recibe con guía', 'Te enviamos tu número de guía: llega a tu ciudad en 3-7 días hábiles.') +
      stepHtml('4', 'Paga al recibir', 'Revisa tu pedido con el transportador y paga en efectivo. Así de simple.') +
      '</div>' +
      '<div class="trust-row">' +
      '<span class="chip"><span class="ck">✓</span> Envío <b>GRATIS</b> a toda Colombia</span>' +
      '<span class="chip"><span class="ck">✓</span> Pago <b>contra entrega</b></span>' +
      '<span class="chip"><span class="ck">✓</span> Cupón <b>VORTEX10</b> (-10%)</span>' +
      '<span class="chip"><span class="ck">✓</span> Garantía de funcionamiento</span>' +
      '</div>' +
      '<div class="wa-float-big"><div><b style="color:#fff">¿Listo para pedir?</b>' +
      '<div class="muted" style="font-size:13px">Escríbenos y te ayudamos: ' + esc(CONFIG.waDisplay) + '</div></div>' +
      '<a class="btn btn-wa" href="' + waLink('Hola VÓRTEX, quiero hacer un pedido contra entrega') + '" target="_blank" rel="noopener">Escribir por WhatsApp</a></div>';
  }

  function vContacto() {
    return '<h1 style="font-size:22px;font-weight:900">Contacto y pedidos</h1>' +
      '<p class="muted" style="margin:4px 0 14px">Te respondemos rápido por WhatsApp, todos los días.</p>' +
      '<div class="wa-float-big" style="justify-content:flex-start;flex-direction:column;align-items:stretch">' +
      '<b style="color:#fff">WhatsApp oficial de pedidos</b>' +
      '<div style="font-size:22px;font-weight:900">' + esc(CONFIG.waDisplay) + '</div>' +
      '<div class="muted" style="font-size:13px">Catálogo, pedidos, cupón VORTEX10, garantías y soporte.</div>' +
      '<a class="btn btn-wa" href="' + waLink('Hola VÓRTEX Gadgets') + '" target="_blank" rel="noopener">Abrir WhatsApp</a>' +
      '</div>' +
      '<div class="trust-row">' +
      '<span class="chip">Tienda web: vortexgadgets.com.co</span>' +
      '<span class="chip">Pago en línea: PSE y tarjetas</span>' +
      '<span class="chip">Pago contra entrega: efectivo</span>' +
      '</div>';
  }

  /* ---------- Router ---------- */
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('?');
    var seg = parts[0].split('/').filter(Boolean);
    return { seg: seg, q: parts[1] || '' };
  }
  function renderRoute() {
    var r = parseHash();
    var seg = r.seg;
    if (r.q) { var params = new URLSearchParams(r.q); if (params.get('q')) state.searchTerm = params.get('q'); }
    var v = $('#view');
    if (state.loading && !state.products.length) { v.innerHTML = spinner(); }
    else if (seg.length === 0 || seg[0] === 'inicio') v.innerHTML = vHome();
    else if (seg[0] === 'catalogo') v.innerHTML = vCatalog();
    else if (seg[0] === 'producto') v.innerHTML = vProduct(decodeURIComponent(seg[1] || ''));
    else if (seg[0] === 'carrito') v.innerHTML = vCart();
    else if (seg[0] === 'como-comprar') v.innerHTML = vComo();
    else if (seg[0] === 'contacto') v.innerHTML = vContacto();
    else v.innerHTML = '<div class="empty-state"><p>Página no encontrada.</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/inicio">Ir al inicio</a></p></div>';
    closeLb();
    renderNav();
    window.scrollTo({ top: 0 });
  }
  function renderNav() {
    var r = parseHash().seg[0] || 'inicio';
    var map = { inicio: 'inicio', catalogo: 'catalogo', 'como-comprar': 'como', contacto: 'contacto', carrito: '' };
    var key = map[r] || '';
    $$('#bottomnav a').forEach(function (a) { a.classList.toggle('active', a.dataset.nav === key); });
  }

  /* ---------- Acciones (delegación) ---------- */
  function findHandle(el) {
    var node = el;
    while (node && node !== document) { if (node.dataset && node.dataset.handle) return node.dataset.handle; node = node.parentNode; }
    return null;
  }
  function findLine(el) {
    var node = el;
    while (node && node !== document) { if (node.dataset && node.dataset.line) return node.dataset.line; node = node.parentNode; }
    return null;
  }
  function productByHandle(h) { return state.products.filter(function (p) { return p.handle === h; })[0]; }
  function qtyOf(scope) {
    var input = $('[data-qty-input]', scope || document);
    var n = input ? parseInt(input.value, 10) : 1;
    return (isNaN(n) || n < 1) ? 1 : n;
  }
  function addToCart(h, qty) {
    var p = productByHandle(h);
    if (!p) return;
    var c = state.cart, found = false;
    c = c.map(function (l) {
      if (l.handle === h) { found = true; return { handle: l.handle, title: l.title, price: l.price, image: l.image, qty: l.qty + qty }; }
      return l;
    });
    if (!found) c.push({ handle: p.handle, title: p.title, price: p.price, image: p.image, qty: qty });
    saveCart(c);
    toast('✓ Añadido al carrito');
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var act = t.dataset.action;
    if (act === 'acc-toggle') {
      var acc = t.closest('.acc');
      if (acc) { acc.classList.toggle('open'); $$('.acc.open', acc.parentNode).forEach(function (a) { if (a !== acc) a.classList.remove('open'); }); }
      return;
    }
    if (act === 'add-cart') { var h = findHandle(t); if (h) addToCart(h, qtyOf(document)); return; }
    if (act === 'wa-product') { var p2 = productByHandle(findHandle(t)); if (p2) openWa(productWaText(p2, qtyOf(document))); return; }
    if (act === 'qty-inc' || act === 'qty-dec') {
      var line = findLine(t);
      var scope = line ? t.closest('.cartline') : document;
      var input = $('[data-qty-input]', scope);
      if (!input) return;
      var n = parseInt(input.value, 10) || 1;
      n = act === 'qty-inc' ? n + 1 : n - 1;
      if (n < 1) return;
      input.value = n;
      if (line) { updateLineQty(line, n); }
      return;
    }
    if (act === 'cart-del') {
      var hd = findLine(t);
      saveCart(state.cart.filter(function (l) { return l.handle !== hd; }));
      renderRoute(); toast('Producto eliminado');
      return;
    }
    if (act === 'wa-cart') { if (state.cart.length) openWa(cartWaText()); return; }
    if (act === 'apply-coupon') { var ci = $('#couponInput'); applyCoupon(ci ? ci.value : ''); return; }
    if (act === 'remove-coupon') { saveCoupon(null); toast('Cupón eliminado'); return; }
    if (act === 'open-gallery') {
      var pd = t.closest('.pdp');
      var handle = pd ? pd.getAttribute('data-handle') : (t.closest('#view') ? null : null);
      if (!handle) { var wrap = $('#view .pdp'); handle = wrap ? wrap.getAttribute('data-handle') : null; }
      openGallery(handle, parseInt(t.dataset.idx || '0', 10));
      return;
    }
    if (act === 'lb-close') { closeLb(); return; }
    if (act === 'lb-prev') { lbNav(-1); return; }
    if (act === 'lb-next') { lbNav(1); return; }
  });
  document.addEventListener('input', function (e) {
    var inp = e.target;
    if (inp.dataset && inp.dataset.qtyInput !== undefined) {
      var line = findLine(inp);
      var n = parseInt(inp.value, 10);
      if (line && !isNaN(n) && n >= 1) updateLineQty(line, n);
    }
    if (inp.id === 'q') {
      state.searchTerm = inp.value;
      if ((parseHash().seg[0] || '') !== 'catalogo') { location.hash = '#/catalogo'; }
      else renderRoute();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'couponInput') {
      applyCoupon(document.activeElement.value);
    }
  });
  function updateLineQty(handle, n) {
    saveCart(state.cart.map(function (l) { return l.handle === handle ? { handle: l.handle, title: l.title, price: l.price, image: l.image, qty: n } : l; }));
    renderRoute();
  }

  /* ---------- Galería lightbox (tocar + deslizar) ---------- */
  var lb = { images: [], i: 0 };
  var lbEl = null;
  function lbBuild() {
    if (lbEl) return;
    lbEl = document.createElement('div');
    lbEl.className = 'lb';
    lbEl.id = 'lb';
    lbEl.hidden = true;
    lbEl.innerHTML =
      '<div class="lb-back" data-action="lb-close"></div>' +
      '<button class="lb-x" data-action="lb-close" aria-label="Cerrar">✕</button>' +
      '<button class="lb-nav prev" data-action="lb-prev" aria-label="Anterior">‹</button>' +
      '<img class="lb-img" id="lbImg" alt="Foto del producto">' +
      '<button class="lb-nav next" data-action="lb-next" aria-label="Siguiente">›</button>' +
      '<div class="lb-dots" id="lbDots"></div>' +
      '<div class="lb-hint">Desliza para ver más fotos</div>';
    document.body.appendChild(lbEl);
    // swipe táctil
    var sx = 0, sy = 0;
    lbEl.querySelector('.lb-img').addEventListener('touchstart', function (ev) {
      var t = ev.changedTouches[0]; sx = t.clientX; sy = t.clientY;
    }, { passive: true });
    lbEl.querySelector('.lb-img').addEventListener('touchend', function (ev) {
      var t = ev.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy)) { lbNav(dx < 0 ? 1 : -1); }
    }, { passive: true });
  }
  function openGallery(handle, idx) {
    var p = productByHandle(handle);
    if (!p) return;
    var imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
    if (!imgs.length) return;
    lb.images = imgs;
    lbBuild();
    lb.i = Math.max(0, Math.min(idx || 0, imgs.length - 1));
    lbEl.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { lbEl.classList.add('open'); lbPaint(); });
  }
  function lbPaint() {
    if (!lbEl || !lb.images.length) return;
    var img = $('#lbImg');
    if (img) { img.src = lb.images[lb.i]; img.alt = 'Foto ' + (lb.i + 1) + ' de ' + lb.images.length; }
    var dots = $('#lbDots');
    if (dots) {
      dots.innerHTML = lb.images.map(function (_, j) {
        return '<span class="dot' + (j === lb.i ? ' on' : '') + '" data-dot="' + j + '"></span>';
      }).join('');
    }
    $$('.lb-nav').forEach(function (b) { b.style.display = lb.images.length > 1 ? 'grid' : 'none'; });
    var hint = $('.lb-hint');
    if (hint) hint.style.display = lb.images.length > 1 ? 'block' : 'none';
  }
  function lbNav(d) {
    if (!lb.images.length) return;
    lb.i = (lb.i + d + lb.images.length) % lb.images.length;
    lbPaint();
  }
  function closeLb() {
    if (lbEl) { lbEl.classList.remove('open'); lbEl.hidden = true; }
    document.body.style.overflow = '';
  }
  document.addEventListener('click', function (e) {
    var dot = e.target.closest('[data-dot]');
    if (dot && lbEl && !lbEl.hidden) { lb.i = parseInt(dot.getAttribute('data-dot'), 10); lbPaint(); }
  });

  /* ---------- UI: drawer, búsqueda, instalación ---------- */
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }
  function openDrawer() { $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); }
  $('#btnMenu').addEventListener('click', openDrawer);
  $$('[data-close-drawer]').forEach(function (el) { el.addEventListener('click', closeDrawer); });
  $('#btnSearch').addEventListener('click', function () {
    var sb = $('#searchbar');
    sb.hidden = !sb.hidden;
    if (!sb.hidden) $('#q').focus();
  });

  /* ---------- Instalación (Android / iOS / escritorio) ---------- */
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream; }
  function isAndroid() { return /android/i.test(navigator.userAgent); }
  function installInstructions() {
    if (isIOS()) {
      return '1. Pulsa el botón Compartir (cuadrado con flecha hacia arriba) en Safari.\n2. Desliza las opciones y toca “Añadir a pantalla de inicio”.\n3. Toca “Añadir” (arriba a la derecha).\n\nLa app quedará en tu pantalla de inicio y se abrirá a pantalla completa.';
    }
    if (isAndroid()) {
      return '1. Toca el menú ⋮ (arriba a la derecha de Chrome).\n2. Toca “Instalar app” o “Añadir a pantalla de inicio”.\n3. Confirma tocando “Instalar”.\n\nSi la opción no aparece aún, vuelve a entrar a la app, úsala unos segundos y repite — Chrome la muestra después de un rato.';
    }
    return '1. Mira la barra de direcciones de Chrome/Edge: debe aparecer un icono de monitor con flecha (Instalar).\n2. Tócalo y confirma, o ve al menú ⋮ → “Instalar como aplicación”.\n3. La app se abre en su propia ventana.';
  }
  function openInstallModal() {
    var info = $('#installInfo');
    if (info) info.textContent = installInstructions();
    var m = $('#installModal');
    if (m) { m.hidden = false; requestAnimationFrame(function () { m.classList.add('open'); }); }
  }
  function closeInstallModal() {
    var m = $('#installModal');
    if (m) { m.classList.remove('open'); setTimeout(function () { m.hidden = true; }, 200); }
  }
  $$('[data-close-install]').forEach(function (el) { el.addEventListener('click', closeInstallModal); });
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', function () {
    toast('App instalada: búscala en tu pantalla de inicio.');
    deferredPrompt = null;
  });
  var btnInstall = $('#btnInstall');
  btnInstall.addEventListener('click', function () {
    if (deferredPrompt && !isIOS()) {
      try {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (res) {
          if (res && res.outcome === 'accepted') { toast('Instalando…'); }
          deferredPrompt = null;
        });
      } catch (e) { openInstallModal(); }
    } else {
      openInstallModal();
    }
  });
  if (isIOS() && !window.navigator.standalone) $('#iosHint').hidden = false;

  window.addEventListener('hashchange', renderRoute);

  /* ---------- Init ---------- */
  renderBadge();
  setInterval(tickFlash, 1000);
  loadData();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
