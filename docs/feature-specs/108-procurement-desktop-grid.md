# Spec 108 — Procurement desktop grid worklist (Airtable arc, phase 1)

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user tablet/PC).
**Driver:** "record review on bigger screens" → researched Airtable (grid + sidesheet) → operator
approved the mockup → build it phased. **Phase 1 = the grid.** Phase 2 (sidesheet + prev/next) = spec 109.

## What ships (app-only)

- **`src/components/features/procurement-grid.tsx`** — presentational server component: a dense table
  of purchase records grouped by pipeline band (spec 104), columns `รายการ (item + PR# + WP) · ผู้ขาย ·
สถานะ/ETA · จำนวนเงิน`. Item cell links to the record detail (`/requests/[id]`); status via the
  existing `purchaseRequestStatusPillClasses` + `PURCHASE_REQUEST_STATUS_LABEL`.
- **`/requests/page.tsx`** — for procurement, responsive split: the spec-104 **card pipeline on phone**
  (`lg:hidden`) and the **grid on tablet/PC** (`hidden lg:block`); the summary strip (105/106) sits
  above both. The amount admin read now covers **all** visible rows → an `amountById` map feeding both
  the grid's จำนวนเงิน column and the ค้างจ่าย tile (one read, procurement-gated).

## Money posture

Unchanged: `amount` admin read is gated to the procurement branch (`if (isProcurement)`); never runs
for SA/PM; no authenticated grant added. The grid only renders inside that branch.

## Tests

- Reuses pure helpers already tested (`groupByProcurementBand`, `sumOutstanding`). The grid is
  presentational → verified-by-checklist (same convention as the spec-104 card sections).
- 780 unit / lint / typecheck / build green.

## Seams (recorded)

- **Phase 2 (spec 109):** click a row → sidesheet drawer with the record detail + action zones +
  prev/next (the Airtable expand). Today the grid's item cell links to `/requests/[id]` (full nav).
- Grid columns are fixed (no user sort/column-pick yet); a sortable/configurable grid is a later step.
- WP subline shows the WP name only (project name would need an extra fetch).
