/* Relevamientos Lucciano's — service worker
   Subí el número de CACHE cada vez que cambies index.html o app.js */
const CACHE = 'relevamientos-v2';
const SHELL = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png', './logo-negro.png', './logo-blanco.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // La API nunca se cachea acá: los datos offline los maneja la app
  const esPropio = url.origin === location.origin;
  const esFuente = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!esPropio && !esFuente) return;

  // Muestra lo guardado al instante y actualiza en segundo plano
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const guardado = await cache.match(req, { ignoreSearch: esPropio });
      const red = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => guardado);
      return guardado || red;
    })
  );
});
