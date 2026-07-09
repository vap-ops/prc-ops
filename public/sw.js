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

// Spec 290 — warm the static cache from the deploy's precache manifest
// (public/precache-manifest.json, written by scripts/gen-precache-manifest.mjs
// during `pnpm build`). Fail-open by design: warming is an optimization — any
// fetch/shape problem is swallowed and the on-demand cache path still works.
// The /_next/static/ allowlist is RE-ENFORCED here entry-by-entry, so even a
// corrupt or hostile manifest can never cache /api, HTML, or cross-origin bytes.
async function warmStaticCache() {
  try {
    const res = await fetch("/precache-manifest.json", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res || res.status !== 200) return;
    const manifest = await res.json();
    if (!manifest || !Array.isArray(manifest.assets)) return;
    const cache = await caches.open(CACHE);
    for (const entry of manifest.assets) {
      if (typeof entry !== "string") continue;
      // Gate on the RESOLVED URL, never the raw string — a traversal entry like
      // "/_next/static/../../api/x" passes a raw startsWith but normalizes
      // outside the allowlist. Same-origin + resolved-pathname or nothing.
      let url;
      try {
        url = new URL(entry, self.location.origin);
      } catch {
        continue;
      }
      if (url.origin !== self.location.origin) continue;
      if (!url.pathname.startsWith("/_next/static/")) continue;
      try {
        const hit = await cache.match(url.href);
        if (hit) continue;
        // Bounded per-asset: one stalled fetch must not hang the whole warm
        // (event.waitUntil holds the SW alive while this loop runs).
        const response = await fetch(url.href, { signal: AbortSignal.timeout(10_000) });
        // Same rule as the fetch handler: full 200s only.
        if (response && response.status === 200) await cache.put(url.href, response.clone());
      } catch {
        // one bad asset never aborts the rest of the warm
      }
    }
  } catch {
    // no manifest / offline / malformed JSON — silently skip
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drop any previous-version cache so storage stays bounded across deploys
  // (content-hashed assets would otherwise accumulate forever), then warm the
  // new deploy's assets (spec 290 — covers sw.js-change deploys).
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
      await warmStaticCache();
    })(),
  );
});

// Spec 290 — the app nudges once per browser session (sw-register.tsx), which
// covers the common case: a deploy whose sw.js bytes did NOT change (no
// install/activate fires) but whose chunk hashes did.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "WARM_STATIC_CACHE") return;
  event.waitUntil(warmStaticCache());
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
