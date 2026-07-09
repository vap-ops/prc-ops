# Spec 289 — WP-detail query cleanup (perf)

**Status:** APPROVED (operator go 2026-07-10, perf lane — follows specs 241/242/243)
**Type:** perf refactor, behavior-preserving. Code-only, NO schema.
**Route:** `/projects/[projectId]/work-packages/[workPackageId]` — the app's heaviest,
highest-traffic route (Vercel CPU rank 1; 30 DB reads on the planner leaf path as of
main `1e3d5021`, re-verified 2026-07-10).

## Problem

The leaf render runs ~30 DB reads. The big `Promise.all` fan (spec 147) is good, but:

1. **A 5-stage serial tail runs AFTER the batch** — uploader display-names,
   catalog thumbnail signing, WP-category resolve, scoped-category resolve, and
   catalog-item memberships each await in sequence (page.tsx:356–444). Each stage
   is one full client→DB round trip (~30ms+ each from TH → sin1, more under load).
2. **Two duplicate reads per render:** `contractors` is read by BOTH
   `load-detail.ts:143` (superset columns) and `fetch-zone-data.ts:30` (id+name);
   `workers` is read by BOTH `fetch-zone-data.ts:24` (superset, unfiltered) and
   `page.tsx:228` (project-filtered id+name).
3. **Two `users` display-name reads** where one suffices: load-detail's tail resolves
   approval/request actor names; the page then serially resolves photo-uploader
   names with a second `fetchDisplayNames` call.
4. `fetchWpLaborBudgetSummary` awaits `labor_logs` then `wp_economics` serially;
   the two reads are independent (both keyed on `work_package_id` only).

## Contract (binding)

Behavior-preserving: same tables, same column lists, same filters, same rendered
output for every role. Only scheduling and deduplication change. No RLS posture
change — every read keeps its current client (user vs admin).

## Units

### U1 — page serial-tail fold + users-read merge (code-only lane, auto-merge path)

Files: `page.tsx` (WP detail), `src/lib/work-packages/load-detail.ts`,
new helper `src/lib/catalog/wp-category-scope.ts`.

- Add `category_id` to the `pre` read's select (page.tsx:118) so the category
  chain no longer waits on the batch's `wp` row.
- New helper `loadWpCategoryScope(supabase, categoryId | null)` →
  `{ workCategoryName, workCategoryCode, scopedRelation }`; internally
  `project_categories` read → chained `resolveScopedCategories` (unavoidable
  2-deep dependency, but it now overlaps the batch). Rides the big `Promise.all`.
- Move `loadCatalogItemMemberships(supabase)` (independent) into the batch.
- Chain `mintSignedUrls` onto the `catalog_items` read INSIDE the batch
  (`.then(...)`) so thumbnail signing overlaps the other reads.
- Merge photo-uploader ids into load-detail's existing tail `fetchDisplayNames`
  call (union with approval/request actor ids); page drops its own serial
  `fetchDisplayNames` and reads `data.displayNames`. One `users` read total.
- Result: post-batch serial round trips 5 → 0; reads 30 → 29.

### U2 — labor-path dedupe (danger-path: `src/lib/labor/` — operator-held PR)

Files: `src/lib/labor/fetch-zone-data.ts`, `src/lib/labor/wp-budget-summary.ts`,
`src/lib/work-packages/load-detail.ts`, `page.tsx`.

- `fetchLaborZoneData` gains an optional `contractorsPromise` param; when
  provided it awaits that instead of issuing its own `contractors` read.
  `load-detail.ts` creates ONE contractors promise (superset columns) and shares
  it. The `/review/work-packages/[id]` caller passes nothing — unchanged.
- `fetchLaborZoneData` additionally returns `projectWorkers: {id, name}[]`
  (the same active+project filter it already computes for `projectWorkerIds`,
  name order preserved from the read). Page drops its own `workers` read
  (page.tsx:228) and uses `data.labor.projectWorkers`.
- `fetchWpLaborBudgetSummary`: `labor_logs` + `wp_economics` reads →
  one `Promise.all`.
- Result: reads 29 → 27; budget pair 2 serial → 1 parallel stage.

## Verification checklist

- [ ] U1/U2 RED tests seen failing first (vitest).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] Browser real-flow: open a leaf WP detail as dev-preview (super_admin) —
      photos render with uploader names, catalog picker thumbnails load,
      category badge + scoped pickers correct, เบิก receiver picker lists
      project workers, จัดการ tab budget renders. Zero console errors.
- [ ] Reviewer subagent pass on the full diff.
