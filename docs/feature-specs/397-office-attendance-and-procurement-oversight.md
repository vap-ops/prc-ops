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

**5.3a What U3 actually unblocks (gate-checked at build time, and it narrowed
the unit).** `muster_scan_in` carries **no closure guard** — the SA can already
add rows to a closed day — so ADDING was never blocked. `muster_undo_scan` is the
one that refuses (`P0001`), and `close_muster_day` is idempotent and re-derives.
So reopen is the real blocker and the loop is reopen → fix → close again. U3
therefore widens only `muster_undo_scan` to `procurement`, not the other four
write RPCs: procurement has no cockpit door, so that privilege would be dead
weight. Giving procurement a scanning surface is a separate unit if it is ever
wanted.

⚠️ **Built, and it cost two corrections worth recording.** ① `lead_worker_id` was
`NOT NULL` **at the table level**, so no amount of RPC logic could have allowed a
leadless office team — the first insert died `23502`. Dropping that constraint
outright would let a CREW team exist with no lead, and the cockpit board GROUPS by
lead, so the rule moved from "always" to per-kind:
`CHECK (kind = 'office' OR lead_worker_id IS NOT NULL)`, strictly stronger than
the old NOT NULL for crew rows. ② The 3-arg `open_muster_team` is **dropped**, not
left beside the 4-arg one — two overloads make PostgREST resolve by argument
NAMES, so an existing 3-name call would go ambiguous instead of defaulting. The
drop also takes the old ACL, so the `revoke … from public, anon` is mandatory: a
new function is born executable by anon.

**5.2a Which readers exclude the office team, decided once.** `loadMusterBoard`
(groups by lead — a leadless team renders headless) and the prior-day rows that
seed crew suggestions filter `kind = 'crew'`; so does the `/team` hub's วันนี้
card, because that card is the crew's and U5 owns the office surface. The
prior-team-BY-LEAD read needs no filter (`eq(lead_worker_id)` never matches null),
and **`loadUnclosedPriorDays` is deliberately NOT filtered** — closure is a
project-DAY fact, so an office-only day still needs closing and filtering there
would hide it. All five classifications are pinned in `office-team-kind.test.ts`.

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

U2 note (decided at build time): the door is a **labeled card**, deliberately not
a member of `PROCUREMENT_STR_SECTIONS` — the ทั้งหมด grid and the icon chip row
are the purchasing spine (ขอบเขต / เวลา / ทรัพยากร), and attendance oversight is
not a purchasing door. Precedent: the คำขอสมัคร nudge sits outside that list too.

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
- **Q9 — an office team can still be bound to a WP, and that IS a wage path.**
  `set_muster_team_wps` accepts any `muster_teams` row (no kind check) and
  `derive_muster_labor` joins attendance to teams without one, so binding a WP to
  the office team would book a wage for any office attendee who later gains a
  confirmed rate. §8 says "no wage path for office staff", and today TWO accidents
  hold it shut — rate 0, and zero WPs on that team — neither of them a constraint.
  Guard `set_muster_team_wps` with `kind <> 'office'`, or accept it? Found by the
  U4 review; deliberately not built, because it changes another RPC's contract.
- **Q10 — the unclosed-day banner counts teams, including the office one.**
  `loadUnclosedPriorDays` is (correctly) unfiltered — closure is a project-day
  fact — and its `teamCount` renders as `N ทีม`. So an office-only day will read
  "1 ทีม" while the crew-filtered วันนี้ card reads `not_started` and the board is
  empty: one surface nags to close a day another says never happened. Unreachable
  until U5 creates office teams; U5 should decide whether that count means crews
  or teams.
- **Q2 — who may reopen a closed day?** U3 assumes the same set that may close it
  plus `procurement`. `site_admin` closing and `procurement` reopening is the
  separation of powers ADR 0075 wants; confirm before building.
- **Q3 — the 2026-08-04 hole.** 4 check-ins against 21/23 either side, day closed.
  Fix it as the first real use of U3, or leave it as-is and record the reason?
- **Q7 — should `procurement` be able to CLOSE a day, not just reopen one?**
  U3 gives them the reopen; `close_muster_day` still admits only
  `SA_SURFACE_ROLES` and applies `can_see_project`, both of which plain
  procurement fails. So the loop is deliberately two-person: procurement reopens
  with a reason, the SA fixes and closes. The copy says exactly that (it does not
  tell a non-closer to close), and the report already flags the interim state as
  `ยังไม่ได้ปิด`. Widening close would hand a money-deriving action to that tier —
  an operator call, not a build-time one. ⚠️ Nothing NOTIFIES the SA that a day
  was reopened; today it is visible only as an unclosed day on the report.
- **Q8 — `site_admin` holds reopen at the DB level with no door.** It is in
  `MUSTER_REOPEN_ROLES` (mirroring the RPC, which must admit whoever may close),
  but the form renders on `/team/attendance`, which `site_admin` cannot open —
  spec 358 deliberately keeps them on the cockpit. Their cockpit's closed-day
  refusal now states the precondition without naming a surface they lack. Give
  the cockpit its own reopen control, or leave it to the office tier?
- **Q6 — `procurement` cannot read its own audit trail.** `audit_log`'s SELECT
  policy is an event allowlist: privileged internal roles, plus site_admin /
  procurement / procurement_manager for `wp_reopened_for_defect` and
  `wp_evidence_resubmitted` **only**. So the role that reopens a day writes an
  audit row it can never see, and no surface shows reopen history to anyone.
  Found while writing U3's pgTAP (the asserts read 0 until they ran as the
  owner). Surface it, widen the allowlist, or leave it to the DB? Not U3's call.
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
