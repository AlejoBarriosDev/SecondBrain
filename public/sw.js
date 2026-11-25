/* SecondBrain Security-First Service Worker
 * - /api/* and non-GET requests: STRICT Network-Only (never cached)
 * - Navigation requests: Network-First with /offline HTTP 200 fallback (never caches private HTML)
 * - Same-origin static assets: Cache-First with background revalidation
 */

const STATIC_CACHE = "secondbrain-static-v1";
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

const OFFLINE_HTML_FALLBACK = `<!doctype html>
<html lang="es" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sin conexión — SecondBrain</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090b; color: #f4f4f5; font-family: system-ui, -apple-system, sans-serif; padding: 1.5rem; }
    main { max-width: 26rem; text-align: center; background: #111114; border: 1px solid #27272a; border-radius: 1rem; padding: 2rem; }
    h1 { margin: 0 0 0.75rem; font-size: 1.375rem; }
    p { margin: 0 0 1.5rem; color: #a1a1aa; line-height: 1.5; font-size: 0.95rem; }
    button { background: #6366f1; color: #fff; border: 0; border-radius: 0.625rem; padding: 0.625rem 1.25rem; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Sin conexión</h1>
    <p>No se puede conectar con SecondBrain en este momento. Tus datos financieros nunca se almacenan en caché sin conexión por seguridad.</p>
    <button type="button" onclick="window.location.reload()">Reintentar</button>
  </main>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(request, url) {
  if (url.pathname === "/sw.js" || url.pathname.startsWith("/api/")) {
    return false;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    return true;
  }
  return ["style", "script", "font", "image"].includes(request.destination);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Non-GET requests: strict Network-Only
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Cross-origin requests: strict Network-Only
  if (url.origin !== self.location.origin) {
    return;
  }

  // API & Auth endpoints: STRICT Network-Only — NEVER cache authenticated financial data
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Never cache the Service Worker script itself
  if (url.pathname === "/sw.js") {
    return;
  }

  // Navigation requests: Network-First, fallback to precached /offline (HTTP 200)
  // Authenticated HTML pages are intentionally NEVER written to cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedOffline = await caches.match(OFFLINE_URL);
        if (cachedOffline) {
          return cachedOffline;
        }
        return new Response(OFFLINE_HTML_FALLBACK, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }),
    );
    return;
  }

  // Same-origin static assets: Cache-First with background revalidation
  if (isStaticAsset(request, url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.ok && response.type === "basic") {
              const copy = response.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      }),
    );
  }
});
