# Spec 228 — UC1: scoped supply-plan item picker (ADR 0066 / S7)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decisions **D5 / D8**. This is **session S7**. **Autonomy class: ✅ CODE-ONLY →
AUTO-MERGES on green** (no schema, pure `src/` + tests; danger-path guard passes).
**Depends on: S6** (Relation R, spec 227) merged.

## Acceptance criteria / Definition of Done (test-first intent)

> Write the **failing Vitest** FIRST. These bullets ARE the red tests.

1. `CatalogItemPicker` is refactored into a `ScopedCatalogItemPicker` accepting an
   **optional** `scopedCategoryIds` (plus, optionally, the `kind_filter` from Relation R).
   When provided, the picker **pre-filters / surfaces-first** the items in those material
   categories.
2. **Show-all-default with empty-Relation-R fallback (MANDATORY, ADR 0066 D8):** when
   `scopedCategoryIds` is **empty or undefined** (the work-category is unmapped, or the row
   has no WP / no reconciled work-category), the picker shows the **full catalog** — it
   **never hides** items. The scope reorders/pre-filters; it is never a gate. A failing
   Vitest pins: empty scope → full catalog rendered.
3. The supply-plan grid wires each row's picker to **that row's WP's work-category via
   Relation R**: row WP → its project category → reconciled `work_category_id` →
   `work_category_material_categories` → `scopedCategoryIds`. A whole-project row
   (`ทั้งโครงการ`, no WP) → no scope → full catalog.
4. Existing supply-plan grid behaviour (single WP, multi-WP fan-out spec 222, save,
   convert) stays green.
5. `pnpm lint && pnpm typecheck && pnpm test` green.

## Why (ADR 0066 D5/D8 — operator UC1)

When a planner builds a แผนจัดหา row whose WP carries a work-category, the item picker
should surface the materials that work-category actually buys first. Relation R (spec 227)
provides the mapping. But almost no WPs are categorised yet and Relation R may be empty for
a given work-category, so the picker **must default to showing everything** — a hiding
picker would be an adoption dead-end (D8).

## Files the downstream session touches (real anchors)

- `src/components/features/purchasing/catalog-item-picker.tsx` — props at **:59-78**, the
  filter at **:89-102**. Refactor into `ScopedCatalogItemPicker` with the optional
  `scopedCategoryIds` (+ `kind_filter`) and the show-all fallback. Keep the existing
  bottom-sheet UX.
- `src/components/features/purchasing/supply-plan-manager.tsx:456-464` — the row→picker
  wiring; pass the row WP's resolved `scopedCategoryIds`.
- `src/lib/catalog/scoped-categories.ts` (from spec 227) — the
  `(work_category_id) → [(category_id, kind_filter)]` resolver; call it to build
  `scopedCategoryIds`.
- `tests/unit/` — new picker-scope + grid-wiring tests.

## Out of scope

- Any schema change (S7 is pure UI; Relation R already exists from S6).
- The WP-detail pickers (spec 229) and the read-side cards (spec 230).
- Hiding items by scope (explicitly forbidden — show-all-default).

## Verification

- `pnpm lint && pnpm typecheck && pnpm test`.
- Prove: a row on a WP whose work-category maps to material-categories {A,B} surfaces A/B
  items first but still lets you reach the rest; a whole-project row shows the full catalog.
