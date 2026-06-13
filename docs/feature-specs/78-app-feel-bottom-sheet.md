# Spec 78 — App-feel slice 4: bottom-sheet primitive

**Status:** COMPLETE (2026-06-13; no DB change; acceptance = operator eyeball on the live deploy).
**Program:** the "feel like a native app" round (memory `app-feel-roadmap`). Slice 4 of N.
**Note:** slice 3 (optimistic UI) was deliberately deferred — it mutates payroll/labor data where an
optimistic-then-rolled-back row is confusing; it needs careful per-surface treatment, not a rush.

## Why

Inline `<details>` expanders push the page around and read as web forms. Native apps slide a sheet up
from the bottom — thumb-reachable, dims the page behind, focused. This slice adds the reusable
primitive and migrates the first form to prove it.

## What shipped

- **`src/components/features/bottom-sheet.tsx`** — `<BottomSheet open title onClose>{children}</>`.
  Same overlay contract as `ConfirmDialog`/the lightbox: `fixed inset-0` scrim (`z-50`, the dialog
  band), Escape + scrim-click close, content click `stopPropagation`, `role=dialog aria-modal`,
  `aria-labelledby` the title. Bottom-anchored `rounded-t-2xl` panel with a grab handle + sticky
  header + 44px ปิด button; `max-h-[85vh]` own overscroll-contained scroller; `pb-[env(safe-area-inset-bottom)]`.
  The body is already LOCKED (spec 64) so the page can't scroll-leak behind the scrim on iOS.
- **`globals.css`** — `@keyframes sheet-up` (translateY 100%→0) gated by `prefers-reduced-motion:
no-preference` (instant for reduced-motion).
- **Migration:** `wp-assignment-panel.tsx` (มอบหมายงาน) — its inline `<details>` becomes a trigger
  button opening the sheet with the contractor picker + add-contractor form; the sheet closes on a
  successful assign. Chosen as the first migration because it is already a self-contained client
  component (no server/client boundary change, no form-component change, no test ripple).

## Tests

`bottom-sheet.test.tsx` (5: closed renders nothing; open = labelled dialog + title + children;
Escape closes; scrim-click closes but content click does not; ปิด closes). 639 unit / lint /
typecheck / build green.

## Seams (recorded)

- Full focus-trap (Tab cycling) — not implemented, matching `ConfirmDialog`; the panel takes focus on
  open. Add if a sheet form grows long.
- Swipe-to-close gesture — deferred (v1 is tap-scrim / Escape / ปิด).
- More form migrations (create-purchase-request, site-purchase, worker-add) — fast-follows reusing
  this primitive. The `<details>` create-form on the WP page needs a small client wrapper (it lives
  in a Server Component) — that's the one boundary to handle next.

## Next slices (memory `app-feel-roadmap`)

3 optimistic UI (careful, per-surface; payroll-safe surfaces only) · 5 motion (CSS list-enter is the
safe half; route View Transitions are experimental → guarded spike only).
