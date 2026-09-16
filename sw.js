/* Service Worker â€” VÃ“RTEX Gadgets PWA */
const VERSION = 'vortex-app-v20';
const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'assets/app.css?v=20',
  'assets/app.js?v=20',
  'assets/cod-splash.png',
  'datos-tienda.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache:'reload' evita que el precache herede copias viejas de la cache HTTP
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // NavegaciÃ³n: red primero, cachÃ© si estÃ¡s sin conexiÃ³n
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // Mismo origen (shell, datos, imÃ¡genes de assets): cachÃ© primero + actualizaciÃ³n en segundo plano
  // Codigo (JS y CSS): RED PRIMERO, para que las actualizaciones se vean en la siguiente carga.
  // Antes iba cache-first, que es la razon por la que al desplegar seguia sirviendo el archivo viejo.
  if (url.origin === self.location.origin && /\.(js|css)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'reload' })
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // ImÃ¡genes del catÃ¡logo (cdn.shopify.com): runtime cache simple
  if (/^https?:\/\/(cdn|images)\./.test(url.origin) || url.origin.indexOf('alicdn') > -1 || url.origin.indexOf('shopify') > -1) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
      })
    );
  }
});
