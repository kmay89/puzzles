/* The Sudoku Room service worker — offline play + the update whisper.
   Bump VERSION with every release: the changed byte triggers the
   browser's update check, which shows the in-app refresh bar. Same
   pattern as the chess room, scoped here to /sudoku/. */
const VERSION = '2026.07.26.1';
const CACHE = 'sudokuroom-' + VERSION;
const SHELL = [
  './', './index.html',
  './core.js', './strategies.js', './forge.js', './lessons.js',
  './badges.js', './dojo.js', './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('sudokuroom-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_VERSION' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navigations: network-first so a deploy reaches players immediately,
  // falling back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', res.clone()).catch(() => {});
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Everything else: cache-first. The shell is versioned, so a new
  // release means a new cache and stale files cannot outlive it.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});
