# Spec 140 — App-feel slice 5: motion (Unit 1 — staggered list-enter)

**Status:** Draft (2026-06-18). **Program:** the "feel like a native app" round (memory
`app-feel-roadmap`). Slice 5 of N — motion. App-only, no DB change. Acceptance = operator eyeball
on the live deploy + the pure-helper test.

This unit does the **safe half** of the motion slice only: a CSS-driven, reduced-motion-gated
list-enter animation. Route-level View Transitions stay an experimental, guarded spike (Next 16's
`experimental.viewTransition` is "not recommended for production" — verified in the roadmap audit)
and are explicitly NOT in this unit.

## Why

Motion is the biggest remaining "web, not app" tell: lists snap into place with no entrance.
Native lists glide their rows in with a short, staggered fade-up. This unit adds that to the
work-package worklist — the screen the operator opens most — using the same CSS pattern the
earlier app-feel slices established (`@keyframes` gated behind `prefers-reduced-motion:
no-preference`, like spec-76 `toast-in` and spec-78 `sheet-up`). No motion library, no JS — pure
CSS, zero data risk (entrance animation never touches state).

## Change (app-only, no schema)

- **Pure helper** `src/lib/ui/list-enter.ts` (TDD): `listEnterProps(index)` → `{ className:
"list-enter", style: { "--enter-index": n } }` where `n` is the row's **capped** stagger index
  (`Math.trunc`, clamped to `[0, LIST_ENTER_STAGGER_CAP]`, cap = 8). The cap is the load-bearing
  logic: without it a long list's tail would wait seconds; rows past the cap all share the last
  delay step. The CSS var feeds the keyframe's `animation-delay`. This is the testable seam.
- **`src/app/globals.css`** — `@keyframes list-enter` (opacity `0 → 1`, `translateY(6px) → 0`) +,
  inside `@media (prefers-reduced-motion: no-preference)`, `.list-enter { animation: list-enter
240ms ease-out both; animation-delay: calc(var(--enter-index, 0) * 35ms); }`. `both` fill-mode
  holds the row invisible through its stagger delay then settles visible. **Reduced-motion users
  get no animation → static, fully-visible rows** (the `from { opacity: 0 }` only applies while the
  animation is attached, which only happens inside the no-preference query — no FOUC).
- **Component** `src/components/features/chrome/worklist-row.tsx` (`WorklistRow`): add an optional
  `enterIndex?: number` prop; when provided, merge `listEnterProps(enterIndex)` into the root
  `<Link>` (append the class, set the style var). Omitted → no animation (every existing caller is
  untouched until it opts in). Server-safe (no `'use client'`); the class+style are plain markup.
- **Wire** `src/app/projects/[projectId]/work-package-list.tsx`: pass `enterIndex={i}` from the
  map index at the WorklistRow's **three** render sites (grouped-by-band, flat action-state, and
  the deliverable-group `<li>`), so the WP list glides in uniformly in every group mode.

## Tests

`tests/unit/list-enter.test.ts` (TDD): `listEnterProps` returns `className: "list-enter"` + the
row's `--enter-index`; clamps the first row / negatives to 0; caps the tail at
`LIST_ENTER_STAGGER_CAP`; truncates fractional indices. The CSS keyframe + the component wiring are
the **visual half** — acceptance is the operator eyeball on device (the slice-77 precedent for
visual slices: guarded by `design-doctrine` / lint / typecheck / build; "list-enter" trips no
green-\*/min-h-9 rule).

## Seams / out of scope

- Other lists (procurement worklist cards, contacts, suppliers, requests) — fast-follows reusing
  `listEnterProps`; only the WP worklist here.
- Route / View Transitions, the gliding active-tab indicator, and shared-element transitions — a
  later unit; route VT is experimental → guarded spike only, never the foundation.
- Re-entrance on `router.refresh()` (the rows re-animate) is acceptable and subtle; if it reads as
  busy on a high-frequency refresh surface, scope the class to first-mount in a later unit.

## Next slices (memory `app-feel-roadmap`)

5 motion — more lists + (guarded) route transitions, later units · slice 3 optimistic UI continues
per-surface on payroll-safe surfaces only.
