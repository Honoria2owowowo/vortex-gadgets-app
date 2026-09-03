APP VÓRTEX GADGETS (PWA instalable) — guía rápida
==================================================

La carpeta contiene la app completa (Opción B + C):
- index.html + assets/app.js + assets/app.css  → la app
- manifest.webmanifest                         → la hace instalable
- sw.js                                        → funciona offline
- datos-tienda.json                            → catálogo de respaldo (23 productos reales)
- icons/                                       → iconos en todos los tamaños

La app se conecta EN VIVO a tu tienda Shopify (Storefront API) para traer
productos, precios e imágenes actualizados. Si no hay internet, usa el
catálogo guardado.

----------------------------------------
1) PUBLICARLA (necesario para instalar en celulares) — gratis
----------------------------------------
La app necesita estar en HTTPS. Opciones gratuitas (2 minutos):

A) NETLIFY DROP (más fácil):
   1. Entra a https://app.netlify.com/drop
   2. Arrastra TODA la carpeta app-vortex-pwa encima
   3. Listo: te da una URL https://…netlify.app

B) VERCEL: https://vercel.com → New Project → sube la carpeta.

C) GitHub Pages: sube la carpeta a un repo y activa Pages.

Después de publicar, abre la URL desde el celular.

----------------------------------------
2) INSTALARLA COMO APP
----------------------------------------
Android (Chrome): abre la URL → menú ⋮ → "Instalar app" (o "Añadir a
pantalla de inicio"). También aparece el botón "Instalar app" dentro de la
propia app (menú ☰).

iPhone (Safari): abre la URL → botón Compartir → "Añadir a pantalla de
inicio". Se abre a pantalla completa como una app nativa.

PC (Windows/Mac): Chrome o Edge → icono de instalar en la barra de
direcciones (o menú → Instalar como aplicación). Se abre en su propia
ventana, como una app de escritorio.

----------------------------------------
3) AJUSTES RÁPIDOS (si quieres cambiar algo)
----------------------------------------
En assets/app.js, al inicio (config APP):
- waNumber   → número de WhatsApp (573181738642)
- storeUrl   → tu tienda
- shopDomain / storefrontToken → conexión Shopify (no lo cambies salvo que
  regeneres el token en Admin → Apps → Desarrollo de apps → VÓRTEX PWA)
Colores: en assets/app.css, variables --bg, --accent, --accent2…

Datos en vivo: el token Storefront se creó desde tu Admin (Admin API). Si
algún día caduca, regenéralo y pega el nuevo valor en app.js.

----------------------------------------
4) PEDIDOS (Opción C — WhatsApp)
----------------------------------------
Cada producto tiene "Pedir por WhatsApp": abre el chat con el pedido listo.
El carrito arma un mensaje con todos los ítems + total. El botón "Abrir en
la tienda" lleva a vortexgadgets.com.co para pagar en línea (PSE/tarjetas).
