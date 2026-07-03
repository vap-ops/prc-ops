# Spec 255 — Schedule calendar: actuals-driven timeline + presentation fixes

**Status:** shipped (PRs #273 + #274, 2026-07-03)
**Depends on:** spec 92 (schedule Gantt), ADR 0004/0009/0015 (photo_logs supersede/tombstone read pattern)
**Schema:** none — code-only.

## Problem

The schedule calendar (`/projects/[projectId]/schedule`, spec 92 Unit D) is dead in
practice. Live audit (2026-07-03): 274 work packages across 3 projects, **1** has
planned dates, 0 dependencies, 1 deliverable; 3 page visits ever (1 user), all on a
project with zero dated WPs — every real visit landed on the empty state. Root
causes:

1. Planned-date entry is per-WP (WP-detail panel, PM/super only) — prohibitive at
   262 WPs; the CSV import (ADR 0014) carries no date columns.
2. Undated WPs render as full 48px filler rows — the one real bar drowns in
   ~12,600px of "ยังไม่กำหนดวันที่".
3. No auto-scroll to today; the viewport opens at the earliest padded month.

Photos are the data PRC actually produces: 36 WPs already carry photo evidence.
This spec makes the calendar self-populate from that evidence and fixes the
presentation. Bulk date entry (rec 3) and real progress fills (rec 4) are
explicitly **out of scope** — follow-up specs if wanted.

## Design

### U1 — activity spans (pure lib + loader)

`src/lib/work-packages/activity-span.ts` (new, pure):

- Input rows: `{ id, work_package_id, storage_path, superseded_by, captured_at_client, created_at }`.
- Current-photo filter per ADR 0009/0015 (mirrors `selectCurrentPhotosByPhase`):
  drop tombstones (`storage_path === null`) and rows whose id appears in any
  other row's `superseded_by` (in-memory anti-join).
- Photo date = Asia/Bangkok calendar date of `captured_at_client ?? created_at`
  via the spec-68 helper in `src/lib/dates.ts`.
- Output: `Map<workPackageId, { firstIso, lastIso }>` (min/max photo date).

`src/lib/projects/load-schedule.ts`: photo_logs query joins the dependent tail
(`.in("work_package_id", wpIds)`, the 6 columns above only), result fed through
the pure helper; loader returns `activitySpans`.

### U2 — timeline scale (pure)

`src/lib/work-packages/gantt-scale.ts`:

- `TimelineItem` gains optional `activityStart` / `activityEnd`; `buildTimeline`
  collects them into the domain so an activity-only project gets a real timeline.
- Activity bar geometry reuses `barFor` (pass activity dates as the window).

### U3 — Gantt component

`src/components/features/work-packages/schedule-gantt.tsx` (+ the schedule page
passes spans through):

- `GanttWp` gains `activityStart` / `activityEnd`.
- **Activity strip:** thin (~6px) rounded, non-interactive `bg-done/70` bar in
  the row — under the planned bar when one exists, alone otherwise. Meaning:
  "ช่วงที่มีงานจริง (จากรูปถ่าย)" — added to the legend.
- **Visibility:** a WP is _on the calendar_ if it has a planned window OR an
  activity span. The empty state shows only when no WP has either; its copy now
  explains photos populate the calendar automatically.
- **Collapse:** rows with neither are hidden by default behind a toggle chip
  "แสดงงานที่ยังไม่มีข้อมูล (N)"; deliverable group headers with zero visible
  WPs hide with them.
- **Auto-scroll to today:** scroll-container ref; on timeline change,
  `scrollLeft = clamp(todayX − (clientWidth − NAME_W)/3)` — today sits ~⅓ in.
- **Summary chips** (pure helper, above the Gantt; zero-count chips hidden):
  - ช้ากว่าแผน N — `planned_end < today`, status ≠ complete
  - ครบกำหนดใน 7 วัน N — `planned_end ∈ [today, today+6]`, status ≠ complete
  - มีงานจริง 7 วันล่าสุด N — `activityEnd ∈ [today−6, today]`

## Units / PRs

- **U1** (PR 1): activity-span lib + loader extension. TDD.
- **U2+U3** (PR 2): gantt-scale domain + component UI. TDD.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green per PR.
- [ ] Activity-span tests cover: supersede chain (A→B→C counts C only),
      tombstone excluded, `captured_at_client` preferred over `created_at`,
      Bangkok date conversion, multi-WP grouping.
- [ ] Component tests cover: strip renders for activity-only WP, empty state
      only when nothing has data, undated rows collapsed + toggle reveals,
      summary chips counts + zero-hide, legend entry present.
- [ ] Live shape: PRC-2026-003 (0 dated, photos exist) shows strips, not the
      empty state; TFM (262 WPs, 1 dated) collapses to data-bearing rows.
