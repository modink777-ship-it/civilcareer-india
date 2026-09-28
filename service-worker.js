// CivilCareer India — PWA Service Worker
//
// Design notes (rewritten 2026-09-29):
//   * Network-first for every requests. The cache is an OFFLINE FALLBACK, never
//     the primary source, so a deployment is visible on the next navigation.
//   * The previous version called cache.addAll(["/", "/private-jobs", …]) at
//     install time. If any single URL failed the whole worker failed to
//     install, and every deploy served those five precached HTML routes from
//     the cache — which is what made people reach for a hard refresh. There is
//     no precaching of HTML now.
//   * API responses are no longer cached. Serving a cached JSON job list after
//     a deploy (or to an offline visitor) is misleading, and the pages already
//     render their own empty state.
//   * CACHE_NAME no longer has to be bumped by hand. Forgetting to bump it can
//     only affect the offline snapshot, never pin a live site to old assets.
const CACHE_NAME = "civilcareer-v23-netfirst-20260929";

/** Only these get an offline copy: the shell and the app's own assets. */
function isCacheableAsset(pathname) {
  return (
    pathname === "/" ||
    pathname === "/manifest.json" ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".png")
  );
}

self.addEventListener("install", (event) => {
  // No addAll(): an install must never fail because one URL was unavailable.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add("/").catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin requests or the API: always go to the network.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && isCacheableAsset(url.pathname)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/"))
      )
  );
});
