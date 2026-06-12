# Spec 53 — refresh button on every content page

**Status:** complete (2026-06-13)
**Date:** 2026-06-13
**Origin:** operator request 2026-06-12: "Also include a refresh button"
(rider on a design request whose reference attachment is still pending —
the refresh button is independent and ships first).

## Problem

The installed PWA has no browser chrome — no reload control at all
(standalone display mode). Server-component pages go stale: another
user's decision, an AppSheet write, or a status flip stays invisible
until navigation forces a re-render. In the field the workaround is
kill-and-relaunch.

## Scope

One new client component + placement on every content page. Nothing else.

- `RefreshButton` (`src/components/features/refresh-button.tsx`,
  `'use client'` justified: onClick + useTransition spinner state):
  - `router.refresh()` inside `startTransition` — re-fetches all server
    components for the current route, no full reload, client state kept.
  - Icon button, lucide `RotateCw`, **44px tap target** (h-11 w-11 — the
    spec-36 transparent-wrapper lesson does not apply; the button itself
    is 44px), `aria-label="รีเฟรช"`.
  - Icon spins (`animate-spin`) while the transition is pending;
    button disabled meanwhile.
  - Two variants, same prop shape as LogoutButton: `dark` (brand band,
    slate-100 icon, hover amber) and `light` (white detail headers,
    zinc-600 icon, hover zinc-900).
- Placement:
  - `AppHeader` (dark variant) — covers every hub page (/sa, /pm,
    /requests, /pm/projects, /workers, reports). NOT hidden in
    standalone (unlike logout — refresh is exactly for standalone).
  - The four bespoke detail headers (light variant), right-aligned in
    the back-link row: SA project WP list, SA WP detail, PM WP detail,
    /requests/[requestId].
- Exceptions (recorded): /profile, /coming-soon, /login keep no refresh
  button — max-w-md single-card pages, no stale-data surface.

## Recorded decisions

1. `router.refresh()` over `window.location.reload()` — keeps client
   state (lightbox, form drafts), re-runs server components; a hard
   reload would also drop the offline-queue banner mid-drain.
2. Button lives in AppHeader for hubs rather than per-page — one
   placement, every future hub page inherits it.

## Tests (failing first)

- `tests/unit/refresh-button.test.tsx`: renders with aria-label รีเฟรช
  and 44px classes; click calls router.refresh exactly once; dark/light
  variants differ; disabled + spinning while pending (transition held
  open).
- `tests/unit/app-shell-primitives.test.tsx` (or equivalent AppHeader
  pin): header now contains the refresh button.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green.
2. Manual (operator, on deploy): tap refresh on /requests — pill/state
   changes made elsewhere appear without relaunching the PWA.
