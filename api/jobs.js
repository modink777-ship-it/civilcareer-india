// CivilCareer India — PWA Service Worker
const CACHE_NAME = 'civilcareer-v17-explorer-20260925';

const STATIC_ASSETS = [
  '/',
  '/private-jobs',
  '/government-jobs',
  '/exams',
  '/study-materials',
  '/about',
  '/manifest.json',
  '/styles.css',
  '/app.js',
  '/v8.js',
  '/discovery-v9.js',
  '/cc-intelligence.js',
  '/visual-backgrounds.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  const serveCachedFallback = () => {
    return caches.match(request).then((cached) => cached || caches.match('/'));
  };

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => serveCachedFallback())
    );
    return;
  }

  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname === '/manifest.json'
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
        .catch(() => serveCachedFallback())
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => serveCachedFallback())
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => serveCachedFallback())
  );
});



