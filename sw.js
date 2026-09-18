/* Service Worker â€” VÃ“RTEX Gadgets PWA */
const VERSION = 'vortex-app-v53';
const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'assets/app.css?v=53',
  'assets/app.js?v=53',
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
      /* [2026-09-17] cache:'reload' es importante: sin el, esta peticion la
         resolvia la cache HTTP del navegador y seguia sirviendo un index.html
         viejo (GitHub Pages lo cachea unos 10 minutos). Era la causa de que
         hubiera que abrir la app dos veces para ver un despliegue. */
      fetch(req, { cache: 'reload' })
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

/* ===========================================================================
   AVISOS DE VENTA (push)   [2026-09-18]
   ===========================================================================
   El dueno quiere que le suene con el panel CERRADO. Antes el sonido lo ponia la
   pagina, y sin pagina abierta no habia sonido. Con esto lo pone el propio
   telefono: no hace falta tener nada abierto.

   EL SONIDO NO SE ELIGE AQUI. Una notificacion web no puede sonar con un sonido
   propio: lo pone el sistema operativo. En Android el dueno puede escoger cual
   quiere en: Ajustes -> Notificaciones -> Chrome -> sonido.
   =========================================================================== */
self.addEventListener('push', (event) => {
  let aviso = { title: 'VÓRTEX Gadgets', body: 'Tienes un aviso nuevo.' };
  try {
    if (event.data) {
      const crudo = event.data.text();
      if (crudo) {
        const j = JSON.parse(crudo);
        if (j.title) aviso.title = j.title;
        if (j.body) aviso.body = j.body;
        if (j.id) aviso.id = j.id;
      }
    }
  } catch (e) {
    /* Si el mensaje no se entiende, se muestra algo generico antes que nada. */
  }

  event.waitUntil(self.registration.showNotification(aviso.title, {
    body: aviso.body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    /* requireInteraction: el aviso de una VENTA no debe borrarse solo. Se queda en
       pantalla hasta que el dueno lo vea. Justo lo contrario de una notificacion
       cualquiera, que desaparece en segundos. */
    requireInteraction: true,
    /* En Android O en adelante estas dos las ignora el sistema y usa lo del canal,
       pero se dejan puestas para los navegadores que si las respetan. */
    vibrate: [200, 100, 200],
    tag: aviso.id ? ('pedido-' + aviso.id) : 'vortex-aviso',
    renotify: true,
    data: { url: 'gestor-pedidos-cod.html' }
  }));
});

/* Al tocar la notificacion se abre el panel (o se trae al frente si ya estaba). */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || 'gestor-pedidos-cod.html';
  const completa = new URL(destino, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if (v.url.indexOf('gestor-pedidos-cod') > -1 && 'focus' in v) return v.focus();
      }
      if (clients.openWindow) return clients.openWindow(completa);
    })
  );
});
