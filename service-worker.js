// CivilCareer India — PWA service worker v16
const CACHE_NAME='civilcareer-v16';
const SHELL=['/','/private-jobs','/government-jobs','/exams','/study-materials','/about','/manifest.json','/styles.css','/styles-patch.css','/css-fixes.css','/app.js','/v8.js','/discovery-v9.js','/portal-v16.js'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(SHELL).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));
  self.clients.claim();
});
async function networkFirst(request){
  try{
    const response=await fetch(request);
    if(response.ok){const c=await caches.open(CACHE_NAME);c.put(request,response.clone());}
    return response;
  }catch{return caches.match(request).then(r=>r||new Response('Offline',{status:503,statusText:'Offline'}))}
}
self.addEventListener('fetch',event=>{
  const r=event.request;if(r.method!=='GET')return;
  const u=new URL(r.url);if(u.origin!==location.origin)return;
  // Live API data should never be stale-first. Cache only as an offline fallback.
  if(u.pathname.startsWith('/api/')){event.respondWith(networkFirst(r));return;}
  // Static assets update first, then fall back to the previous cached deployment.
  if(/\.(js|css|png|jpg|jpeg|webp|svg|ico|json)$/.test(u.pathname)||u.pathname==='/manifest.json'){event.respondWith(networkFirst(r));return;}
  // HTML: network-first avoids serving an obsolete job/detail page after deployment.
  event.respondWith(networkFirst(r));
});
