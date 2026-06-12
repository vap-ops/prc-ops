# Spec 56 — WP list: status filter rework, search removed

**Status:** complete (2026-06-13) — operator eye on deploy = acceptance
**Date:** 2026-06-13
**Origin:** operator screenshot feedback 2026-06-13: "the default should
be that it hides the finished WPs. Should there be more items to pick
though? also, we don't need search feature on WP list."

## Scope

`/sa/projects/[projectId]` list controls (work-package-list.tsx) only.

1. **Search input REMOVED** (operator call). The `searching`
   force-expand behaviour and query-dependent empty copy go with it.
2. **Hide-completed checkbox → 4-view segmented control** (the spec-21
   urgency-control shape), answering the operator's "more items to
   pick" question:
   - **งานค้าง** (default) — everything not `complete`
     (not_started / in_progress / on_hold / pending_approval).
     Default = the operator's "hide finished by default".
   - **รอตรวจ** — `pending_approval` only (what's waiting on the PM).
   - **เสร็จแล้ว** — `complete` only.
   - **ทั้งหมด** — no filter.
3. New pure helper `src/lib/work-packages/list-filter.ts`:
   `WP_LIST_VIEWS` + `filterByView(workPackages, view)` — unit-tested;
   the component maps over it.
4. Group headers keep deriving progress from the UNFILTERED list
   (spec 12 truth rule); groups emptied by the view disappear (existing
   helper semantics); collapse state untouched.
5. Empty copy: no WPs at all → ยังไม่มีรายการงาน; view งานค้าง with every
   WP complete → รายการงานทั้งหมดเสร็จสิ้นแล้ว; otherwise
   ไม่พบรายการงานที่ตรงกับเงื่อนไข.

## Recorded decisions

- Local client state only (no URL param) — same posture as the controls
  it replaces.
- View definitions live in the pure helper so the PM-side reuse (if a
  PM list round wants them) imports, not copies.

## Tests (failing first)

- `tests/unit/wp-list-filter.test.ts` — filterByView over all 5
  statuses × 4 views; default view constant pinned to งานค้าง.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Operator: open the project list — finished WPs hidden by default,
   four filter choices, no search box.
