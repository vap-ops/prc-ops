# Spec 358 — Attendance audit for office / payroll — Implementation Plan

> **For agentic workers:** load the `ship-unit` skill for EVERY task — each task is one PR through the gate. **U1 is a schema unit** (single schema lane; additive migration = two new DEFINER functions → admin-squash on green under the standing grant). **U2/U3/U4 are code-only** and depend on U1 merged + `pnpm db:types` regenerated. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give office staff (accounting/HR first, PM/PD too) a cross-project attendance AUDIT surface — per-worker days-present + OT over a range, per-day in/out detail with the audit signals (in_method, out_auto, scanned_by, closure), and a payroll CSV export — reading scan truth only, never money.

**Architecture:** Two `SECURITY DEFINER` read RPCs gated on a NEW `ATTENDANCE_AUDIT_ROLES` set (RLS untouched; `is_back_office` excludes accounting/hr). A server-rendered `/team/attendance` report (GET-form range picker → searchParams; `?worker=` drill; `?from&to&project` export link). No client JS, no cockpit churn, no new write path.

**Tech Stack:** Postgres/Supabase (two DEFINER functions + pgTAP), Next.js 16 App Router RSC (server components + a route handler), TypeScript strict, Vitest. Thai UI copy.

## Global Constraints

- **TDD, RED first.** First commit per unit is the failing test; state "Writing failing test first."
- **Schema single-lane.** DB head at spec time = `20260813075852`; the schema-lane STATUS says next claimant `075853`. **Claim `075853` in `../LANES.md`** and re-check the live head at build (`ls supabase/migrations | tail`; `select version from supabase_migrations.schema_migrations order by version desc limit 3`) — take the next free number if another lane moved it.
- **Read-only feature — NO new write paths.** No INSERT/UPDATE/DELETE anywhere; muster scan/close/move flows and `muster-cockpit.tsx` are NOT edited (spec 357 on-device proof owed).
- **RLS / `can_see_project` NOT touched.** Access is the two DEFINER RPCs' inner 42501 gate only.
- **RAW scan truth, money boundary.** This surface reads `muster_*` + `workers`/`users`/`projects` for names only. It never reads `labor_logs`, wages, GL, or any money view, and computes no baht.
- **Gate parity (doctrine §3, three layers).** The RPC's inner allowlist (7 roles), the TS page gate, and the export-route gate MUST be the same set (`ATTENDANCE_AUDIT_ROLES`). Pin behaviourally over the exhaustive 17-value `user_role` domain, mutation-checked both directions.
- **Source each RPC's neighbours from LIVE.** `can_see_project(uuid)` and `current_user_role()` are existing DEFINER helpers (`current_user_role()` = `select role from public.users where id = auth.uid()`); call them, do not reimplement.
- **PII wall respected.** Output uses `workers.name` (authenticated-readable). `workers.employee_id` is service-role-walled → NOT exposed in v1 (open question in the spec).
- **Assertions pin absence + mutation-check** (doctrine); pgTAP RED-first; a new enum value must trip the allowlist test.
- Enum/role codes are English snake_case; UI copy Thai in `labels.ts` (ties to `MUSTER_LABEL` = เช็คชื่อ per the UI-term SSOT).

## File Structure

| File                                                             | Responsibility                                                                                         | Task |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---- |
| `supabase/migrations/<075853>_spec358_attendance_audit_rpcs.sql` | `audit_attendance_summary` + `audit_attendance_detail` DEFINER read functions                          | U1   |
| `supabase/tests/database/358-attendance-audit.sql`               | pgTAP: role allowlist (exhaustive), PM scope, cross-project, signal counts                             | U1   |
| `src/lib/auth/role-home.ts`                                      | NEW `ATTENDANCE_AUDIT_ROLES` const (7 roles)                                                           | U2   |
| `tests/unit/role-sets.test.ts`                                   | pin `ATTENDANCE_AUDIT_ROLES` exact positive set over the enum domain                                   | U2   |
| `src/lib/muster/attendance-audit.ts`                             | readers (`loadAttendanceSummary`) + pure view-model (`formatSignals`, `attendanceRange`, `parseRange`) | U2   |
| `src/lib/i18n/labels.ts`                                         | `ATTENDANCE_AUDIT_LABEL` + column/signal strings                                                       | U2   |
| `src/app/team/attendance/page.tsx`                               | server report page: gate, range picker (GET form), summary table, entry back-chip                      | U2   |
| `src/app/team/page.tsx` + `/accounting` landing                  | entry-point cards to `/team/attendance`                                                                | U2   |
| `tests/unit/attendance-audit-view.test.ts`                       | summary view-model + range parsing + signal formatting                                                 | U2   |
| `src/lib/muster/attendance-audit.ts` (extend)                    | `loadAttendanceDetail` + `shapeDetailRow`                                                              | U3   |
| `src/app/team/attendance/page.tsx` (extend)                      | `?worker=` drill section: per-session detail rows                                                      | U3   |
| `tests/unit/attendance-audit-view.test.ts` (extend)              | detail view-model (per-row signals, session split, empty)                                              | U3   |
| `src/app/team/attendance/export/route.ts`                        | CSV export route (gate + `audit_attendance_detail` all-workers → text/csv)                             | U4   |
| `src/lib/muster/attendance-csv.ts`                               | pure CSV serializer (columns, escaping, filename)                                                      | U4   |
| `tests/unit/attendance-csv.test.ts`                              | CSV serialization + escaping + filename                                                                | U4   |

---

## Task 1 (U1): schema — the two read RPCs · additive migration (admin-squash on green)

**Files:** Create the migration + pgTAP file (number per Global Constraints).

**Interfaces produced (later tasks consume these signatures):**

- `audit_attendance_summary(p_from date, p_to date, p_project_id uuid default null)` → table `(worker_id uuid, worker_name text, days_present int, ot_hours_total numeric, project_count int, manual_in_count int, qr_in_count int, auto_out_count int, open_out_count int, unclosed_day_count int)`
- `audit_attendance_detail(p_from date, p_to date, p_project_id uuid default null, p_worker_id uuid default null)` → table `(worker_id uuid, worker_name text, project_id uuid, project_name text, work_date date, session muster_session, in_at timestamptz, in_method muster_method, out_at timestamptz, out_method muster_method, out_auto boolean, ot_hours numeric, scanned_by uuid, scanned_by_name text, team_lead_name text, day_closed boolean)`
- Both: `raise 42501` unless `current_user_role() in ('accounting','hr','project_director','project_coordinator','procurement_manager','super_admin','project_manager')`. Visibility inside: full set (the 6 minus `project_manager`) → all projects; else (`project_manager`) → `can_see_project(project_id)`.

- [ ] **Step 1 — claim the schema lane + pick the number.** Read `../LANES.md` whole; confirm the schema lane is free; take `075853` (re-check the live head). Annotate the lane block.

- [ ] **Step 2 — write the pgTAP RED first.** `supabase/tests/database/358-attendance-audit.sql`, standard form (`begin; select plan(N); … finish(); rollback;`). Seed: project A + project B, a super_admin, an accounting user, a `project_manager` who is a `project_members` row on A only, two workers, and `muster_teams` + `muster_attendance` rows on A (worker1, one regular + one ot, in_method manual, out_at null on the ot) and on B (worker2, one regular). Assert:
  - **Exhaustive role allowlist** — plan-pin `array_length(enum_range(null::user_role),1) = 17` (a new enum value reds this ⇒ author must classify it); then for EACH of the 17 roles set `public.users.role` on a seeded probe user + `set local role authenticated` + `set local "request.jwt.claims" = '{"sub":"<probe>"}'` and: `lives_ok(select * from audit_attendance_summary(...))` for the 7 audit roles, `throws_ok(…, '42501')` for the other 10. (Same 17 for `audit_attendance_detail`.)
  - **Cross-project (accounting):** summary returns BOTH workers; detail (worker null) returns rows from A and B.
  - **PM scope:** as the A-only PM, summary/detail return ONLY project-A rows (worker2/B never leaks).
  - **Signal counts (accounting, range covering the seed):** worker1 `days_present=1`, `ot_hours_total = <seeded ot span>`, `manual_in_count=2`, `qr_in_count=0`, `open_out_count=1` (the ot row), `project_count=1`, `unclosed_day_count=1` (no closure seeded). Seed a closure for A's day in a second sub-check and assert `unclosed_day_count=0` / `day_closed=true`. Assert by SEEDED property, never a global table count.
  - **Detail fields:** `scanned_by_name` resolves the seeded scanner's `users.full_name`; `team_lead_name` resolves the team's lead worker; `day_closed` reflects the closure.

  Run `pnpm db:test` (or the single file) → RED (functions don't exist).

- [ ] **Step 3 — write the migration** `supabase/migrations/<075853>_spec358_attendance_audit_rpcs.sql`:

```sql
-- Spec 358 U1 — attendance audit read RPCs for the office/payroll audience.
-- muster_* RLS is can_see_project-scoped (FALSE for accounting/hr/legal/procurement),
-- so these SECURITY DEFINER reads serve them without touching RLS. Gated on a NEW
-- 7-role allowlist (is_back_office excludes accounting/hr). Full set = cross-project;
-- project_manager = can_see_project-scoped. Read-only, money-free.

create function public.audit_attendance_summary(
  p_from date,
  p_to date,
  p_project_id uuid default null
) returns table (
  worker_id uuid,
  worker_name text,
  days_present integer,
  ot_hours_total numeric,
  project_count integer,
  manual_in_count integer,
  qr_in_count integer,
  auto_out_count integer,
  open_out_count integer,
  unclosed_day_count integer
) language plpgsql stable security definer set search_path = public as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role not in (
    'accounting','hr','project_director','project_coordinator',
    'procurement_manager','super_admin','project_manager'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with visible as (
    select a.worker_id, a.work_date, a.session, a.in_method, a.out_at,
           a.out_auto, a.ot_hours, t.project_id
      from public.muster_attendance a
      join public.muster_teams t on t.id = a.team_id
     where a.work_date between p_from and p_to
       and (p_project_id is null or t.project_id = p_project_id)
       and (
         v_role in ('accounting','hr','project_director','project_coordinator','procurement_manager','super_admin')
         or public.can_see_project(t.project_id)
       )
  )
  select
    w.id,
    w.name,
    count(distinct v.work_date) filter (where v.session = 'regular')::int,
    coalesce(sum(v.ot_hours) filter (where v.session = 'ot'), 0)::numeric,
    count(distinct v.project_id)::int,
    count(*) filter (where v.in_method = 'manual')::int,
    count(*) filter (where v.in_method = 'qr')::int,
    count(*) filter (where v.out_auto)::int,
    count(*) filter (where v.out_at is null)::int,
    count(distinct (v.project_id, v.work_date)) filter (
      where not exists (
        select 1 from public.muster_day_closures c
         where c.project_id = v.project_id and c.work_date = v.work_date
      )
    )::int
  from visible v
  join public.workers w on w.id = v.worker_id
  group by w.id, w.name
  order by w.name;
end;
$$;

create function public.audit_attendance_detail(
  p_from date,
  p_to date,
  p_project_id uuid default null,
  p_worker_id uuid default null
) returns table (
  worker_id uuid,
  worker_name text,
  project_id uuid,
  project_name text,
  work_date date,
  session public.muster_session,
  in_at timestamptz,
  in_method public.muster_method,
  out_at timestamptz,
  out_method public.muster_method,
  out_auto boolean,
  ot_hours numeric,
  scanned_by uuid,
  scanned_by_name text,
  team_lead_name text,
  day_closed boolean
) language plpgsql stable security definer set search_path = public as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role not in (
    'accounting','hr','project_director','project_coordinator',
    'procurement_manager','super_admin','project_manager'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    a.worker_id,
    w.name,
    t.project_id,
    p.name,
    a.work_date,
    a.session,
    a.in_at,
    a.in_method,
    a.out_at,
    a.out_method,
    a.out_auto,
    a.ot_hours,
    a.scanned_by,
    su.full_name,
    lead.name,
    exists (
      select 1 from public.muster_day_closures c
       where c.project_id = t.project_id and c.work_date = a.work_date
    )
  from public.muster_attendance a
  join public.muster_teams t on t.id = a.team_id
  join public.workers w on w.id = a.worker_id
  join public.projects p on p.id = t.project_id
  left join public.workers lead on lead.id = t.lead_worker_id
  left join public.users su on su.id = a.scanned_by
  where a.work_date between p_from and p_to
    and (p_project_id is null or t.project_id = p_project_id)
    and (p_worker_id is null or a.worker_id = p_worker_id)
    and (
      v_role in ('accounting','hr','project_director','project_coordinator','procurement_manager','super_admin')
      or public.can_see_project(t.project_id)
    )
  order by a.work_date, w.name, a.session;
end;
$$;

revoke all on function public.audit_attendance_summary(date, date, uuid) from public;
revoke execute on function public.audit_attendance_summary(date, date, uuid) from anon;
grant execute on function public.audit_attendance_summary(date, date, uuid) to authenticated;

revoke all on function public.audit_attendance_detail(date, date, uuid, uuid) from public;
revoke execute on function public.audit_attendance_detail(date, date, uuid, uuid) from anon;
grant execute on function public.audit_attendance_detail(date, date, uuid, uuid) to authenticated;
```

- [ ] **Step 4 — `pnpm db:push`** (auto-Y), then re-run `pnpm db:test` → 358 file GREEN; full suite only the tolerated known-red (221). If any OTHER file reds, it is an in-flight concurrent-lane / operator-data issue — diagnose (doctrine: an unpinned pgTAP red is a queue-ejector), do NOT add a blind known-red pin.

- [ ] **Step 5 — `pnpm db:types`** → regenerate `src/lib/db/database.types.ts` (adds the two RPCs). Confirm they appear. `git status` after (codegen is a mutation).

- [ ] **Step 6 — real-flow verify (live RPC drive).** As dev-preview (super_admin) call `select * from audit_attendance_summary('2026-07-01','2026-07-31')` and `audit_attendance_detail('2026-07-01','2026-07-31')` on the LIVE DB → expect the pilot day's ~13 workers, `manual_in_count`>0/`qr_in_count`=0, `open_out_count`>0, `unclosed_day_count`>0 (07-24 never closed). Confirm a plain `technician`/`accounting`-less path raises 42501 (impersonate via a throwaway or read the pgTAP proof — a live 42501 drive for a non-audit role is the pgTAP's job).

- [ ] **Step 7 — fresh-eyes review** (cavecrew-reviewer / general-purpose opus on the full diff) → address findings. **Step 8 — ship** via `ship-unit` (danger-path additive migration → admin-squash on green under the standing grant). Move the lane's schema STATUS to head `075853`.

---

## Task 2 (U2): report page + range picker + per-worker rows (code-only)

**Depends on:** U1 merged + `db:types` regenerated (`Database['public']['Functions']['audit_attendance_summary']`).

**Gate-check block (before writing code):**

- Confirm `audit_attendance_summary` is in `src/lib/db/database.types.ts` at HEAD (its RETURNS-TABLE cols may be typed non-null; widen nullables — `ot_hours_total` etc. — in the reader per the spec-350 note).
- Read `roleHome` for each audit role (`accounting`→`/accounting/review`; find hr, PM, PD, PC, pmgr, super) so the entry cards land on a surface each role actually sees. `hr` in particular — verify its home; if hr routes to `/coming-soon`, place its entry differently (surface on the page it can reach, or note as an open question, do NOT widen roleHome here).
- Confirm the `?from` multi-parent back-chip pattern (spec 334 follow-up) and how a DetailHeader detail route reads it.
- Read `src/app/payroll/export/route.ts` (the CSV precedent, for U4) and `src/app/team/page.tsx` (entry-card host).

**Interfaces produced:**

- `ATTENDANCE_AUDIT_ROLES: ReadonlyArray<UserRole>` in `role-home.ts` = `['accounting','hr','project_director','project_coordinator','procurement_manager','super_admin','project_manager']`.
- `loadAttendanceSummary(client, { from, to, projectId? }): Promise<AttendanceSummaryRow[]>` in `src/lib/muster/attendance-audit.ts`.
- `attendanceRange(searchParams): { from: string; to: string; projectId?: string }` (pure; default = current BKK month) and `formatSignals(row): SignalChip[]` (pure).

- [ ] **Step 1 — RED: role-set + view-model tests.** In `tests/unit/role-sets.test.ts` add an EXHAUSTIVE-domain pin: iterate `Object.keys(USER_ROLE_LABEL)` (a `Record<UserRole>`, so an enum-add trips it) and assert `ALL.filter(r => ATTENDANCE_AUDIT_ROLES.includes(r)).sort()` `toEqual` the exact 7-role positive set — pins BOTH widen and add directions (doctrine allowlist rule). In `tests/unit/attendance-audit-view.test.ts`: `attendanceRange` defaults to the current BKK month; parses `?from&to&project`; clamps `from<=to`; `formatSignals` emits a chip only for non-zero counts (manual/qr ratio, auto-out, open-out, unclosed-day) with the Thai labels; empty summary → empty. Run → RED.

- [ ] **Step 2 — implement** `ATTENDANCE_AUDIT_ROLES` (role-home.ts, with a doc-comment citing spec 358 + why not `is_back_office`), the label strings (`labels.ts`), and `src/lib/muster/attendance-audit.ts` (`attendanceRange`, `formatSignals`, `loadAttendanceSummary` calling `client.rpc('audit_attendance_summary', {...})` on the RLS **session** client, widening nullable cols). Run tests → GREEN.

- [ ] **Step 3 — the page** `src/app/team/attendance/page.tsx` (server component): `requireRole(ATTENDANCE_AUDIT_ROLES)`; DetailHeader with `?from` back chip (default `/team`); a **GET-form range picker** (month-preset links computing `?from&to`, plus two `<input type=date>` + submit; optional project `<select>`); the per-worker summary table from `loadAttendanceSummary`; a signals cell via `formatSignals`; an export link carrying the current `?from&to&project` (wired in U4). NO `'use client'`.

- [ ] **Step 4 — entry cards.** Add a card/link to `/team/attendance` on `src/app/team/page.tsx` (ops audience) and on the `/accounting` surface the gate-check chose (accounting/hr audience). Label from `labels.ts`.

- [ ] **Step 5 — verify.** `pnpm lint && pnpm typecheck && pnpm test`. **Real-flow:** dev-preview (super_admin) → `/team/attendance` renders the pilot day's rows with the manual/open-out/unclosed signals; SSR probe (the in-app browser click wedge is documented — RTL + an SSR/RSC probe is the sanctioned substitute if the form won't drive). Zero console errors.

- [ ] **Step 6 — fresh-eyes → ship** (code-only, auto-merge on green). Serialize on `labels.ts`/`role-home.ts` if a nav lane appears.

---

## Task 3 (U3): per-day drill-down + audit signals (code-only)

**Depends on:** U2 merged.

- [ ] **Step 1 — RED: detail view-model.** Extend `tests/unit/attendance-audit-view.test.ts`: `shapeDetailRow` maps an RPC row → a display row with per-row signals (`manual`/`qr` tag, `out_auto` badge, `open` when `out_at` null, `scanned_by` name, session tag, `day_closed` state); rows group by date then session; empty worker → empty. Run → RED.

- [ ] **Step 2 — implement** `loadAttendanceDetail(client, { from, to, projectId?, workerId })` + `shapeDetailRow` in `attendance-audit.ts`. GREEN.

- [ ] **Step 3 — drill section** in `page.tsx`: when `?worker=<id>` is present, load `audit_attendance_detail(..., workerId)` and render the per-session rows below (or in place of) the summary — in_at/out_at, session, in_method/out_method, `out_auto` badge, `scanned_by` name, team lead, project, closure state. Each summary row's name links to `?worker=<id>` (preserving `from&to&project&from-chip`).

- [ ] **Step 4 — verify + fresh-eyes + ship** (code-only). Real-flow: drill a worker on the pilot day → per-session rows with the right signals; zero console errors.

---

## Task 4 (U4): CSV export for payroll (code-only)

**Depends on:** U2 merged (U3 optional).

- [ ] **Step 1 — RED: CSV serializer.** `tests/unit/attendance-csv.test.ts`: `toAttendanceCsv(rows)` emits a header row + one line per detail row with the columns (worker*name, project_name, work_date, session, in_at, in_method, out_at, out_method, out_auto, ot_hours, scanned_by_name, team_lead_name, day_closed); escapes commas/quotes/newlines (RFC 4180 double-quote); `attendanceCsvFilename(from,to)` → `attendance*<from>\_<to>.csv`; empty rows → header only. Run → RED.

- [ ] **Step 2 — implement** `src/lib/muster/attendance-csv.ts` (`toAttendanceCsv`, `attendanceCsvFilename`) — pure, no I/O. GREEN.

- [ ] **Step 3 — the route** `src/app/team/attendance/export/route.ts` (GET): resolve the user, `requireRole`/gate on `ATTENDANCE_AUDIT_ROLES` (the export gate = the page gate — parity); read `?from&to&project`; call `audit_attendance_detail(from,to,project,null)` on the session client; `new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="…"' } })` — the `src/app/payroll/export/route.ts` shape. NO money.

- [ ] **Step 4 — wire** the export link on `page.tsx` to `/team/attendance/export?from&to&project`.

- [ ] **Step 5 — verify + fresh-eyes + ship.** Real-flow: hit the route as dev-preview → CSV downloads with the pilot rows; a non-audit role → the gate's refusal. `pnpm build` (route handler). Zero console errors.

---

## Self-review (plan vs spec)

- **Spec coverage:** Crux 1 access → U1 RPC gate + `ATTENDANCE_AUDIT_ROLES` (U2). Crux 2 where/who → U2 route + gate + entry cards. Crux 3 shape → U2 summary + U3 drill + signals on both. Crux 4 cockpit past-day → **deferred U5, not a task here** (matches spec). Crux 5 money boundary → Global Constraint + no money table anywhere. CSV export → U4. All covered.
- **Type consistency:** `audit_attendance_summary` / `audit_attendance_detail` signatures identical in U1 (produced) and U2–U4 (consumed); `ATTENDANCE_AUDIT_ROLES` = same 7 roles in the RPC bodies (U1) and the TS const (U2), pinned for parity.
- **No placeholders:** RPC SQL is complete; test intents name the exact assertions; gate-checks name the exact live objects to re-verify.
- **Deferred:** U5 (cockpit read-only past-day picker) — documented, not planned, honoring the no-cockpit-churn constraint.
