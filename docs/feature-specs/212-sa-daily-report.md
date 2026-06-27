# 212 — SA daily report (รายงานประจำวัน)

Status: IN PROGRESS — design confirmed with the operator 2026-06-28 (see "Design
revisions" below). Flex-message generator + tests shipped (`src/lib/daily-report/flex.ts`,
`sample.ts`). Data layer (U1) + capture screen next.
Relates: spec 46 (`labor_logs` / attendance), ADR 0016 + spec 04 (deliverable grouping),
spec 39/61 (PM project PDF report — distinct from this), spec 144 (defect rework), spec 92
(WP schedule), spec 130 (DC self-service portal — feeds a later unit), spec 143 (project
visibility), spec 167 (WP detail tabs). Doctrine: self-governance (workers self-report),
AI-first (AI-drafted narrative later), WP-centric.

## Why

Site admins file a **daily report** at the end of each day. Today it is a hand-typed LINE
message. A real example (project TFM คำม่วง, 27/06/2026):

- header: project + date
- work grouped by crew/area — "DC" (8 people: paint touch-up + clearing) and
  "ฐานราก / ช่างนัน" (1 person: finishing) — each = a narrative line + headcount + every
  worker's name with hours (เข้างาน 08:00–17:00)
- ปัญหาที่พบ (problems) — a standing section, empty that day
- แผนงานวันที่ 28/06/2026 (next-day plan) — empty
- รอยืนยัน (awaiting confirmation)

About **80% of that message is data the app already holds** (or should):

- attendance — who worked, how long — is `labor_logs` (spec 46)
- the work, grouped by area — is `work_packages` under `deliverables`
- progress — is `photo_logs`

So the SA **re-types structured data into prose**, in a channel disconnected from the app,
every single day. And the parts that genuinely ARE narrative (what we did, problems,
tomorrow's plan) have no structured home at all.

This spec makes the daily report a **byproduct of structured capture**: the app assembles
the day's attendance + photos; the SA adds only the human narrative (summary, problems,
plan) and submits; a PM confirms (รอยืนยัน → ยืนยันแล้ว). The shared output is a **LINE
Flex Message** (a rich bubble) reproducing the report, so the existing LINE habit
transfers — richer and more scannable than the current plain-text message.

### Decisions

- **One report per project per day.** Keyed `(project_id, report_date)` — the SA's mental
  unit ("today's report for คำม่วง"). Not per-WP (too granular), not per-org (loses the
  site).
- **Auto sections are DERIVED, never copied.** Attendance + photos are read live from
  `labor_logs` / `photo_logs` (grouped by WP/deliverable) at render time. The
  `daily_reports` row stores ONLY the SA's authored text + workflow state. The single
  source of truth stays in the existing tables; the report cannot drift from them. Those
  tables are append-only / supersede, so a past day's numbers are stable once confirmed.
- **Standard hours by default; late/OT are exceptions (operator-corrected 2026-06-28).**
  Workers default to the project's **standard site hours** (configurable; default
  08:00–17:00). The SA flags only deviations per person — `สาย` (late, with time),
  `ออกก่อน` (left early), `OT` (+hours). These are operational annotations on the day's
  labour record (additive on `labor_logs`), **money-free in v1** (shown on the report; OT
  _pay_ is the downstream payment flow's job — deferred). Captures exactly the signal the
  operator named ("they are late, or stayed over for OTs") without a full per-worker
  timesheet.
- **The work is the spine; worker type is a TAG, never a group (operator-corrected).** DC
  and subcontractor describe _who_; the work package describes _what_ — never mixed as a
  heading. Each report entry = the work done (a WP, or "ไม่ผูก WP" general site work) + the
  crew, every person tagged `บริษัท / DC / ผู้รับเหมา`. So the sample's "•DC" heading is
  wrong-by-design — it becomes a per-person tag; **ช่างนัน is a subcontractor** on the
  ฐานราก work, not a DC.
- **Every worker is identified, because daily pay needs the names (operator).** The firm
  pays DC and daily-paid subs _every day_, so the attendance roster is the record of _who
  gets paid that day_ — it must name each person, across all three types. The in-app report
  holds the full identified roster; the LINE bubble lists them grouped by work. This is the
  clean source the existing DC/subcon daily-payment flow consumes (specs 127/128). **Model
  note:** the app identifies company + DC today; **subcontractor members** need to be
  identifiable in the same daily-attendance model — confirm/extend when building the data
  layer.
- **SA-owned, PM confirms, money-free to read.** No rates/costs on the report (headcount +
  names only), so it is safe on the SA field tier. SA authors; PM/PD/super confirm — SA
  cannot self-confirm (mirrors the approvals tier split). Read = project-visible roles
  (spec 143).
- **Status enum, mutable until confirmed.** `daily_reports.status` =
  `draft | submitted | confirmed`. Editable by the SA while draft/submitted; `confirm`
  locks it and stamps `confirmed_by/at`. Not append-only (it is a working doc, not an
  audit/photo log); the confirm event is audited.
- **Output = LINE Flex Message, kept FLEXIBLE (operator: "keep the report flexible, review
  and change as needed").** The shared report is a LINE Flex bubble — header · headcount by
  type · per-work entries with named late/OT · problems · next-day plan · status — built by
  a **template-driven generator** (`src/lib/daily-report/flex.ts`) so the layout can be
  re-styled/reordered without rewiring callers. A text `altText` is the fallback. Validated
  with the operator on the real bubble before it reaches the team.

## Design revisions (2026-06-28, operator-confirmed)

Confirmed live with the operator after the first draft:

1. One report per project/day — **kept.**
2. Auto-assemble attendance + photos (derive, don't copy) — **kept.**
3. ~~No clock in/out~~ → **overturned**: capture late/OT exceptions (standard-hours default).
4. Group by work, type-as-tag — **kept + sharpened**: DC is a person-type not a group;
   ช่างนัน is a subcontractor; every worker identified (daily pay).
5. SA writes / PM confirms / money-free — **kept.**
6. ~~Share as plain text~~ → **LINE Flex Message**, template-driven + flexible; test with
   the operator first.

## U1 — data layer (`daily_reports`)

Additive migration (new table + enum + functions). Money-free, but still schema →
operator-held until pgTAP is required CI (flag on ship).

- **Migration** `…_spec212u1_daily_reports.sql`:
  - `create type public.daily_report_status as enum ('draft','submitted','confirmed');`
  - `create table public.daily_reports` — `id uuid pk default gen_random_uuid()`,
    `project_id uuid not null references projects(id)`, `report_date date not null`,
    `work_summary text`, `problems text`, `next_day_plan text`,
    `status daily_report_status not null default 'draft'`,
    `created_by uuid not null references users(id)`, `confirmed_by uuid references
users(id)`, `confirmed_at timestamptz`, `created_at/updated_at timestamptz default
now()`, `unique (project_id, report_date)`. Length checks (each text ≤ 4000).
  - RLS on. **Read** = the project-visibility predicate (reuse `can_see_project` / the
    spec-143 arm). **Write** only via the definer RPCs below (no direct table grants).
  - `upsert_daily_report(p_project uuid, p_date date, p_summary text, p_problems text,
p_plan text)` — `security definer`, `set search_path = public`. Gate:
    `current_user_role()` in `('site_admin','project_manager','project_director',
'super_admin')` AND caller can see the project → else `42501`. Refuse when the existing
    row is `confirmed` (locked) → `P0001`. Upsert by `(project_id, report_date)` preserving
    `status`/`created_by`; set `updated_at`. `revoke all from public, anon; grant execute
to authenticated`. Audit `('update', …, 'daily_reports', id, {…})`.
  - `submit_daily_report(p_id uuid)` — same authoring gate + project scope; `draft` →
    `submitted`.
  - `confirm_daily_report(p_id uuid)` — gate `('project_manager','project_director',
'super_admin')` (NOT site_admin); `submitted` → `confirmed` + `confirmed_by/at`. Audit.
    (Names `project_manager` ⇒ ADR 0058 requires `project_director` ride-along — included.)
  - (A `reopen_daily_report` super/PD override, mirroring spec 194, is a later unit.)
- **pgTAP** `…-daily-reports.test.sql`: table + enum + unique present; SA upserts on a
  visible project; SA on a non-visible project denied (`42501`); a `confirmed` report
  rejects upsert (`P0001`); SA submit ok; SA confirm DENIED (`42501`); PM confirms; PD
  rides along; visitor denied; successful writes audited.
- `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (new file green; 90 green).

## U2 — auto-assembly read layer (pure + server)

Code-only.

- Pure `src/lib/daily-report/assemble.ts` — from labor rows + photo rows + WP/deliverable
  lookups for a (project, date), shape:
  - `attendanceByWp`: `[{ wpId, wpCode, wpName, deliverableCode, headcount, workers:
[{ name, type: 'own'|'dc'|'subcon', dayFraction }] }]` + an `unassigned` (general site
    work) bucket.
  - `photos`: the day's `photo_logs` (captured-at date = report_date) — count + thumbs.
  - `totalHeadcount`.
    Unit-tested: grouping, half-day counting, empty day, the unassigned bucket.
- Server `src/lib/daily-report/load.ts` — read `labor_logs` + `photo_logs` +
  `work_packages`/`deliverables` for (project, date) → the assembled shape. Caller gates on
  project visibility.

## U3 — the SA daily-report screen

Code-only.

- Route `/projects/[projectId]/daily-report` — today by default; `?date=YYYY-MM-DD` for
  history, with a date stepper. Linked from the project hub + the SA home.
- Renders: header (project · date · standard site-hours line · status pill), the **auto**
  attendance-by-WP and the day's **photo strip** (read-only, from U2), and the **editable**
  fields — สรุปงานวันนี้ (`work_summary`), ปัญหาที่พบ (`problems`), แผนงานพรุ่งนี้
  (`next_day_plan`) — with บันทึก (`upsert_daily_report`) and ส่งรายงาน (`submit`).
- SA-tier, money-free. PM/PD also reach it (plus the confirm control, U4).

## U4 — confirmation (รอยืนยัน → ยืนยันแล้ว)

Code-only.

- Status pill + a PM/PD/super confirm button (`confirm_daily_report`). After confirm the
  editable fields lock for everyone (read-only record); the SA sees รอยืนยัน after submit,
  then ยืนยันแล้ว with the confirmer's name + time.
- Optional: a "rooms to confirm" count for PMs mirroring the รอตรวจ queue — defer if budget
  is tight.

## U5 — LINE Flex output (the adoption bridge) — built FIRST

The output the team sees. Built and validated with the operator before the capture layer
(operator: "try flex messages, test with me first").

- **SHIPPED (code-only):** pure `src/lib/daily-report/flex.ts` — `dailyReportBubble` /
  `dailyReportFlexMessage` / `dailyReportAltText` over a `DailyReportView`. Template-driven
  (one `bodyContents()` composer + a `C` palette to restyle) so the layout stays flexible
  to iterate. `src/lib/daily-report/sample.ts` drives the test + the preview. Unit-tested
  (`tests/unit/daily-report-flex.test.ts`, 7 cases).
- **NEXT — the real LINE test (held PR, danger-path = notifications):** a flex-capable push
  (`pushLineFlex`, extending `src/lib/notifications/line-push.ts`) + an in-app
  "ส่งรายงานตัวอย่างเข้า LINE ของฉัน" action that targets the **logged-in** user's
  `line_user_id` — no guessing (there are ≥2 LINE-linked super_admins, so an ad-hoc
  to-the-operator send is unsafe). The operator merges the held PR, taps it, and the real
  bubble lands in their LINE; we iterate on `flex.ts` from there.
- **THEN:** push the confirmed report to the project's recipients via the same flex push
  (reuse the notifications drain) — a later unit.

## Out of scope (v1)

- Full per-worker clock in/out **timesheets** — v1 captures only the late / early-leave /
  OT _exceptions_ the operator flagged, not a continuous time clock.
- **OT pay** (rates × OT hours) — OT is captured as hours for the report; turning it into
  pay is the downstream DC/subcon payment flow's job (specs 127/128), deferred here.
- AI-drafted narrative (summary/problems from photos + labor + WP progress) — the natural
  next step under the AI-first doctrine; its own unit once the manual flow is proven.
- DC / field-worker self-report feeding attendance — covered by spec 130 (DC portal); this
  report consumes `labor_logs` regardless of who entered them.
- Auto-pushing the report via LINE OA; weekly/monthly rollups; cross-project digests.
- Snapshotting the auto sections into the report row at confirm (derive-live is fine while
  labor/photo logs are append-only/superseded).
- Per-WP narrative lines (v1 = one overall summary). Add if a single summary proves too
  coarse.

## Verification

- `pnpm db:test` → the new file green; role-completeness (90) green.
- Unit: `flex.ts` green (header/identification/WP-tag/late+OT/headcount-by-type/
  data-driven/altText); `assemble.ts` green when U2 lands.
- `pnpm lint && pnpm typecheck && pnpm test` green.
- Preview `/projects/[id]/daily-report`: SA sees auto attendance + photos, fills
  summary/problems/plan, submits → รอยืนยัน; PM confirms → locked; คัดลอกข้อความ
  reproduces the LINE message. Screenshot → Telegram.
