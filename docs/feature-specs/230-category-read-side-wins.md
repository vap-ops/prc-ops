# Spec 230 — Read-side wins: spend-by-category card + procurement filter chip + catalog badge (ADR 0066 / S9)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md),
decision **D4**. This is **session S9**. **Autonomy class: ✅ CODE-ONLY → AUTO-MERGES on
green** (no schema, pure `src/` + tests). **Depends on: S5** (work-cat library + binding,
spec 226) merged.

> **Three DISJOINT files — parallelizable in separate worktrees.** The three deliverables
> touch non-overlapping files, different domains, no shared SSOT — so per
> [[safe-parallel-sessions]] they MAY run as three concurrent code-only lanes (or one
> session, sequentially). If parallelized: one worktree each, distinct branches, append
> each lane to LANES.md. None touch schema.

## Acceptance criteria / Definition of Done (test-first intent)

> Write the **failing Vitest** FIRST per deliverable. These bullets ARE the red tests.

1. **Spend-by-category card** — a `/dashboard` card breaking spend down by work-category
   (or material category, per the chosen lens), built purely from existing reads. Pure
   helper in `src/lib/dashboard/spend.ts`, unit-tested; no double-count (respect the
   existing [[prc-ops-dashboard-spend-model]] disjointness invariants — net like
   `wp_profit`).
2. **Procurement grid category filter chip + badge** — a category facet chip + a per-row
   category badge on the procurement grid, filtering ROWS only (counts unchanged), in
   `src/components/features/purchasing/procurement-grid.tsx`.
3. **Catalog row category badge** — a category badge on `/catalog` rows via the shared
   `src/lib/catalog/categories.ts` reader (reuse `loadCatalogCategories`; do not re-roll).
4. Each deliverable's existing tests stay green.
5. `pnpm lint && pnpm typecheck && pnpm test` green.

## Why (ADR 0066 D4)

Once work/material categories are first-class and bilingual (S5), the cheapest user-visible
wins are **read-side**: surfacing the category on the dashboard, the procurement grid, and
the catalog. No schema, no risk — pure display over data that now exists.

## Files the downstream session touches (real anchors — disjoint)

- `src/lib/dashboard/spend.ts` — spend-by-category helper (+ a `/dashboard` card consumer).
- `src/components/features/purchasing/procurement-grid.tsx` — category filter chip + badge.
- `src/lib/catalog/categories.ts` — the shared category reader feeding a `/catalog` row
  badge (consumer in the catalog list component).
- `tests/unit/` — one test file per deliverable.

## Out of scope

- Any schema change (pure read-side).
- The scoped pickers (specs 228/229) and the estimate layer (spec 231).
- Changing the dashboard spend math beyond adding a category breakdown (respect the
  disjointness/returns-netting invariants — no double-count).

## Verification

- `pnpm lint && pnpm typecheck && pnpm test`.
- Prove each: the dashboard card sums correctly without double-count; the procurement chip
  filters rows but not counts; the catalog badge renders the category name.
