# Spec 297 — off-category warning in the ขอซื้อ (purchase request) item picker

**Status:** design approved (brainstorm, 2026-07-11). Code-only, no schema.
**Origin:** operator — "materials and equipments can be in more than 1 categories. also, ขอซื้อ can pick from those not in the category (with warnings)."

## Premise (already built — NOT part of this unit)

The two operator clarifications resolved this to a small, additive UI unit:

1. **Materials/equipment in >1 category already exists.** `catalog_items` has a primary
   `category_id` plus a `catalog_item_categories` junction for secondary memberships
   (spec 225); the catalog edit form already offers primary `<Select>` + secondary
   checkboxes, and `add/remove_catalog_item_category` RPCs are live. The ขอซื้อ picker
   already honours secondaries in its in-scope test (`itemCategoryIds` = primary ∪
   secondary). **No category-model change here.** (The `equipment_items` asset registry
   is single-category and out of scope — see below.)
2. **Picking outside the category already works.** The picker fetches the whole active
   catalog; the WP work-category scope only *reorders / soft-filters*. "แสดงทั้งหมด"
   reveals everything and an empty scope falls back to the full catalog. Nothing is
   hidden today.

**The genuine gap:** an off-scope pick is **silent**. In-scope rows get a positive green
"ตรงกับงาน" check; there is no negative counterpart, and the chosen item carries no
warning once the sheet closes. Operator chose a **passive warning** (allow the pick, just
flag it).

## Current mechanics (grounding)

- Scope source: WP work-category → `work_category_material_categories` bridge (Relation R),
  resolved to `scopedCategoryIds` + `membershipsByItem` and passed into the picker.
  `src/lib/catalog/wp-category-scope.ts`, `scoped-categories.ts`.
- Per-item scope test: `scopeCatalogItems` (`src/lib/catalog/scoped-picker.ts:34-67`)
  returns entries each carrying an `inScope` boolean; `scoped`/`inScopeCount` drive
  `scopeActive`. Reusable form-side helper: `itemInCategoryScope`
  (`src/lib/catalog/categories.ts`).
- Picker UI: `ScopedCatalogItemPicker` (`src/components/features/purchasing/catalog-item-picker.tsx`).
  Green in-scope check ~L293-297 (`WORK_CATEGORY_MATCH_LABEL = "ตรงกับงาน"`,
  `src/lib/i18n/labels.ts:86`). Show-all toggle ~L259-267. Scope compute ~L120-128.
- Form: `purchase-request-form.tsx` renders the picker (~L286-295), passing
  `scopedCategoryIds` + `membershipsByItem`; it holds the selected `catalogItemId` and
  renders the chosen-item chip.
- Other picker consumers: supply-plan `draft-row.tsx` (scoped — inherits the row marker),
  `self-purchase-form.tsx` (unscoped — `scopeActive` false, shows nothing).

## Design (approved — approach A, symmetric)

Reuse the scope data already in hand. Zero new data, no schema, no RPC, no PR column.

1. **Picker row marker.** When `scopeActive` and an entry is `!inScope`, render an amber
   "นอกหมวดงาน" pill — the exact mirror of the existing green "ตรงกับงาน" pill (same
   shape, `warning` role tokens). Off-scope thumbnails tint with the warning bg for
   parity (as mocked). When no scope is active (WP has no work-category, empty bridge, or D8 fallback,
   or the unscoped self-purchase form) → **no pills at all**, positive or negative
   (unchanged behaviour).
2. **Selected-item warning.** After a pick, if the chosen item is off-scope
   (`itemInCategoryScope` false while a scope is active), render a non-blocking amber
   strip under the chosen-item chip:
   `วัสดุนี้ไม่อยู่ในหมวดงานของงานนี้ (<work-category name>) — เลือกได้ แต่โปรดตรวจสอบ`.
   Persists after the sheet closes, so both the requester and a later approver reading the
   PR see it. Never blocks submit.
   - **Dependency:** the work-category *name* may not be threaded to the form today (it
     receives `scopedCategoryIds` + `membershipsByItem`, resolved from
     `project_categories(name, work_categories(code))` in `wp-category-scope.ts`). Build
     step: check at HEAD — if the name is not already on a prop, thread it in (small);
     otherwise omit the `(<name>)` clause and keep the bare sentence. No blocker either way.
3. **Show-all toggle label** (minor, approved): the static toggle text becomes
   "แสดงทั้งหมด (นอกหมวดงานด้วย)" for discoverability. Pure copy change.

Multi-category items that match on *any* of their categories read as in-scope → no false
warning. This is exactly why the multi-category premise matters: adding a secondary
category to an item is how a curator makes it "ตรงกับงาน" for more work contexts.

## Files

- `src/lib/i18n/labels.ts` — add `WORK_CATEGORY_MISMATCH_LABEL = "นอกหมวดงาน"` and a
  selected-item warning label (parameterised on the work-category name). Thai via
  Edit/Write (never PowerShell).
- `src/components/features/purchasing/catalog-item-picker.tsx` — off-scope amber pill on
  rows; toggle-label copy.
- `src/components/features/purchasing/purchase-request-form.tsx` — off-scope warning strip
  under the selected-item chip (compute via existing scope props).
- Tests (TDD): picker renders the mismatch pill for an off-scope item and the match pill
  for an in-scope one, and neither when unscoped; form shows/hides the warning strip on
  off-scope / in-scope / no-scope picks.

## Out of scope (flagged)

- **Approver-side enforcement / stored category on the PR.** Category is derived from
  `catalog_item_id`, not stored on `purchase_requests`. The passive warning is recomputed
  at render, not persisted. A hard gate or an approver banner = separate unit.
- **Confirm-gate / required reason** on off-category picks — operator chose passive.
- **`equipment_items` asset-registry multi-category** — single-FK, separate subsystem;
  not touched.
- **Supply-plan chosen-item warning** — the shared picker-row marker already benefits the
  supply-plan grid; a per-row *selected* warning in that grid is deferred.

## Rollout

Code-only, no migration → no schema lane. Ship via the standard unit flow (TDD → build →
fresh-eyes review → PR). Danger-path guard should pass (no admin/money/auth/migration
paths). `labels.ts` is shared SSOT — note the lane.
