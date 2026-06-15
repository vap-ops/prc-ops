# Spec 109 — Procurement record-review sidesheet (Airtable arc, phase 2)

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user tablet/PC).
**Driver:** spec 108 shipped the desktop grid (phase 1). Phase 2 is the **sidesheet**: on
tablet/PC, clicking a grid row opens a **right-side drawer** with that purchase record +
prev/next to step through records without leaving the grid — Airtable's grid + expand pattern.
**Approach (operator-picked, 2026-06-15): (b) light read-only review drawer.** Record detail
(facts / supplier / amount / status stepper) + prev/next; a **ดำเนินการ →** button links to
`/requests/[id]` to act. No intercepting/parallel routes — a client drawer fed by data the grid
already has. (Approach (a), full action zones inside an `@modal` intercepting route, was the
bigger alternative; deferred.)

## What ships (app-only, no schema/migration)

- **`src/lib/purchasing/grid-record-nav.ts`** (NEW, pure) —
  - `flattenRecordOrder(groups)` → the banded groups flattened to one ordered list, matching the
    grid's top-to-bottom reading order, so prev/next steps exactly as the rows appear.
  - `adjacentRecordIds(order, currentId)` → `{ prevId, nextId, index, total }`, **non-wrapping**
    (null at the ends — mirrors the lightbox nav, spec 50). `index = -1` when the id is absent.
- **`src/components/features/bottom-sheet.tsx`** — add an optional `side?: "bottom" | "right"`
  prop (default `"bottom"`, fully back-compatible with the spec-78 callers). `"right"` slides a
  full-height panel in from the right (`.sheet-panel-right` keyframe, reduced-motion-gated) — the
  same scrim / Escape / scrim-click / portal-to-body / focus-on-open shell.
- **`src/app/globals.css`** — `@keyframes sheet-in-right` + `.sheet-panel-right` (motion-opt-in,
  matching the spec-78 `.sheet-panel` pattern).
- **`src/components/features/procurement-grid.tsx`** — now the **interactive grid** (`"use client"`):
  renders the same dense banded table, but the item cell is a **button** that opens the review
  drawer for that record (selected row highlighted); the drawer carries the record detail + a
  persistent top bar with **‹ ก่อนหน้า / ถัดไป ›** + an `n / total` counter + **ดำเนินการ →**
  (links to `/requests/[id]`). Reuses `PurchaseRequestTracker` for the status stepper (hidden for
  `site_purchased`, mirroring the detail page), `purchaseRequestStatusPillClasses` /
  `purchaseRequestPriorityPillClasses`, `PURCHASE_REQUEST_STATUS_LABEL` /
  `PURCHASE_REQUEST_PRIORITY_LABEL`.
- **`src/app/requests/page.tsx`** — for the procurement branch, build serializable
  `ProcurementGridRecord[]` groups (each row enriched with `wp_code` / `wp_name` from `wpById` and
  `amount` from `amountById`) and pass them to `<ProcurementGrid groups={...} />`. The old function
  props (`wpName` / `amount`) are gone — a client component can't take server closures, so the data
  is baked into the (serializable) rows.

## Scope

- **IN:** desktop-only (the grid is `hidden lg:block`); the row→drawer review + prev/next; the
  ดำเนินการ → deep link to the existing detail page.
- **OUT:** the phone card pipeline (spec 104) and the WP-detail flows stay byte-unchanged. No
  action zones inside the drawer (that is approach (a) / a later spec). No intercepting routes,
  no URL change on open, no schema change.

## Money posture

Unchanged from spec 106/108: `amount` is money, read once via the admin client **gated to the
procurement branch** (`if (isProcurement)`), never for SA/PM, no authenticated grant added. The
amount is only baked into rows inside that branch; the grid renders only there.

## Tests

- **TDD:** `tests/unit/grid-record-nav.test.ts` first (RED) — flatten order across bands, prev/next
  adjacency, non-wrapping ends, absent id → index -1, single/empty.
- The grid + drawer are presentational/interactive over already-tested data → verified by checklist
  - the pure-helper tests, same convention as the spec-104/108 sections.

## Acceptance

Procurement user on a PC: click a grid row → the right drawer opens with that record (facts,
supplier, amount, status stepper); **‹ / ›** steps through the records in grid order without
leaving the grid; **ดำเนินการ →** opens `/requests/[id]` to act. SA/PM screens and the phone
pipeline unchanged.

## Seams (recorded)

- **Approach (a)** — action zones inside the drawer via an `@modal` intercepting route (URL
  updates, refresh deep-links) — deferred; the routing research (Next 16 intercepting + parallel
  routes) is owed before it.
- Keyboard arrow-key prev/next, swipe-to-dismiss, a full tab-trap — recorded (the BottomSheet
  primitive's focus-trap seam carries over).
- Grid columns still fixed (no user sort/column-pick).
