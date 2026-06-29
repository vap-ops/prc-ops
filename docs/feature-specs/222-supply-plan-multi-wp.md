# Spec 222 — Supply plan: one item into multiple work packages

## Problem

When procurement (or a PM) builds a **แผนจัดหา** (supply plan) in the inline grid
(`SupplyPlanManager`, spec 181 U2), each row is one catalog item allocated to **one**
work package (or `ทั้งโครงการ` = whole project / no WP). To plan the same material
across several WPs the planner must re-pick the same item once per WP — tedious, and
the item picker is a bottom-sheet, so it's several taps each time.

Operator (2026-06-29): _"When procurement creates a แผนจัดหา, we don't want to force
the user to pick a WP, but they can pick multiple WPs per item if they want to."_

Two asks:

1. **WP must not be forced.** _Already satisfied_ — the row's WP `<select>` defaults to
   `ทั้งโครงการ` (`work_package_id` null = whole-project line), and save only requires
   item + positive qty (`supply-plan-manager.tsx`). No change needed; covered here only
   so the spec records it.
2. **One item → many WPs in one go.** New. This spec.

## Decision

Operator picked the **"just pre-fill rows"** model (over per-WP qty nested in one row,
or one qty fanned to all): picking N WPs for an item **spawns N independent draft rows**,
each pre-filled with that item + one WP and a **blank qty**, which the planner then fills.
Quantities differ per WP in practice, so each WP gets its own row + qty.

This needs **no schema and no RPC change**: a supply plan line is already
`(plan, item, WP)` with a per-`(plan,item,WP)` unique index, `work_package_id` nullable,
and `bulkAddPlanLines` / `add_supply_plan_lines` already take a per-line nullable WP and
insert an array atomically. The whole change is client-side in `SupplyPlanManager`.

## U1 — multi-WP fan-out in the grid (code-only, `'use client'`)

Keep the per-row single WP `<select>` (the single / whole-project path; existing
behaviour and tests unchanged). Add, per editable row, a secondary affordance:

- A **`＋ หลายงาน`** button, **always tappable** (only `saving` disables it). Item-first
  is still the logical order (you fan out an item), but the button must never sit greyed —
  a disabled link read as "broken / can't pick multiple WP" (operator, 2026-06-29). So the
  requirement moved to the confirm step (below) instead of disabling the opener.
- Clicking it opens an **inline checklist** of the project's work packages (a checkbox
  per WP, code + name). If the row has no item yet, the panel shows the hint
  _"เลือกวัสดุของแถวนี้ก่อน เพื่อกระจายไปยังงานที่เลือก"_ and the confirm stays disabled
  until an item is picked.
- The planner ticks ≥1 WP and confirms (`เพิ่ม (N)`). The row is **replaced** by one
  draft row per ticked WP: same `catalogItemId`, `workPackageId` = that WP, **qty blank**,
  note blank. Ticking 0 and confirming is a no-op (closes the panel, row unchanged).
- The planner fills each row's qty, then **บันทึก** saves them in the existing one
  bulk write (`bulkAddPlanLines`). One line per `(item, WP)`; the unique index still
  guards true duplicates.

Pure helper `expandRowToWorkPackages(row, wpIds)` holds the fan-out so it's unit-tested
directly; the grid splices its result in place of the source row.

### Out of scope

- Per-WP qty entered inside a single row (rejected in favour of pre-fill rows).
- Any change to the convert-to-PR step, lifecycle, schema, or RPCs.
- Touching `labels.ts` — the grid uses inline Thai strings; stay consistent.

## Verification

- New unit test in `tests/unit/supply-plan-manager.test.tsx`: pick an item, open
  `หลายงาน`, tick 2 WPs, confirm → 2 rows pre-filled with that item + each WP, qty blank;
  fill both quantities; save → `bulkAddPlanLines` called with the 2 lines.
- Pure-helper test for `expandRowToWorkPackages` (0 WPs → unchanged; N WPs → N rows).
- Existing grid tests (single WP, whole-project null, add-row, remove, lifecycle,
  convert) stay green.
- `pnpm lint && pnpm typecheck && pnpm test`.
