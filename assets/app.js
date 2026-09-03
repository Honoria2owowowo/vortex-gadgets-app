/* ============================================================
   VÓRTEX Gadgets — app.js (PWA catálogo + pedidos WhatsApp)
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
    currency: 'COP'
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
    t._h = setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.hidden = true; }, 300); }, 2600);
  }
  function spinner() { return '<div class="spin"></div>'; }

  /* ---------- Estado ---------- */
  var state = {
    products: [],
    collections: [],
    loading: true,
    searchTerm: ''
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
        var images = (n.images && n.images.edges || []).map(function (i) { return i.node.url; });
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

  /* ---------- WhatsApp ---------- */
  function waLink(text) { return 'https://wa.me/' + CONFIG.waNumber + '?text=' + encodeURIComponent(text); }
  function productWaText(p, qty) {
    var t = 'Hola VÓRTEX Gadgets, quiero pedir:\n';
    t += '- ' + (qty || 1) + 'x ' + p.title + ' (' + money(p.price) + ')\n';
    t += '\nTotal: ' + money((p.price || 0) * (qty || 1)) + '\n';
    t += 'Envío: GRATIS a Colombia\nPago: contra entrega\n';
    t += '\nMi nombre: __\nCiudad: __';
    return t;
  }
  function cartWaText() {
    var t = 'Hola VÓRTEX Gadgets, quiero pedir:\n';
    state.cart.forEach(function (l) { t += '- ' + l.qty + 'x ' + l.title + ' (' + money(l.price * l.qty) + ')\n'; });
    t += '\nTotal: ' + money(cartTotal()) + '\nEnvío: GRATIS a Colombia\nPago: contra entrega\n';
    t += '\nMi nombre: __\nCiudad: __';
    return t;
  }
  function cartTotal() { return state.cart.reduce(function (a, l) { return a + (l.price || 0) * l.qty; }, 0); }
  function openWa(text) { window.open(waLink(text), '_blank'); }

  /* ---------- Plantillas de producto ---------- */
  function prodCard(p) {
    var off = pctOff(p.price, p.compare);
    return '<article class="pcard">' +
      '<div class="pimg">' +
      '<a href="#/producto/' + esc(p.handle) + '">' + (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.title) + '" loading="lazy">' : '') + '</a>' +
      (off > 0 ? '<span class="pbadge">-' + off + '%</span>' : (!p.available ? '<span class="pbadge agotado">AGOTADO</span>' : '')) +
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
      '<span class="hero-chip">● PAGA CONTRA ENTREGA</span>' +
      '<h1>Tecnología y gadgets, <span style="color:#4CE0D6">pagas al recibir</span></h1>' +
      '<p>Catálogo oficial de VÓRTEX Gadgets. Envío GRATIS a toda Colombia, revisas tu pedido y pagas en efectivo cuando llega. Sin tarjeta ni anticipo.</p>' +
      '<div class="hero-cta">' +
      '<a class="btn btn-accent" href="#/catalogo">Ver catálogo</a>' +
      '<a class="btn btn-wa" href="' + waLink('Hola VÓRTEX Gadgets, quiero información de sus productos') + '" target="_blank" rel="noopener">Pedir por WhatsApp</a>' +
      '</div></section>' +
      '<div class="trust-row">' +
      '<span class="chip"><span class="ck">✓</span> Envío <b>GRATIS</b> Colombia</span>' +
      '<span class="chip"><span class="ck">✓</span> Paga <b>contra entrega</b></span>' +
      '<span class="chip"><span class="ck">✓</span> Revisa antes de pagar</span>' +
      '<span class="chip"><span class="ck">✓</span> Garantía y soporte</span>' +
      '</div>' +
      '<h2 class="section-title">Destacados</h2>' +
      '<p class="section-sub">Los favoritos de la tienda</p>' + gridHtml(dest) +
      '<h2 class="section-title">Así de fácil compras</h2>' +
      '<div class="steps">' +
      stepHtml('1', 'Elige tu producto', 'Explora el catálogo y añade al carrito.') +
      stepHtml('2', 'Pide por WhatsApp', 'Te enviamos el resumen de tu pedido.') +
      stepHtml('3', 'Te lo llevamos', 'Despacho 24-72h con guía de seguimiento.') +
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
      '<p class="muted" style="font-size:13px;margin:2px 0 12px">' + list.length + ' productos · Envío gratis · Contra entrega</p>' +
      (list.length ? '' : '<div class="empty-state"><p>Sin resultados para “' + esc(state.searchTerm) + '”.</p></div>') +
      gridHtml(list);
  }

  function vProduct(handle) {
    var p = state.products.filter(function (x) { return x.handle === handle; })[0];
    if (!p) return '<div class="empty-state"><p>Producto no encontrado.</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/catalogo">Ver catálogo</a></p></div>';
    var off = pctOff(p.price, p.compare);
    var imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
    var main = imgs[0] || '';
    return '<div class="detail">' +
      '<div class="gallery">' +
      '<div class="gmain">' + (off > 0 ? '<span class="pbadge" style="top:12px;left:12px">-' + off + '%</span>' : '') +
      (main ? '<img data-gmain src="' + esc(main) + '" alt="' + esc(p.title) + '">' : '') + '</div>' +
      (imgs.length > 1 ? '<div class="gthumbs">' + imgs.map(function (im, i) {
        return '<button class="gthumb' + (i === 0 ? ' active' : '') + '" data-gthumb data-full="' + esc(im) + '" aria-label="Imagen ' + (i + 1) + '"><img src="' + esc(im) + '" alt=""></button>';
      }).join('') + '</div>' : '') +
      '</div>' +
      '<div class="pdp-info">' +
      '<div class="stars">★★★★★</div>' +
      '<div class="d-meta">Vendido por VÓRTEX Gadgets · Envío gratis a toda Colombia</div>' +
      '<h1 class="d-title">' + esc(p.title) + '</h1>' +
      '<div class="d-price"><span class="d-now">' + money(p.price) + '</span>' +
      (off > 0 ? '<span class="d-old">' + money(p.compare) + '</span><span class="d-pct">-' + off + '%</span>' : '') + '</div>' +
      '<div class="d-cod"><b>PAGA CONTRA ENTREGA</b><ul>' +
      '<li>Pagas en efectivo cuando recibes tu pedido</li>' +
      '<li>Sin tarjeta ni anticipos</li>' +
      '<li>Revisas el producto antes de pagar</li>' +
      '</ul><span class="d-check">✓ Envío GRATIS a Colombia · 24-72h despacho</span></div>' +
      (p.available
        ? '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:8px 0 14px">' +
          '<div class="qty"><button data-action="qty-dec" aria-label="Menos">−</button>' +
          '<input data-qty-input value="1" inputmode="numeric">' +
          '<button data-action="qty-inc" aria-label="Más">+</button></div>' +
          '<span class="muted" style="font-size:12px">Cantidad</span></div>' +
          '<div style="display:grid;gap:9px">' +
          '<button class="btn btn-wa btn-block" data-action="wa-product" data-handle="' + esc(p.handle) + '">Pedir por WhatsApp</button>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">' +
          '<button class="btn btn-accent" data-action="add-cart" data-handle="' + esc(p.handle) + '">Añadir al carrito</button>' +
          '<a class="btn btn-ghost" href="' + esc(p.url) + '" target="_blank" rel="noopener">Ver en la tienda</a>' +
          '</div></div>'
        : '<button class="btn btn-ghost btn-block" disabled>Producto agotado</button>') +
      '<div class="acc" style="margin-top:16px">' +
      '<button class="acc-h" data-action="acc-toggle">Descripción <span class="chev">▾</span></button>' +
      '<div class="acc-b">' + (p.desc || 'Producto disponible en la tienda VÓRTEX Gadgets.') + '</div>' +
      '<button class="acc-h" data-action="acc-toggle">Envío y contra entrega <span class="chev">▾</span></button>' +
      '<div class="acc-b">Despachamos a toda Colombia en 24-72 horas hábiles con número de guía (3-7 días según tu ciudad).\n\nPagas CONTRA ENTREGA: en efectivo al recibir tu pedido, después de revisarlo. También puedes pagar en línea (PSE o tarjeta) desde nuestra tienda web.</div>' +
      '<button class="acc-h" data-action="acc-toggle">Garantía y devoluciones <span class="chev">▾</span></button>' +
      '<div class="acc-b">Todos nuestros productos tienen garantía de funcionamiento. Si algo llega dañado o no funciona, te lo cambiamos o devolvemos tu dinero. Escríbenos por WhatsApp y te atendemos.</div>' +
      '</div></div></div>';
  }

  function vCart() {
    if (!state.cart.length) {
      return '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 7h16l-1.5 12h-13L4 7Z"/><path d="M8 7a4 4 0 0 1 8 0"/></svg>' +
        '<p>Tu carrito está vacío</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/catalogo">Ir al catálogo</a></p></div>';
    }
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
    return '<h1 style="font-size:22px;font-weight:900;margin-bottom:12px">Tu carrito</h1>' + lines +
      '<div class="totals">' +
      '<div class="trow"><span>Subtotal</span><span>' + money(cartTotal()) + '</span></div>' +
      '<div class="trow"><span>Envío</span><span class="free">GRATIS</span></div>' +
      '<div class="trow total"><span>Total</span><span>' + money(cartTotal()) + '</span></div>' +
      '<p class="muted" style="font-size:12px;margin-top:8px">Pago contra entrega: pagas en efectivo al recibir. También puedes pagar en línea desde la tienda.</p>' +
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
      stepHtml('2', 'Confirmamos tu pedido', 'Te escribimos por WhatsApp para confirmar dirección, ciudad y datos.') +
      stepHtml('3', 'Recibe con guía', 'Te enviamos tu número de guía: llega a tu ciudad en 3-7 días hábiles.') +
      stepHtml('4', 'Paga al recibir', 'Revisa tu pedido con el transportador y paga en efectivo. Así de simple.') +
      '</div>' +
      '<div class="trust-row">' +
      '<span class="chip"><span class="ck">✓</span> Envío <b>GRATIS</b> a toda Colombia</span>' +
      '<span class="chip"><span class="ck">✓</span> Pago <b>contra entrega</b></span>' +
      '<span class="chip"><span class="ck">✓</span> Revisas antes de pagar</span>' +
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
      '<div class="muted" style="font-size:13px">Catálogo, pedidos, garantías y soporte.</div>' +
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
    renderNav();
    window.scrollTo({ top: 0 });
  }
  function renderNav() {
    var r = parseHash().seg[0] || 'inicio';
    var map = { inicio: 'inicio', catalogo: 'catalogo', producto: 'catalogo', 'como-comprar': 'como', contacto: 'contacto' };
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
    toast('Añadido al carrito');
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action], [data-gthumb]');
    if (!t) return;
    var act = t.dataset.action;
    if (t.dataset.gthumb) {
      var main = $('[data-gmain]');
      if (main) { main.src = t.dataset.full; $$('.gthumb').forEach(function (g) { g.classList.remove('active'); }); t.classList.add('active'); }
      return;
    }
    if (act === 'acc-toggle') {
      var acc = t.closest('.acc');
      if (acc) { acc.classList.toggle('open'); $$('.acc.open', acc.parentNode).forEach(function (a) { if (a !== acc) a.classList.remove('open'); }); }
      return;
    }
    if (act === 'add-cart') {
      var h = findHandle(t); if (h) addToCart(h, 1); return;
    }
    if (act === 'wa-product') {
      var p2 = productByHandle(findHandle(t)); if (p2) openWa(productWaText(p2, qtyOf(document))); return;
    }
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
    if (act === 'wa-cart') {
      if (state.cart.length) openWa(cartWaText());
      return;
    }
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
  function updateLineQty(handle, n) {
    saveCart(state.cart.map(function (l) { return l.handle === handle ? { handle: l.handle, title: l.title, price: l.price, image: l.image, qty: n } : l; }));
    renderRoute();
  }

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
  function installSteps() {
    return isIOS()
      ? 'En iPhone: botón Compartir → “Añadir a pantalla de inicio”.'
      : 'En Chrome: menú ⋮ → “Instalar app” o “Añadir a pantalla de inicio”.';
  }
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e; // Chrome/Edge mostrarán el diálogo al tocar el botón
  });
  window.addEventListener('appinstalled', function () {
    toast('App instalada: búscala en tu pantalla de inicio.');
    deferredPrompt = null;
  });
  var btnInstall = $('#btnInstall');
  btnInstall.addEventListener('click', function () {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (res) {
          if (res && res.outcome === 'accepted') { toast('Instalando…'); }
          deferredPrompt = null;
        });
      } catch (e) { toast(installSteps()); }
    } else {
      toast(installSteps());
    }
  });
  if (isIOS() && !window.navigator.standalone) $('#iosHint').hidden = false;

  window.addEventListener('hashchange', renderRoute);

  /* ---------- Init ---------- */
  renderBadge();
  loadData();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
