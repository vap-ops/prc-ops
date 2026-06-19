# Spec 150 — Streaming: route-level loading coverage

## Problem

"Switching pages feels slow." `loading.tsx` is route-level streaming built on
React Suspense: on client navigation Next shows the fallback **instantly** while
the server renders the page. The app has 11 such files — but ~13 data-backed,
dynamic routes have none, so navigating to them shows **nothing** until the
server render completes (now ~200ms DB + render after specs 147/148, plus the
middleware `getUser` roundtrip). Those routes feel dead on tap.

This is the cheap 80% of the streaming win, lower-risk than refactoring pages
into in-page Suspense bodies.

## Approach

**U1 (this unit) — Tier 1 coverage.** Add `loading.tsx` to the dynamic,
data-backed routes that lack one, each a one-line re-export of the existing
shared `PageSkeleton` (`src/components/features/chrome/page-skeleton.tsx`) — the
exact idiom of all 11 existing `loading.tsx`. No new logic, no new component;
this just wires the already-used skeleton to more routes. Routes added:

`dashboard`, `equipment`, `profile`, `settings`, `workers`,
`contacts/crews`, `contacts/customers`, `contacts/vendors`,
`projects/[projectId]/schedule`, `projects/[projectId]/settings`,
`requests/[requestId]`, `requests/orders/[poId]`,
`requests/orders/[poId]/deliveries/[deliveryId]`.

Skipped: static/public/redirect routes (`/`, `login`, `coming-soon`,
`grid-preview`, `portal/claim`) — no server data wait to mask.

## Out of scope (later units)

- **Tier 2 — in-page `<Suspense>`** on the hero pages (WP-detail, project-detail):
  keep the real chrome (header + tab bar) rendered, stream only the data body via
  the spec-147 loaders. Nicer "app feel" (chrome doesn't flash to skeleton) but
  more work; separate units.
- Lazy client bundles (`next/dynamic` the zod+supabase form chunk), middleware
  `getUser`, infra — separate.

## Verification

`loading.tsx` is presentational — a re-export of the already-shipped
`PageSkeleton` (the same untested one-liner as the 11 existing files), so no new
unit test (matches precedent; the skeleton component is the reused unit).
`pnpm lint && pnpm typecheck && pnpm build` green; build registers each new
`loading.tsx`. Manual: tapping into each route now shows the skeleton instantly.
