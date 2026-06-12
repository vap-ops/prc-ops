# Spec 63 — consolidate the reusable chrome

**Status:** complete (2026-06-13) — operator eye on deploy = acceptance (nothing should LOOK different)
**Date:** 2026-06-13
**Origin:** operator 2026-06-13: "the reusable elements should be
consolidated, so that when there is a change of design, every page
remains consistent by default."

## Problem

The spec 54–62 rounds hand-copied class strings: the 44px icon chip
exists 8×, the slate primary button 8×, the inline error strip 6×, the
sticky detail-header shell 6×. A design change now means a sweep; a
missed copy means drift. PAGE_MAX_W (spec 41) already proved the cure:
one canonical token, consumers import it.

## Scope (pure consolidation — byte-identical rendering)

### 1. `src/lib/ui/classes.ts` — canonical class constants

Server-safe strings (work on `<button>`, `<label>`, `<Link>` alike —
the reason these are constants, not components):

- `BUTTON_PRIMARY` — the slate-900 fill (h-11, ring, active press,
  disabled zinc).
- `BUTTON_SECONDARY` — the white outline sibling (HoldToggle/labels).
- `ICON_CHIP` — the 44px rounded-xl white chip (back/gear/reports/
  add-photo affordances); `ICON_CHIP_MUTED` variant (zinc-600 ink).
- `INLINE_ERROR` — the red strip used with `role="alert"`.
- `CARD` — `rounded-xl border border-zinc-200 bg-white px-4 py-3
shadow-sm` (adopted where files are already touched; the full-app
  card sweep is NOT this unit — recorded).

### 2. `DetailHeader` feature component

The sticky detail-header shell (spec 54/62): back chip (`href` +
`ariaLabel`), RefreshButton, optional action chips, title block as
children. Adopted by all six detail pages — SA WP list, SA WP detail,
PM WP detail, request detail, project settings, reports. Per-page
back targets and aria-labels preserved verbatim (site-map contract).

### 3. Adoption

The 8 primary-button sites, secondary-button sites, and 6 inline-error
sites import the constants. No class value changes — `git diff` of
rendered classes must be empty (constants equal the strings they
replace).

### 4. Docs

`ui-conventions.md` §5/§7 point at `classes.ts` + `DetailHeader` as the
source of truth; hand-rolled copies of these patterns are now a review
reject.

## Tests (failing first)

- `tests/unit/detail-header.test.tsx` — back href + aria-label, refresh
  button present, sticky classes, actions slot renders, title children
  render.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Constants equal the replaced strings (reviewed per call site) — no
   visual delta anywhere.
