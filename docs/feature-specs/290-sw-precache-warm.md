# Spec 290 — SW static-asset warm (install-time precache, grown up)

**Status:** APPROVED (operator go 2026-07-10, perf lane — the "first load / PWA cold
open" gap named in the 2026-07-01 live diagnosis and left open by spec 241).
**Type:** perf. Code + build-script. NO schema.

## Problem

Spec 241's service worker caches `/_next/static/*` only ON DEMAND — each asset is
cached the first time a navigation requests it. So the first visit AND every
post-deploy cold open still download chunks per-navigation before the skeleton
can paint. A local app feels instant because its shell is already on disk; ours
re-earns that shell one navigation at a time.

Constraint discovered in design: `public/sw.js` bytes rarely change, and a service
worker only re-installs when its bytes change — so a per-deploy "install-time
precache manifest baked into sw.js" would never refresh. The warm must be a
RUNTIME mechanism keyed off a manifest that changes per deploy.

## Design

1. **Manifest at build time.** `scripts/gen-precache-manifest.mjs` walks
   `.next/static/**` after `next build` and writes
   `public/precache-manifest.json`: `{ "assets": ["/_next/static/..."] }`.
   `package.json` `build` becomes `next build && node scripts/gen-precache-manifest.mjs`
   (runs inside Vercel's build command, so the file ships with the deploy).
   The manifest lives OUTSIDE `/_next/static/` on purpose: public files are
   served must-revalidate (never immutable), and the SW's own allowlist ignores
   it — a stale manifest can't wedge.
2. **Warm in the SW.** `sw.js` gains `warmStaticCache()`:
   - fetch `/precache-manifest.json` (`cache: "no-store"`); on ANY failure or
     bad shape → silent no-op (fail-open — warming is an optimization, never a
     gate);
   - accept ONLY string entries starting with `/_next/static/` (the PDPA
     allowlist is re-enforced HERE, independent of the manifest's content — a
     corrupt manifest can never cache `/api`, HTML, or cross-origin bytes);
   - for entries not already cached: fetch same-origin, `cache.put` 200s only.
     Triggers: `activate` (covers SW updates) and a `message` event
     `{type: "WARM_STATIC_CACHE"}` (covers ordinary page loads long after the
     last SW update — the common case).
3. **Nudge from the app.** `sw-register.tsx` posts `WARM_STATIC_CACHE` to the
   ready SW once per browser session (sessionStorage throttle) so each deploy's
   new chunks warm in the background on the first visit after it.
4. **Pruning unchanged.** Old hashed assets still age out via the existing
   CACHE-version bump; manifest-diff pruning is a possible follow-up, deferred
   (in-flight tabs on the previous build may still need old chunks).

Mobile-data note: a warm downloads at most the same bytes the user would pay
per-navigation anyway (already-cached entries are skipped); it just front-loads
them. Accepted.

## Units

- **U1 (this unit):** manifest script + sw.js warm + register nudge + tests.
  PR is guard-held via `package.json` (build script line) — expected.

## Verification checklist

- [ ] RED first: sw warm tests (mock SW scope, real sw.js file) + manifest
      script test (fixture dir) seen failing.
- [ ] PDPA boundary pinned by test: manifest offering `/api/x`, an absolute
      cross-origin URL, or a non-string is NEVER fetched/cached.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] Real-flow: `pnpm build` produces `public/precache-manifest.json` with
      real chunk paths; production `next start` + preview browser: SW registers,
      warm populates the cache (inspect `caches` keys/entries), zero console
      errors.
- [ ] Reviewer subagent pass.
