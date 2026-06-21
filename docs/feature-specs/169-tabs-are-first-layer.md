# Spec 169 — Bottom tabs (and the hub strip) are first-layer destinations

## Problem

The operator (2026-06-21): _"Hitting the menu button, should take users back to
the top of the sitemap … all the tabs on the bottom of screen must be treated as
first layer."_

The phone **bottom tab bar** (`BottomTabBar`, `aria-label="เมนูหลัก"`) renders the
**active** tab as an inert `<span>` (only inactive tabs are `<Link>`s). So when you
are on a **sub-page** of a section — e.g. a project detail `/projects/[id]` or a
deeper screen — the section's own tab (โครงการ) is "active" and therefore **not
tappable**. There is no one-tap way back to the section's root (`/projects`, the
first layer); the tab looks like a button but does nothing.

The operator's mental model: every bottom tab is a **first-layer** destination —
tapping it always returns to the top of that section.

The desktop **hub strip** (`HubNav`, the `sm:`-only counterpart that the codebase
keeps mirrored with the bottom bar) has the identical inert-`<span>` for the
current item — same dead-tab on a cloud PC.

## Decision

Make the **active / current item a real `<Link>` to its root** in both nav
surfaces. Keep the "you are here" identity via `aria-current="page"` plus the
existing active styling (the bottom bar's amber-blue indicator bar + bold
`text-action`; the strip's blue underline + `font-semibold`). A tap on the active
tab now navigates to its root href — returning to the first layer from any
sub-page.

This is the smallest change that satisfies "every tab is first layer": no new
component, no route change, no change to which tab lights (the longest-prefix
active detection is untouched).

## Scope (exactly this)

1. **`BottomTabBar`** (`src/components/features/chrome/bottom-tab-bar.tsx`) — drop
   the `tab === active` `<span>` branch; render **every** tab as a `<Link>`. The
   active one adds `aria-current="page"`, the indicator bar, `text-action`, and
   bold label; inactive keeps its muted style. (`tabsForRole` / active detection
   unchanged.)

2. **`HubNav`** (`src/components/features/chrome/hub-nav.tsx`) — same: the current
   item becomes a `<Link aria-current="page">` with the underline/`font-semibold`
   active style instead of a `<span>`. Applied for cross-viewport parity (the
   strip mirrors the bottom bar; a desktop operator would otherwise hit the same
   dead tab).

3. **Tests (path b — behaviour change):**
   - `bottom-tab-bar.test.tsx` — the active tab is a tappable `<a>` with its root
     `href` (new test on a deep `/projects/[id]/work-packages/[id]` path); the PM
     active tab (รอตรวจ on /review) is a link to /review; comments updated.
   - `hub-nav.test.tsx` — every item is a link; the current page carries
     `aria-current="page"` (was: rendered as a span).

## Out of scope / preserved

- **Active detection unchanged** — longest-matching-prefix still lights exactly one
  tab; `aria-current` still marks it for a11y + styling.
- **Detail screens that hide the bottom bar** (WP detail's thumb capture bar, etc.)
  are unchanged — this unit only changes how the bar behaves where it already
  renders; it does not add the bar to new screens.
- No route, role-set, label, or DB change.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] `pnpm build` green.
- [ ] From a project sub-page, tapping the (active) โครงการ bottom tab returns to
      `/projects`.
- [ ] Exactly one tab still shows the active indicator on every path.
- [ ] Desktop hub strip: the current item is clickable and returns to its root.
- [ ] Acceptance = operator phone (PM/SA-gated routes; preview env only renders /login).
