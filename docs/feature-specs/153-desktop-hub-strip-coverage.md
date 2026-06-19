# Spec 153 — Desktop hub-strip coverage (HubNav on /settings and /dashboard)

## Locked design (operator, 2026-06-19)

The desktop nav strip (`HubNav`) renders on only three pages — `/projects`,
`/review`, `/requests`. `/settings` and `/dashboard` are primary-tab hubs (no
back chip, spec 63) that render **no** HubNav. The bottom tab bar is `sm:hidden`
(phone only), so on desktop those two pages have **zero** nav affordance — they
are dead-ends. `/settings` is in every served role's tab set; `/dashboard` is in
SA/PM/super/director. `docs/site-map.md` already claims "Desktop HubNav mirrors
this (deciders + ตั้งค่า)", so this is a gap vs documented intent, not a design
choice.

**Decision:**

- HubNav must render on the full hub set: `review`, `projects`, `requests`,
  `settings`, `dashboard`. `/portal` is the documented exception (its own header
  - logout) — it never gets HubNav.
- The strip is chosen by **role**, not by page. A single selector
  `hubNavForRole(role: string): ReadonlyArray<HubNavItem> | null` in
  `hub-nav.tsx`, mirroring `tabsForRole` exactly:
  - `site_admin` → `SA_HUB_NAV`
  - `isManagerRole(role as UserRole)` → `PM_HUB_NAV` (pm / super_admin / project_director)
  - `procurement` → `PROCUREMENT_HUB_NAV`
  - `project_coordinator` → `COORDINATOR_HUB_NAV`
  - `accounting` → `ACCOUNTING_HUB_NAV` (NEW)
  - else → `null` (render nothing, same as the bottom bar for unserved roles)
- `ACCOUNTING_HUB_NAV` mirrors `ACCOUNTING_TABS`:
  `[{ label: "บัญชี", href: "/accounting" }, { label: "ตั้งค่า", href: "/settings" }]`.

Every served role that reaches `/settings` (sa, pm, super_admin,
project_director, procurement, project_coordinator, accounting) now has a
`*_HUB_NAV` set — `ACCOUNTING_HUB_NAV` closes the last gap. Unserved roles
(visitor, technician, hr, subcon_manager) get `null`, exactly as the bottom bar
already does. `contractor` lands on `/portal` (the HubNav exception) and never
reaches these internal hubs.

## Scope — IN

1. `hub-nav.tsx`: add `ACCOUNTING_HUB_NAV` + `hubNavForRole(role)`.
2. `src/app/settings/page.tsx`: render `<HubNav maxWidthClass={PAGE_MAX_W}
items={hubNavForRole(role)} currentHref="/settings" />` guarded by a null
   check, placed to match the `/projects` + `/review` pattern (adjacent to
   `<BottomTabBar/>`, before the main `<section>`).
3. `src/app/dashboard/page.tsx`: same, `currentHref="/dashboard"`, using
   `ctx.role`.
4. The two TDD tests (below).
5. `docs/site-map.md`: narrow update — record that `/settings` and `/dashboard`
   now render the desktop HubNav (same-unit doc rule). Fix the stale
   `hub-nav.tsx` comment that says HubNav is "NOT used by /requests" (it is).
   Doc edits ONLY where touched.

## TDD

Failing tests first.

1. `hubNavForRole` mapping (extend `tests/unit/hub-nav.test.tsx`): each served
   role returns its set; `accounting` → `ACCOUNTING_HUB_NAV`; an unserved role
   (e.g. `"visitor"`) → `null`. Fails until `hubNavForRole` + `ACCOUNTING_HUB_NAV`
   exist.
2. Desktop-strip source guard (extend `tests/unit/nav-back-affordance.test.ts`
   with a new `describe`): assert `page.tsx` for `[review, projects, requests,
settings, dashboard]` each contains `"HubNav"`; assert `portal/page.tsx` does
   NOT contain `"HubNav"`. Fails on settings + dashboard until they render it.

## Scope — OUT (open questions, do NOT build)

- The `/accounting` dual-nature contradiction (a primary tab AND a DetailHeader
  back-chip page). Leave `/accounting` exactly as-is.
- Unifying `BottomTabBar` + `HubNav` into one source; migrating the three
  existing inline HubNav role-selects (`/projects`, `/review`, `/requests`) to
  `hubNavForRole`.
- Label drift between phone tabs and desktop strip (รอตรวจ vs รายการรอตรวจ, etc.).
- Any routing/middleware/caching/server-action change — this touches none.
  HubNav is a Server Component; no `'use client'`.

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` — all green; the two new tests pass.
- No new `'use client'`; both pages stay Server Components.
- Live (operator, on device): at desktop width `/settings` and `/dashboard` show
  the role's strip with the current page underlined; at phone width the strip is
  hidden and the bottom bar shows. Other roles show their own strip (accounting →
  บัญชี + ตั้งค่า).
