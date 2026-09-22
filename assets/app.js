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
    /* Servidor de pedidos (el Worker de Cloudflare de la carpeta vortex-api).
       Ejemplo: 'https://vortex-pedidos.tucuenta.workers.dev'
       MIENTRAS ESTE VACIO, la app funciona igual que siempre: el pedido solo va por
       WhatsApp y no se manda a ningun servidor. Al ponerlo, el pedido se guarda
       ademas en el servidor y aparece en el panel privado. */
    apiPedidos: 'https://vortex-pedidos.granadoalejandro97.workers.dev',   // desplegado el 2026-09-17 (Worker vortex-pedidos)
    shopDomain: 'kvrfbn-n1.myshopify.com', // dominio de la API
    storefrontToken: 'd93566827739f74089b5b9933113035c', // token público (catálogo)
    apiVersion: '2026-01',
    currency: 'COP',
    pixelId: '1544591750238444',           // Píxel de Meta oficial "Píxel de vortexgadgets" (corregido 09/09/2026: apuntaba al ajeno 1724390862126477)
    ttPixelId: 'DACQKEJC77U4RNF8JLTG',     // Píxel de TikTok "Vortex Gadgets App"
    couponCode: 'VORTEX10',                // cupón 10 % extra
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
    cat: '',
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
      toast('Cupón VORTEX10 aplicado: 10 % extra');
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
      type: p.type || '', tags: p.tags || '',
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
      if (c && c.products && c.products.length && c.products[0].type !== undefined) { state.products = c.products; state.collections = c.collections || []; return true; }
    } catch (e) {}
    return false;
  }
  function loadStorefront() {
    var q = '{ products(first: 60) { edges { node { id title handle productType description availableForSale priceRange { minVariantPrice { amount } } compareAtPriceRange { minVariantPrice { amount } } variants(first: 1) { edges { node { id } } } images(first: 6) { edges { node { url } } } } } } collections(first: 25) { edges { node { handle title } } } }';
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
        /* [2026-09-16] id numerico de la variante: hace falta para el permalink
           del carrito de Shopify (/cart/{variante}:{cantidad}). Si el producto no
           existe en la tienda, no viene y el boton de pagar en linea se oculta. */
        var vgid = (n.variants && n.variants.edges && n.variants.edges.length) ? n.variants.edges[0].node.id : '';
        var vnum = vgid ? (Number(String(vgid).split('/').pop()) || 0) : 0;
        return {
          title: n.title, handle: n.handle,
          price: Number(n.priceRange.minVariantPrice.amount) || 0,
          compare: Number(cmp) || 0,
          image: img, images: images,
          variantId: vnum,
          desc: n.description || '', available: !!n.availableForSale,
          type: n.productType || '',
          url: CONFIG.storeUrl + '/products/' + n.handle
        };
      });
      state.collections = colls.map(function (e) { return e.node; });
      try { localStorage.setItem('vx_cache', JSON.stringify({ products: state.products, collections: state.collections, ts: Date.now() })); } catch (e) {}
    });
  }
  function loadData() {
    /* los testimonios se cargan aparte y, al llegar, se repinta para que la
       seccion aparezca sola si hay resenas reales */
    loadTestimonios().then(function () { renderRoute(); });
    if (tryCache()) { state.loading = false; renderRoute(); pintarDescuentoPopup(); }
    loadStorefront().then(function () {
      state.loading = false; renderRoute(); pintarDescuentoPopup();
    }).catch(function () {
      return loadFallback().then(function () { state.loading = false; renderRoute(); pintarDescuentoPopup(); })
        .catch(function () { state.loading = false; if (!state.products.length) toast('Sin conexión y sin catálogo guardado', true); renderRoute(); pintarDescuentoPopup(); });
    });
  }

  /* ---------- Urgencia ---------- */
  /* [2026-09-16] Se elimino viewersNow(): mostraba "N viendo ahora" con un numero
     inventado (18 + hash % 46). No se anuncia lo que no se puede probar. */
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
  function openWa(text) { window.open(waLink(text), '_blank'); trackPixel('Contact'); }

  /* ---------- Píxeles: Meta + TikTok ---------- */
  function initPixel() {
    if (CONFIG.pixelId) {
      (function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v;
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', CONFIG.pixelId);
      window.fbq('track', 'PageView');
    }
    if (CONFIG.ttPixelId) {
      // Cargador oficial de TikTok (ttq): load + PageView
      (function (w, d, t) {
        w.TiktokAnalyticsObject = t;
        var ttq = w[t] = w[t] || [];
        ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
        ttq.setAndDefer = function (x, e) { x[e] = function () { x.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
        for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
        ttq.load = function (e) {
          var o = 'https://analytics.tiktok.com/i18n/pixel/events.js';
          var s = d.createElement('script'); s.async = !0; s.src = o + '?sdkid=' + e + '&lib=' + t;
          var p = d.getElementsByTagName('script')[0]; p.parentNode.insertBefore(s, p);
        };
        ttq.load(CONFIG.ttPixelId);
        ttq.page();
      })(window, document, 'ttq');
    }
  }
  function trackPixel(ev, data) {
    var d = data || {};
    d.source = 'app_pwa'; // etiqueta para saber que el evento vino de la app
    if (CONFIG.pixelId && typeof window.fbq !== 'undefined') {
      try { window.fbq('track', ev, d); } catch (e) {}
    }
    if (CONFIG.ttPixelId && typeof window.ttq !== 'undefined' && window.ttq.track) {
      try {
        var t = { source: 'app_pwa' };
        if (d.content_ids && d.content_ids.length) {
          t.content_id = d.content_ids[0];
          t.contents = d.content_ids.map(function (id) { return { content_id: id }; });
        }
        if (d.content_name) t.content_name = d.content_name;
        if (d.content_type) t.content_type = d.content_type;
        if (d.value != null) t.value = d.value;
        if (d.currency) t.currency = d.currency;
        if (ev === 'PageView') { window.ttq.page(); } else { window.ttq.track(ev, t); }
      } catch (e2) {}
    }
  }

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
      '</div></div></article>';
  }
  function gridHtml(list) {
    if (!list.length) return '<div class="empty-state"><p>No encontramos productos.</p></div>';
    return '<div class="grid-products">' + list.map(prodCard).join('') + '</div>';
  }

  /* ---------- Vistas ---------- */
  /* ---------- Testimonios reales ---------- */
  /* [2026-09-17] La seccion de resenas se pinta SOLO con testimonios reales que
     esten en testimonios.json. Si la lista esta vacia, devuelve '' y no se ve
     nada. No se inventan resenas: afirmar opiniones que no existen es publicidad
     engañosa (Ley 1480 de 2011) y es justo lo que se quito de esta app. */
  function tstStars(n) {
    var h = '';
    for (var i = 1; i <= 5; i++) h += '<span' + (i <= n ? '' : ' class="off"') + '>★</span>';
    return h;
  }
  function tstCard(t) {
    var ini = String(t.nombre || '?').trim().charAt(0).toUpperCase();
    var meta = [t.ciudad, t.fecha].filter(Boolean).join(' · ');
    return '<figure class="tst-card">' +
      '<div class="tst-top">' +
      '<span class="tst-av">' + esc(ini) + '</span>' +
      '<div class="tst-ident">' +
      '<div class="tst-nom">' + esc(t.nombre) +
      (t.verificado === false ? '' : '<span class="tst-ver" title="Compra verificada">✓</span>') +
      '</div>' +
      '<div class="tst-meta">' + esc(meta) + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="tst-stars">' + tstStars(Number(t.estrellas) || 5) + '</div>' +
      (t.titulo ? '<div class="tst-tit">' + esc(t.titulo) + '</div>' : '') +
      '<blockquote class="tst-txt">' + esc(t.texto) + '</blockquote>' +
      /* [2026-09-22] La foto que mando el cliente. Es opcional: una resena sin
         foto se ve igual de bien. Se marca como "foto del cliente" para que
         quede claro que no es material de la tienda. */
      (t.foto
        ? '<figure class="tst-foto"><img src="' + esc(t.foto) + '" alt="Foto enviada por ' + esc(t.nombre) + '" loading="lazy" decoding="async"><figcaption>Foto del cliente</figcaption></figure>'
        : '') +
      '</figure>';
  }
  /* [2026-09-22] Que resenas van en cada sitio:
       - una resena CON "producto" solo sale en la ficha de ese producto
       - una resena SIN "producto" sale en todas las fichas y en el inicio
     Asi una resena del proyector no aparece dando a entender que es del
     enfriador de aire. */
  function tstDeProducto(handle) {
    var ts = state.testimonios || [];
    if (!handle) return ts;
    return ts.filter(function (t) { return !t.producto || t.producto === handle; });
  }
  function vTestimonios(handle) {
    var ts = tstDeProducto(handle);
    if (!ts.length) return '';
    var suma = 0;
    ts.forEach(function (t) { suma += Number(t.estrellas) || 0; });
    var media = (suma / ts.length).toFixed(1);
    var tarjetas = ts.map(tstCard).join('');
    return '<section class="tst">' +
      '<div class="tst-head">' +
      /* En la ficha el titular NO dice "de este producto": son clientes de la
         tienda. Afirmar que la resena es de ese producto seria inventar. */
      '<h2>' + (handle ? 'Lo que dicen nuestros clientes' : 'Reseñas de clientes') + '</h2>' +
      '<div class="tst-score"><b>' + media + '</b>' +
      '<span class="tst-stars">' + tstStars(Math.round(suma / ts.length)) + '</span>' +
      '<small>(' + ts.length + (ts.length === 1 ? ' reseña' : ' reseñas') + ' de compra verificada)</small>' +
      '</div>' +
      '</div>' +
      '<div class="tst-marquee">' +
      /* la tira va DUPLICADA: al llegar al 50 % el bucle vuelve a empezar sin
         salto. El movimiento es siempre derecha -> izquierda, en bucle. */
      '<div class="tst-track">' + tarjetas + tarjetas + '</div>' +
      '</div>' +
      '</section>';
  }
  function loadTestimonios() {
    return fetch('testimonios.json?v=36', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var arr = (j && j.testimonios) ? j.testimonios : [];
        state.testimonios = arr.filter(function (t) { return t && t.nombre && t.texto; });
      })
      .catch(function () { state.testimonios = []; });
  }

  /* ---------- Seccion "Compra con seguridad total" ---------- */
  /* [2026-09-17] Recreada a partir del video que envio el dueno.
     Lo que se midio en el video (21 fotogramas, pixel a pixel):
       - el titulo, el subtitulo, la descripcion, los dos chips y el boton: QUIETOS
         (0 px de diferencia en todos los fotogramas)
       - la insignia "100% COMPRA SEGURA": es lo UNICO que cambia, y buscando el
         mejor encuadre el desplazamiento es siempre (0,0), o sea que NO se mueve:
         cambia de brillo. Es una animacion de entrada, no un movimiento continuo.
     Por eso aqui: la insignia respira con un brillo suave y los bloques entran
     con un desplazamiento corto cuando la seccion aparece en pantalla.
     El plazo es el unico oficial de la app: 3 a 4 dias habiles (el video decia
     5-8 dias, que ya no se usa). */
  function segIcono(k) {
    if (k === 'truck') {
      return '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" ' +
        'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 7h11v9H2z"/><path d="M13 10h4l3 3v3h-7z"/>' +
        '<circle cx="7" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M13 2 4.5 13H11l-1 9 8.5-11H12z"/></svg>';
  }
  function vSeguridad() {
    return '<section class="seg" id="seg">' +
      '<div class="seg-badge seg-el">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 2.5l7.5 3v6c0 4.4-3.1 8.4-7.5 9.5-4.4-1.1-7.5-5.1-7.5-9.5v-6z"/>' +
      '<path d="M8.8 12.1l2.3 2.3 4.1-4.4"/></svg>' +
      '100% COMPRA SEGURA</div>' +
      '<h2 class="seg-h seg-el">Compra con seguridad total</h2>' +
      '<p class="seg-sub seg-el">Paga al Recibir</p>' +
      '<p class="seg-p seg-el">Recibe tu pedido en casa en <b>3 a 4 días hábiles</b> y paga en ' +
      'efectivo al recibirlo. Revisas antes de pagar. <b>Sin riesgos.</b></p>' +
      '<div class="seg-chips seg-el">' +
      '<div class="seg-chip">' + segIcono('truck') +
      '<div><b>Envío nacional</b><span>Gratis a toda Colombia</span></div></div>' +
      '<div class="seg-chip">' + segIcono('bolt') +
      '<div><b>Entrega express</b><span>3 a 4 días hábiles</span></div></div>' +
      '</div>' +
      '<a class="seg-cta seg-el" href="#/catalogo">¡Comprar ahora!</a>' +
      '</section>';
  }
  /* la animacion de entrada: en cuanto la seccion asoma, los bloques aparecen */
  function segInit() {
    var s = document.getElementById('seg');
    if (!s || s.classList.contains('in')) return;
    /* Los bloques solo se ocultan a partir de aqui (clase .seg-armed). Si JS no
       llega a ejecutarse, la seccion se ve completa: nunca queda en blanco. */
    s.classList.add('seg-armed');
    var mostrar = function () { s.classList.add('in'); };
    /* red de seguridad: pase lo que pase, el contenido se muestra */
    setTimeout(mostrar, 1200);
    if (!('IntersectionObserver' in window)) { mostrar(); return; }
    try {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { mostrar(); io.disconnect(); } });
      }, { threshold: 0.15 });
      io.observe(s);
    } catch (err) { mostrar(); }
  }

  function vHome() {
    var dest = state.products.filter(function (p) { return p.available; }).slice(0, 8);
    return '' +
      vHeroSlider() +
      vHeroBar() +
      vTestimonios() +
      '<h2 class="section-title">Destacados de la semana</h2>' +
      '<p class="section-sub">Elige, completa tus datos y paga al recibir</p>' + gridHtml(dest) +
      '<h2 class="section-title">Así de fácil compras</h2>' +
      '<div class="steps">' +
      stepHtml('1', 'Elige tu producto', 'Explora el catálogo y añade al carrito.') +
      stepHtml('2', 'Aplica tu cupón', 'Usa VORTEX10 y obtén 10 % extra.') +
      stepHtml('3', 'Completa tus datos', 'Nombre, cédula, celular y dirección de entrega.') +
      stepHtml('4', 'Pagas al recibir', 'Revisas tu pedido y pagas en efectivo.') +
      '</div>' +
      '<div class="wa-float-big">' +
      '<div><b style="color:#fff">¿Dudas o pedido especial?</b></div>' +
      '<a class="btn btn-wa" href="' + waLink('Hola VÓRTEX, tengo una consulta') + '" target="_blank" rel="noopener">Chatear ahora</a>' +
      '</div>' +
      vSeguridad();
  }
  function stepHtml(n, t, d) {
    return '<div class="step"><div class="n">' + n + '</div><b>' + t + '</b><p>' + d + '</p></div>';
  }

  function normTxt(s) {
    return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function vCatalog() {
    var q = normTxt(state.searchTerm);
    var cat = state.cat || '';
    var tipos = tiposDeCat(cat);
    var list = state.products.filter(function (p) {
      if (tipos && tipos.indexOf(p.type) < 0) return false;
      if (!q) return true;
      return normTxt(p.title + ' ' + (p.vendor || '') + ' ' + p.desc).indexOf(q) > -1;
    });
    var nombreCat = (CATEGORIAS.filter(function (c) { return c.slug === cat; })[0] || {}).nombre || '';
    return '<h1 style="font-size:22px;font-weight:900">' + (nombreCat ? esc(nombreCat) : 'Catálogo') + '</h1>' +
      '<p class="muted" style="font-size:13px;margin:2px 0 12px">' + list.length + ' productos · Envío gratis · Contra entrega · Cupón VORTEX10 (-10%)</p>' +
      '<div class="cat-chips">' +
      '<a class="chip-btn' + (!cat ? ' on' : '') + '" href="#/catalogo">Todos</a>' +
      CATEGORIAS.map(function (c) { return '<a class="chip-btn' + (cat === c.slug ? ' on' : '') + '" href="#/catalogo?cat=' + c.slug + '">' + esc(c.nombre) + '</a>'; }).join('') +
      '</div>' +
      (list.length ? '' : '<div class="empty-state"><p>Sin resultados' + (q ? ' para “' + esc(state.searchTerm) + '”' : ' en esta categoría') + '.</p></div>') +
      gridHtml(list);
  }

  /* [2026-09-16] Blindaje del plazo de envio.
     Las descripciones de producto vienen de la tienda (GraphQL / datos-tienda.json)
     y alli pueden quedar plazos viejos (p.ej. "2-6 dias habiles"). Aqui se normaliza
     cualquier RANGO de dias u horas habiles al plazo oficial unico, de modo que la
     promesa nunca pueda contradecirse aunque cambie el catalogo.
     No toca plazos sueltos como "5 dias habiles" (retracto) ni "30 dias" (garantia). */
  function saneaPlazo(txt) {
    if (!txt) return txt;
    return String(txt)
      .replace(/\b\d+\s*(?:a|-|\u2013|\u2014)\s*\d+\s*d[i\u00ed]as?\s*h[\u00e1a]biles/gi, '3 a 4 d\u00edas h\u00e1biles')
      .replace(/\b\d+\s*(?:a|-|\u2013|\u2014)\s*\d+\s*horas\s*h[\u00e1a]biles/gi, '3 a 4 d\u00edas h\u00e1biles')
      .replace(/\b24\s*-\s*72\s*(?:horas|h)?\b/gi, '3 a 4 d\u00edas h\u00e1biles');
  }

  function vProduct(handle) {
    var p = state.products.filter(function (x) { return x.handle === handle; })[0];
    if (!p) return '<div class="empty-state"><p>Producto no encontrado.</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/catalogo">Ver catálogo</a></p></div>';
    var off = pctOff(p.price, p.compare);
    var imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
    var main = imgs[0] || '';
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
      '<h1 class="d-title">' + esc(p.title) + '</h1>' +
      '<div class="d-meta">Vendido por VÓRTEX Gadgets · Envío gratis a toda Colombia · Despacho 3 a 4 días hábiles</div>' +
      '<div class="d-price"><span class="d-now">' + money(p.price) + '</span>' +
      (off > 0 ? '<span class="d-old">' + money(p.compare) + '</span><span class="d-pct">-' + off + '%</span>' : '') + '</div>' +
      '<div class="d-save">Ahorras ' + money(p.compare - p.price) + ' hoy · Oferta de lanzamiento</div>' +
      /* cupón */
      (couponOn
        ? '<div class="coupon-on">✓ Cupón <b>VORTEX10</b> activo en tu carrito (-10%)</div>'
        : '<div class="coupon-strip">Cupón <b>VORTEX10</b> = <b>10 % extra</b> — aplícalo en el carrito</div>') +
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
          '<button class="btn btn-accent btn-block btn-stack btn-late" data-action="cod-start" data-handle="' + esc(p.handle) + '">Pedir contra entrega<span class="btn-sub">Sin registro · Menos de 1 minuto</span></button>' +
          '</div>' +
          (tieneTienda(p)
            ? '<a class="d-store" href="' + esc(p.url) + '" target="_blank" rel="noopener">También disponible en la tienda online (pago con PSE / tarjeta)</a>'
            : '') +
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
      '<div class="acc-b">' + saneaPlazo(p.desc || 'Producto disponible en la tienda VÓRTEX Gadgets.') + '</div>' +
      '<button class="acc-h" data-action="acc-toggle">Envío y contra entrega <span class="chev">▾</span></button>' +
      '<div class="acc-b">Despachamos a todo Colombia con número de guía: tu pedido llega en 3 a 4 días hábiles.\n\nPagas CONTRA ENTREGA: en efectivo al recibir tu pedido, después de revisarlo. También puedes pagar en línea (PSE o tarjeta) desde nuestra tienda web.</div>' +
      '<button class="acc-h" data-action="acc-toggle">Garantía y devoluciones <span class="chev">▾</span></button>' +
      '<div class="acc-b">Todos nuestros productos tienen garantía de funcionamiento. Si algo llega dañado o no funciona, te lo cambiamos o devolvemos tu dinero. Escríbenos por WhatsApp y te atendemos.</div>' +
      '</div>' +
      '</div></div>' +
      /* [2026-09-22] Las resenas tambien en la ficha, que es donde decide el
         cliente. Si la lista esta vacia, vTestimonios devuelve '' y no se ve
         nada: nunca hay un bloque vacio. */
      vTestimonios(p.handle) +
      /* barra fija móvil */
      (p.available
        ? '<div class="buybar">' +
          '<div class="bb-price"><span class="bb-now">' + money(p.price) + '</span>' +
          (off > 0 ? '<span class="bb-old">' + money(p.compare) + '</span>' : '') + '</div>' +
          '<button class="btn btn-accent" data-action="cod-start" data-handle="' + esc(p.handle) + '">Pedir contra entrega</button>' +
          '</div>' : '') +
      '</div>';
  }

  /* [2026-09-16] Enlace de pago en linea.
     Shopify arma el carrito con un permalink: /cart/{variante}:{cantidad},...
     Solo se puede construir si TODAS las lineas tienen id de variante, es decir
     si el producto existe de verdad en la tienda. Si falta alguno devuelve null
     y el boton NO se muestra.
     Antes este boton llevaba a /collections/all (el catalogo entero): el cliente
     salia de la app, perdia su carrito y tenia que buscar el producto otra vez. */
  function tieneTienda(p) { return !!(p && p.variantId); }
  /* [2026-09-16] El id de variante se busca primero en la linea del carrito y,
     si no esta (carritos guardados antes de este cambio), en el catalogo por
     handle. Asi el boton funciona tambien para quien ya tenia el carrito lleno. */
  function variantDeLinea(l) {
    if (l && l.variantId) return l.variantId;
    var p = l ? productByHandle(l.handle) : null;
    return (p && p.variantId) ? p.variantId : 0;
  }
  function shopifyCartUrl(lines) {
    var partes = [];
    for (var i = 0; i < (lines || []).length; i++) {
      var v = variantDeLinea(lines[i]);
      if (!v) return null;
      partes.push(v + ':' + (lines[i].qty || 1));
    }
    if (!partes.length) return null;
    var ruta = '/cart/' + partes.join(',');
    /* [2026-09-16] Si el cliente aplico un cupon en la app hay que mandarlo a
       Shopify, o al pagar en linea veria el precio LLENO y perderia su descuento.
       El cupon VORTEX10 existe tambien como codigo de descuento en la tienda
       (comprobado: 259.900 -> 233.910, el 10 % exacto). */
    var cup = couponCode();
    if (cup) return CONFIG.storeUrl + '/discount/' + encodeURIComponent(cup) + '?redirect=' + ruta;
    return CONFIG.storeUrl + ruta;
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
    var shopUrl = shopifyCartUrl(state.cart);
    return '<h1 style="font-size:22px;font-weight:900;margin-bottom:12px">Tu carrito</h1>' +
      '<div class="cart-cupon">' +
      (couponOn
        ? '<div class="coupon-applied">✓ Cupón <b>VORTEX10</b> aplicado (-10%) <button class="link" data-action="remove-coupon">Quitar</button></div>'
        : '<div class="coupon-box"><input id="couponInput" placeholder="Cupón de descuento (ej. VORTEX10)" autocomplete="off">' +
          '<button class="btn btn-accent btn-sm" data-action="apply-coupon">Aplicar</button></div>') +
      '<p class="muted" style="font-size:11.5px;margin-top:6px">Prueba el cupón <b>VORTEX10</b> = 10 % extra</p></div>' +
      lines +
      '<div class="totals">' +
      '<div class="trow"><span>Subtotal</span><span>' + money(sub) + '</span></div>' +
      (disc > 0 ? '<div class="trow discount"><span>Cupón ' + couponCode() + ' (-' + couponPct() + '%)</span><span>-' + money(disc) + '</span></div>' : '') +
      '<div class="trow"><span>Envío</span><span class="free">GRATIS</span></div>' +
      '<div class="trow total"><span>Total a pagar</span><span>' + money(total) + '</span></div>' +
      '<p class="muted" style="font-size:12px;margin-top:8px">Pago contra entrega: pagas en efectivo al recibir y revisas tu pedido antes.</p>' +
      '<p class="pick-h">¿Cómo quieres pedir?</p>' +
      '<div style="display:grid;gap:9px;margin-top:9px">' +
      '<a class="btn btn-accent btn-block btn-stack btn-late" href="#/contraentrega">Completar mis datos de envío<span class="btn-sub">Sin registro · Menos de 1 minuto</span></a>' +
      '<button class="btn btn-wa2 btn-block btn-stack" data-action="wa-cart">Pedir todo por WhatsApp<span class="btn-sub">Lo cerramos contigo por chat</span></button>' +
      (shopUrl
        ? '<a class="btn btn-ghost btn-block btn-stack" href="' + esc(shopUrl) + '" target="_blank" rel="noopener">Pagar en línea (PSE o tarjeta)<span class="btn-sub">Se abre el pago seguro de la tienda · El envío sigue siendo GRATIS</span></a>'
        : '<p class="muted" style="font-size:11.5px;margin:2px 0 0">Algunos productos de este carrito no están habilitados para pago en línea. Puedes pedir contra entrega o por WhatsApp.</p>') +
      '</div></div>';
  }

  function vComo() {
    return '<h1 style="font-size:22px;font-weight:900">Cómo comprar (contra entrega)</h1>' +
      '<p class="muted" style="margin:4px 0 14px">Sin tarjeta, sin riesgo: pagas cuando recibes.</p>' +
      '<div class="steps" style="grid-template-columns:1fr">' +
      stepHtml('1', 'Elige tu producto', 'Explora el catálogo y añádelo al carrito.') +
      stepHtml('2', 'Aplica tu cupón', 'En el carrito usa VORTEX10 y obtén 10 % extra.') +
      stepHtml('3', 'Completa tus datos', 'Nombre, documento, celular, ciudad y dirección de entrega.') +
      stepHtml('4', 'Recibe con guía', 'Te enviamos tu número de guía: llega a tu ciudad en 3 a 4 días hábiles.') +
      stepHtml('5', 'Paga al recibir', 'Revisa tu pedido con el transportador y paga en efectivo. Así de simple.') +
      '</div>' +
      '<div class="trust-row">' +
      '<span class="chip"><span class="ck">✓</span> Envío <b>GRATIS</b> a toda Colombia</span>' +
      '<span class="chip"><span class="ck">✓</span> Pago <b>contra entrega</b></span>' +
      '<span class="chip"><span class="ck">✓</span> Cupón <b>VORTEX10</b> (-10%)</span>' +
      '<span class="chip"><span class="ck">✓</span> Garantía de funcionamiento</span>' +
      '</div>' +
      '<div class="wa-float-big"><div><b style="color:#fff">¿Listo para pedir?</b></div>' +
      '<a class="btn btn-wa" href="' + waLink('Hola VÓRTEX, quiero hacer un pedido contra entrega') + '" target="_blank" rel="noopener">Escribir por WhatsApp</a></div>';
  }

  function vContacto() {
    return '<h1 style="font-size:22px;font-weight:900">Contacto y pedidos</h1>' +
      '<p class="muted" style="margin:4px 0 14px">Te respondemos rápido por WhatsApp, todos los días.</p>' +
      '<div class="wa-float-big" style="justify-content:flex-start;flex-direction:column;align-items:stretch">' +
      '<b style="color:#fff">WhatsApp oficial de pedidos</b>' +
      '<div class="muted" style="font-size:13px">Catálogo, pedidos, cupón VORTEX10, garantías y soporte.</div>' +
      '<a class="btn btn-wa" href="' + waLink('Hola VÓRTEX Gadgets') + '" target="_blank" rel="noopener">Abrir WhatsApp</a>' +
      '</div>' +
      '<div class="trust-row">' +
      '<span class="chip">Tienda web: vortexgadgets.com.co</span>' +
      '<span class="chip">Pago en línea: PSE y tarjetas</span>' +
      '<span class="chip">Pago contra entrega: efectivo</span>' +
      '</div>';
  }

  /* ---------- Barra deslizante de beneficios ----------
     Movimiento medido del video de referencia: el mensaje central se desliza
     hacia ARRIBA cada 5,00 s (transiciones en 4,5 / 9,5 / 14,5 / 19,5 s), con una
     copia del primer mensaje al final para que el bucle suba siempre. Las zonas
     de los extremos quedan fijas. */
  var BAR_ITEMS = [
    { i: 'cash', t: 'Paga <em>contra entrega</em>', s: 'En efectivo cuando recibes' },
    { i: 'eye', t: '<em>Revisa</em> antes de pagar', s: 'Abres y revisas tu pedido' },
    { i: 'shield', t: '<em>5 días</em> de retracto', s: 'Garantía Ley 1480' }
  ];
  var BAR_ICONS = {
    truck: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="1.7"/><circle cx="17" cy="17" r="1.7"/></svg>',
    cash: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/></svg>'
  };
  function hbItem(o) {
    return '<div class="hb-item">' + BAR_ICONS[o.i] +
      '<span class="hb-txt"><b>' + o.t + '</b><i>' + o.s + '</i></span></div>';
  }
  function vHeroBar() {
    return '<div class="herobar" data-hero-bar>' +
      '<div class="hb-zone hb-left">' + BAR_ICONS.truck +
        '<span class="hb-txt"><b>Envío <em>GRATIS</em></b><i>a toda Colombia</i></span>' +
        '<span class="hb-chev">&rsaquo;</span>' +
      '</div>' +
      '<span class="hb-sep"></span>' +
      '<div class="hb-zone hb-mid"><div class="hb-track" data-hb-track>' +
        BAR_ITEMS.map(hbItem).join('') + hbItem(BAR_ITEMS[0]) +
      '</div></div>' +
      '<span class="hb-sep hb-sep-end"></span>' +
      '<a class="hb-zone hb-right" href="#/catalogo">' + BAR_ICONS.box +
        '<span class="hb-txt"><b>Todos los gadgets</b><i>Ver catálogo</i></span>' +
      '</a>' +
    '</div>';
  }
  var hbTimer = null;
  function initHeroBar() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    var track = document.querySelector('[data-hb-track]');
    if (!track) return;
    var items = track.children;
    if (items.length < 2) return;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
    var idx = 0, copia = items.length - 1;
    function subir() {
      var h = items[0].offsetHeight || 46;
      idx++;
      track.style.transition = 'transform .42s cubic-bezier(.4,0,.2,1)';
      track.style.transform = 'translateY(' + (-idx * h) + 'px)';
      if (idx >= copia) {
        setTimeout(function () {
          track.style.transition = 'none';
          idx = 0;
          track.style.transform = 'translateY(0)';
        }, 470);
      }
    }
    hbTimer = setInterval(subir, 5000);
  }

  /* ---------- Barra de anuncios en movimiento (2026-09-17) ----------
     El dueno pidio que el anuncio se mueva: que ENTRE POR LA DERECHA y SALGA
     POR LA IZQUIERDA, repitiendo la misma secuencia.
     Como se hace sin cortes: la secuencia se duplica N veces (N par) y se anima
     de translateX(0) a translateX(-50%). Con N par, -50% cae justo en la mitad,
     donde el contenido es identico al del arranque, asi que el reinicio del
     bucle no se ve.
     La duracion se calcula con esa misma distancia, para que la velocidad en
     px/s sea la misma en movil y en escritorio.
     Se llama UNA sola vez: si se llamara en cada renderRoute, la marquesina se
     reiniciaria cada vez que el cliente cambia de pagina. */
  var AN_SECUENCIA = null;
  function initAnnounce() {
    var caja = document.querySelector('[data-announce]');
    if (!caja) return;
    var pista = caja.querySelector('[data-an-track]');
    if (!pista) return;
    if (AN_SECUENCIA === null) AN_SECUENCIA = pista.innerHTML;
    pista.innerHTML = AN_SECUENCIA;
    caja.classList.remove('an-live');
    caja.style.removeProperty('--an-dur');
    if (pista.children.length < 2) return;
    var quieto = false;
    try { quieto = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    if (quieto) return;
    /* mensajes que tiene UNA secuencia */
    var porSecuencia = pista.children.length;
    if (porSecuencia < 2) return;
    /* Medir UNA secuencia. Hay que hacerlo sin envolver y sin centrar, porque
       con flex-wrap el ancho leido seria el de la barra, no el del contenido. */
    var wj = pista.style.flexWrap, jc = pista.style.justifyContent;
    pista.style.flexWrap = 'nowrap';
    pista.style.justifyContent = 'flex-start';
    var anchoUno = pista.scrollWidth;
    var pantalla = window.innerWidth || 360;
    if (!anchoUno || anchoUno < 40 || anchoUno > pantalla * 30) {   // medida poco fiable
      pista.style.flexWrap = wj;
      pista.style.justifyContent = jc;
      return;
    }
    /* copias suficientes para que la tira siempre cubra la pantalla (con holgura) */
    var copias = Math.ceil((pantalla + 120) / anchoUno) + 1;
    if (copias > 12) copias = 12;
    if (copias % 2) copias++;                        // par: las dos mitades quedan identicas
    var html = AN_SECUENCIA;
    for (var i = 1; i < copias; i++) html += AN_SECUENCIA;
    pista.innerHTML = html;
    /* Distancia EXACTA de una secuencia, medida sobre el DOM ya montado: va del
       primer mensaje al primero de la copia siguiente. Se mide mientras la pista
       esta sin envolver, que es como estara cuando la animacion corra. */
    var seq = pista.children[porSecuencia].getBoundingClientRect().left -
              pista.children[0].getBoundingClientRect().left;
    pista.style.flexWrap = wj;
    pista.style.justifyContent = jc;
    if (!(seq > 40)) return;                         // medida poco fiable: se deja quieta
    var VELOCIDAD = 58;                              // px por segundo
    caja.style.setProperty('--an-mueve', (-seq).toFixed(2) + 'px');
    caja.style.setProperty('--an-dur', (seq / VELOCIDAD).toFixed(2) + 's');
    caja.classList.add('an-live');
  }

  /* ---------- Formulario contra entrega (datos de envío) ---------- */
  var DEPARTAMENTOS = ['Amazonas', 'Antioquia', 'Arauca', 'Atlántico', 'Bogotá D.C.', 'Bolívar', 'Boyacá', 'Caldas', 'Caquetá', 'Casanare', 'Cauca', 'Cesar', 'Chocó', 'Córdoba', 'Cundinamarca', 'Guainía', 'Guaviare', 'Huila', 'La Guajira', 'Magdalena', 'Meta', 'Nariño', 'Norte de Santander', 'Putumayo', 'Quindío', 'Risaralda', 'San Andrés y Providencia', 'Santander', 'Sucre', 'Tolima', 'Valle del Cauca', 'Vaupés', 'Vichada'];
  var TIPOS_DOC = [['CC', 'Cédula de ciudadanía'], ['CE', 'Cédula de extranjería'], ['NIT', 'NIT'], ['TI', 'Tarjeta de identidad'], ['PAS', 'Pasaporte']];
  /* [2026-09-16] Los datos personales del comprador ya no se guardan ni se
     precargan en el navegador. En un dispositivo compartido el siguiente
     cliente veia nombre, cedula, celular y direccion del anterior. Se limpia
     lo que hubiera quedado de versiones anteriores (Ley 1581). */
  var MISDATOS_KEY = 'vx_misdatos';
  try { localStorage.removeItem(MISDATOS_KEY); } catch (e) {}
  var PEDIDOS_KEY = 'vortex_cod_pedidos_v1';

  function loadMisDatos() {
    try { return JSON.parse(localStorage.getItem(MISDATOS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveMisDatos(d) {
    try {
      localStorage.setItem(MISDATOS_KEY, JSON.stringify({
        nombre: d.nombre, apellido: d.apellido, tipoDoc: d.tipoDoc, numDoc: d.numDoc,
        telefono: d.telefono, correo: d.correo, departamento: d.departamento,
        ciudad: d.ciudad, direccion: d.direccion
      }));
    } catch (e) {}
  }
  function codItems(q) {
    var params = new URLSearchParams(q || '');
    var ph = params.get('p');
    var pq = Math.max(1, parseInt(params.get('n'), 10) || 1);
    if (ph) {
      var p = productByHandle(ph);
      if (p) return [{ handle: p.handle, title: p.title, price: p.price, image: p.image, qty: pq }];
    }
    return state.cart.slice();
  }
  function codTotals(items) {
    var sub = items.reduce(function (a, l) { return a + (l.price || 0) * l.qty; }, 0);
    var disc = couponPct() > 0 ? Math.round(sub * couponPct() / 100) : 0;
    return { sub: sub, disc: disc, total: sub - disc };
  }
  function codVal(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }

  function vCod(q) {
    var items = codItems(q);
    if (!items.length) {
      return '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 7h16l-1.5 12h-13L4 7Z"/><path d="M8 7a4 4 0 0 1 8 0"/></svg>' +
        '<p>Todavía no tienes productos</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/catalogo">Ir al catálogo</a></p></div>';
    }
    var t = codTotals(items);
    var d = {}; /* [2026-09-16] sin precarga de datos personales */
    var resumen = items.map(function (l) {
      return '<div class="trow"><span>' + l.qty + '× ' + esc(l.title) + '</span><span>' + money(l.price * l.qty) + '</span></div>';
    }).join('');
    var optsDep = DEPARTAMENTOS.map(function (x) {
      return '<option value="' + esc(x) + '"' + (d.departamento === x ? ' selected' : '') + '>' + esc(x) + '</option>';
    }).join('');
    var optsDoc = TIPOS_DOC.map(function (x) {
      return '<option value="' + x[0] + '"' + ((d.tipoDoc || 'CC') === x[0] ? ' selected' : '') + '>' + x[0] + ' — ' + x[1] + '</option>';
    }).join('');
    return '<h1 style="font-size:22px;font-weight:900">Último paso: tus datos</h1>' +
      '<p class="muted" style="margin:4px 0 12px">Toma <b>menos de 1 minuto</b> y no necesitas tarjeta. Pago <b>contra entrega</b>: pagas en efectivo cuando recibas y revisas tu pedido antes.</p>' +
      '<div class="totals" style="margin-top:0">' + resumen +
        (t.disc > 0 ? '<div class="trow" style="color:#4CE0D6"><span>Cupón ' + esc(couponCode()) + ' (-' + couponPct() + '%)</span><span>-' + money(t.disc) + '</span></div>' : '') +
        '<div class="trow"><span>Envío</span><span style="color:#4CE0D6;font-weight:800">GRATIS</span></div>' +
        '<div class="trow total"><span>Total a pagar</span><span>' + money(t.total) + '</span></div>' +
      '</div>' +
      '<form class="codform" id="codForm" novalidate autocomplete="on">' +
        '<div class="fld-row">' +
          '<div class="fld"><label for="cod_nombre">Nombre *</label><input id="cod_nombre" required maxlength="40" name="given-name" autocomplete="given-name" value="' + esc(d.nombre || '') + '" placeholder="Ej: María"></div>' +
          '<div class="fld"><label for="cod_apellido">Apellido *</label><input id="cod_apellido" required maxlength="40" name="family-name" autocomplete="family-name" value="' + esc(d.apellido || '') + '" placeholder="Ej: Gómez"></div>' +
        '</div>' +
        '<div class="fld-row">' +
          '<div class="fld"><label for="cod_tipoDoc">Tipo de documento *</label><select id="cod_tipoDoc">' + optsDoc + '</select></div>' +
          '<div class="fld"><label for="cod_numDoc">Número de documento *</label><input id="cod_numDoc" required maxlength="15" inputmode="numeric" autocomplete="off" value="' + esc(d.numDoc || '') + '" placeholder="Ej: 1126705132"></div>' +
        '</div>' +
        '<div class="fld"><label for="cod_telefono">Teléfono / WhatsApp *</label><input id="cod_telefono" required maxlength="10" pattern="3[0-9]{9}" type="tel" inputmode="tel" autocomplete="tel" value="' + esc(d.telefono || '') + '" placeholder="Ej: 3001234567 (10 dígitos)"></div>' +
        '<div class="fld"><label for="cod_correo">Correo (opcional)</label><input id="cod_correo" type="email" inputmode="email" autocomplete="email" value="' + esc(d.correo || '') + '" placeholder="tucorreo@ejemplo.com"></div>' +
        '<div class="fld-row">' +
          '<div class="fld"><label for="cod_departamento">Departamento *</label><select id="cod_departamento"><option value="">Selecciona…</option>' + optsDep + '</select></div>' +
          '<div class="fld"><label for="cod_ciudad">Ciudad o municipio *</label><input id="cod_ciudad" required maxlength="60" autocomplete="address-level2" value="' + esc(d.ciudad || '') + '" placeholder="Ej: Cali"></div>' +
        '</div>' +
        '<div class="fld"><label for="cod_direccion">Dirección de entrega *</label><input id="cod_direccion" required maxlength="120" autocomplete="street-address" value="' + esc(d.direccion || '') + '" placeholder="Calle 1 #2-3, torre 4, apto 501, barrio…"></div>' +
        '<div class="fld"><label for="cod_notas">Notas para la entrega</label><textarea id="cod_notas" maxlength="300" rows="3" placeholder="Punto de referencia, horario en que estás, nombre del conjunto, color o talla…"></textarea></div>' +
        '<label class="cod-acepto"><input type="checkbox" id="cod_acepto">' +
        '<span>Autorizo el tratamiento de mis datos personales para gestionar y entregar este pedido, conforme a la <b>Ley 1581 de 2012</b>. No se usan para nada más.</span></label>' +
        '<p class="cod-legal">Lee nuestra <a href="#/info/politica-de-privacidad">política de privacidad</a>. Sin esta autorización no podemos despachar tu pedido.</p>' +
        '<button class="btn btn-accent btn-block" type="button" data-action="cod-submit">Confirmar pedido contra entrega</button>' +
      '</form>';
  }

  /* Confirmacion del pedido.
     [2026-09-17] El dueno pidio quitar el boton de WhatsApp: no quiere que al
     terminar se mande al cliente a WhatsApp. Ahora el pedido ya quedo guardado en
     su panel y la pantalla solo confirma. */
  function vCodOk() {
    var ref = '';
    try { ref = sessionStorage.getItem('vx_pedido_id') || ''; } catch (e) {}
    return '<div class="codok">' +
      '<div class="codok-ico">✓</div>' +
      '<h1 style="font-size:22px;font-weight:900">Pedido registrado</h1>' +
      '<p class="muted" style="margin:6px 0 14px">Gracias por tu compra. En breve un asesor se contactará contigo para confirmar tu envío.</p>' +
      (ref ? '<p class="muted" style="font-size:13px;margin:0 0 14px">N.º de pedido: <b>' + esc(ref) + '</b></p>' : '') +
      '<a class="btn btn-accent btn-block" href="#/catalogo">Seguir comprando</a>' +
      '<p class="muted" style="font-size:12px;margin-top:12px">Te contactaremos al celular que dejaste.</p>' +
      '</div>';
  }

  /* Pantalla de emergencia: SOLO aparece si el servidor NO pudo guardar el pedido.
     Existe para que una caida del servidor no se convierta en una venta perdida:
     el cliente tiene un boton para mandarnos el pedido por WhatsApp. No es un
     redireccionamiento automatico: nada mas terminar un pedido normal, ya no se
     abre WhatsApp. */
  function vCodFallo() {
    var txt = 'Hola VÓRTEX Gadgets, quiero confirmar mi pedido contra entrega.';
    try { txt = sessionStorage.getItem('vx_last_wa') || txt; } catch (e) {}
    return '<div class="codok">' +
      '<div class="codok-ico" style="background:#f59e0b;color:#3b2600">!</div>' +
      '<h1 style="font-size:22px;font-weight:900">No pudimos registrar tu pedido</h1>' +
      '<p class="muted" style="margin:6px 0 14px">Hubo un problema de conexión con nuestro sistema. ' +
      '<b>Tu pedido no se ha perdido:</b> mándanoslo por WhatsApp y lo cerramos contigo ahora mismo.</p>' +
      '<a class="btn btn-wa btn-block" href="' + esc(waLink(txt)) + '" target="_blank" rel="noopener">Enviar mi pedido por WhatsApp</a>' +
      '<a class="btn btn-ghost btn-block" href="#/contraentrega" style="margin-top:9px">Reintentar</a>' +
      '<p class="muted" style="font-size:12px;margin-top:12px">Tus datos y tu carrito siguen guardados en este teléfono.</p>' +
      '</div>';
  }

  /* [2026-09-22] Que campo corresponde a cada mensaje de error, para poder
     marcarlo en rojo y bajar hasta el. Antes el aviso salia arriba mientras el
     cliente estaba abajo pulsando el boton: parecia que el boton no funcionaba. */
  var MAPA_ERR = [
    ['Nombre (', 'cod_nombre'],
    ['Apellido (', 'cod_apellido'],
    ['Pasaporte (', 'cod_numDoc'],
    ['Número de documento (', 'cod_numDoc'],
    ['Teléfono celular (', 'cod_telefono'],
    ['Correo (', 'cod_correo'],
    ['Departamento', 'cod_departamento'],
    ['Ciudad', 'cod_ciudad'],
    ['Dirección (', 'cod_direccion'],
    ['Autorización de datos', 'cod_acepto']
  ];
  function campoDeError(msg) {
    for (var i = 0; i < MAPA_ERR.length; i++) {
      if (String(msg).indexOf(MAPA_ERR[i][0]) === 0) return MAPA_ERR[i][1];
    }
    return '';
  }
  /* Marca los campos con error, muestra el motivo debajo y baja hasta el primero. */
  function marcarErrores(campos, mensajes) {
    limpiarErrores();
    var lista = campos && campos.length ? campos : [];
    var vistos = {};
    var primero = '';
    lista.forEach(function (c) {
      if (!c.id || vistos[c.id]) return;
      vistos[c.id] = 1;
      if (!primero) primero = c.id;
      var el = document.getElementById(c.id);
      if (!el) return;
      var caja = el.closest('.fld') || el.closest('.cod-acepto') || el.parentNode;
      if (!caja) return;
      caja.classList.add('is-err');
      if (caja.classList.contains('fld')) {
        var aviso = document.createElement('span');
        aviso.className = 'fld-err';
        aviso.textContent = c.msg;
        caja.appendChild(aviso);
      }
    });
    var form = document.getElementById('codForm');
    if (form) { form.classList.add('is-err'); setTimeout(function () { form.classList.remove('is-err'); }, 400); }
    var n = lista.length;
    toast('Falta completar ' + (n === 1 ? '1 campo' : n + ' campos') + '. Te llevamos al primero.', true);
    var target = primero ? document.getElementById(primero) : null;
    if (target) {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { target.scrollIntoView(); }
      setTimeout(function () { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }, 320);
    }
  }
  function limpiarErrores() {
    var form = document.getElementById('codForm');
    if (!form) return;
    Array.prototype.forEach.call(form.querySelectorAll('.is-err'), function (el) { el.classList.remove('is-err'); });
    Array.prototype.forEach.call(form.querySelectorAll('.fld-err'), function (el) { el.remove(); });
  }
  /* Al corregir un campo, el rojo desaparece solo. */
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.closest || !el.closest('#codForm')) return;
    var caja = el.closest('.fld');
    if (caja && caja.classList.contains('is-err')) {
      caja.classList.remove('is-err');
      var av = caja.querySelector('.fld-err');
      if (av) av.remove();
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.id || el.id !== 'cod_acepto') return;
    var caja = el.closest('.cod-acepto');
    if (caja) caja.classList.remove('is-err');
  });

  function leerCod() {
    var d = {
      nombre: codVal('cod_nombre'),
      apellido: codVal('cod_apellido'),
      tipoDoc: codVal('cod_tipoDoc') || 'CC',
      numDoc: codVal('cod_numDoc').replace(/[^0-9A-Za-z]/g, ''),
      telefono: codVal('cod_telefono').replace(/[^0-9]/g, ''),
      correo: codVal('cod_correo'),
      departamento: codVal('cod_departamento'),
      ciudad: codVal('cod_ciudad'),
      direccion: codVal('cod_direccion'),
      notas: codVal('cod_notas')
    };
    if (d.telefono.length === 12 && d.telefono.slice(0, 2) === '57') d.telefono = d.telefono.slice(2);
    var e = [];
    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' ]{2,40}$/.test(d.nombre)) e.push('Nombre (solo letras)');
    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' ]{2,40}$/.test(d.apellido)) e.push('Apellido (solo letras)');
    if (d.tipoDoc === 'PAS') {
      if (!/^[A-Za-z0-9]{5,20}$/.test(d.numDoc)) e.push('Pasaporte (5 a 20 letras o números)');
    } else if (!/^\d{5,15}$/.test(d.numDoc)) {
      e.push('Número de documento (solo números)');
    }
    if (!/^3\d{9}$/.test(d.telefono)) e.push('Teléfono celular (10 dígitos, empieza por 3)');
    if (d.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.correo)) e.push('Correo (revisa el formato)');
    if (!d.departamento) e.push('Departamento');
    if (d.ciudad.length < 3) e.push('Ciudad');
    if (d.direccion.length < 8) e.push('Dirección (calle, número y barrio)');
    var acep = document.getElementById('cod_acepto');
    if (!acep || !acep.checked) e.push('Autorización de datos (marca la casilla)');
    return {
      datos: d, errores: e,
      campos: e.map(function (m) { return { id: campoDeError(m), msg: m }; })
    };
  }

  function codMsg(d, items) {
    var t = codTotals(items);
    var m = 'PEDIDO CONTRA ENTREGA — VÓRTEX Gadgets\n\n';
    m += 'PRODUCTO(S)\n';
    items.forEach(function (l) { m += '- ' + l.qty + 'x ' + l.title + ' (' + money(l.price * l.qty) + ')\n'; });
    if (t.disc > 0) m += 'Cupón ' + couponCode() + ' (-' + couponPct() + '%): -' + money(t.disc) + '\n';
    m += 'Envío: GRATIS\n';
    m += 'TOTAL A PAGAR: ' + money(t.total) + '\n\n';
    m += 'DATOS DE ENVÍO\n';
    m += 'Nombre: ' + d.nombre + ' ' + d.apellido + '\n';
    m += 'Documento: ' + d.tipoDoc + ' ' + d.numDoc + '\n';
    m += 'Celular: ' + d.telefono + '\n';
    if (d.correo) m += 'Correo: ' + d.correo + '\n';
    m += 'Departamento: ' + d.departamento + '\n';
    m += 'Ciudad: ' + d.ciudad + '\n';
    m += 'Dirección: ' + d.direccion + '\n';
    if (d.notas) m += 'Notas: ' + d.notas + '\n';
    m += '\nPago: contra entrega (efectivo al recibir)';
    return m;
  }

  /* Arma el objeto del pedido. Se separa de guardarlo porque el MISMO objeto se
     usa para dos cosas: la copia local del navegador y el envio al servidor. Antes
     se armaba dentro de codGuardarPedido, asi que el servidor no lo veia. */
  function codPedidoObj(d, items) {
    if (!items || !items.length) return null;
    var t = codTotals(items);
    var qty = items.reduce(function (a, l) { return a + l.qty; }, 0);
    var prod = items.map(function (l) { return l.qty + 'x ' + l.title; }).join(' + ');
    var now = new Date().toISOString();
    var nota = d.notas || '';
    if (couponCode() && t.disc > 0) nota += (nota ? ' · ' : '') + 'Cupón ' + couponCode() + ' -' + money(t.disc);
    return {
      id: 'P' + Date.now().toString(36).toUpperCase(),
      creado: now, updated: now,
      nombre: d.nombre, apellido: d.apellido,
      telefono: d.telefono, correo: d.correo,
      direccion: d.direccion, ciudad: d.ciudad, departamento: d.departamento,
      tipoDoc: d.tipoDoc, numDoc: d.numDoc,
      producto: prod, cantidad: qty, valor: t.total, nota: nota,
      compro: '', pagado: false, salio: false, camino: false, entregado: false, guia: '',
      origen: 'app_pwa'
    };
  }

  /* Navega dentro de la app y sube al principio: las pantallas de resultado deben
     verse desde arriba, no a mitad de pagina. */
  function irA(hash) {
    try { history.replaceState(null, '', hash); renderRoute(); }
    catch (e) { location.hash = hash; }
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  function codGuardarPedido(pedido) {
    var arr = [];
    try {
      var raw = localStorage.getItem(PEDIDOS_KEY);
      arr = raw ? JSON.parse(raw) : [];
    } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.unshift(pedido);
    try { localStorage.setItem(PEDIDOS_KEY, JSON.stringify(arr)); return true; } catch (e) { return false; }
  }

  /* ---------- Envio del pedido al servidor (2026-09-17) ----------
     Manda el pedido a la API de Cloudflare para que quede guardado y aparezca en el
     panel privado, ademas de irse por WhatsApp.

     TRES REGLAS QUE NO SE PUEDEN ROMPER:
     1) Si no hay servidor configurado (CONFIG.apiPedidos vacio), no se hace nada.
     2) Si el servidor esta caido, tarda o da error, el pedido NO se pierde: sigue
        llegando por WhatsApp como siempre. Esta funcion no puede lanzar errores.
     3) Se manda DESPUES de abrir WhatsApp, nunca antes (ver codSubmit).
     Se usa keepalive para que la peticion termine aunque el cliente cambie de
     pantalla o se vaya de la app justo despues de confirmar. */
  function enviarPedidoServidor(pedido) {
    var base = String(CONFIG.apiPedidos || '').replace(/\/+$/, '');
    if (!base || !pedido || !window.fetch) return null;
    var ctrl = null;
    var reloj = null;
    try { if (window.AbortController) ctrl = new AbortController(); } catch (e) { ctrl = null; }
    var tarea = fetch(base + '/api/pedido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pedido),
      signal: ctrl ? ctrl.signal : undefined,
      keepalive: true
    }).then(function (r) {
      if (reloj) clearTimeout(reloj);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      try { sessionStorage.setItem('vx_pedido_sync', '1'); } catch (e) {}
      return r.json();
    }).catch(function () {
      if (reloj) clearTimeout(reloj);
      /* Al comprador no se le dice nada feo: para el, el pedido ya quedo hecho.
         Se deja la marca por si hace falta revisarlo desde el navegador. */
      try { sessionStorage.setItem('vx_pedido_sync', '0'); } catch (e) {}
      return null;
    });
    if (ctrl) {
      reloj = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 12000);
    }
    return tarea;
  }

  var codEnviando = false;
  function codSubmit() {
    if (codEnviando) return;
    var items = codItems(parseHash().q);
    if (!items.length) { toast('Todavía no tienes productos', true); return; }
    var r = leerCod();
    if (r.errores.length) { marcarErrores(r.campos, r.errores); return; }
    var d = r.datos;
    var total = codTotals(items).total;
    var piezas = items.reduce(function (a, l) { return a + l.qty; }, 0);
    codEnviando = true;
    var msg = codMsg(d, items);
    var pedido = codPedidoObj(d, items);
    var guardado = pedido ? codGuardarPedido(pedido) : false;
    try { sessionStorage.setItem('vx_last_wa', msg); } catch (e) {}
    trackPixel('InitiateCheckout', { value: Math.round(total), currency: 'COP', num_items: piezas });
    if (pedido) { try { sessionStorage.setItem('vx_pedido_id', pedido.id); } catch (e) {} }

    /* SIN SERVIDOR CONFIGURADO: se mantiene el comportamiento de siempre (WhatsApp).
       Es una red de seguridad para que la tienda nunca se quede sin forma de recibir
       pedidos si alguien vacia CONFIG.apiPedidos. */
    if (!pedido || !CONFIG.apiPedidos) {
      openWa(msg);
      saveCart([]);
      codEnviando = false;
      if (!guardado) toast('No pudimos guardar la copia local, pero el pedido va por WhatsApp', true);
      irA('#/contraentrega/enviado');
      return;
    }

    /* CON SERVIDOR: el pedido no se da por bueno hasta que el servidor lo confirma.
       [2026-09-17] Antes se abria WhatsApp, se vaciaba el carrito y se ponia
       "Pedido registrado" PASARA LO QUE PASARA con el servidor. Asi era imposible
       enterarse de que un pedido no habia llegado: el dueno se entero de casualidad.
       Ahora, si el servidor no confirma, el carrito NO se vacia y se avisa. */
    var btn = document.querySelector('[data-action="cod-submit"]');
    var textoBtn = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Enviando tu pedido…'; }

    enviarPedidoServidor(pedido).then(function (res) {
      codEnviando = false;
      if (btn) { btn.disabled = false; btn.innerHTML = textoBtn; }
      if (res && res.ok) {
        saveCart([]);
        if (!guardado) toast('Aviso: no se pudo guardar la copia local del pedido', true);
        irA('#/contraentrega/enviado');
      } else {
        /* El carrito y los datos se dejan intactos para poder reintentar. */
        irA('#/contraentrega/fallo');
      }
    });
  }

  /* ---------- Carrusel del hero (migrado de la tienda vortexgadgets.com.co) ---------- */
  var HERO_SLIDES = [
    { mod: "", style: "",
      content: "<div class=\"hero-slide-media\">\n        <picture>\n          <source media=\"(max-width: 900px)\" srcset=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-chica-mobile.png?v=1789770031\">\n          <img src=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-chica-desktop.png?v=1789770035\" srcset=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-chica-desktop.png?v=1789770035&width=640 640w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-chica-desktop.png?v=1789770035&width=960 960w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-chica-desktop.png?v=1789770035&width=1280 1280w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-chica-desktop.png?v=1789770035&width=1920 1920w\" sizes=\"100vw\" alt=\"Audífonos M10\" loading=\"eager\" fetchpriority=\"high\">\n        </picture>\n      </div>\n      <div class=\"hero-slide-overlay\"></div>\n      <div class=\"hero-slide-content\">\n        <p class=\"hero-eyebrow\">OFERTA DE LANZAMIENTO · M10 -26%</p>\n        <h1 class=\"hero-heading\">Sonido premium a precio inteligente. Olvídate de pagar $300.000 por lo mismo.</h1>\n        <p class=\"hero-text\">Bluetooth 10 m · 24 h de batería con estuche · controles táctiles. Envío GRATIS a toda Colombia y 5 días de retracto: si no te encantan, te devolvemos tu dinero.</p>\n        <div class=\"hero-actions\">\n          <a class=\"btn-hero btn-hero--orange\" href=\"#/producto/auda-fonos-bluetooth-inala-mbricos-m10-a-sonido-premium-con-estuche-de-carga\">COMPRAR AHORA CON ENVÍO GRATIS — $77.700</a>\n          <a class=\"btn-hero btn-hero--outline-white\" href=\"#/catalogo\">Ver todo</a>\n        </div>\n        <p class=\"hero-fineprint hero-fineprint--urg\">Precio de lanzamiento · Envío GRATIS a toda Colombia · Llega en 3 a 4 días hábiles · +10 % extra con el código VORTEX10</p>\n      </div>" },
    { mod: "", style: "",
      content: "<div class=\"hero-slide-media\">\n        <picture>\n          <source media=\"(max-width: 900px)\" srcset=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-blackgold-mobile.png?v=76911661388189351661788233787\">\n          <img src=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-blackgold.png?v=180299142012676739271788230321\" srcset=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-blackgold.png?v=180299142012676739271788230321&width=640 640w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-blackgold.png?v=180299142012676739271788230321&width=960 960w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-blackgold.png?v=180299142012676739271788230321&width=1280 1280w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-blackgold.png?v=180299142012676739271788230321&width=1920 1920w\" sizes=\"100vw\" alt=\"VÓRTEX: tu energía diaria\" loading=\"lazy\">\n        </picture>\n      </div>\n      <div class=\"hero-slide-overlay\"></div>\n      <div class=\"hero-slide-content\">\n        <p class=\"hero-brand\">VÓRTEX GADGETS</p>\n        <h1 class=\"hero-heading\">El sonido <span class=\"accent\">anti-pereza</span> que despierta tu energía</h1>\n        <p class=\"hero-text\">Diseñado para darte foco, energía y motivación en cada nota. Tu mejor versión empieza con un play.</p>\n        <div class=\"hero-guarantee\">\n          <svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z\"/><path d=\"m9 12 2 2 4-4\"/></svg>\n          5 días de retracto: si no te encanta, te devolvemos tu dinero\n        </div>\n        <div class=\"hero-actions\">\n          <a class=\"btn-hero btn-hero--yellow\" href=\"#/catalogo\">Quiero el mío</a>\n          <a class=\"btn-hero btn-hero--outline-white\" href=\"#/como-comprar\">Ver garantía</a>\n        </div>\n      </div>" },
    { mod: "", style: "",
      content: "<div class=\"hero-slide-media\">\n        <picture>\n          <source media=\"(max-width: 900px)\" srcset=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-ml-box-mobile.png?v=145853460823946795501788233790\">\n          <img src=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-ml-box.png?v=126154574519817888841788230324\" srcset=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-ml-box.png?v=126154574519817888841788230324&width=640 640w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-ml-box.png?v=126154574519817888841788230324&width=960 960w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-ml-box.png?v=126154574519817888841788230324&width=1280 1280w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-ml-box.png?v=126154574519817888841788230324&width=1920 1920w\" sizes=\"100vw\" alt=\"Ofertas exclusivas VÓRTEX\" loading=\"lazy\" style=\"filter: contrast(1.14) saturate(1.1);\">\n        </picture>\n      </div>\n      <div class=\"hero-slide-overlay\"></div>\n      <div class=\"hero-slide-content\">\n        <p class=\"hero-eyebrow\" style=\"border-color: rgba(0,0,0,.5); color: #111; background: rgba(255,255,255,.85);\">Exclusivo para ti</p>\n        <h1 class=\"hero-heading\" style=\"color: #0b0e13; text-shadow: 0 1px 3px rgba(255,255,255,.65);\">Tu primera compra con <span class=\"accent\" style=\"color:#ff6b2b;\">ofertas únicas</span></h1>\n        <p class=\"hero-text\" style=\"color: #111; font-weight: 500; text-shadow: 0 1px 2px rgba(255,255,255,.7);\">Gadgets seleccionados para empezar con todo. Aprovecha tu cupón de bienvenida.</p>\n        <div class=\"hero-actions\">\n          <a class=\"btn-hero btn-hero--yellow\" href=\"#/catalogo\">ENVÍO GRATIS</a>\n          <a class=\"btn-hero btn-hero--white\" href=\"#/catalogo\">10 % EXTRA</a>\n        </div>\n      </div>" },
    { mod: "", style: "background:#ffe600;",
      content: "<div class=\"hero-slide-overlay\" style=\"background:linear-gradient(100deg, #ffe600 40%, #ffd21f 75%, #ffce2e 100%);\"></div>\n      <div class=\"hero-slide-content\" style=\"color:#111;\">\n        <div class=\"hero-cols\">\n          <div class=\"hero-col\">\n            <div class=\"hero-badge-dark\">Nuevo<span>Mini Proyector HY320</span></div>\n            <h1 class=\"hero-heading\">Tu cine en casa: <span class=\"accent\" style=\"color:#111; text-decoration:underline; text-decoration-color:#ff6b2b; text-underline-offset:6px;\">las apps adentro</span> y 4K soportado</h1>\n            <div class=\"hero-pills\">\n              <span class=\"hero-pill\">SOPORTE 4K</span>\n              <span class=\"hero-pill-plus\">+</span>\n              <span class=\"hero-pill\">IMAGEN LED</span>\n            </div>\n            <p class=\"hero-text\" style=\"max-width:560px\">Sin caja, sin consola y sin computador de por medio.</p>\n            <div class=\"hero-actions\">\n              <a class=\"btn-hero btn-hero--dark\" href=\"#/producto/mini-proyector-portatil-hy320-android-tv-13-1080p-soporte-4k\">Ver el proyector — $259.900</a>\n            </div>\n          </div>\n          <div class=\"hero-prod\">\n            <div class=\"hero-prod-img\"><img src=\"https://cdn.shopify.com/s/files/1/0828/1178/1371/files/proyector-3.png?v=1788581390\" alt=\"Mini Proyector HY320\" loading=\"lazy\"></div>\n            <div class=\"hero-prod-tag\">-28 % · <s>$359.900</s> · Ahorras $100.000</div>\n          </div>\n        </div>\n      </div>" },
    { mod: "", style: "background:#EAF7EF;",
      content: "<div class=\"hero-slide-media\">\n        <picture>\n          <source media=\"(max-width: 900px)\" srcset=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-van-mobile.png?v=72521963569034057271788233794\">\n          <img src=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-van.png?v=123366742103092711511788231801\" srcset=\"//vortexgadgets.com.co/cdn/shop/t/7/assets/hero-van.png?v=123366742103092711511788231801&width=640 640w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-van.png?v=123366742103092711511788231801&width=960 960w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-van.png?v=123366742103092711511788231801&width=1280 1280w, //vortexgadgets.com.co/cdn/shop/t/7/assets/hero-van.png?v=123366742103092711511788231801&width=1920 1920w\" sizes=\"100vw\" alt=\"Envío GRATIS en tu primera compra\" loading=\"lazy\">\n        </picture>\n      </div>\n      <div class=\"hero-slide-overlay\" style=\"background:linear-gradient(90deg, rgba(234,247,239,.94) 0%, rgba(234,247,239,.7) 45%, rgba(234,247,239,0) 72%);\"></div>\n      <div class=\"hero-slide-content\" style=\"color:#111;\">\n        <p class=\"hero-eyebrow\" style=\"border-color:#111; color:#333; background:rgba(255,255,255,.75);\">Exclusivo para ti</p>\n        <h1 class=\"hero-heading\">ENVÍO <span class=\"accent\" style=\"color:#ff6b2b;\">GRATIS</span></h1>\n        <p class=\"hero-text\" style=\"font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#111;\">En todas tus compras</p>\n        <div class=\"hero-actions\">\n          <a class=\"btn-hero btn-hero--dark\" href=\"#/catalogo\">Aprovechar oferta</a>\n        </div>\n        <p class=\"hero-fineprint\">*<a href=\"#/info/terminos-y-condiciones\">Consulta los Términos y Condiciones</a>.</p>\n      </div>" }
  ];

  function vHeroSlider() {
    if (!HERO_SLIDES.length) return '';
    var inner = HERO_SLIDES.map(function (s) {
      return '<div class="hero-slide ' + s.mod + '"' + (s.style ? ' style="' + s.style + '"' : '') + '>' + s.content + '</div>';
    }).join('');
    return '<section class="hero-slider" data-hero-slider>' +
      '<div class="hero-slider-track" data-hero-track>' + inner + '</div>' +
      '<button type="button" class="hero-arrow hero-arrow--prev" data-hero-prev aria-label="Banner anterior">&#8249;</button>' +
      '<button type="button" class="hero-arrow hero-arrow--next" data-hero-next aria-label="Banner siguiente">&#8250;</button>' +
      '<div class="hero-dots" data-hero-dots></div>' +
      '</section>';
  }

  var heroTimer = null;
  function initHeroSlider() {
    if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
    var slider = document.querySelector('[data-hero-slider]');
    if (!slider) return;
    var track = slider.querySelector('[data-hero-track]');
    var dotsWrap = slider.querySelector('[data-hero-dots]');
    var prev = slider.querySelector('[data-hero-prev]');
    var next = slider.querySelector('[data-hero-next]');
    if (!track || !dotsWrap) return;
    var total = track.children.length;
    var index = 0;
    dotsWrap.innerHTML = '';
    if (total < 2) return;
    function go(n) {
      index = (n + total) % total;
      track.style.transform = 'translateX(-' + (index * 100) + '%)';
      for (var i = 0; i < total; i++) dotsWrap.children[i].classList.toggle('is-active', i === index);
    }
    function restart() {
      if (heroTimer) clearInterval(heroTimer);
      heroTimer = setInterval(function () { go(index + 1); }, 6000);
    }
    for (var i = 0; i < total; i++) {
      (function (n) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'hero-dot' + (n === 0 ? ' is-active' : '');
        d.setAttribute('aria-label', 'Ir al banner ' + (n + 1));
        d.addEventListener('click', function () { go(n); restart(); });
        dotsWrap.appendChild(d);
      })(i);
    }
    if (prev) prev.addEventListener('click', function () { go(index - 1); restart(); });
    if (next) next.addEventListener('click', function () { go(index + 1); restart(); });
    slider.addEventListener('mouseenter', function () { if (heroTimer) clearInterval(heroTimer); });
    slider.addEventListener('mouseleave', restart);
    var x0 = null;
    slider.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    slider.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) { go(index + (dx < 0 ? 1 : -1)); restart(); }
      x0 = null;
    }, { passive: true });
    restart();
  }

  /* ---------- Información interna (texto real migrado de la tienda) ---------- */
  var INFO_PAGES = {"faq":{"t":"Preguntas frecuentes","h":"<h1 class=\"info-h1\">Preguntas frecuentes</h1><h3 class=\"faq-q\">¿Qué medios de pago aceptan?</h3><p>En la app el pago es CONTRA ENTREGA: pagas en efectivo al mensajero cuando recibes y revisas tu pedido. No necesitas tarjeta ni anticipo.</p><h3 class=\"faq-q\">¿Cuánto tarda el envío y cómo lo rastreo?</h3><p>Enviamos a todo Colombia. Los tiempos estimados son de 3 a 4 días hábiles según tu ciudad. Te enviamos el número de guía por correo y WhatsApp para rastrear tu pedido.</p><h3 class=\"faq-q\">¿El envío es gratis?</h3><p>Sí. El envío a toda Colombia es GRATIS en todos tus pedidos, sin montos mínimos. Tiempo estimado: 3 a 4 días hábiles según tu ciudad.</p><h3 class=\"faq-q\">¿Puedo devolver un producto?</h3><p>Sí. Tienes derecho de retracto de 5 días hábiles desde la entrega (Ley 1480 de 2011) y la garantía legal de calidad. El producto debe estar sin uso y con su empaque. Escríbenos a soportevortexgadgets@gmail.com para gestionarlo.</p><h3 class=\"faq-q\">¿Cuándo me llega la factura?</h3><p>Emitimos factura electrónica. La recibes en tu correo al confirmarse el pedido, indícalo en la nota del pedido.</p><h3 class=\"faq-q\">¿Los precios incluyen IVA?</h3><p>Sí, los precios mostrados incluyen el IVA (19 %) cuando aplica.</p><h3 class=\"faq-q\">¿Qué pasa si mi producto llega dañado o defectuoso?</h3><p>Lamentamos el inconveniente. Escríbenos dentro de las 48 horas siguientes con fotos o video del producto y gestionamos la garantía o reposición sin costo.</p>"},"politica-de-envios":{"t":"Política de envíos","h":"<h1 class=\"info-h1\">Política de Envíos</h1><p>Cobertura y costo. El envío es GRATIS a toda Colombia, sin monto mínimo de compra.</p><p>Tiempos de entrega. Los pedidos se procesan el mismo día o el siguiente día hábil. El tiempo de entrega es de 3 a 4 días hábiles a toda Colombia.</p><p>Seguimiento. Una vez despachado el pedido, se envía el número de guía al correo del comprador para rastrear el paquete en tiempo real.</p><p>Dirección incorrecta. Es responsabilidad del comprador ingresar una dirección válida. Si el paquete es devuelto por dirección incorrecta, el costo de reenvío corre por cuenta del comprador.</p><p>Paquete perdido o dañado. Si el paquete se pierde en tránsito, se realiza reemplazo o reembolso total. Si llega dañado, el comprador debe reportarlo con fotos dentro de las 48 horas siguientes a la entrega para gestionar la reposición.</p><p>Retrasos. Fuerza mayor (condiciones climáticas, paros de transporte) puede generar demoras; se informará al comprador con el nuevo estado.</p>"},"devoluciones-y-garantia":{"t":"Devoluciones y garantía","h":"<h1 class=\"info-h1\">Devoluciones y Garantía</h1><p>1. Derecho de retracto (Ley 1480, Art. 47). Para compras a distancia, el comprador tiene derecho a retractarse dentro de los 5 días hábiles siguientes a la entrega, sin necesidad de justificar la decisión. Para ejercerlo, debe notificarlo por escrito a soportevortexgadgets@gmail.com y devolver el producto en su empaque original, sin uso y con todos sus accesorios. El reembolso se realiza dentro de los 30 días siguientes, descontando únicamente el costo de transporte de la devolución cuando aplique.</p><p>2. Garantía legal (Ley 1480). Todos los productos cuentan con la garantía legal por defectos de calidad, funcionamiento o fabricación. Si el producto sale defectuoso, el comprador puede exigir, a su elección: reparación, reposición del producto o devolución del dinero. La garantía cubre defectos de fábrica, no daños por mal uso, golpes, humedad o manipulación no autorizada.</p><p>3. Política comercial de 30 días. Adicionalmente, VÓRTEX Gadgets ofrece una política comercial: dentro de los 30 días posteriores a la entrega, si el producto llega dañado, incompleto o no corresponde a lo pedido, se gestiona reemplazo o reembolso con solo enviar:</p><ul><li>Foto o video del estado del producto</li><li>Número de pedido</li><li>Descripción del inconveniente</li></ul><p>4. Proceso. Los casos de garantía se responden en máximo 2 días hábiles. La solución (reemplazo, reparación o reembolso) se aplica según el caso y las condiciones de la Ley 1480.</p><p>5. Exclusiones. No aplican garantía ni devolución a: productos usados de manera indebida, daños estéticos por maltrato, productos modificados o desarmados por el comprador.</p>"},"politicas":{"t":"Todas las políticas","h":"<h1 class=\"info-h1\">Políticas de la tienda</h1><p>Políticas de VÓRTEX Gadgets</p><p>En esta sección encontrarás toda la información sobre nuestras políticas. Si tienes alguna duda, escríbenos por WhatsApp o correo.</p><ul><li>Términos y Condiciones</li><li>Política de Envíos</li><li>Devoluciones y Garantía</li><li>Política de Privacidad</li></ul><p>Contacto</p><p>Correo: soportevortexgadgets@gmail.com</p><p>WhatsApp: +57 318 173 8642</p><h2>Políticas de la tienda — Colombia</h2><p>Vigentes para VÓRTEX Gadgets. Última actualización: agosto de 2026.</p><h2>Política de envíos</h2><ul><li>Cobertura: envíos a todo el territorio colombiano (cabeceras municipales principales; zonas rurales pueden tener tiempos mayores).</li><li>Tiempos estimados: 3 a 4 días hábiles según la ciudad de destino, contados desde la confirmación del pedido.</li><li>Rastreo: al despachar, enviamos el número de guía por correo y WhatsApp para que sigas tu pedido en tiempo real.</li><li>Envío GRATIS: todos tus pedidos se envían gratis a toda Colombia, sin montos mínimos ni costos ocultos. Tiempo estimado: 3 a 4 días hábiles según la ciudad de destino.</li><li>Dirección incorrecta: si el pedido no puede entregarse por datos errados, el reenvío tendrá un costo adicional.</li></ul><h2>Devoluciones, retracto y garantía (Ley 1480 de 2011 — Estatuto del Consumidor)</h2><ul><li>Derecho de retracto: en compras a distancia tienes 5 días hábiles para retractarte desde la entrega del producto, sin necesidad de justificación (art. 47, Ley 1480 de 2011).</li><li>Requisitos del retracto: producto sin uso, con empaque original, y aviso por escrito (correo o formulario de contacto) dentro del plazo.</li><li>Reembolso: se realiza por el mismo medio de pago en un plazo máximo de 30 días calendario (art. 48).</li><li>Garantía legal de calidad: respondemos por la calidad, idoneidad y seguridad del producto (art. 11). Para hacerla efectiva, escríbenos describiendo el inconveniente con fotos o video.</li><li>Excepciones: productos personalizados o que por su naturaleza no puedan devolverse (los indicamos en cada ficha).</li><li>Superintendencia de Industria y Comercio (SIC): el consumidor puede acudir a la SIC en caso de no resolver una reclamación (solicitudes en línea, sic.gov.co ).</li></ul><h2>Política de privacidad y tratamiento de datos (Ley 1581 de 2012 — Habeas Data)</h2><ul><li>Al comprar o suscribirte, autorizas el tratamiento de tus datos personales (nombre, correo, teléfono, dirección) con fines de procesamiento de pedidos, envíos, facturación, atención al cliente y comunicaciones comerciales.</li><li>No vendemos ni compartimos tus datos con terceros, salvo los necesarios para la logística del pedido y pasarela de pago.</li><li>Puedes ejercer tus derechos de conocer, actualizar, rectificar y suprimir tus datos, o revocar la autorización, escribiendo a soportevortexgadgets@gmail.com. También puedes registrar tu queja ante la SIC.</li><li>Usamos cookies básicas y herramientas de análisis para mejorar tu experiencia de compra.</li></ul><h2>Facturación e impuestos</h2><ul><li>Emitimos factura electrónica de venta conforme a los requisitos de la DIAN para los pedidos que lo requieran.</li><li>Los precios mostrados incluyen el IVA (19 %) cuando aplica.</li><li>Razón social / NIT: VÓRTEX Gadgets SAS — Marlon Torrealba C.C. 1126705132.</li><li>Para facturación empresarial (NIT), indícalo en la nota del pedido o contáctanos antes de pagar.</li></ul><h2>Medios de pago</h2><ul><li>PSE: paga desde tu banco colombiano directamente.</li><li>Tarjetas: débito y crédito (Visa, Mastercard, American Express).</li><li>Procesamos con pasarelas de pago seguras (Mercado Pago, PayPal), incluyendo PSE para pagar desde tu banco sin tarjeta , con cifrado y cumplimiento PCI.</li><li>No almacenamos los datos de tu tarjeta.</li></ul><h2>Términos y condiciones</h2><p>Al realizar una compra aceptas estas políticas. Los precios y disponibilidad pueden cambiar sin previo aviso. Las promociones tienen vigencia limitada. Las imágenes de los productos son referenciales y pueden variar ligeramente de la versión final. Cualquier duda, escríbenos a soportevortexgadgets@gmail.com o por WhatsApp.</p>"},"politica-de-privacidad":{"t":"Política de privacidad","h":"<h1 class=\"info-h1\">Política de Privacidad</h1><p>1. Datos que recopilamos. Para procesar tu pedido recopilamos: nombre, correo electrónico, teléfono, dirección de envío, datos de facturación y el historial de compras. Los datos de pago (tarjeta, PSE) son procesados directamente por las pasarelas de pago (PayPal, Mercado Pago y otros), que cumplen estándares PCI-DSS; VÓRTEX Gadgets no almacena números de tarjeta.</p><p>2. Uso de la información. Utilizamos tus datos para: procesar y entregar pedidos, enviar notificaciones de envío, atender soporte, prevenir fraude y, con tu consentimiento, enviar comunicaciones comerciales.</p><p>3. Cookies y analítica. La tienda utiliza cookies propias y de terceros (analítica, publicidad) para mejorar la experiencia y medir el rendimiento. Puedes deshabilitarlas desde tu navegador.</p><p>4. Protección y tratamiento (Ley 1581 de 2012). Tus datos personales son tratados conforme a la Ley 1581 de 2012 y su reglamentación. VÓRTEX Gadgets adopta medidas de seguridad razonables para protegerlos y no los vende ni comparte con terceros, salvo los necesarios para el cumplimiento del pedido (proveedores logísticos, pasarelas de pago) o por requerimiento legal.</p><p>5. Tus derechos (Habeas Data). Puedes ejercer los derechos de conocer, actualizar, rectificar y suprimir tus datos, así como revocar la autorización de tratamiento, escribiendo a soportevortexgadgets@gmail.com. También puedes consultar a la Superintendencia de Industria y Comercio (SIC).</p><p>6. Contacto. Duda sobre privacidad: soportevortexgadgets@gmail.com.</p>"},"terminos-y-condiciones":{"t":"Términos y condiciones","h":"<h1 class=\"info-h1\">Términos y Condiciones</h1><p>1. Aceptación. Al realizar un pedido en VÓRTEX Gadgets, el comprador acepta los presentes términos y condiciones, que se rigen por la legislación colombiana, en especial la Ley 1480 de 2011 (Estatuto del Consumidor).</p><p>2. Productos y precios. Todos los productos se describen con la mayor exactitud posible. Los precios están expresados en pesos colombianos (COP) e incluyen el IVA (19 %). Los precios pueden variar sin previo aviso; el precio aplicable es el vigente al momento de confirmar la compra.</p><p>3. Disponibilidad. La disponibilidad de stock depende del proveedor. Si un producto no está disponible después de la compra, el comprador será notificado y podrá elegir entre un producto equivalente, esperar reposición o recibir el reembolso total.</p><p>4. Pagos. Se aceptan tarjetas de crédito y débito, PSE, PayPal, Mercado Pago y los demás medios habilitados en el checkout. La compra se confirma únicamente cuando el pago es aprobado.</p><p>5. Envíos. El envío es GRATIS a toda Colombia. Los tiempos de entrega son de 3 a 4 días hábiles según la ciudad de destino. Toda orden incluye número de seguimiento.</p><p>6. Garantía y devoluciones. Aplican la garantía legal y las condiciones descritas en la Política de Devoluciones y Garantía de la tienda.</p><p>7. Limitación de responsabilidad. VÓRTEX Gadgets no se hace responsable por el uso indebido de los productos, daños causados por mal manejo del cliente o por casos de fuerza mayor en la entrega (desastres, restricciones de transporte, etc.).</p><p>8. Contacto. Para cualquier inquietud: soportevortexgadgets@gmail.com o WhatsApp +57 318 173 8642 (lunes a sábado, 8:00 a.m. – 6:00 p.m.).</p>"}};

  function vInfo(slug) {
    var p = INFO_PAGES[slug];
    if (!p) return '<div class="empty-state"><p>No encontramos esa información.</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/inicio">Volver al inicio</a></p></div>';
    return '<article class="info-page">' +
      '<a class="info-back" href="#/inicio">&lsaquo; Volver al inicio</a>' +
      p.h +
      '<div class="info-cta">' +
      '<a class="btn btn-wa btn-block" href="' + waLink('Hola VÓRTEX Gadgets, tengo una duda') + '" target="_blank" rel="noopener">Preguntar por WhatsApp</a>' +
      '</div>' +
      '</article>';
  }

  /* Categorías: se arman con el campo real "type" de cada producto */
  var CATEGORIAS = [
    { slug: 'audio', nombre: 'Audio', tipos: ['Audio'] },
    { slug: 'smart-home', nombre: 'Smart home', tipos: ['Smart Home', 'Hogar Inteligente', 'Iluminación Inteligente'] },
    { slug: 'bienestar', nombre: 'Bienestar', tipos: ['Bienestar y Cuidado', 'Salud y Bienestar', 'Bienestar'] },
    { slug: 'hogar', nombre: 'Hogar', tipos: ['Hogar y Limpieza', 'Hogar y Jardín', 'Cocina', 'Hogar y Climatización'] }
  ];
  function tiposDeCat(slug) {
    var c = CATEGORIAS.filter(function (x) { return x.slug === slug; })[0];
    return c ? c.tipos : null;
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
    if (seg[0] === 'catalogo') { var params = new URLSearchParams(r.q || ''); state.cat = params.get('cat') || ''; if (params.get('q')) state.searchTerm = params.get('q'); }
    var v = $('#view');
    if (state.loading && !state.products.length) { v.innerHTML = spinner(); }
    else if (seg.length === 0 || seg[0] === 'inicio') v.innerHTML = vHome();
    else if (seg[0] === 'catalogo') v.innerHTML = vCatalog();
    else if (seg[0] === 'producto') {
      v.innerHTML = vProduct(decodeURIComponent(seg[1] || ''));
      var pv = productByHandle(decodeURIComponent(seg[1] || ''));
      if (pv) trackPixel('ViewContent', { content_ids: [pv.handle], content_name: pv.title, content_type: 'product', value: Math.round(pv.price), currency: 'COP' });
    }
    else if (seg[0] === 'carrito') v.innerHTML = vCart();
    else if (seg[0] === 'contraentrega') v.innerHTML = (seg[1] === 'enviado') ? vCodOk() : ((seg[1] === 'fallo') ? vCodFallo() : vCod(r.q));
    else if (seg[0] === 'como-comprar') v.innerHTML = vComo();
    else if (seg[0] === 'info') v.innerHTML = vInfo(seg[1]);
    else if (seg[0] === 'contacto') v.innerHTML = vContacto();
    else v.innerHTML = '<div class="empty-state"><p>Página no encontrada.</p><p style="margin-top:10px"><a class="btn btn-accent" href="#/inicio">Ir al inicio</a></p></div>';
    closeLb();
    renderNav();
    initHeroSlider();
  initHeroBar();
    /* [2026-09-17] IMPORTANTE: la seccion de seguridad se pinta con sus bloques
       ocultos hasta recibir la clase 'in'. Si no se llama aqui, en la PRIMERA
       carga (sin cache) el inicio se pinta despues de que segInit ya se hubiera
       ejecutado, nadie lo reintenta, y la seccion se queda como un panel oscuro
       VACIO. Este era el fallo de "no me permite ver nada". */
    segInit();
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
      if (l.handle === h) { found = true; return { handle: l.handle, title: l.title, price: l.price, image: l.image, variantId: l.variantId || (p && p.variantId) || 0, qty: l.qty + qty }; }
      return l;
    });
    if (!found) c.push({ handle: p.handle, title: p.title, price: p.price, image: p.image, variantId: p.variantId || 0, qty: qty });
    saveCart(c);
    trackPixel('AddToCart', { content_ids: [p.handle], content_name: p.title, content_type: 'product', value: Math.round(p.price * qty), currency: 'COP' });
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
    if (act === 'cod-submit') { codSubmit(); return; }
    if (act === 'cod-start') {
      var hcod = findHandle(t);
      var qcod = qtyOf(document);
      if (!hcod) { location.hash = '#/contraentrega'; return; }
      location.hash = '#/contraentrega?p=' + encodeURIComponent(hcod) + '&n=' + qcod;
      return;
    }
    if (act === 'newsletter') {
      var elm = document.getElementById('ftEmail');
      var mail = elm ? String(elm.value || '').trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) { toast('Escribe un correo válido', true); if (elm) elm.focus(); return; }
      window.open(waLink('Hola VÓRTEX Gadgets, quiero suscribirme y recibir el 10 % en mi primera compra. Mi correo es: ' + mail), '_blank');
      if (elm) elm.value = '';
      toast('Te escribimos por WhatsApp para confirmar tu suscripción');
      return;
    }
    if (act === 'toast-close') { apagarAviso(); toastIdx = SOCIAL_TOASTS.length; pararToasts(); return; }
    if (act === 'exit-coupon') {
      closeExitPopup();
      applyCoupon(CONFIG.couponCode);
      location.hash = state.cart.length ? '#/carrito' : '#/catalogo';
      return;
    }
    if (act === 'hero-coupon') { applyCoupon(CONFIG.couponCode); location.hash = '#/carrito'; return; }
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
  /* [2026-09-22] La foto de la tarjeta de producto crece al TOCAR.
     Con el dedo no existe el hover, asi que al tocar se marca la foto un instante
     y ahi se ve el mismo efecto que con el cursor. Con eso el comportamiento vale
     en todos los dispositivos, que es lo que se pidio.

     Se engancha a .pimg, que es la caja de la foto en la tarjeta de producto. Como
     el catalogo y "Destacados de la semana" usan la misma tarjeta, esto cubre los
     dos sitios de una vez. */
  document.addEventListener('touchstart', function (e) {
    var im = (e.target && e.target.closest) ? e.target.closest('.pimg') : null;
    if (!im) return;
    im.classList.add('is-tap');
    clearTimeout(im._tapaP);
    im._tapaP = setTimeout(function () { im.classList.remove('is-tap'); }, 600);
  }, { passive: true });
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
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href*="wa.me"]');
    if (a) trackPixel('Contact');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'couponInput') {
      applyCoupon(document.activeElement.value);
    }
  });
  function updateLineQty(handle, n) {
    saveCart(state.cart.map(function (l) { return l.handle === handle ? { handle: l.handle, title: l.title, price: l.price, image: l.image, variantId: l.variantId || 0, qty: n } : l; }));
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
  /* [2026-09-22] El silencio por ruta solo evitaba que el aviso APARECIERA. Si
     ya estaba en pantalla y el cliente entraba al carrito o a la ficha, seguia
     tapando el boton. Ahora se quita al cambiar de ruta. */
  window.addEventListener('hashchange', function () {
    var h = location.hash || '';
    if (h.indexOf('#/contraentrega') === 0 || h.indexOf('#/carrito') === 0 || h.indexOf('#/producto/') === 0) pararToasts();
  });

  /* ---------- Aviso flotante de actividad ----------
     El contenido es el REAL de la seccion social-proof de la tienda
     (vortexgadgets.com.co). No se inventa ningun dato ni ningun numero. */
  var SOCIAL_TOASTS = [
    { badge: 'Destacado en TikTok', prod: 'Audífonos M10', txt: 'sonido premium, batería de larga duración y envío gratis a tu ciudad.', cta: 'Ver audífonos', href: '#/producto/auda-fonos-bluetooth-inala-mbricos-m10-a-sonido-premium-con-estuche-de-carga' },
    { badge: 'Entrega en 3 a 4 días hábiles', prod: 'Bombillo RGB y cámara A9', txt: 'controla tu casa desde el celular, sin cables complejos.', cta: 'Ver smart home', href: '#/catalogo' },
    { badge: 'Envío gratis y rápido', prod: 'Esterilla EMS de pies', txt: 'alivio y relajación después de un día largo.', cta: 'Ver bienestar', href: '#/catalogo' },
    { badge: 'Hogar más fácil', prod: 'Hidrolavadora, aspiradora y cepillo giratorio', txt: 'tu hogar impecable sin esfuerzo.', cta: 'Ver hogar', href: '#/catalogo' }
  ];

  var toastTimer = null, toastIdx = 0, toastOn = false;

  function pararToasts() {
    toastOn = false;
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    var el = document.getElementById('socialToast');
    if (el) el.classList.remove('is-on');
  }

  function toastBox() {
    var el = document.getElementById('socialToast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'socialToast';
    el.className = 'social-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.addEventListener('mouseenter', function () { if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; } });
    el.addEventListener('mouseleave', function () { if (toastOn) { if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(ocultarToast, 2400); } });
    el.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== el) { if (t.className && String(t.className).indexOf('st-cta') >= 0) { toastIdx = SOCIAL_TOASTS.length; pararToasts(); break; } t = t.parentNode; }
    });
    document.body.appendChild(el);
    return el;
  }

  function ocultarToast() {
    toastOn = false;
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    var el = document.getElementById('socialToast');
    if (el) el.classList.remove('is-on');
    if (toastIdx < SOCIAL_TOASTS.length) toastTimer = setTimeout(mostrarToast, 6000);
  }

  function mostrarToast() {
    if (toastIdx >= SOCIAL_TOASTS.length) return;
    /* [2026-09-22] No tapar el boton de pedir. Antes solo se evitaba el
       formulario contra entrega: en el carrito llegaba a tapar "Completar mis
       datos de envio" y en la ficha el boton de anadir. Si el cliente lo cerro
       una vez, no vuelve en toda la visita. */
    var h = location.hash || '';
    var rutaCallada = h.indexOf('#/contraentrega') === 0 || h.indexOf('#/carrito') === 0 || h.indexOf('#/producto/') === 0;
    if (rutaCallada || avisoApagado()) { toastTimer = setTimeout(mostrarToast, 6000); return; }
    var d = SOCIAL_TOASTS[toastIdx++];
    var el = toastBox();
    el.innerHTML = '<span class="st-dot"></span><div class="st-body">' +
      '<span class="st-badge">' + esc(d.badge) + '</span>' +
      '<p class="st-txt"><b>' + esc(d.prod) + '</b>: ' + esc(d.txt) + '</p>' +
      '<a class="st-cta" href="' + esc(d.href) + '">' + esc(d.cta) + ' &rsaquo;</a>' +
      '</div>' +
      '<button class="st-x" data-action="toast-close" type="button" aria-label="Cerrar aviso">&times;</button>';
    toastOn = true;
    el.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(ocultarToast, 7000);
  }

  /* [2026-09-22] El cliente que ya cerro el aviso no lo vuelve a ver. */
  function avisoApagado() {
    try { return localStorage.getItem('vx_aviso_off') === '1'; } catch (e) { return false; }
  }
  function apagarAviso() {
    try { localStorage.setItem('vx_aviso_off', '1'); } catch (e) {}
  }
  function initSocialToast() {
    if (!SOCIAL_TOASTS.length || toastIdx > 0) return;
    if (avisoApagado()) return;
    if (document.getElementById('socialToast')) return;
    toastTimer = setTimeout(mostrarToast, 7000);
  }

  /* ---------- Descuento maximo REAL (para el popup de salida) ----------
     [2026-09-18] Se CALCULA en vez de escribirlo a mano: descuento del producto
     (precio antes vs precio hoy) mas el 10 % del cupon, sobre los productos que
     hay cargados de verdad. Un numero escrito a mano se queda viejo el dia que
     cambies un precio, y en publicidad eso se llama prometer algo falso.
     Si no hay datos, no se promete NINGUN porcentaje: el texto sigue siendo cierto
     sin el numero. */
  function maxDescuentoTotal() {
    var max = 0;
    (state.products || []).forEach(function (p) {
      var antes = Number(p.compare) || 0, hoy = Number(p.price) || 0;
      if (!antes || antes <= hoy) return;
      var conCupon = hoy * (1 - CONFIG.couponPct / 100);
      var pct = Math.round((antes - conCupon) * 100 / antes);
      if (pct > max) max = pct;
    });
    return max;
  }
  function pintarDescuentoPopup() {
    var el = document.getElementById('exitMax');
    if (!el) return;
    var max = maxDescuentoTotal();
    if (max < 11) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = ' Hoy hay hasta ' + max + ' % de descuento total.';
    el.hidden = false;
  }

  /* ---------- Popup de intención de salida (migrado de la tienda) ---------- */
  function closeExitPopup() {
    var pop = document.querySelector('[data-exit-popup]');
    if (!pop) return;
    pop.classList.remove('is-open');
    pop.setAttribute('aria-hidden', 'true');
  }

  function initExitPopup() {
    var pop = document.querySelector('[data-exit-popup]');
    if (!pop) return;
    var yaVisto = '';
    try { yaVisto = sessionStorage.getItem('vortex_exit_shown') || ''; } catch (e) {}
    if (yaVisto) return;
    var shown = false;
    function isTouch() {
      try { return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0); } catch (e) { return false; }
    }
    function show() {
      if (shown) return;
      /* [2026-09-22] Nunca en el paso de pago: el popup se abria ENCIMA del
         formulario contra entrega y se comia el primer toque del cliente. */
      if ((location.hash || '').indexOf('#/contraentrega') === 0) return;
      shown = true;
      try { sessionStorage.setItem('vortex_exit_shown', '1'); } catch (e) {}
      pop.classList.add('is-open');
      pop.setAttribute('aria-hidden', 'false');
    }
    /* Escritorio: el mouse sale por el borde superior */
    document.addEventListener('mouseout', function (e) {
      if (isTouch()) return;
      if (!e.relatedTarget && !e.toElement && e.clientY <= 40) show();
    });
    if (isTouch()) {
      /* Movil/tablet: tras bajar, subir de golpe = intención de salir */
      var lastY = window.pageYOffset || document.documentElement.scrollTop;
      var engaged = false;
      var raf = false;
      window.addEventListener('scroll', function () {
        if (raf) return;
        raf = true;
        requestAnimationFrame(function () {
          raf = false;
          var y = window.pageYOffset || document.documentElement.scrollTop;
          if (y > 140) engaged = true;
          if (engaged && y <= 60 && y < lastY) show();
          lastY = y;
        });
      }, { passive: true });
      /* Respaldo: si ya navego la pagina, recordarle el cupon una vez */
      setTimeout(function () {
        if (!shown && engaged && document.visibilityState !== 'hidden') show();
      }, 16000);
    }
    var closeBtn = pop.querySelector('[data-exit-close]');
    if (closeBtn) closeBtn.addEventListener('click', closeExitPopup);
    pop.addEventListener('click', function (e) { if (e.target === pop) closeExitPopup(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && pop.classList.contains('is-open')) closeExitPopup();
    });
  }

  /* ---------- Init ---------- */
  renderBadge();
  initPixel();
  initExitPopup();
  initSocialToast();
  initAnnounce();
  setInterval(tickFlash, 1000);
  loadData();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  /* [2026-09-17] arranque de la animacion de la seccion de seguridad */
  window.addEventListener('hashchange', function () { setTimeout(segInit, 80); });
  setTimeout(segInit, 300);
})();
