# 397 — ลงเวลาทีมสำนักงาน + จัดซื้อตรวจสอบเวลา (office attendance & procurement attendance oversight)

**Status:** draft
**Author:** CC session 2026-08-05
**Related:** spec 306 (scan muster), spec 358 (`/team/attendance` audit report),
spec 334 U3 (the `/team` hub), spec 368 U2 (rate confirmation — the wage window
below closes when it lands), ADR 0075 / site-governance separation of powers
(`site_owner`, `auditor`)

---

## 1. Why — two asks, both about people the muster does not model

Operator, 2026-08-05, after an onboarding inspection:

1. _"At the moment, procurement team is double checking the attendance, enable them"_
2. _"The site office team doesn't know how to take attendance of themselves yet"_

The muster models exactly one shape: a ช่าง in a crew team, scanned by the site
admin. Everyone else — the procurement staff who verify the result, and the
office/visiting staff whose own presence is never recorded — falls outside it.

## 2. Measured state (live, 2026-08-05 — re-measure at build time)

| Fact                                                     | Value                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/team/attendance` route views, all time                 | **42** — `super_admin` 39, `accounting` 3                                                                                                   |
| `procurement_manager` views of `/team*`, 30d             | **0** (their 30d top routes: `/requests` 6147, `/procurement` 3396, `/catalog` 3073)                                                        |
| Live role gate on `audit_attendance_summary` / `_detail` | `accounting, hr, project_director, project_coordinator, procurement_manager, super_admin` (+ `project_manager` scoped by `can_see_project`) |
| Live role gate on **every** muster write RPC             | `site_admin, super_admin, procurement_manager`                                                                                              |
| Un-close / reopen path                                   | **does not exist** — `muster_undo_scan` raises `P0001 the day is already closed`                                                            |
| `labor_logs` rows, all time                              | **0** — `derive_muster_labor` books only when `cost_confirmed_at is not null`, and **no worker has it set**                                 |
| Office-tier users with a `workers` row                   | **1 of 22** (`aemon`, site_admin)                                                                                                           |
| `get_my_attendance` gate                                 | `current_user_worker_id() is not null` ⇒ an office user without a worker row sees nothing                                                   |
| `muster_teams` grain                                     | one row per **project × work_date**, `lead_worker_id` is a **worker**                                                                       |
| `site_owner` / `auditor` users                           | **0 each** (both exist in the `user_role` enum)                                                                                             |
| Precedent for a wage-free attendee                       | `Preston Inter` — `pay_type=monthly`, `day_rate=0`, **6 attendance days, 0 wages**                                                          |

⭐ **The `labor_logs = 0` line is the schedule.** Closing a day currently books
nothing, so a correction path can be built and exercised on real data with zero
money blast radius. That window shuts the moment spec 368 U2 confirms the first
rate — after which every correction to a closed day must retract and re-derive.

## 3. The two gaps

**A — procurement is refused twice, and the permitted role has no door.**
Plain `procurement` (4 users) fails the audit RPCs _and_ every write RPC, so the
team doing the double-checking today is doing it outside the app.
`procurement_manager` (1 user) **is** already permitted — and has never once
opened `/team`, let alone the report. The `/team` hub already admits both roles
(`TEAM_PAGE_ROLES`), and `team-tiles.tsx:182` renders the attendance tile on
`ATTENDANCE_AUDIT_ROLES` — so a set widening lights the tile, but the tile is on a
hub this audience does not visit. Permission and door are two units, not one.
Same class as spec 396 U4: _the surface existed, the door did not._

**B — office staff are invisible to the attendance model.**
No worker row ⇒ no badge (the sheet groups by `project_id`), no scan target
(`muster_attendance.worker_id` is a NOT NULL FK), and no own-history read. And a
visiting auditor is the same shape as an office person: present on site, not a ช่าง.

## 4. Decisions (operator, 2026-08-05)

- **D1 — procurement gets read _and_ correct.** Not read-only: the double-check
  finds wrong or missing rows (e.g. 2026-08-04 carries **4** check-ins between a
  21 and a 23, all manual, and the day is closed), and a checker who cannot fix
  what they find hands the work back to the SA.
- **D2 — teach the office team, and give every site a standing office team led by
  the `site_owner`.** A visiting `auditor` checks into that same team. It must be
  **prominent in the UI**, not a hidden tab.

## 5. Design

**5.1 Office attendance rides the existing muster, wage-free by construction.**
An office person gets a `workers` row with `day_rate = 0` and
`cost_confirmed_at = null`; `derive_muster_labor`'s cost gate
(`contractor_id is null AND cost_confirmed_at is not null AND day_rate > 0`)
therefore books nothing for them, today and after 368 U2. This is not a new
mechanism — `Preston Inter` has attended 6 days this way. It buys badges,
scanning, `get_my_attendance`, and the audit report for free.
⚠️ It also puts office people into every surface that reads `workers`. §9 Q1.

**5.2 The office team is a team KIND, not a naming convention.**
`muster_teams` gains `kind` (`crew` | `office`, default `crew`) with a partial
unique index of one `office` team per project × date. `open_muster_team` takes the
kind. The lead is the site owner's worker row and is **nullable** — zero
`site_owner` users exist today, and a team that cannot open until an appointment
lands is a team nobody can check into.

**5.3 Correcting a closed day needs a reopen, and the reopen is the danger.**
There is no un-close path by design. The unit adds `reopen_muster_day(project,
date, reason)` — audited, reason mandatory — which deletes the closure row and, when
`labor_logs` rows exist for that day, retracts them through the same retract loop
`derive_muster_labor` already owns. It must take **derive's own advisory lock**
(`pg_advisory_xact_lock(hashtextextended(project||'|'||date, 0))`) — the lesson
`muster_undo_scan` records in its own body. Correction then uses the existing
scan/undo/move RPCs, and the day is closed again afterwards.

## 6. Units

| Unit   | What                                                                                                                                                                                             | Schema? |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **U1** | `procurement` joins `ATTENDANCE_AUDIT_ROLES` + `ATTENDANCE_AUDIT_ALL_PROJECT_ROLES`; migration widens both `audit_attendance_*` allowlists to match; capability registry; pgTAP + role-sets pins | **yes** |
| **U2** | The door: an attendance card on `/procurement` (3396 + 1814 views/30d) for the whole procurement tier. Ships with or after U1, never before — a card to a page that 42501s is a lie.             | no      |
| **U3** | `reopen_muster_day` + widen the muster write RPCs to `procurement`; the reopen affordance on `/team/attendance` with a mandatory reason. **DANGER PATH.**                                        | **yes** |
| **U4** | `muster_teams.kind` + one-office-team-per-day index + `open_muster_team(p_kind)`; office team never counts toward crew totals.                                                                   | **yes** |
| **U5** | Prominent office-team surface: a pinned ทีมสำนักงาน card on `/team` and the SA cockpit, opening the team and scanning office/visitor badges.                                                     | no      |
| **U6** | The teaching half: Thai how-to for the office team + the operator data op creating their worker rows (rate 0) and printing badges.                                                               | no      |

Order is load-bearing: **U1 → U2** (permission before door) and
**U4 → U5 → U6** (a card for a team that cannot exist is the same lie as U2's).
U3 is independent of both and carries its own risk.

## 7. Gates

- Every role-set edit must be mirrored **verbatim** by the RPC allowlist in the
  same PR — spec 358's own comment makes that a rule; drift is a silent 42501.
- Adding an exported role set trips spec 316's capability-registry bijection —
  register it in the SAME edit.
- U3 and U4 touch `supabase/migrations/**`; U3 also touches the muster write path
  ⇒ danger-path guard red by design ⇒ operator-held merge.
- pgTAP: no bare global `count(*)` over an app-written table (#954/#961).

## 8. Non-goals

- **No self check-in button and no poster self-scan.** Offered and declined —
  office attendance is recorded through the existing scan, by the site owner or SA.
- **No new attendance store.** Office presence is `muster_attendance`, same table,
  same audit trail.
- **No wage path for office staff.** Rate 0 / unconfirmed is the whole mechanism.

## 9. Open questions

- **Q1 — office people in `workers` surfaces.** A rate-0 office row appears in the
  roster, the badge sheet, `/workers`, and the payout-account audit (spec 395).
  Filter them out by `kind`/`employment_type`, or accept the noise?
- **Q2 — who may reopen a closed day?** U3 assumes the same set that may close it
  plus `procurement`. `site_admin` closing and `procurement` reopening is the
  separation of powers ADR 0075 wants; confirm before building.
- **Q3 — the 2026-08-04 hole.** 4 check-ins against 21/23 either side, day closed.
  Fix it as the first real use of U3, or leave it as-is and record the reason?
- **Q4 — the CSV export writes no `audit_log` row.** `/team/attendance/export` lets
  any audit role bulk-download every worker's cross-project attendance (names,
  scan times, who recorded each one) with no record that they did. Pre-existing for
  the other seven roles, so U1 is not a regression — but procurement is explicitly
  the OVERSIGHT tier, which is the role class where an unlogged bulk export of
  other people's movements is most worth a deliberate decision. Log it, or accept?
  (Raised by the U1 fresh-eyes review, not built — out of U1's scope.)
- **Q5 — the inner (cross-project) arm is pinned for only 2 of its 7 members.**
  `358-attendance-audit.test.sql` asserts real cross-project reach for `accounting`
  and (U1) `procurement`; the other five are covered only by the outer `lives_ok`.
  Dropping any of them from the inner list would leave the suite green while their
  report renders empty — the exact silent failure U1's own mutation test exposed.
  A loop over the tier would close it. Pre-existing hole; not U1's to fix.
