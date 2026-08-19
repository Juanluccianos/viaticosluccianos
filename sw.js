/* Service worker · Viáticos Lucciano's
   Recordá: subir SIEMPRE index.html + sw.js juntos y bumpear la versión. */
const CACHE = "viaticos-v13";
const ASSETS = ["./", "./index.html", "./manifest.json", "./logo-blanco.png", "./logo-negro.png"];

self.addEventListener("install", e => {
  // NO llamamos skipWaiting() acá: dejamos que el nuevo SW quede "en espera"
  // y que la app le avise al usuario con un cartel "Actualizar". El usuario
  // decide cuándo, para no cortarlo en medio de una carga.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// La app manda este mensaje cuando el usuario toca "Actualizar".
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // El backend (API) y las imágenes NUNCA se cachean: siempre a la red.
  if (url.pathname.startsWith("/api/") || e.request.method !== "GET") return;
  // App shell: cache-first con fallback a red.
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
