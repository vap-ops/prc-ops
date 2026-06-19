# Spec 151 — Lazy client bundles (defer the offline-queue runner)

## Problem

Bundle measurement (spec 147/148 follow-up): total client JS ~542 kb gz; one
chunk is **125 kb gz (512 kb raw) = supabase-js (browser client) + zod**. zod is
pulled in only by `env.ts` (client env validation at import); the browser
supabase client by 9 client components. **Eight are route-scoped + tap-gated —
but `UploadQueueRunner` is mounted in the root `layout.tsx`**, so it drags that
125 kb chunk into **every page's first load**, app-wide.

`UploadQueueRunner` (spec 35) is a *background* drainer for LEFTOVER offline
uploads — it renders nothing unless the queue has items, and the live
phase-uploader handles in-page photos. It does not need to be on the critical
path of first paint.

## Approach

**U1 (this unit).** Load `UploadQueueRunner` lazily, after hydration, via a small
`'use client'` wrapper using `next/dynamic` with `ssr: false`
(`upload-queue-runner-lazy.tsx`). The root layout renders the wrapper instead of
the runner directly. This keeps supabase-js + zod out of the server render and
the initial JS of every page; the drain loop starts a beat after paint.

Safe because the runner is for leftovers only (crash/offline/navigation), replay
is idempotent end-to-end (ADR 0039), and the in-page uploader is unaffected.

`'use client'` justification (per CLAUDE.md): `next/dynamic({ ssr: false })` must
be called from a Client Component.

## Out of scope (later)

The 8 route-scoped uploader/sheet components could also be `next/dynamic`'d for
extra per-route first-load savings — smaller, separate units. Streaming Tier-2,
middleware, infra — separate.

## Verification

Re-run the chunk computation (raw + gzip, shared baseline vs total) before/after
and confirm the 125 kb chunk leaves first-load (moves to a lazily-fetched chunk).
`pnpm lint && pnpm typecheck && pnpm build` green. No new unit test — the wrapper
is a presentational `next/dynamic` boundary (same class as the other untested
layout chrome components: SwRegister, ViewportScrollGuard).
