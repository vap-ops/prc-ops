// Minimal network-only service worker (spec 18). Exists because Android
// Chrome's install prompt expects a registered SW with a fetch handler;
// it caches NOTHING (every request passes straight to the network) so
// there is zero stale-content risk. Offline support is a future unit.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
