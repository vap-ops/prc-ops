// Service worker — spec 241 (supersedes the spec-18 network-only SW).
//
// Runtime cache-first for IMMUTABLE static assets ONLY: same-origin GET
// requests under /_next/static/* (content-hashed filenames, served with
// Cache-Control: immutable). Serving these from cache lets the loading
// skeleton + page chunks paint instantly on repeat navigations instead of
// re-downloading ~1 MB of JS over the network every time.
//
// EVERYTHING else passes straight to the network, uncached: RSC payloads
// (?_rsc), HTML / navigation requests, /api, /auth, Server Actions (POST),
// and Supabase / cross-origin requests. That allowlist is the ENTIRE PDPA
// safety boundary — no per-user / RLS data is ever cached, because only the
// content-hashed /_next/static assets (which carry no user data) qualify.
//
// Policy is guarded by tests/unit/sw-static-cache.test.ts, which runs this
// file in a mock ServiceWorker scope. Bump CACHE when changing the policy.
const CACHE = "prc-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drop any previous-version cache so storage stays bounded across deploys
  // (content-hashed assets would otherwise accumulate forever).
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

function isImmutableStaticAsset(request) {
  if (request.method !== "GET") return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  if (!isImmutableStaticAsset(event.request)) {
    // Untouched network passthrough — RSC, HTML, /api, /auth, POST, cross-origin.
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const response = await fetch(event.request);
      // Cache only a full 200 — never a 206 partial, opaque, or error response.
      if (response && response.status === 200) cache.put(event.request, response.clone());
      return response;
    })(),
  );
});
