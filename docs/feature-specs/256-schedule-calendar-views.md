# Spec 256 — Real calendar views: วัน / สัปดาห์ / เดือน as true views, Gantt becomes ไทม์ไลน์

**Status:** in progress
**Depends on:** spec 255 (photo-evidence activity plumbing), spec 92 (Gantt), ADR 0004/0009/0015
**Schema:** none — code-only.

## Problem

Operator feedback on the spec-255 schedule page: "day week month are just shrinking
and expanding, not helpful." Correct — the วัน/สัปดาห์/เดือน switch only changes
`dayWidth` (44/16/5 px per day) in `gantt-scale.ts`. The labels promise
calendar-app semantics; they deliver zoom. Operator chose: build real calendar
views (option 2).

## Design

The schedule page gains a view switch — **เดือน | สัปดาห์ | วัน | ไทม์ไลน์** — first
three are genuine calendar views fed by the spec-255 photo-evidence data plus
planned dates; ไทม์ไลน์ is the existing Gantt unchanged except an honest zoom
relabel. Selected-date state lives in the container, defaults to `todayISO`.

### View semantics

- **เดือน (default):** month grid, Sunday-first (Thai wall-calendar convention),
  BE header (e.g. "ก.ค. 2569"), ‹ › month nav + วันนี้ jump. Day cell: day number,
  activity dot + count of WPs with photos that day, due marker (planned_end that
  day; danger-styled when overdue+incomplete), today ring, weekend/out-of-month
  muting. Tap day → วัน view at that date.
- **สัปดาห์:** vertical 7-day agenda (อา–ส) for the week containing the selected
  date, ‹ › week nav. Day rows: date header (today highlighted) + compact WP
  chips (active-that-day w/ photo count, due-that-day). Empty day = thin row.
- **วัน:** single-day agenda, ‹ › day nav + วันนี้. Sections hidden when empty:
  **มีงานจริง** (WPs with photos that day + count, links to WP detail via
  `workPackageHref` + `withBackFrom`), **ครบกำหนดวันนี้** (planned_end = date),
  **เริ่มตามแผน** (planned_start = date). All empty → one empty-state line.
- **ไทม์ไลน์:** existing `ScheduleGantt`; its internal period toggle relabels to
  zoom-honest **ใกล้ / กลาง / ไกล** (aria-label "ซูม"). Nothing else changes.

### Data (pure, reuses spec-255 plumbing)

- `src/lib/work-packages/activity-days.ts` (new): same minimal photo-row input as
  `activity-span.ts`; current-photo filter (tombstone + anti-join) extracted into
  a shared predicate used by both; date = `bangkokDateOf(captured_at_client ??
created_at)`; output `Map<isoDate, Map<wpId, photoCount>>`.
- `src/lib/work-packages/calendar-grid.ts` (new): `monthGrid(anchorIso)` →
  Sunday-first weeks/cells `{iso, day, inMonth, isWeekend}` + BE month label;
  `weekOf(anchorIso)` → 7 ISO dates; `addDaysIso` / `addMonthsIso` nav; Thai
  weekday constants (อา–ส); `THAI_MONTHS` exported from gantt-scale (no copy).
  Same UTC-ms date math as gantt-scale.
- Loader `load-schedule.ts`: the already-fetched photo rows also feed
  `activityDays()`; returned alongside `activitySpans`. Zero new queries.

### Components

- `schedule-views.tsx` (new client container): view radiogroup (styling of the
  existing pill toggle), selected-date state, renders the three calendar views or
  `ScheduleGantt`. `activityDays` crosses the RSC boundary as a plain object
  (`Record<isoDate, Record<wpId, count>>`) — page converts.
- `schedule-month-view.tsx` (new) + `schedule-agenda.tsx` (new; week = 7 stacked
  day sections, day = one expanded). Field-First tokens only; ≥44px touch
  targets.
- `schedule/page.tsx`: renders `ScheduleViews`; passes the plain-object
  activity-days map.

### Out of scope

Drag-to-reschedule, per-day labor/money data, holiday calendars beyond weekend
shading, bulk date editor (declined 2026-07-03, decision stands).

## Units / PRs

- **U1** (PR 1): pure libs + zoom relabel + loader. TDD.
- **U2** (PR 2): components + page wiring. TDD.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green per PR.
- [ ] activity-days tests: per-day counting, multi-photo day, supersede chain,
      tombstone, Bangkok dateline crossing.
- [ ] calendar-grid tests: Sunday-first month shape, BE labels, month boundaries
      (incl. leap Feb), weekOf, nav helpers.
- [ ] Component tests: 4-view switch; month cell count/due/today; tap-day →
      วัน view at that date; week/day nav; agenda sections + empty states; WP
      link carries back-referrer; ไทม์ไลน์ renders the Gantt; Gantt zoom shows
      ใกล้/กลาง/ไกล.
- [ ] Live: TFM month grid shows activity dots on recently-photographed days;
      tapping a dotted day lists those WPs in วัน view; ไทม์ไลน์ = spec-255
      Gantt intact.
