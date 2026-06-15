# Spec 110 — Procurement worklist filters + priority sort

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user PC/phone).
**Driver:** operator asked "should the purchasing team get filters, and what?" → bands already
cover **stage** (spec 104), so filters target the cross-cutting slices the bands can't express.
Operator picked **all four**: by supplier · by project · overdue-only · priority sort.

## What ships (app-only, no schema/migration)

Filtering is **server-side via URL params** (the `?mine` / spec-56 segmented-control pattern), so
it filters the shared `myRequests` set → **both** the phone card pipeline (spec 104) **and** the
desktop grid (spec 108/109) get it, and the view is deep-linkable. Procurement branch only —
SA/PM keep the flat list with no filter UI.

- **`src/lib/purchasing/worklist-filter.ts`** (NEW, pure) —
  - `matchesProcurementFilter(row, filter, todayIso)` — AND-composes the three filters. `supplier`
    (exact text, null = all), `projectId` (null = all), `overdue` (in-transit band AND `eta < today`).
  - `sortByPriority(items)` — stable sort, critical → urgent → normal (same-priority order
    preserved). Applied **within each band** after grouping.
  - `distinctSuppliers(rows)` / `distinctProjects(rows)` — sorted, de-duped picker options, built
    from the **unfiltered** set so you can always change the filter.
  - `buildWorklistQuery({supplier, projectId, overdue})` — serializes to `/requests?…` (drops
    empties); shared by the server-rendered overdue tile and the client `<select>`s so the controls
    compose (changing one preserves the others).
- **`src/lib/purchasing/pending-order.ts`** — export `PR_PRIORITY_RANK` (was private) so the new
  sort reuses the one rank; `comparePendingRequests` now references it (no behaviour change).
- **`src/components/features/procurement-filters.tsx`** (NEW, `"use client"`) — supplier + project
  `<select>`s + a ล้างตัวกรอง (clear) button; `onChange` → `router.push(buildWorklistQuery(...))`.
- **`src/app/requests/page.tsx`** — procurement branch: parse `supplier` / `project` / `overdue`
  params; fetch `projects(id,name)` for the WPs' projects (RLS admits procurement, spec 102 — no
  migration); attach `projectId`/`projectName` to rows; filter `myRequests`; band + `sortByPriority`
  the result. The **summary strip (105/106) stays on the unfiltered set** (full-workload glance);
  the **เกินกำหนด tile becomes the overdue toggle** (a Link via `buildWorklistQuery`, pressed when
  active). Empty-after-filter shows a distinct "no results for this filter" notice.
- **`BuyerStat`** — optional `href` + `active` (renders as a Link toggle when given).

## Money posture

Unchanged. Overdue uses status + eta (no money). Supplier/project are non-money. The ค้างจ่าย
tile stays a read-only money glance (not a filter). `amount` admin read stays gated to the
procurement branch; computed on the unfiltered set (tiles stable), grid reads the filtered subset.

## Tests

- **TDD:** `tests/unit/worklist-filter.test.ts` first (RED) — filter AND-composition + each axis,
  overdue boundary (`eta == today` not overdue), stable priority sort (critical first, ties keep
  order), distinct/sorted options, query serialization (drops empties, composes).
- The filter bar + tile toggle are thin UI over tested helpers → verified by checklist (the
  spec-104/108/109 convention).

## Acceptance

Procurement user (PC or phone): pick a supplier → only that vendor's POs (still banded); pick a
project → only that site; tap เกินกำหนด → only late in-transit POs; within every band the critical
items sit on top; ล้างตัวกรอง resets; the URL carries the filter (refresh/share keeps it). SA/PM
screens unchanged.

## Seams (recorded)

- Filters are single-select per axis (one supplier / one project). Multi-select + a saved-view
  ("my chase list") are later steps.
- Other summary tiles (รอสั่งซื้อ / กำลังจัดส่ง) stay glance-only — only เกินกำหนด is a toggle.
- Priority sort is default-on (no toggle back to oldest-first); a sort picker is a later lever.
