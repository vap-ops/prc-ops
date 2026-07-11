# Spec 293 — WP search on the project work-list (type-to-find)

**Status:** ✅ U1 SHIPPED (2026-07-11). From feedback `ca5c871b` (procurement_manager).
**Type:** feature, code-only (no schema, no server round-trip). **Class:** small.

## Problem

A project with 288+ งาน forces the user to scroll the work-list (`รายการงาน`) to
find one WP. Reporter (จัดซื้อ) wants a type-to-search box. Screenshot pins the
target: the empty strip next to the "ต้องทำเลย 288" header.

## Surface

`src/app/projects/[projectId]/work-package-list.tsx` — client component, all WPs
already in-memory (`workPackages` prop → `roster.leaves`), three lenses
(ตามงาน / ตามสถานะ / ตามงวดงาน). Search-input idiom reused: `FIELD_INPUT`
(`src/lib/ui/classes.ts`) + lucide `Search`, mirroring `catalog-item-picker`.

## Design decisions

1. **Placement** — ONE search input at the top of the component, ABOVE the lens
   toggle, persistent across lens switches. Not per-lens.
2. **What it matches** — WP **code** (`WP-01-07`) + **name**, case-insensitive
   substring. The two visible identifiers.
3. **Behavior when query is non-empty** — collapse the lens grouping (+ its
   toggle) and render a **flat filtered list** of matching leaves (WorklistRow),
   ordered by `priorityRank` ascending. "Find the one I need" wants a direct hit
   list, not hunting inside collapsed งาน/งวด sections. Empty query → normal lens
   behavior, untouched. Groups (`isGroup`) always excluded.
4. **Scale** — ~331 rows in-memory → no debounce/virtualization. Clear (✕)
   button. Empty state: "ไม่พบงานย่อยที่ตรงกับคำค้น".
5. **Roles** — lives on the shared work-list → every role that sees it. No gating.

## Unit

- **U1 (code-only, DONE):** pure `filterWorkPackages(leaves, query)` helper
  (`src/lib/work-packages/filter-work-packages.ts`) + `WorklistSearch` input
  wired into `WorkPackageList`. TDD: `tests/unit/filter-work-packages.test.ts`
  (matches code, matches name, case-insensitive, trims, blank = no filter,
  priority order, excludes groups, no-match empty). Browser-verified at phone
  width on PRC-2026-004.

## Out of scope (v1)

Search across category/status/contractor; server-side / cross-project search;
fuzzy matching; recent-search memory.
