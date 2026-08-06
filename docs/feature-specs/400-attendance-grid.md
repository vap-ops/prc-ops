# Spec 400 — ตารางเช็คชื่อ (the attendance grid)

**Status:** spec only. No unit built.
**Audience:** the procurement team running the attendance double-check (spec 397's
ask), plus every other member of `ATTENDANCE_AUDIT_ROLES`.
**Surface:** `/team/attendance` — the same route, a second view. No new nav entry.

Operator, 2026-08-06, on the surface spec 397 shipped one day earlier:

> uxui is unacceptable. you can recommend user to use bigger screens, but design
> better intuitive uxui. how about calendar view?

Two things are granted there and both change the design space: the audience may be
told to use a **bigger screen**, and the operator is asking for a **shape**, not a
tweak. This spec takes the shape seriously and narrows it — a per-worker month
calendar already exists and is not the missing piece.

---

## 1. Why — what the current report structurally cannot show

`/team/attendance` renders one row per worker: name, days present, OT hours, signal
chips, an expandable per-day drill, a CSV link. Every row is derived **from
attendance rows**. That is the defect, and it is not a matter of taste — two of the
three findings a checker most needs are unrenderable in that shape.

Measured live 2026-08-06:

**① A worker who was never scanned has no row at all.** 41 active workers;
**30** appear anywhere in July. The other **11** are not "shown as zero" — they are
absent from the page, because the query that builds the page starts at the
attendance table. "Nobody recorded ต้อม all month" is exactly a double-check
finding, and today it is invisible by construction.

**② A barely-mustered day disappears into per-worker totals.** Headcount by day:

| Jul | 24  | 25  | 26  | 27  | **28** | 29  | 30  | 31  |
| --- | --- | --- | --- | --- | ------ | --- | --- | --- |
|     | 13  | 17  | 18  | 17  | **1**  | 24  | 22  | 23  |

| Aug | **01** | 02  | 03  | **04** | 05  |
| --- | ------ | --- | --- | ------ | --- |
|     | **1**  | 15  | 21  | **4**  | 23  |

07-28 (1 person), 08-01 (1) and 08-04 (4) against a baseline of 17–24 are the days
a checker should open first. 08-04 is already known to be a real hole — spec 397 U3
was proved against it. On the current report each of those days contributes `+1` to
a few workers' "days present" and nothing anywhere says the day was thin.

**③ Nobody is using it.** `/team/attendance` has **zero** route views by any
procurement principal — before or since spec 397 U1/U2 shipped the access and the
door (39 views by `super_admin`, 3 by `accounting`, in 30 days). One day post-ship
is not yet damning, but the surface has to earn the second visit.

### What already exists, and must not be rebuilt

**Spec 374 shipped a calendar on 2026-07-29**: `/workers/[workerId]/attendance`, a
month grid for **one** worker — in–out per cell, OT, `(+1 วัน)`, `บันทึกมือ`,
off-home project code, holiday chips. It is good and it stays.

So the literal reading of "calendar view" is already done. The missing instrument
is the **cross-worker** one: you cannot see 41 people at once, which is where both
findings above live. This spec builds that and links to 374 rather than duplicating
it.

---

## 2. Decisions

### D1 — the shape is a worker × day MATRIX, not a month calendar

Rows = workers. Columns = the days of the selected range. One cell per
(worker, date). A calendar's month layout (weeks as rows) can only ever show one
subject; a matrix shows the whole crew against the same time axis, which is what
makes an outlier visible **without anyone writing a rule for it**: a nearly empty
column, an entirely empty row, one person present on a day the crew was not.

### D2 — spec 358 rejected this shape, and all three of its reasons have expired

Spec 358 §"Shape" rejected the worker × day matrix as primary. Re-read against this
audience, each reason fails:

| 358's reason                | Why it does not transfer                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| "payroll audits per worker" | This audience is not payroll. Oversight is a **scanning** job — a different task needs a different instrument. |
| "mobile-hostile"            | Retired by the operator on 2026-08-06: procurement is office-tier and may be told to use a desktop.            |
| "export-unfriendly"         | The CSV is untouched. A screen and a file are different media (358 U4 already settled that for wording).       |

Recorded explicitly so a future audit does not re-raise the rejection as if it
still stood.

### D3 — the grid is SMALL, which is why this is buildable at all

41 roster rows × the days of a range, and only **13 dates have ever carried
attendance** (24 Jul – 05 Aug). A full month is ≤ 31 columns. This is one desktop
screen, not a virtualisation problem. If the range grows past a month the surface
stays honest by keeping the existing range form — no infinite grid.

### D4 — roster rows are role-split by live RLS, and there is NO admin widening

The `workers` "readable by staff" policy admits
`{site_admin, project_manager, procurement, procurement_manager, super_admin, project_director}`.
`accounting`, `hr` and `project_coordinator` are in `ATTENDANCE_AUDIT_ROLES` but
**not** in that policy — today they read attendance through the DEFINER RPC and
never touch the roster.

So finding ① ships **only to the roles that already own the roster**, read on the
**session client**. The other tier keeps exactly today's population (workers with
attendance). Two populations, one grid.

Rejected: reading the roster through the admin client for everyone. It would hand
`accounting`/`hr` a list of every worker including those who never worked — a real
PII widening — to serve a finding those roles have never asked for. If they want
it, that is a separate operator decision, not a side effect of a UI change.

⚠️ This also **corrects a written claim in spec 358**: that spec states
`workers.name` is "authenticated-readable". The live policy is role-gated. Anything
built on the old sentence should be re-checked.

### D5 — non-working days are SHADED, or the grid cries wolf

`public_holidays` is live with **23 rows** (`holiday_date`, `name_th`, spec 374 U2,
B.E. 2569). Sundays plus those dates render as a shaded column with no finding.

Without this, every Sunday is a 41-cell hole and the reader learns within a week
that holes mean nothing — the failure spec 358 U2 documented (a signal that fires
on every row is not a signal) and spec 341's always-amber board before it. The
shading is load-bearing, not decoration.

⚠️ `public_holidays` is **display-only by operator ruling** (374 §3b). Shading a
column must not change any count, any total, or any wage — it changes what is
DRAWN, nothing else.

### D6 — cell grain is the DATE; the column header carries the project-day facts

A date can carry a regular **and** an OT session (spec 351). The cell merges them —
earliest in, latest out, OT summed — which is exactly what
`buildAttendanceMonth` (`src/lib/attendance/attendance-month.ts`, spec 374) already
does. Reuse that semantic. Do **not** reach for `attendance-sessions.ts`: spec 388
keeps sessions apart on purpose for the ช่าง's own list, and its own header comment
says so.

Facts that belong to the **project-day**, never to a worker cell:

- **headcount** for the day (the finding in ②),
- **closure state** (`ปิดวันแล้ว` / `ยังไม่ปิดวัน` / `ยังอยู่ระหว่างวัน`).

This is spec 358 U2's correction carried forward: repeating a project-day fact on
every worker turns one missed `ปิดวัน` into N findings against N people. In a grid
that error would be 41× worse, so the column header is the only place it may live.

### D7 — same route, a `?view=` toggle, and the list survives

`/team/attendance?view=grid` (the default) and `?view=list` (today's report). No new
tab set, no `*_HUB_NAV` entry, no `roleHome` change — spec 358 deliberately spent
zero nav-SSOT budget on this report and that still holds.

The list is **not** deleted. It is the better shape for "read one person's month" and
it is what the CSV mirrors; a toggle costs one param and removes nothing.

### D8 — desktop-first, said out loud, and the scroll container is a house rule

The grid is a wide surface for an office audience. It scrolls horizontally inside
its own container — and every `overflow-x-auto` row in this app carries the
`[touch-action:pan-x_pinch-zoom]` PAIR (a build-failing guard enforces it). The
page body never scrolls sideways.

Narrow viewports get the LIST view, not a broken grid: the toggle's default is
resolved per viewport class only if that can be done without client JS; otherwise
the grid simply scrolls and the list stays one tap away.

### D9 — the drill is spec 374's calendar, and the link is role-conditional

A worker's name links to `/workers/[workerId]/attendance`. That page gates on
`WORKER_ROSTER_ROLES` = PM set + `procurement` + `procurement_manager` — so
**procurement can open it**, and `accounting` / `hr` / `project_coordinator`
cannot. An unconditional link would hand three roles a redirect.

Render the link exactly for `WORKER_ROSTER_ROLES`; the others keep the existing
in-page drill. `/payroll` already does this same role-conditional link to the same
page — follow it, do not invent a second pattern.

---

## 3. 🔔 The operator decision this spec is blocked on (units U3+)

**Finding a hole is not fixing it, and the people doing the finding cannot fix.**

Live gates, verified 2026-08-06 against `pg_get_functiondef`:

| Action                         | RPC                                    | plain `procurement` |
| ------------------------------ | -------------------------------------- | ------------------- |
| read the audit report          | `audit_attendance_summary` / `_detail` | ✅                  |
| reopen a closed day            | `reopen_muster_day`                    | ✅                  |
| undo a wrong scan              | `muster_undo_scan`                     | ✅                  |
| **add a missing person**       | `muster_scan_in` / `open_muster_team`  | ❌                  |
| **record a missing check-out** | _no RPC exists for any role_           | ❌                  |
| **move a person's day**        | `move_muster_worker`                   | ❌                  |
| **close the day again**        | `close_muster_day`                     | ❌                  |

The four refusing RPCs all read
`{site_admin, super_admin, procurement_manager}`.

**And the split matters: 4 of the 5 procurement people are plain `procurement`**
(only zeeparn is `procurement_manager`). So for 80% of the team the power granted
by spec 397 is **destructive-only** — remove a wrong scan, never supply a right one
— while the commonest correction after finding a hole is _"he was here, add him"_.

A grid that surfaces 11 empty rows and a 1-person day to four people who cannot fix
any of them is a complaint generator, not a feature.

### The options

- **A — procurement may correct, bounded to a day they reopened.** Reuses the loop
  spec 397 U3 already built (reopen → fix → close). Needs: a write path for
  add-person and record-check-out, and a ruling on whether they may re-close.
- **B — procurement stays finder-only; the grid's action is "ส่งกลับให้ SA แก้".**
  No new privilege. Needs a new flag/queue and a notification path — and office-tier
  delivery is the app's weakest channel (LINE reaches no office-tier user at all;
  Telegram binding is at **4 of 41 users**, measured 2026-08-06).
- **C — do nothing; procurement tells the SA outside the app.** Which is what spec
  397 was asked to end.

**Recommendation: A, bounded to a reopened day, via ONE new DEFINER RPC** rather
than widening the four cockpit RPCs. Widening `open_muster_team` / `muster_scan_in`
hands procurement the cockpit's whole write surface with no door to it (dead
privilege), and `set_muster_team_wps` has no `kind` check — spec 397 §9 Q9 already
records that binding a WP to the office team is a wage path held shut only by
rate-0. A single narrow RPC keeps the blast radius nameable.

### ✅ OPERATOR RULING, 2026-08-06 — option A, and both sub-questions answered

> "A, build U1" … "yes re-close too, bind to any open day"

1. **Procurement may correct.** Option A.
2. **They may also RE-CLOSE.** Without it the loop strands: `close_muster_day` is
   what triggers `derive_muster_labor`, so a reopened-and-corrected day whose
   closer never comes leaves wages underived — leaving them worse off than before,
   having un-closed a day they cannot restore.
3. **Bound to ANY OPEN DAY, not only a reopened one.** This is the ruling that
   changed the design, and the measurement behind it: `reopen_muster_day` has
   **0 audit rows all-time** — the power shipped 2026-08-05 and has never been
   used. Gating corrections behind a reopen would have put a new capability behind
   a ritual nobody performs, which is spec §1③'s failure in a new costume. An open
   day is a state that already exists (6 project-days live).

⇒ **The rule is: `procurement` may write to a project-day that has no
`muster_day_closures` row.** A closed day still needs `reopen_muster_day` first —
which they already hold — so the reopen path is not retired, it is just no longer
the only door.

### What U3 must change (gate-checked live 2026-08-06)

- **`close_muster_day(p_project, p_date)`** — role list gains `procurement`, AND it
  needs the cross-project arm, because its second gate is
  `if not can_see_project(p_project)` which is **live-FALSE for procurement**.
  Same shape `reopen_muster_day` and `muster_undo_scan` already use:
  `v_role = 'procurement' or can_see_project(...)`. Widening only the role list
  would produce a `42501` at the second gate — the spec-397 two-allowlist trap.
- **`muster_scan_in(p_team, p_worker, p_method, p_session)`** — role list gains
  `procurement` + the same cross-project arm, PLUS a **closure guard, which it does
  not have today** (verified: the function never mentions `muster_day_closures`).
  It takes a TEAM, not a project-day, so the guard must resolve the team's
  `project_id`/`work_date` first.
  ⚠️ That the SA can currently scan into a CLOSED day is a **pre-existing hole**;
  U3 closes it for the new arm only and records it rather than silently changing
  the SA path.
- **A day with no team at all cannot be corrected**, because `muster_scan_in`
  requires one and `open_muster_team` needs a lead worker (`lead_worker_id` is
  NOT NULL for `kind='crew'`, spec 397 U4). U3 raises a NAMED error the UI turns
  into honest copy — "ยังไม่มีทีมของวันนั้น" — rather than inventing a lead.
- **The pgTAP role-set pin U2 owes lands here** (U3 touches `supabase/` anyway):
  assert the live `workers` "readable by staff" policy admits every member of
  `WORKER_ROSTER_ROLES`, over the exhaustive role domain. U2's TS pin catches a
  widened role set; only this catches a narrowed POLICY.
- Recording a **back-dated check-out** stays U4 — no RPC does it for any role.

### ⚠️ What the gate-check above MISSED — found at build time, 2026-08-06

The list above names two gates per function and is **incomplete**. It was derived by
reading `close_muster_day`'s own body, and a body-read cannot see a gate reached
through a callee.

**`close_muster_day` PERFORMs `derive_muster_labor`, which carries a THIRD gate** —
role list `{site_admin, project_manager, super_admin, project_director,
procurement_manager}` plus its own `can_see_project` with no cross-project arm, and
its comment reads _"Same authority as the labour engine (log_labor_day).
Money-writing."_ So widening `close_muster_day` alone left procurement passing two
gates and dying at the third: affordance-then-refuse, the three-layer class.

It surfaced because U3a's pgTAP drives the RPC **behaviourally** (`lives_ok`), which
reported `42501: derive_muster_labor: role not permitted`. No amount of re-reading
`close_muster_day` would have shown it. ⭐ **Generalises: when a function you are
widening calls another, the callee's gate is part of your change's surface — read the
call graph one level down, or drive it and read the SQLSTATE.**

**The resolution (operator-ruled 2026-08-06): least privilege, NOT the cheap fix.**
Adding `procurement` to `derive_muster_labor`'s list was rejected — it is directly
`authenticated`-executable, so that list is a real security boundary, and widening it
grants the labour engine's whole authority rather than "may re-close a day", and
persists after 368 U2 lights up the money. Instead the mechanism moved:

| function                       | gate                                   | reachable by                      |
| ------------------------------ | -------------------------------------- | --------------------------------- |
| `derive_muster_labor`          | **unchanged** role list                | `authenticated` (EXECUTE granted) |
| `close_muster_day`             | role list **+ `procurement`** + x-proj | `authenticated`                   |
| `derive_muster_labor_internal` | **none** — it is the mechanism         | **nobody** (EXECUTE revoked)      |

Every entry point authorizes before reaching the mechanism; the mechanism is
unreachable from `authenticated` and `anon`. Procurement gains exactly one power
(re-close, which derives as a consequence) and **no** ability to invoke a derive
directly — pinned in pgTAP, with the `super_admin` positive control that proves the
public gate was not narrowed either.

Two further bounds, both from the build's own self-review:

- **REGULAR sessions only.** `muster_scan_in`'s signature carries
  `p_session default 'regular'`, so the widening also handed procurement the `ot`
  arm — ×1.5 money (spec 351), never part of the ruling. The correction arm now
  refuses a non-regular session; the SA arm keeps both, which is the positive
  control that makes the bound procurement-specific rather than global.
- **The subcon money wall moved with the mechanism**, so
  `tests/unit/contractor-money-wall.test.ts` — which pins the LAST definition of
  `derive_muster_labor` carrying `v_worker.contractor_id is null` — went red. The
  wall was never lost, but the guard's REACH no longer covered the writer. Re-pointed
  at `derive_muster_labor_internal`, plus a new assertion that the public wrapper
  **delegates and does not itself `insert into public.labor_logs`** — without that,
  re-inlining a wall-less body later would pass on a stale `_internal` pin.

⚑ **Left alone deliberately:** `close_muster_day` still does not take
`derive_muster_labor`'s advisory key, so `reopen_muster_day`'s lock is one-sided and
cannot serialise against a concurrent close. **Pre-existing, not introduced here**,
and out of U3a's scope — but it is a real gap and belongs in its own unit. The new
correction arm in `muster_scan_in` DOES take that key, because its write is the one
that can invalidate derive's precondition.

### Why the window is open NOW

`labor_logs` is **0 rows all-time** — no worker has `cost_confirmed_at`, so
`derive_muster_labor` books nothing when a day closes. Attendance corrections
therefore have **zero wage consequence today**. That stops being true the moment
spec 368 U2 confirms the first rate, after which every correction on a closed day
moves money. Build the audited path while it is cheap, or build it later under a
money constraint.

Whichever option is chosen, the write must write `audit_log` — `reopen_muster_day`
already does (action `crew_change`, `payload->>'kind' = 'muster_day_reopen'`), and
that convention (existing action + a `kind`, never a new enum value) is the one to
follow.

---

## 4. Units

Order is load-bearing. U1 and U2 are code-only and additive; nothing they ship
removes an affordance, so they may land before the §3 ruling.

**U1 — the grid (code-only, no schema).**
Matrix over the range's attendance rows: worker rows, day columns, merged
regular+OT cells, per-cell marks for `บันทึกมือ` / `ยังไม่เช็คออก` / `ออกอัตโนมัติ`,
shaded non-working columns (D5), column headers carrying headcount + closure (D6),
the `?view=` toggle (D7), the horizontal scroll container (D8), the role-conditional
drill link (D9). Population = exactly today's (workers with attendance), so U1
changes the SHAPE only and can be judged on that alone.

**U2 — roster rows (code-only, no schema).**
Adds the workers with **no** attendance in the range, for the roles that can read
`workers` on the session client (D4). This is finding ① and it is purely additive:
the same grid gains rows. Ships the "11 of 41" fact.

**U3 — the correction path (schema, danger path). §3 is RULED; blocked only on the
schema lane.**
Widen `close_muster_day` and `muster_scan_in` to `procurement` with the
cross-project arm and an open-day guard, per §3's gate-check list; add the pgTAP
role-set pin U2 owes; then the affordances on the grid, gated on a TS set that
mirrors the RPC allowlists verbatim (the `MUSTER_REOPEN_ROLES` precedent).
Splittable as **U3a** (schema + pgTAP) → **U3b** (the affordances), the order spec
397 U1/U2 used.

**U4 — the back-dated timestamps (schema, and it is older than this spec). SHIPPED
2026-08-06, migration `20260813075915`.**
Two holes, one migration, because they are the same defect twice: `muster_scan_in`
names no `in_at` (so U3a's correction stamps the correction moment, and
`close_muster_day`'s `greatest(day_end, in_at)` auto-out then fabricates a
zero-length session), and no RPC recorded a check-out at a past time for any role.

⚠️ **The "23 of 67 August sessions (34%)" figure was re-measured before building
and it conflates two different populations.** 24 regular rows on 07-31…08-05 sit on
days nobody has closed — `close_muster_day` auto-outs those at 17:00 and U3b shipped
procurement the affordance to do it. The genuinely stuck rows are **9 OT sessions,
all on 2026-07-24, on a day that is CLOSED**, because `close_muster_day` skips
`session = 'ot'` by design. ⭐ **A single percentage over a mixed population is not a
work-list; split it by the mechanism that would clear each part.**

⚠️ **And the check-out hole was "permitted and wrong", not "refused".**
`muster_scan_out` carried no date or closure check, so a `site_admin` could close
those nine sessions today at `out_at = now()` — pricing `ot_hours` at ~13 days.
Invisible to every money test, because `derive_muster_labor_internal` never reads
`ot_hours` (it is presence-based); visible to users, because
`attendance-month.ts`, `attendance-sessions.ts` and `attendance-audit.ts` all
display it.

**Shipped shape** — `muster_correct_session(team, worker, session, in_at, out_at)`,
gated on `{super_admin, procurement_manager, procurement}` (NOT `site_admin`: every
surface reaching a past day is gated on `ATTENDANCE_AUDIT_ROLES`, which has no
`site_admin`, so the grant would be privilege with no door). `muster_scan_out` gains
a matching window and refuses anything past 06:00 the next morning. Retiming an
existing row is allowed on **any day whose wages are not booked, including a closed
one** — the closure is not the guard, the CURRENT-wage anti-join is, exactly as in
`muster_undo_scan`. Adding a missing person stays open-days-and-regular-only, and
delegates the insert to `muster_scan_in` so its invariants are not forked.

▶ **What it unblocks and what it does not.** U3c (add-person) is now unblocked on
the TIME axis and still blocked on the other U3b finding: `procurement` cannot read
a team id, so the picker needs an admin seam or a listing RPC.

**U5 — the correction TRAIL (schema, danger path).**

U3a/U3b/U4/U3c ship the whole WRITE side, and every one of those writes already
lands an `audit_log` row — `muster_correction_scan_in`, `muster_correction_time`,
`muster_undo`, `muster_move`, `muster_day_close`, `muster_day_reopen`, all under
action `crew_change`. **Nothing in `src/` reads any of them.** So the question the
audit trail exists to answer — _who edited this day after the fact, and what did it
say before?_ — is answerable only by an operator running SQL.

⚠️ **And it is not merely unbuilt, it is unreachable.** `audit_log`'s RLS is two
policies: an internal-privileged arm (`super_admin`, `project_director`,
`accounting`, `project_manager`) and a WP-rework arm that gives `site_admin`,
`procurement` and `procurement_manager` exactly two payload kinds
(`wp_reopened_for_defect`, `wp_evidence_resubmitted`). **The correction audience
cannot read its own trail on the session client**, so this needs a DEFINER RPC, not
a query.

🚨 **THE MEASUREMENT THAT SHAPED THE QUERY, and it was taken from the live rows
rather than from the producing migrations: `muster_move` and `muster_undo` payloads
carry NO `project_id`.** `muster_move` carries `from_team`/`to_team`, `muster_undo`
carries `team_id`; both must be resolved through `muster_teams`. **13 of the 16 live
rows are `muster_move`** — so a payload-only filter would have rendered an EMPTY
trail on every real day, with every assertion about the other four kinds passing.
⭐ The general form: _a payload written by six different functions is six different
shapes; read the rows, not the writers._

**Shape** — `list_muster_day_audit(p_project uuid, p_date date)`, SECURITY DEFINER,
read-only. Seam chosen by the precedent U3c already set: `audit_attendance_summary`,
`audit_attendance_detail` and `list_muster_teams_for_day` are all DEFINER RPCs
serving this audience this data.

- **Gate = `ATTENDANCE_AUDIT_ROLES`** — the eight roles that already open the
  report. Deliberately WIDER than the correction audience: `accounting` owns the
  wage consequence of a correction and `hr`/the PM tier read the same report, and a
  reader who is shown a hole must be able to see who has already touched it.
  Reusing the existing set is also what keeps the unit's `src/` half free of a new
  role-set export (no capability-registry row, no `role-home.ts` danger path).
- **Scope = the second list**, mirroring `audit_attendance_summary`: the
  cross-project tier passes any project; `project_manager` alone must pass
  `can_see_project`. An unseeable project is a **refusal, not an empty list** — an
  empty trail reads as "nobody edited this day", which is a different fact and the
  one a reader would act on (spec 400 U2's wider-of-two-gates lesson, and U3c's
  refusal-over-silence one).
- **Rows** carry `logged_at`, `kind`, the actor (id, `users.full_name`, and the role
  **as recorded on the audit row**, not as it is today), the worker, the session,
  and a `detail` jsonb built explicitly per kind — the prior `in_at`/`out_at` for a
  retime or an undo, the team names either side of a move, the mandatory reason for
  a reopen. Explicit rather than the raw payload: `before` is a whole row snapshot
  and has no business reaching the client.

**Surface** — a section inside the U3b `?day=` panel, under the reopen/close
controls that produce the rows. The panel's grain is already the project-day, which
is the audit grain. It requires a picked project, exactly as the controls do.

---

## 5. Acceptance

Each is one query, and each answers "is it actually used", not "did it render".

1. **The audience arrives:** `select actor_role, count(*) from interaction_events
where route like '/team/attendance%' and created_at > now() - interval '14 days'
group by 1` — a `procurement` row must exist. It is **0 all-time** today.
2. **The grid is the view they keep:** the same query split by
   `context->>'view'` (or the route's query string) — `list` should not dominate.
3. **The finding is acted on:** `select count(*) from audit_log where action =
'crew_change' and payload->>'kind' = 'muster_day_reopen'` — **0 today**. A
   non-zero count is the first evidence the double-check loop closed end to end.
4. **U5's trail has something to report:** `select payload->>'kind', count(*) from
audit_log where action = 'crew_change' and payload->>'kind' like 'muster%' group
by 1` — **16 rows today, 13 of them `muster_move` and exactly one
   `muster_correction_time`** (a retracted gate-4 probe). A correction row written
   by someone who is not an agent is the first evidence the loop is in real use.
   ⚠️ **Panel opens are NOT measurable and no query should pretend otherwise:**
   `interaction_events.route` stores the path WITHOUT its query string (all 93
   rows in 30 days read exactly `/team/attendance`), so `?day=` and `?worker=` are
   invisible to telemetry. Measuring drill-down would need its own event, which
   this unit does not add.
5. **U2's finding is real:** re-run the roster gap
   (`41 active / 30 appeared` in July) at the end of the next full month; if the gap
   is still ~11 the rows are earning their place, and if it collapses to 0 the
   feature has done its job.

---

## 6. Open / owed, deliberately not built

- **Which range does a checker actually want?** The report defaults to
  month-to-date. A grid may want "this week" as its default. Not decided; U1 keeps
  the existing default so the change is one variable at a time.
- **Sorting the rows.** Alphabetical is the current implicit order. Sorting by
  "most anomalies" is tempting and is the spec-375 trap in miniature — check the
  distribution before ranking on any column.
- **`project_coordinator` and `hr` have no `/team` door** (spec 358's owed note) and
  `procurement_manager` has no `/team` door at all (spec 397 §9 Q15). The grid does
  not fix nav; it inherits those gaps.
- **Cross-project cells.** A worker-day is provably single-project, so a cell can
  name an off-home project — 374's calendar already does. Not in U1's scope.
- The `/team/attendance` CSV export writes **no** `audit_log` row (spec 397's
  recorded item). Unchanged here, still owed a decision.
- ⚠️ **The `WORKER_ROSTER_ROLES` pin is ONE-DIRECTIONAL, and closing it is owed to U3.** U2's
  roster is a SESSION read, so it depends on the live `workers` "readable by staff" policy —
  but the test asserts the TypeScript array. It therefore catches someone WIDENING the role set
  and is blind to the POLICY being narrowed underneath it, which would produce a silent empty
  roster rather than a refusal. The pin belongs in pgTAP over the exhaustive role domain (the
  `358-attendance-audit.test.sql` precedent). It is deferred to U3 rather than built here only
  because U3 touches `supabase/` anyway, while U2 is otherwise code-only.
- **The grid path now costs four reads** — `audit_attendance_summary`, the
  full-range `audit_attendance_detail`, and the holidays select — and the summary's
  only remaining jobs on that path are the header totals, `unclosedDaySignal` and
  the empty-range gate, all of which the detail rows already carry. Collapsing it
  to one read is a real simplification and it changes what the header renders, so
  it is its own unit, not a U1 side effect. Found in review; trivial at today's
  volumes (261 detail rows for a month) and worth doing before the roster grows.
- **`บันทึกมือ` / `ออกอัตโนมัติ` are free string literals in several components**
  (6 and 3 copies in `src/`). The UI-term SSOT rule says a term used in 2+ places
  belongs in `labels.ts`; that file is one of the repo's two constant colliders, so
  hoisting them is a sweep of its own rather than a rider on this unit. `(+1 วัน)`
  was aligned here because it was a THIRD name for a fact two neighbouring surfaces
  already agreed on.

---

Related: `358-attendance-audit.md` (the report this replaces as the default view) ·
`374-worker-attendance-calendar.md` (the per-worker calendar the grid links to) ·
`397-office-attendance-and-procurement-oversight.md` (the access + the reopen loop) ·
`306-scan-muster.md` (the muster the grid reads).
