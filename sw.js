/* Service worker · Viáticos Lucciano's
   Recordá: subir SIEMPRE index.html + sw.js juntos y bumpear la versión. */
const CACHE = "viaticos-v23";
const ASSETS = ["./", "./index.html", "./manifest.json", "./logo-blanco.png", "./logo-negro.png"];

self.addEventListener("install", e => {
  // Bajamos los assets FRESCOS del origen (cache:'reload' saltea el cache HTTP del
  // navegador). Evita quedarnos con un index viejo al instalar una versión nueva.
  // NO llamamos skipWaiting() acá: dejamos que el nuevo SW quede "en espera" y que
  // la app avise con el cartel "Actualizar". El usuario decide cuándo.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(ASSETS.map(u =>
        fetch(new Request(u, { cache: "reload" }))
          .then(r => r.ok ? c.put(u, r) : null)
          .catch(() => null)
      ))
    )
  );
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
  const req = e.request;
  const url = new URL(req.url);
  // El backend (API) y todo lo que no sea GET NUNCA se cachea: siempre a la red.
  if (url.pathname.startsWith("/api/") || req.method !== "GET") return;

  // El HTML (navegación / index) va RED PRIMERO, con el cache solo como respaldo
  // offline. Así, apenas publicás una versión nueva, se ve enseguida: nunca más
  // se queda "pegada" una pantalla vieja como pasó con la cámara.
  const isHTML = req.mode === "navigate" ||
                 (req.headers.get("accept") || "").includes("text/html");
  if (isHTML) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // Resto de assets (logos, manifest): cache primero, bien rápido.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
