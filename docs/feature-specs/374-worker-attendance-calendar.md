# Spec 374 — worker attendance calendar: check-in/out history + rate, for the procurement team

**Status:** operator directive 2026-07-29 — _"where can procurement team verify
technicians' checkin and out history calendar? make it link with technician's rate
and relevant useful info as well"_ — plus, same session: _"yesterday was a holiday,
we forgot to handle that I think"_ (2026-07-28 was วันเฉลิมพระชนมพรรษา ร.10; the app
has no holiday concept at all). Design approved in chat 2026-07-29; **holiday
handling is display-only** by operator ruling — pay rules stay parked with the
operator-held spec 306 U5 money unit.

**Schema:** U1 code-only · U2 additive (one table + seed). No destructive change.

---

## 1. Why

### Today there is no answer to the operator's question

Check-in/out truth lives in the muster tables (spec 306): `muster_attendance`
carries `work_date, in_at/out_at, in_method/out_method, out_auto, ot_hours,
session` per worker per day. It is real, live data — running daily since
2026-07-15, 19 team-days, 146 scans as of 2026-07-29 — but the ONLY surface that
renders it is the SA scan cockpit `/projects/[projectId]/muster`, which:

- is gated `site_admin` + `super_admin` — procurement roles cannot open it;
- renders **today only** (`bangkokTodayIso()` hardcoded, no date param);
- is a scan surface built for gloved thumbs, not a review surface.

Procurement's closest existing surfaces answer a different question:

| Surface    | What it shows                                          | What it lacks             |
| ---------- | ------------------------------------------------------ | ------------------------- |
| `/payroll` | per-worker day COUNT × `day_rate_snapshot` → gross/WHT | no dates, no in/out times |
| `/workers` | roster + `day_rate` (procurement already edits it)     | no attendance at all      |

### The divergence the calendar makes visible

`/payroll` reads `labor_logs` — which received **0 rows on 07-27 and 07-28**
while muster scanned daily. Scan truth and pay truth are disconnected tables;
the muster→`labor_logs` derivation is spec 306 U5, deliberately operator-held.
A per-worker calendar that shows BOTH (scanned days vs paid days) gives
procurement the variance at a glance instead of hiding it.

### The holiday gap

2026-07-28 produced 0 scans (site closed) — no data damage — but nothing in the
app knows it was a holiday. Any attendance view would render it as an ordinary
absent day, and a future paid-holiday / holiday-premium rule has no data to hang
on. Zero tables, zero code mentions of holidays today.

## 2. Design

### U1 — `/workers/[workerId]/attendance` (code-only)

One new page: a month calendar for one worker.

- **Gate:** `requireRole(WORKER_ROSTER_ROLES)` — procurement, procurement_manager,
  PM tier, super_admin: exactly the set already trusted to see and edit
  `day_rate` on `/workers`. Plain `procurement` fails `can_see_project` and
  `workers.day_rate` has no `authenticated` grant, so ALL reads go through the
  server-side admin-client seam behind the role gate — the established
  `/payroll` + `/workers` pattern. No RLS change, no migration.
- **Month grid:** reuse `monthGrid` (`src/lib/work-packages/calendar-grid.ts`)
  - the `schedule-month-view` rendering pattern. `?m=YYYY-MM` param, prev/next
    month steppers, Bangkok dates.
- **Day cell:** in–out times (`HH:mm`), method icon (QR / manual tap), `+N ชม.`
  OT chip when `ot_hours > 0`, `(อัตโนมัติ)` marker when `out_auto`, project
  short-name when the worker mustered on a non-default project. Empty cell =
  no record. (U2 adds the holiday state.)
- **Header card:** worker name · level · `day_rate` บาท/วัน · standard level
  rate beside it when it differs (spec 314 `worker_level_rates`) · phone ·
  project · worker_type (ช่างบริษัท / DC).
- **Month summary row:** days scanned · OT hours total · **ประมาณการค่าแรง =
  scanned days × day_rate** explicitly labeled ประมาณการ (muster does not feed
  payroll yet) · paid days per `labor_logs` for the same month · a variance
  chip when scanned ≠ paid.
- **Doors:** row link in the `/workers` roster sheet
  (`worker-roster-manager.tsx`) and per-worker link on `/payroll` rows. Both
  pass `?from=`; the page resolves `safeBackHref` and registers in
  `STATIC_DETAIL` + `STATIC_MULTI_PARENT` + the owning hub's `DRILL_DOWNS`
  (nav-back-affordance guard). ⚠️ NO team-map door in this spec — lane
  365teammap actively owns `team-map/**`.
- **View-model:** pure `buildAttendanceMonth(...)` in `src/lib/attendance/` —
  cells + summary computed from rows, fully unit-testable; the page stays a
  thin server component pinned by source scan.

### U2 — `public_holidays` (additive schema) + calendar marking

- Table `public_holidays (holiday_date date primary key, name_th text not null)`.
  RLS: SELECT for `authenticated` (public reference data); no INSERT/UPDATE/
  DELETE policies — writes are migration-seeded for now (management UI is a
  non-goal until someone needs it).
- Seed: Thai public holidays for 2026 (national list; the operator can extend
  by asking for a follow-up seed or a management UI later).
- Calendar: holiday cells get a วันหยุด tint + the holiday name; a worker WITH
  a scan on a holiday gets a ทำงานวันหยุด chip (visible fact, no money math).
- pgTAP: table shape, RLS (anon blocked, authenticated read), seed present by
  property (count ≥ N for 2026, contains 2026-07-28) — never exact-equality on
  operator-editable data.

## 3. Non-goals (explicit)

1. **Holiday PAY rules** — paid holidays for company staff, DC holiday
   premium, OT-on-holiday multipliers: operator-held, parked with spec 306 U5.
   U2 is display-only marking.
2. **Muster→labor_logs derivation** — stays spec 306 U5, operator-held. The
   calendar SHOWS the variance; it does not resolve it.
3. **Editing attendance** from this page — read-only. Corrections happen where
   they happen today (cockpit / back-date via open/move/close per
   paper-attendance-backfill).
4. **Team-map door** — deferred until lane 365teammap lands.
5. **Company-staff monthly payroll semantics** — this page is muster-truth ×
   daily-rate; the payroll page remains the money SSOT.

## 4. Rollout

U1 ships first (code-only, auto-merge on green) and does not reference
`public_holidays` at all. U2 claims the schema lane at live-head+1 and ships as
a danger-path PR under the additive-migration self-merge grant, carrying BOTH
the table and the calendar-marking code in one PR (the half that adds the
signal ships with the half that reads it).
