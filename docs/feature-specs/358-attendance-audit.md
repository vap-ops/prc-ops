# 358 — Attendance audit for office / payroll (ประวัติการเช็คชื่อ)

**Class:** mixed — **U1** (new `SECURITY DEFINER` read RPCs) is danger-path ⇒ additive migration, admin-squash on green under the standing grant + single schema lane; **U2–U4** (page, components, export route, tests) are code-only.

**Origin:** operator direction 2026-07-25 — office staff (accounting/HR first, PM/PD too) need to **AUDIT** attendance: not just today, but **history** — per-worker days present + OT hours over a month / date range, per-day in/out detail, and the audit signals (in_method qr|manual, out_auto, scanned_by, closure state), cross-project, and **exportable for payroll**.

**What office staff get:** a cross-project attendance report they can range-filter, drill into per worker per day, and export as CSV. Scan truth only — never money.

## Current state (evidence — live DB + code @ 0.219.0, 2026-07-25)

- **Attendance data** is `muster_attendance` (spec 306). Live columns (gate-checked): `id, team_id, worker_id, work_date, in_at, in_method (muster_method qr|manual), out_at, out_method (nullable), out_auto (bool), ot_hours (numeric, nullable), scanned_by (uuid NOT NULL), note, session (muster_session regular|ot)`. **No `project_id` column** — a row reaches its project only via `team_id → muster_teams.project_id`. Unique `(worker_id, work_date, session)`.
- `muster_teams (id, project_id, work_date, lead_worker_id, created_by, created_at)` · `muster_team_wps (team_id, work_package_id)` · `muster_day_closures (project_id, work_date, closed_at, closed_by)` PK `(project_id, work_date)`.
- **RLS = SELECT for `authenticated` scoped `can_see_project`** on all four muster tables (spec 306 U2); writes are RPC-only. Live `can_see_project`: see-ALL = `super_admin / project_coordinator / project_director / procurement_manager`; membership-scoped = `project_manager / site_admin / site_owner / auditor`; **else FALSE**. So **accounting, hr, legal, procurement have ZERO muster read access.**
- `is_back_office(role)` = `project_manager, super_admin, procurement, procurement_manager, project_director` — **EXCLUDES accounting + hr, the primary audit audience.** So `is_back_office` is the wrong gate for this feature.
- **Only read surfaces today:** the `/projects/:id/muster` cockpit (`requireRole` `SA_SURFACE_ROLES` = `site_admin/super_admin/procurement_manager`; **date hard-locked to `bangkokTodayIso()`** — past days UI-unreachable, a known day-1 audit finding) and the `/team` hero 3-number card (`loadMusterDaySummary`). **No history / cross-project / export surface exists for anyone.**
- **Live volume (grounding):** 22 attendance rows, all pilot day 2026-07-24, one project — 13 regular + 9 ot; **0/22 via QR** (all `manual`); **9 rows with `out_at` null** (the OT sessions left open past midnight); 07-24 **has no closure row** (the day was never ปิดวัน). So the report surfaces real audit signal from row one: 100% manual, 9 open check-outs, 1 unclosed day.
- **Precedent (spec 350):** `get_my_assigned_work()` = a `SECURITY DEFINER` read RPC serving an RLS-excluded audience (technician), `revoke … from anon` / `grant execute … to authenticated`, self-scoped in the body. The exact pattern this spec reuses — but gated on a role allowlist + visibility-scoped instead of self-scoped.
- **Precedent (spec 345):** `/accounting/review` = a back-office audit queue page. **Precedent (spec 350 reader):** `src/lib/technician/assigned-work-view.ts` (RPC call + row typing; db:types marks RETURNS-TABLE cols non-null → widen nullable ones in the consumer). **Precedent (payroll export):** a CSV export route (`src/app/payroll/export/route.ts`) exists behind `PAYROLL_VIEW_ROLES` (= `PAYROLL_ROLES` + accounting), streaming `text/csv` with a `Content-Disposition` filename.

## Design cruxes (decided, justified, alternatives recorded)

### Crux 1 — Access mechanism → **NEW `ATTENDANCE_AUDIT_ROLES` + DEFINER read RPCs** (RLS untouched)

- **Chosen:** new `SECURITY DEFINER` read RPCs (spec-350 pattern). Each `grant execute … to authenticated`, revokes anon/public, and **gates inside the body**: `raise 42501` unless the caller's role ∈ `ATTENDANCE_AUDIT_ROLES`. RLS on `muster_*` is not touched.
- **The role set is NEW, not `is_back_office`** — because the primary audience (accounting, hr) is deliberately _out_ of `is_back_office`. `ATTENDANCE_AUDIT_ROLES` = `{ accounting, hr, project_director, project_coordinator, procurement_manager, super_admin, project_manager }`.
- **Visibility inside the RPC (two tiers):**
  - **Full cross-project** (`accounting, hr, project_director, project_coordinator, procurement_manager, super_admin`) — every project. Payroll spans projects; this is the point.
  - **Own projects only** (`project_manager`) — scoped by `can_see_project(project_id)`. A PM audits the crews on the projects they oversee, not the firm.
  - Predicate in the body: `role in (<full set>) OR public.can_see_project(t.project_id)`. The 42501 gate is the outer allowlist (7 roles); the predicate then hands PM its membership scope. (site_admin / site_owner / auditor are **not** in the gate, so they never reach the predicate — they keep the cockpit, not this office surface.)
- **Rejected — widen `muster_*` SELECT policies:** would serve accounting/hr on _every_ muster read path (the cockpit too), and `can_see_project` returns FALSE for them so the policy needs an extra OR-arm anyway — more blast radius, couples the office audience to the operational cockpit RLS.
- **Rejected — touch `can_see_project`:** it gates 6+ policies across muster and beyond. Huge blast radius. Refused.

### Crux 2 — Where it lives → **`/team/attendance`** (DetailHeader), reached from /team and /accounting

- **Chosen route:** `/team/attendance`. It co-locates with the muster data (the `/team` hub is the attendance home, spec 334) and auto-classifies as a **DetailHeader detail route** (back chip, no new tab set) — the spec-306-U3 lesson. Multi-parent back chip via `?from` (spec 334 follow-up precedent), so a visitor from `/accounting` returns to `/accounting` and one from `/team` returns to `/team`.
- **Page gate = `ATTENDANCE_AUDIT_ROLES`** (a role not in it gets the not-authorized path). **Entry points** (links only, no role-home flip): a card on `/team` for the ops roles and a card/link on `/accounting` (the review hub or its landing) for accounting/hr. U2 gate-checks each audience role's _actual_ home (`roleHome`) so hr in particular has a reachable door.
- **Minimal nav-SSOT footprint:** labels + entry cards only — **no** `roleHome` change, **no** new `*_TABS` / `*_HUB_NAV` set. (Serialize with any concurrent nav lane on `labels.ts` regardless; none is active at spec time.)
- **Rejected — `/accounting/attendance` sibling:** PM/PD/PC aren't accounting; routing them through accounting chrome is wrong. **Rejected — standalone `/reports/attendance` hub:** a new top-level hub = more nav SSOT (tabs, role-home) for a single report; YAGNI.

### Crux 3 — Shape → **per-worker summary rows (U2) + per-day drill-down (U3)**, signals on both

- **Summary (U2):** one row per worker over the selected range — **days present** (`count(distinct work_date)` where `session='regular'`), **OT hours** (`sum(ot_hours)` where `session='ot'`), **# projects**, and aggregate **audit-signal counts**: manual-vs-qr check-ins, auto-outs, open check-outs (`out_at` null), and days the worker appears on that were never closed. The signal counts flag which rows deserve scrutiny.
- **Drill (U3):** expand a worker → per-day, per-session rows: `in_at / out_at`, `session` (regular/OT), `in_method`, `out_method`, `out_auto` flag, **`scanned_by`** (who recorded it), team lead, project, and the day's **closure state**.
- **Rejected as the primary shape — month grid (worker × day ✓/✗/OT matrix):** payroll audits per worker, not per calendar cell; a wide matrix is mobile-hostile and export-unfriendly. Recorded as a possible future visualization, not built.

### Crux 4 — Cockpit past-day access → **its own unit, DEFERRED this session**

- The `/projects/:id/muster` cockpit hard-locks its date to `bangkokTodayIso()`; the RPCs accept any date, only the UI locks. A read-only past-day date picker on the cockpit is a **separate** concern from the office audit surface (U2–U4 already deliver history + cross-project + export for the office).
- **Deferred (U5, not built here):** the session constraint is explicit — do **not** churn `muster-cockpit.tsx` (spec 357 shipped last night, on-device proof still owed). U5 is documented as an operator-visible follow-up.

### Crux 5 — Payroll tie → **RAW scan truth, hard boundary from money**

- This surface reads `muster_*` **only**. It never touches `labor_logs`, `wage_payments`, GL, or any money view, and computes **no baht**. Attendance (presence, OT hours, methods, closure) is the scan truth payroll _ingests_; the wage derivation is spec 306 U5's separate money spine and stays there.
- The CSV export is scan facts (worker, date, session, in/out, method, ot_hours, scanned_by, project, closure) — the input to a payroll run, not a payroll output.

## Design (units)

### U1 — attendance-audit read RPCs (schema, additive migration, admin-squash on green)

Two `SECURITY DEFINER STABLE` functions, both `grant execute … to authenticated` / `revoke … from anon, public`, both 42501-gated on `ATTENDANCE_AUDIT_ROLES` and visibility-scoped per Crux 1:

- **`audit_attendance_summary(p_from date, p_to date, p_project_id uuid default null)`** → one row per worker in range (and project, if given): `worker_id, worker_name, days_present, ot_hours_total, project_count, manual_in_count, qr_in_count, auto_out_count, open_out_count, unclosed_day_count`. Cross-project when `p_project_id` is null (subject to visibility).
- **`audit_attendance_detail(p_from date, p_to date, p_project_id uuid default null, p_worker_id uuid default null)`** → per-session rows: `worker_id, worker_name, project_id, project_name, work_date, session, in_at, in_method, out_at, out_method, out_auto, ot_hours, scanned_by, scanned_by_name, team_lead_name, day_closed (bool)`. `p_worker_id` non-null → one worker's drill (U3); null → all workers (U4 export source). Ordered `work_date, worker_name, session`.
- `unclosed_day_count` / `day_closed` = `not exists (select 1 from muster_day_closures c where c.project_id = t.project_id and c.work_date = a.work_date)`.
- Worker identity = `workers.name` (already `authenticated`-readable). **`employee_id` (PRC code) is NOT exposed in v1** — it sits behind the workers PII column-wall; a payroll-key column in the export is an open question (below), not built here.

### U2 — report page + range picker + per-worker rows (code-only)

- Route `/team/attendance`, gated `ATTENDANCE_AUDIT_ROLES`; DetailHeader with `?from` back chip.
- **Range picker:** month presets (this month / last month) + a custom from–to; default = current month. Optional **project filter** (defaults to all projects the caller may see).
- **Per-worker summary table** from `audit_attendance_summary`: name · days present · OT hours · # projects · a compact **signals** cell (e.g. `manual N/มือ`, `auto-out N`, `เปิดค้าง N`, `วันไม่ปิด N`) that highlights rows needing scrutiny.
- Entry-point cards on `/team` (ops) and `/accounting` (office); label from `labels.ts` (ties to `MUSTER_LABEL` = เช็คชื่อ per the UI-term SSOT).
- Server-component read on the **RLS session client** (never admin); the DEFINER RPC is the only privileged surface.

### U3 — per-day drill-down + audit signals (code-only)

- Expanding a worker row loads `audit_attendance_detail(…, p_worker_id)` and renders per-day/session rows with in/out times, session tag, `in_method`/`out_method`, `out_auto` badge, `scanned_by` name, team lead, project, and closure state.
- The signals that were _counts_ on the summary become _per-row facts_ here (this is where an auditor sees _which_ check-in was manual, _which_ day is open).

### U4 — CSV export for payroll (code-only)

- An export route (the `src/app/payroll/export/route.ts` pattern — `text/csv` + `Content-Disposition` — but gated on `ATTENDANCE_AUDIT_ROLES`) that calls `audit_attendance_detail(…, p_worker_id => null)` for the selected range/project and streams a CSV of the raw per-session rows.
- Columns = the detail RPC's columns (scan truth). No money. A `Content-Disposition` filename carrying the range.

## Non-goals (YAGNI / scope guards)

- **No new write paths.** Muster scan / close / move flows are untouched; this feature is read-only.
- **No money.** No `labor_logs`, wages, GL, or baht anywhere on this surface (Crux 5).
- **No cockpit churn.** `muster-cockpit.tsx` is not edited (spec 357 on-device proof owed). Past-day cockpit access = deferred U5.
- **No RLS / `can_see_project` change.** Access is the DEFINER RPC gate only (Crux 1).
- **No month-grid matrix** as the primary view (Crux 3).
- **No `employee_id` / PRC code** in v1 output (PII wall; open question).

## Open questions

- **PRC employee code in the CSV export?** Payroll systems key on a stable employee code; `employee_id` is service-role-walled PII. Exposing it to the audit audience via the DEFINER RPC is a deliberate PII decision (like spec 357 U-F's gender grant). **v1 leaves it out** (name + worker_id uuid); 🔔 operator call to add it as a fast follow if payroll needs it.
- **Which `/accounting` surface hosts the entry card** — ✅ decided in U2: the `/accounting` register-row list (labelled + hinted door rows), NOT `/accounting/review` (that page is a money-event queue; attendance is not money).
- 🔔 **`hr` and `project_coordinator` are in the gate but have NO navigation door** (found by U2's fresh-eyes pass, confirmed against `TEAM_PAGE_ROLES`). The `/team` tile only renders for `SITE_STAFF_ROLES` + the two procurement tiers, so: `accounting` reaches the report via its `/accounting` row ✅; `hr` (`roleHome` = `/coming-soon`, no bottom tabs) and `project_coordinator` (`roleHome` = `/projects`, no door added there) can reach it only by typing the URL. **Latent, not user-visible today: 0 live `hr` and 0 live `project_coordinator` users.** Giving them a door means either admitting them to `TEAM_PAGE_ROLES` or adding a door on `/projects` — both are nav-SSOT decisions beyond U2's scope, and `hr` is an entirely unbuilt role. **Operator call when an hr user actually exists.**
- **U5 (cockpit past-day read-only picker)** — build when the 357 on-device proof is in and cockpit churn is safe.

## Units

| Unit | Scope                                                                                                  | Class                                        |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| U1   | `audit_attendance_summary` + `audit_attendance_detail` DEFINER RPCs + `ATTENDANCE_AUDIT_ROLES` + pgTAP | schema — additive mig, admin-squash on green |
| U2   | `/team/attendance` page + range/project picker + per-worker summary rows + entry cards + vitest        | code-only                                    |
| U3   | per-day/session drill-down + audit-signal detail + vitest                                              | code-only                                    |
| U4   | CSV export route (payroll) + vitest                                                                    | code-only                                    |
| U5   | cockpit read-only past-day date picker                                                                 | **deferred** (cockpit-churn constraint)      |

## Verification

- **pgTAP (U1):** each of the 17 `user_role` values either gets rows or 42501 (exhaustive-domain allowlist, doctrine §3); accounting/hr get all projects; PM is scoped to `can_see_project` (a second project's rows never leak to a PM who isn't a member); the signal counts (days_present, ot_hours_total, manual/qr, auto_out, open_out, unclosed_day) compute correctly on seeded rows (assert by seeded property/prefix, never a global count or an operator-editable exact value — doctrine).
- **vitest (U2–U4):** summary view-model (signal formatting, empty state, range default); drill view-model (per-row signals, session split); CSV serialization (columns, escaping, filename); page/route gates pinned behaviourally over the exhaustive role domain.
- **Real-flow:** dev-preview as an audit role → `/team/attendance` renders the pilot day's per-worker rows (13 workers, the 100%-manual / 9-open-out / unclosed-day signals visible), drill shows per-session detail, export downloads a CSV; live RPC drive as an audit role confirms cross-project + scoping; zero console errors.
