# Spec 229 — UC2: scoped WP-detail pickers + work-cat badge (ADR 0066 / S8)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decisions **D5 / D8**. This is **session S8**. **Autonomy class: ✅ CODE-ONLY →
AUTO-MERGES on green** (no schema, pure `src/` + tests). **Depends on: S6** (Relation R,
spec 227) + **S5** (work-cat binding UI, spec 226) + **S2** (facets / `kind`, spec 224)
merged.

## Acceptance criteria / Definition of Done (test-first intent)

> Write the **failing Vitest** FIRST. These bullets ARE the red tests.

1. The WP-detail header shows a **work-category badge** (the WP's bound `หมวดงาน`, or the
   empty-state nudge when unbound).
2. The WP-detail **PR-form item picker** is scoped to the WP's work-category via Relation R
   (reuse `ScopedCatalogItemPicker` from spec 228) — **show-all-default with empty-scope
   fallback** (ADR 0066 D8): unbound / unmapped WP → full catalog, never hidden.
3. The **เบิก (issue-stock) picker** is scoped too. **Caveat:** that picker is a plain
   native `<select>` over an `onHand WpStockRow[]` list (NOT the catalog bottom-sheet) — so
   "scope" here means **filter that on-hand list** by Relation R's `(category_id,
kind_filter)`, not swap the component. Empty scope → unfiltered on-hand list.
4. Existing WP-detail + เบิก behaviour stays green.
5. `pnpm lint && pnpm typecheck && pnpm test` green.

## Why (ADR 0066 D5/D8 — operator UC2)

At the WP, both raising a PR and issuing stock (เบิก) happen _in a work-category context_,
so the pickers should surface the relevant materials first. Same Relation R mapping as
UC1, same **never-hide** rule (D8): the WP work-category coverage is sparse today, so the
scope reorders/pre-filters and always falls back to the full set.

## Files the downstream session touches (real anchors)

- `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx` — add the
  work-category badge to the header; pass the WP's resolved `scopedCategoryIds` to the
  PR-form picker.
- `src/components/features/purchasing/catalog-item-picker.tsx` /
  `ScopedCatalogItemPicker` (from spec 228) — reuse for the PR-form picker.
- `src/components/features/store/wp-issue-stock.tsx:22-28,52-89` — the เบิก native
  `<select>` over `onHand WpStockRow[]`. Scope = **filter the on-hand list** by Relation R
  `(category_id, kind_filter)`; keep the native select (do NOT swap to the bottom-sheet).
- `src/lib/catalog/scoped-categories.ts` (spec 227) — the resolver.
- `tests/unit/` — new badge + scoped-PR-picker + scoped-เบิก-filter tests.

## Out of scope

- Any schema change (pure UI on top of S2/S5/S6).
- The supply-plan picker (spec 228) and the read-side cards (spec 230).
- Hiding items/stock by scope (forbidden — show-all-default).

## Verification

- `pnpm lint && pnpm typecheck && pnpm test`.
- Prove: a categorised WP surfaces its work-category's materials first in both the PR form
  and the เบิก select; an uncategorised WP shows the full catalog / full on-hand list and
  the empty-state nudge.
