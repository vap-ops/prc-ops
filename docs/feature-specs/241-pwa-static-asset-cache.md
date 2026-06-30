# 241 — PWA static-asset runtime cache (skeleton-paint perf)

## Why

Measured 2026-07-01 (operator report: "every page change feels slow, the skeleton
too"). Findings:

- **Every route is dynamic (`ƒ`)** — no static HTML; each navigation is a server
  function round-trip for the RSC.
- The registered service worker (`public/sw.js`, spec 18) is **network-only** — it
  caches NOTHING. So every navigation re-downloads ~1 MB of JS chunks over the
  network before the `loading.tsx` skeleton can even paint. On mobile this is the
  dominant "skeleton is slow on every page" cost.
- Bundle-_splitting_ has low headroom: runtime client deps are lean (react-dom +
  `@supabase/supabase-js` + zod + lucide + tiny utils); no fat library to lazy-load.

The leverage is to serve the **immutable, content-hashed** `/_next/static/` assets
from the SW cache, so repeat navigations paint instantly and survive flaky links.

## What (scope)

Replace the network-only fetch handler in `public/sw.js` with a **runtime
cache-first** strategy for immutable static assets ONLY.

Cache-first (serve cache, else network then populate the cache) when ALL hold:

- `event.request.method === "GET"`
- request is **same-origin**
- `url.pathname` starts with `/_next/static/`

Everything else → `fetch(event.request)` untouched (today's behaviour): RSC payloads
(`?_rsc` / `RSC: 1`), HTML document / navigation requests, `/api/**`, `/auth/**`,
Server Actions (POST), Supabase / cross-origin, images.

Cache hygiene:

- Cache name carries a version: `prc-static-v1`.
- On `activate`, delete every cache whose name ≠ the current one, so a new deploy's
  SW drops the previous chunk cache (bounded growth; at most one cold load after a
  deploy).
- Keep `skipWaiting()` + `clients.claim()` (current behaviour).

## Non-goals (explicit — do not add)

- **No caching of RSC payloads, HTML, navigation responses, `/api`, `/auth`, or any
  per-user / RLS / PDPA data.** The allowlist is `/_next/static/` only — that single
  rule is the entire safety boundary. Static chunks are content-hashed and carry no
  user data.
- No build-time precache manifest — first visit to a chunk still downloads; only
  repeat visits are served from cache. (True precache = a later unit.)
- No offline fallback page; the existing offline photo queue (spec 35) is untouched.
- No prefetch code change — App Router `<Link>` prefetch is on by default; confirm no
  `prefetch={false}` on nav links during implementation and leave it as-is if clean.

## Test plan (TDD)

`tests/unit/sw-static-cache.test.ts` — load the real `public/sw.js` source and execute
it in a mock ServiceWorker scope (stub `self`, `caches`, `fetch`, a `FetchEvent` with
`respondWith`). Assert the fetch handler:

1. GET same-origin `/_next/static/chunks/abc.js` → cache-first (opens cache, returns
   cached hit; on miss, fetches then `cache.put`s).
2. GET `/dashboard?_rsc=1` → network only; cache never opened.
3. GET `/api/notifications/drain` → network only.
4. POST to `/requests` (Server Action) → network only.
5. cross-origin GET (the Supabase URL) → network only.
6. `activate` deletes non-current caches.

## Verify

`pnpm lint && pnpm typecheck && pnpm test` green. Manual post-deploy: DevTools →
Application → Cache Storage shows `prc-static-v1` populated with `/_next/static`
entries; Network shows chunks served from "(ServiceWorker)" on repeat nav; RSC and
`/api` requests still hit the network.

## References

- spec 18 (current network-only SW), spec 35 (offline photo queue — untouched).
- Next.js static-asset immutability + RSC `_rsc` cache-key behaviour:
  <https://nextjs.org/docs/app/guides/cdn-caching>.
