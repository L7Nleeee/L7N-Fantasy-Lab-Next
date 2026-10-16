// Offline app-shell cache. Bump CACHE when releasing (scripts/build.mjs stamps it). Static files only; remote data is never cached here.
const CACHE = 'l7n-lab-v5.1.0';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'styles/app.css', 'assets/l7n-logo.png', 'src/main.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // cross-origin (CSV sync, photos) always goes to the network
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req).then((m) => m || caches.match('index.html'))));
});
