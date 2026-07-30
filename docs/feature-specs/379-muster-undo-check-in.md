# 379 — Undo a muster check-in

**Status:** draft, 2026-07-30
**Origin:** operator, 2026-07-30 — _"allow each scan to add to team, then allow SA to confirm or
edit."_ The "add on each scan" half already works (one `musterScan` RPC per decode). The **edit**
half does not exist at all. The face-photo half is [spec 378](378-worker-identity-photo.md).
**Schema:** YES — one new DEFINER RPC (no table, no column, no enum). Claims the schema lane.

---

## 1. Why this exists

Gate-checked live 2026-07-30: there are **seven** muster RPCs —
`open_muster_team`, `muster_scan_in`, `muster_scan_out`, `set_muster_team_wps`,
`move_muster_worker`, `close_muster_day`, `derive_muster_labor` — and **not one of them removes an
attendance row.** Once a badge decodes, that worker is recorded present for the day. The only
repairs available are:

- **move** them to a different team (`move_muster_worker`), or
- **check them out** (`muster_scan_out`), which asserts they were here and left.

Neither says _"this did not happen."_ ⚠️ One non-RPC path does remove attendance rows:
`muster_attendance_team_id_fkey` is **`ON DELETE CASCADE`** on `muster_teams`, so deleting a team
takes its attendance with it — silently, and with no audit trace, which is precisely the gap D1's
audit-first ordering closes for the deliberate case. That cascade is out of scope here but should
not be described away: the accurate claim is that no RPC offers a _per-worker_ retraction.

And the SA is already reaching for the one she has:
**`move_muster_worker` has been used 13 times since 2026-07-19** (audit `crew_change`,
`payload->>'kind' = 'muster_move'`). Some of those are real team changes; the operator's request
says the rest are corrections being forced through the wrong door.

The cost of the gap is not cosmetic. Attendance is the input to `derive_muster_labor`, which
writes `labor_logs` — wages. A wrongly-present worker is a wrongly-paid worker the moment the
cost gate opens (today `labor_logs` is 0 rows because 0 of 31 workers are cost-confirmed; spec 369
U2 is the operator action that opens it). **Building the undo before that gate opens is much
cheaper than repairing money after it.**

⚠️ This becomes more likely, not less, now that #860 made the scanner continuous: the SA sweeps a
line without looking at the screen between people, so a stray badge in frame is recorded with no
one watching. The undo is the other half of that change.

---

## 2. Decisions

**D1 — Undo DELETES the row; the audit log carries the trace.** `muster_attendance` has **no
triggers**, is not in the append-only family, and `authenticated` holds `SELECT` only (writes are
RPC-only) — so a delete is mechanically clean. A tombstone column would be the more conservative
shape, but it would touch every reader (`derive_muster_labor`, the cockpit board query, the
spec-374 per-worker calendar, the spec-358 audit report) and each one that forgot the filter
would keep counting a retracted person. **The honest minimum: delete the row, and write the full
deleted row into `audit_log` first** — that table is append-only and immovable in three layers, so
the trace outlives the record. "This person was never here" is exactly what a mis-scan means.

**D2 — Refuse after the day is closed.** `close_muster_day` books wages (it calls
`derive_muster_labor` inline). Undoing an attendance row underneath a closure would leave a
`labor_logs` row whose basis vanished, and ⚠️ **`labor_logs.source_muster_id` has NO foreign key**
(verified: zero constraints reference it), so nothing at the database level would stop it or
cascade it. The RPC therefore checks `muster_day_closures` for that project+date and refuses. A
closed day is repaired by the existing retract-then-re-derive path, not by this RPC.

**D3 — Refuse when a `labor_logs` row already points at it.** Defence in depth behind D2, because
`derive_muster_labor` is callable directly, not only through `close_muster_day`. (Its own body
says in so many words that no cron calls it — so this guard rests on direct callability, not on a
scheduler that does not exist.) Cheap to check, and it fails closed.

**D4 — Refuse to undo a `regular` session while an `ot` session exists for that worker that day.**
`muster_scan_in` enforces that OT may only be opened _after_ the worker's regular session on the
same team; deleting the regular row would strand the OT row against its own invariant. The SA
undoes the OT first. (The refusal must say so — see D7.)

**D5 — Any unclosed day, not just today.** `close_muster_day` accepts any date, the prior-day
close banner already lists unclosed past days, and no `muster_*` SELECT policy carries a date
predicate. Restricting the RPC to `today` would make yesterday's mis-scan permanently
unrepairable while yesterday's _closure_ stays reachable — an inconsistent pair. The cockpit UI
is today-locked; that is a UI fact, not a rule to bake into the RPC.

**D6 — Two doors, both two-tap.**

1. **The sweep tally row** — the common case, and the one the operator described: wrong person,
   three seconds ago, sheet still open. ⚠️ No tally _row_ reads `เพิ่มแล้ว` — that is the count
   line's `countNoun`, and an `added` row renders the name alone (`OUTCOME_NOTE.added` returns
   null). The undo belongs on rows whose outcome is in `WRITE_KINDS`
   (`muster-add-sheet.tsx:76-81`), which is also the correct predicate for "only rows that
   actually wrote".
2. **The team-card member row** — the same repair, found later.

Two-tap confirm on both: this destroys an attendance record, and the cockpit's own precedent for
a destructive-feeling action is confirm-then-act.

**D7 — New refusals get their own Thai copy; do not reuse `scanErrorToThai`'s existing arms.**
That mapper already has a recorded defect — it answers a refused _day-close_ with
`ไม่มีสิทธิ์เช็คชื่อ` ("no permission to take attendance"), the wrong domain. Four new refusal
reasons arrive with this RPC (closed day · wages already booked · OT still open · not permitted)
and each needs copy that names what to do next. ⚠️ And the undo control's label must not read like
`เช็คออก` — "they left" and "they were never here" are different claims about a person's day.

---

## 3. The RPC

`muster_undo_scan(p_worker uuid, p_date date, p_session muster_session) returns void`,
SECURITY DEFINER, `set search_path to 'public'`.

⚠️ **Revoke from `public, anon`, not just `anon`** — a new function carries a default PUBLIC
EXECUTE grant (the #833 lesson: a widened RPC shipped callable by `anon` because the revoke named
only `anon`).

Guards, in order, each with its own SQLSTATE so the client can classify:

1. `current_user_role()` ∈ `('site_admin','super_admin','procurement_manager')`, else `42501`.
   This is the verbatim gate on `muster_scan_in`/`_out` — parity by construction, so there is no
   affordance-then-refuse seam (the three-layer authority rule: the button, the server action and
   the RPC must admit the same set).
2. The row exists for `(p_worker, p_date, p_session)` — the live unique key is
   `UNIQUE (worker_id, work_date, session)`, so this triple identifies exactly one row — else `P0001`.
3. `can_see_project(team.project_id)` for the row's team, else `42501`.
4. No `muster_day_closures` row for that project + date, else `P0001` (D2).
5. No `labor_logs` row with `source_muster_id` = this row, else `P0001` (D3).
6. If `p_session = 'regular'`, no `ot` row for that worker+date, else `P0001` (D4).
7. Write `audit_log`: action `crew_change`, `payload` = `{kind:'muster_undo', worker_id, work_date,
session, team_id, in_at, in_method, out_at, ot_hours, scanned_by}` — the whole row, because
   after the next statement it is gone. Then delete.

### 3.1 pgTAP

RED-first, one assert per guard, **each pinning the SQLSTATE and the message** — and every
absence-style assert needs a positive control (a caller who _may_ undo, undoing successfully),
or "0 rows deleted" is equally consistent with "the guard works" and "the whole function is
broken".

⚠️ Do not assert global counts over `muster_attendance` (167 live rows, operator-written) — that
is the merge-queue-ejector class. Seed and assert your own rows.

---

## 4. Surfaces

- `muster-cockpit.tsx` — the member row's undo, and the sweep tally row's undo. The tally already
  distinguishes outcomes (`added`, `already_here`, `other_team`, …); only rows that actually
  **wrote** are undoable.
- `src/lib/muster/actions.ts` — one new action mirroring `musterScan`'s shape (getActionUser →
  RPC → Thai error map).
- `src/lib/muster/sweep.ts` — the tally must reflect the undo. The removal shape **already
  exists**: `markFailed` (`sweep.ts:317-328`) filters the id out of `addedIds` when a write is
  refused, which is exactly what an undo needs. Mirror it rather than inventing a remover — and
  clear `addedRef` too, or the closing `router.refresh()` count and the "already added this
  sweep" classification both go wrong.
- ⚠️ **`addedRef` and `sweepGenRef` are episode state.** An undo issued for a row whose sweep has
  ended must land on the page-level alert, not silently no-op against a replaced tally — the same
  late-completion hazard that #764 fixed for failed writes. Carry the generation.

---

## 5. Non-goals

- **No undo after close.** D2. The repair path for a closed day already exists.
- **No bulk undo.** One person, one deliberate act.
- **No time editing.** Correcting a wrong `in_at`/`out_at` is a different feature with a different
  authority question.
- **No un-checkout in v1** — but ⚠️ **named as the adjacent gap**: `muster_scan_out` has _no
  already-out guard_ and sets `out_at = now()` unconditionally, so a second scan silently rewrites
  a real 17:13 departure. That is recorded as owed from spec 359 U4 and is the sibling repair to
  this one; it belongs in the same neighbourhood but is a separate unit.

---

## 6. Acceptance

Not a green suite — the measure is that the wrong door stops being used:

```sql
select date_trunc('week', created_at)::date as wk,
       count(*) filter (where payload->>'kind' = 'muster_undo') as undos,
       count(*) filter (where payload->>'kind' = 'muster_move') as moves
from public.audit_log
where action = 'crew_change' and created_at > now() - interval '60 days'
group by 1 order by 1 desc;
```

Baseline: **0 undos, 13 moves since 2026-07-19.** If undos stay at 0 while moves continue, the
control is not where the SA looks — re-open D6 rather than adding a hint. If moves fall and undos
rise, the correction was being forced through the move door exactly as the operator said.

---

## 7. Owed before build

1. Whether the SA may undo **another SA's** scan. The gate as specified says yes (role + project,
   not authorship) — consistent with spec 360's finding that the uploader-only photo-delete gate
   left 5 of 10 bounced WPs unclearable because no single SA could act. Worth confirming, since
   attendance is money-adjacent.
2. Whether an undo should be possible once the worker has been **checked out** (row complete, day
   not closed). Mechanically yes; ask whether it should be.
