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

### What exists today (fact-checked 2026-07-29, corrected from the first draft)

Check-in/out truth lives in the muster tables (spec 306): `muster_attendance`
carries `work_date, in_at/out_at, in_method/out_method, out_auto, ot_hours,
session` at the **(worker, date, session)** grain — a day legitimately holds
two rows once OT runs (spec 351). Live: teams since 07-15 across **6 work
dates**, 146 scans all within 07-24 → 07-29 (adoption is one week old and
accelerating).

Two surfaces already render muster, neither answering the operator's question:

| Surface                       | Gate                                                 | What it shows                                                      | What it lacks                             |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| `/projects/[id]/muster`       | `SA_SURFACE_ROLES` (SA, super, procurement_manager)  | today's scan cockpit                                               | any history (no date param)               |
| `/team/attendance` (spec 358) | `ATTENDANCE_AUDIT_ROLES` (incl. procurement_manager) | range summary per worker + per-DAY drill (times, method, OT) + CSV | per-WORKER calendar view, rate/money link |
| `/payroll`                    | `PAYROLL_VIEW_ROLES` (incl. accounting)              | per-worker day COUNT × rate snapshot → gross/WHT                   | dates, in/out times                       |
| `/workers`                    | `WORKER_ROSTER_ROLES`                                | roster + `day_rate` (procurement already edits it)                 | attendance                                |

So the genuinely missing delta — what this spec builds — is narrow: **a
per-worker MONTH view**, **the rate + money link on the same screen**, and
**plain `procurement` access** (it fails `can_see_project`, so both muster
surfaces above are closed to it; only the admin-seam pattern reaches it).

### The divergence the calendar makes visible

`labor_logs` — what `/payroll` pays from — has **zero rows, ever**. The
muster→labor derivation is NOT missing: `derive_muster_labor` shipped (spec 369) and `close_muster_day` calls it — but it deliberately skips any worker
without `cost_confirmed_at`, and **0 of 31 workers are confirmed**, so every
close-day derives nothing and `/payroll` renders empty for every period. The
calendar shows scanned days AND recorded-pay days side by side, and when the
gap is explained by an unconfirmed worker it says so, naming the real
affordance (ยืนยันค่าแรงและระดับ on /workers). Until workers start being
confirmed the variance line fires for everyone — the explainer, not the
variance, is the actionable element today; the variance becomes the signal
the moment confirms begin.

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
- **Header card:** worker name · level (`workers.level`, `WORKER_LEVEL_LABEL`;
  NULL on 31/31 live rows today, renders once grading starts) · `day_rate`
  บาท/วัน · standard level rate beside it when it differs
  (`worker_level_rates.entered_rate` through `grossRate`, shown ONLY to the
  /settings/labor-rates money audience: procurement_manager + super_admin —
  pinned by an exhaustive role-domain test) · phone · project ·
  `pay_type` (รายเดือน/รายวัน — there is no `worker_type` column; pay_type +
  employment_type are the real discriminators).
- **Month summary row:** days scanned · OT hours total · **ประมาณการค่าแรง =
  scanned days × day_rate** explicitly labeled ประมาณการ (muster does not feed
  payroll yet) · paid days per `labor_logs` for the same month · a variance
  chip when scanned ≠ paid.
- **Doors:** row link on the `/workers` roster rows
  (`worker-roster-manager.tsx`; ships in U1) and a per-worker link on
  `/payroll` rows (ships as **U1b**, a separate one-file PR — `src/app/payroll/`
  is on the danger-path deny list, so folding it into U1 would hold the whole
  unit). Both pass `?from=`; the page resolves `safeBackHref` and joins
  `MULTI_PARENT_DETAILS` in the nav-back guard (a dynamic-segment route is
  auto-classified DETAIL — the draft's `STATIC_DETAIL`/`STATIC_MULTI_PARENT`/
  `DRILL_DOWNS` names were the wrong registries). ⚠️ The payroll door renders
  ONLY for `WORKER_ROSTER_ROLES` viewers: `/payroll` also admits `accounting`,
  which this page's gate refuses — an unconditional door would be
  affordance-then-refuse. ⚠️ NO team-map door in this spec — lane 365teammap
  actively owns `team-map/**`.
- **View-model:** pure `buildAttendanceMonth(...)` in `src/lib/attendance/` —
  cells + summary computed from rows, fully unit-testable; the page stays a
  thin server component pinned by source scan.

### U2 — `public_holidays` (additive schema) + calendar marking — ⛔ WITHDRAWN 2026-08-08

> 🚨 **The MARKING is withdrawn; the TABLE stays.** Operator 2026-08-08, on a
> screenshot of ก.ค. 2569: _"hide info about holidays, we do not have those yet.
> money is the same as normal day."_ PRC works the national calendar — the site
> scanned full days on 2026-07-29 (อาสาฬหบูชา) and 2026-07-30 (วันเข้าพรรษา) —
> so the tint, the name, the ทำงานวันหยุด chip and the legend all described a
> policy the firm does not have, and on a page headlined ประมาณการค่าแรง an amber
> tint reads as "this day is priced differently".
>
> The money half needed no code: `public_holidays` is referenced by nothing in
> `supabase/` beyond its own migration and pgTAP file — no function, view or
> trigger — so holiday pay was already identical to a normal day.
>
> `public_holidays` (23 rows) and its pgTAP file are KEPT so a future holiday
> policy inherits the data; every READER is gone, pinned repo-wide by
> `tests/unit/attendance-holiday-display-withdrawn.test.ts`. The holiday arm of
> `GridDay.nonWorking` went with it (now Sunday alone) — leaving it would have
> kept those columns shaded and un-fixable with nothing on screen saying why.
> Spec 400 D5 is amended to match.
>
> The description below is kept as the record of what shipped and was retired.

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
2. **Feeding `labor_logs`** — the derivation itself shipped (spec 369:
   `close_muster_day` → `derive_muster_labor`, skipping cost-unconfirmed
   workers). Confirming the 31 unconfirmed workers is the operator's
   super_admin action on /workers, not this spec's; the calendar SHOWS the gap
   and names that affordance, it does not write anything.
3. **Editing attendance** from this page — read-only. Corrections happen where
   they happen today (cockpit / back-date via open/move/close per
   paper-attendance-backfill).
4. **Team-map door** — deferred until lane 365teammap lands.
5. **Company-staff monthly payroll semantics** — this page is muster-truth ×
   daily-rate; the payroll page remains the money SSOT.

## 3b. U2 follow-ups — ⛔ ALL MOOT, WITHDRAWN WITH U2 (2026-08-08)

> These were logged at U2's review against a shipped marking. The marking is
> gone (see the U2 notice above), so none of them is open work: there is no chip
> to qualify (1), nothing renders in or outside the seeded window (2), and no
> displayed date to re-verify (3). They are kept because a future holiday policy
> would meet every one of them again — **`observed_by` scoping in particular is
> still REQUIRED before any pay semantics ever land on this table.**

1. **Observance regimes.** The seed mixes three: วันแรงงาน (private-sector),
   วันพืชมงคล + the Jan-2 special (government-sector), the rest (both). Which
   days PRC actually closes is an operator/company-policy fact the app does
   not know; an `observed_by` scope column is REQUIRED before any pay
   semantics ever land on this table. Until then a ทำงานวันหยุด chip on a
   sector-specific day is a calendar fact, not a pay claim.
2. **Coverage window.** Seed ends 2026-12-31; a 2027 seed migration is owed by
   December, and months outside the seeded window render unmarked —
   indistinguishable from "no holidays". A covered-range marker is the fix if
   this page outlives ad-hoc reseeding.
3. **วันพืชมงคล is announced annually** (palace announcement, not statute) —
   2026-05-11 came from published 2026 calendars; re-verify against the actual
   announcement if precision starts to matter.
4. **List changes = NEW migrations** with `on conflict (holiday_date)`
   handling — the applied seed migration no-ops on edit, and its bare insert
   would abort a future overlapping seed.

## 4. Rollout

U1 ships first (code-only, auto-merge on green) and does not reference
`public_holidays` at all. U2 claims the schema lane at live-head+1 and ships as
a danger-path PR under the additive-migration self-merge grant, carrying BOTH
the table and the calendar-marking code in one PR (the half that adds the
signal ships with the half that reads it).
