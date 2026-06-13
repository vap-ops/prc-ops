# Spec 77 — App-feel slice 2: press / active tactile feedback

**Status:** COMPLETE (2026-06-13; no DB change; acceptance = operator eyeball on the live deploy).
**Program:** the "feel like a native app" round (memory `app-feel-roadmap`). Slice 2 of N.

## Why

Native apps respond on _touch_. Today only buttons have a press state (`active:translate-y-px`); the
cards, list rows, tabs, chips, and icon affordances people actually tap had none — and iOS painted its
grey tap-flash over them. Verified fact: `navigator.vibrate` is a no-op on iOS PWA, so `:active`
press states are the only "haptic" the primary users get.

## What shipped (exhaustive tap-target sweep → press states)

- **Global (`globals.css`):** `-webkit-tap-highlight-color: transparent` on `html` (kills the grey iOS
  tap-flash so our own press states show) + `touch-action: manipulation` on `a, button, summary,
label, [role=button]` (drops the legacy ~300ms double-tap-zoom delay → taps register instantly).
  This single change is the biggest perceptual win and covers every control.
- **Press tints on the high-traffic non-button tap targets** (`active:bg-zinc-100`, the native
  row-press tint): purchase-request cards, WP list rows (flat + contained), the deliverable group
  toggle (`active:bg-slate-200`), project rows (SA + PM hubs), the PM decision-queue rows.
- **Press lift (`active:translate-y-px`) on the button-like chips:** `ICON_CHIP` / `ICON_CHIP_MUTED`
  (back/gear/reports) + the custom `RefreshButton`; `RadioChip` (view filter + worker-type picker);
  the `/requests` ของฉัน/ทั้งหมด filter chips.
- **Bottom tab bar:** `active:scale-95` on the tab items (transform — no layout shift).

All keep the 44px floor; press hues are zinc/slate (no green, no `min-h-9` — design-doctrine stays
green). No new component, no constant churn (`ICON_CHIP` was not byte-pinned).

## Tests

Visual slice — guarded by `design-doctrine.test` (green/min-h-9 drift) + `ui-classes-spec65` pins +
lint/typecheck/build. 634 unit green. Acceptance = operator eyeball: tap a WP row / a card / a tab on
the phone → it visibly presses, instantly, with no grey flash.

## Deferred (low-traffic / covered by the global)

Text-only disclosure `<summary>` toggles, the desktop HubNav + AppHeader links, the report download
button, the `/requests` back link — the global `touch-action`/tap-highlight already covers them; an
explicit `active:` is a cheap fast-follow if wanted.

## Next slices (memory `app-feel-roadmap`)

3 optimistic UI (kill the 37 `router.refresh` flickers — careful, per-surface) · 4 bottom sheets ·
5 motion (CSS list-enter via `@starting-style`; route View Transitions only as a guarded spike).
