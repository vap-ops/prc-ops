# Feature Spec 11: Deliverable-grouped work-package list (SA project screen)

## Status

Locked — 2026-06-11. Operator brief (chat): "WPs are supposed to be grouped
under Deliverables, users can toggle show/hide WPs under each deliverable.
Consider UX/UI."

Consumes spec 04 Phase 1 (the `deliverables` table + `work_packages.
deliverable_id`, live since 2026-05-31, ADR 0016). **Read spec 04 and
ADR 0016 before extending.**

## Data prerequisite (surfaced, not built here)

The live `deliverables` table is **empty** (verified read-only 2026-06-11:
0 rows; 0 of 162 WPs linked). Populating it is spec 04 **Phase 2** (the
importer) — blocked on the operator's real source CSVs, whose deliverable
column names are unknown (the in-repo `data/work-packages-template.csv` is
a 3-column example without them). Until Phase 2 runs, this UI must degrade
to today's flat list — the feature lights up when data lands, with **zero
code changes**.

## Goal

On `/sa/projects/[projectId]`, group the WP list under deliverable
headers. Each header is a show/hide toggle for its WPs. Mobile-first: SA
users scan ~81 rows on a phone today; grouped-and-collapsed turns that
into a handful of deliverable headers with progress summaries.

## Locked behaviour

1. **Pure grouping helper** `src/lib/deliverables/group-work-packages.ts`
   (unit-tested, TDD — the failing test ships first):
   - `groupWorkPackagesByDeliverable(wps, deliverables)` → ordered array
     of `{ deliverable, workPackages }`.
   - Groups ordered by `sort_order` asc, tie-broken by `code` asc.
   - A deliverable with zero (post-filter) WPs does not appear — no empty
     headers.
   - WPs keep their input order within a group (caller orders by code).
   - WPs whose `deliverable_id` is null **or references an id not in the
     deliverables list** fall into a final `deliverable: null` group
     ("Ungrouped"), rendered last, only when non-empty. (Mirrors spec 04
     Phase 3's PDF bucket rule.)
2. **Component** (`work-package-list.tsx`, reworked in place):
   - New props: each WP carries `deliverableId`; the page passes the
     project's `deliverables` (id, code, name, sortOrder).
   - **Zero deliverables ⇒ the exact current flat list.** No "Ungrouped"
     header noise; today's behaviour is the degraded mode.
   - Grouped mode: each group renders a full-width header **button**
     (chevron + `D01 · name`, right-aligned `n WPs` count and, when > 0,
     `k complete`), `aria-expanded`, ≥44px touch target. Tapping toggles
     that group's WP rows. Row markup inside groups is unchanged.
   - **Default: all groups collapsed** — the landing view is the
     deliverable overview.
   - **Text filter wins over collapse:** while a query is active, groups
     containing matches render expanded (collapse state ignored, not
     mutated); groups without matches drop out (empty groups never
     render). Clearing the query restores the user's collapse state.
   - "Hide completed" composes as today: hidden WPs leave their group;
     a group emptied by the toggle disappears.
   - Existing filter bar, empty-state messages, status pills: unchanged.
3. **Server page** `/sa/projects/[projectId]/page.tsx`:
   - WP select gains `deliverable_id`; new query fetches the project's
     deliverables ordered by `sort_order` (RLS already admits sa/pm/super
     SELECT per spec 04 Phase 1).
4. **PM queue untouched.** `/pm` lists only pending-approval WPs — short
   by nature; grouping is not requested there.

## TDD plan (test first — state "Writing failing test first")

`tests/unit/group-work-packages.test.ts`:

- empty WP list → `[]` (with and without deliverables).
- no deliverables → one `null` group carrying all WPs.
- groups ordered by `sort_order` regardless of input order; tie → `code`.
- WP input order preserved within a group.
- deliverable with no WPs omitted.
- null `deliverable_id` → Ungrouped last; unknown `deliverable_id` →
  Ungrouped; no Ungrouped group when every WP is linked.
- generic passthrough: extra WP fields survive grouping untouched.

Component/page are `"use client"` + Server Component wiring — not
component-tested (no harness precedent; P1b posture).

## Verification checklist

- [ ] New unit test fails before the helper exists, passes after.
- [ ] `pnpm lint` / `pnpm typecheck` clean; full `pnpm test` green.
- [ ] With 0 deliverables (today's live state): rendered output is the
      current flat list.
- [ ] With seeded deliverables (unit-test level): groups ordered, collapse
      toggles, search force-expands, hide-completed drops emptied groups.
- [ ] No diff under `supabase/` (schema already live — no migration).

## Scope — out (record; do not build)

- **Spec 04 Phase 2 (deliverables importer / WP backfill)** — blocked on
  the operator's real CSV header; own mini-spec when known.
- Phase 3 (PDF grouping), expand-all/collapse-all control, persisting
  collapse state (URL or storage), deliverable admin UI, PM-side grouping.
