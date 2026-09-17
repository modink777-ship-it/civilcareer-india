// CivilCareer India — PWA Service Worker
const CACHE_NAME = "civilcareer-v3";

const STATIC_ASSETS = [
  "/",
  "/private-jobs",
  "/government-jobs",
  "/exams",
  "/study-materials",
  "/about",
  "/manifest.json",
  "/styles.css",
  "/styles-patch.css",
  "/app.js",
  "/v8.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept non-GET requests. This prevents POST/PUT/PATCH caching errors.
  if (request.method !== "GET") return;

  // API: network first, cached GET fallback.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell/static assets: network first for JS/CSS so deployments update quickly.
  if (
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // HTML: stale cached page first, refresh cache in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
      return cached || fresh;
    })
  );
});
