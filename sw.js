// Service worker: makes the site installable and playable offline. Installing
// precaches everything the pages need to start, so an offline reopen works even
// though the first visit loaded before this worker took control. After that,
// requests go to the network first, so players get fresh files, and the cache is
// the offline fallback. scripts/build-site.js fills in VERSION and PRECACHE.
const VERSION = 'dev';
const PRECACHE = [];
const CACHE = `clocktower-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Bypass the HTTP cache so the precached copies all belong to this version.
    await cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('clocktower-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.status === 200) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
      }
      return response;
    } catch (error) {
      // Pages keep working offline with any query (?date=…), served from the precached page.
      const cached = (await caches.match(request))
        ?? (request.mode === 'navigate' ? await caches.match(request, { ignoreSearch: true }) : undefined);
      if (cached) return cached;
      throw error;
    }
  })());
});
