# Spec 113 — Grid health smoke test + visual preview (review all color cases)

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = operator eyeballs the preview).
**Driver:** operator on the spec-112 grid colors: "I only see green — add a smoke test so we can
review all possible cases." Root cause of all-green: the health is **date-driven** (`to_order` needs
`needed_by`, `in_transit` needs `eta`); pilot rows mostly have those null → every row classifies
`on_track` (green). The color wiring is correct — there's just no data exercising late/at_risk.

Two deliverables: an **automated render smoke test** (pins that every health color renders) and a
**temporary visual preview page** (so the operator reviews red/amber/green/grey on the live deploy).

## What ships (app-only, no schema/migration)

- **`tests/unit/procurement-grid-health.test.tsx`** (NEW) — renders `<ProcurementGrid>` with
  synthetic rows hitting every band/health, asserts the four health border colors
  (`border-danger` / `border-attn` / `border-done-strong` / `border-edge`) and the late-ETA
  `text-danger` all appear. Catches a future regression that washes the grid one color.
- **`src/app/grid-preview/page.tsx`** (NEW, **temporary**, public — no auth) — renders the grid
  with crafted rows covering: รอสั่งซื้อ late/at_risk/on_track, กำลังจัดส่ง late/at_risk/on_track,
  ได้รับแล้ว, รออนุมัติ — plus a small legend. A fixed `today` makes the cases deterministic. Marked
  TEMPORARY; deleted after the operator's review (the spec-38 `/design-preview` precedent).

## Why all-green on live (the diagnosis)

`rowHealth` (spec 112) is purely time-driven and takes no priority input. A `to_order` row with no
`needed_by`, or an `in_transit` row with no `eta`, has nothing to be late against → `on_track`. So
real coloring appears once requesters set `needed_by` and procurement/AppSheet set `eta`. The
preview proves the colors work today with dates present.

## Tests

- The new render smoke test + the existing `row-health.test.ts` (14 cases) cover the matrix.
- The preview page is verified live in the preview browser (public page) — screenshot to operator.

## Acceptance

Operator opens `/grid-preview` (or the screenshot): sees red (late-to-order, overdue delivery),
amber (due soon, lands-late), green (on track), grey (awaiting approval) — confirming the design.
Then the page is deleted.

## Seams (recorded)

- The preview page is throwaway; remove after review.
- Real-data coloring depends on `needed_by` / `eta` being populated — if the operator wants more
  rows to color, that's a data-entry prompt (make `needed_by` more prominent on the request form),
  a separate unit.
