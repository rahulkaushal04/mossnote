// The service worker of the standalone web app. `scripts/vite/standalone.ts` fills in the two
// values below when the app is built. It keeps a copy of every file of the app so Mossnote opens
// with no network, and switches to a newer copy only when the page asks (see `serviceWorker.ts`
// in the web app), so a page is never half old and half new.
const CACHE = '__CACHE_NAME__';
const FILES = JSON.parse('__FILES__');
const SHELL = '__SHELL__';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('mossnote-') && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // Every page of the app is the same document; the router shows the right screen.
  const wanted = request.mode === 'navigate' ? SHELL : request;
  // The files never change under the same name, so which headers a host varies its answers by
  // (some vary by Origin, which cross-origin-mode requests would not match) does not matter here.
  event.respondWith(
    caches.match(wanted, { ignoreVary: true }).then((cached) => cached || fetch(request)),
  );
});
