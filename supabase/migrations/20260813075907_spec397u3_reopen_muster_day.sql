-- Spec 397 U3 — a way back from a closed muster day, and the checker's undo.
--
-- Operator, 2026-08-05: procurement double-checks the attendance and must be able
-- to CORRECT what they find. Today they cannot, and neither can anyone else once
-- the day is closed: `muster_undo_scan` raises P0001 against a closure by design,
-- and there is no un-close path anywhere. 2026-08-04 is the live case — FOUR
-- check-ins between a 21 and a 23, closed.
--
-- Two changes, and the second is why the first is worth anything:
--
--   1. reopen_muster_day(project, date, reason) — deletes the closure, audited,
--      reason mandatory. `close_muster_day` is idempotent and re-derives, so the
--      correction loop is reopen → fix → close again.
--   2. muster_undo_scan admits `procurement` — the role that reopens must be able
--      to remove the wrong row, or reopening only hands the work back.
--
-- ⚠️ SCOPE, and it is NOT close_muster_day's: `can_see_project` is FALSE for
-- plain `procurement` (verified live — the function falls to `else false`), so
-- gating them on membership would admit them at the door and refuse them at every
-- project. Procurement is cross-project here exactly as it is in the spec-397 U1
-- audit RPCs' inner arm; every other role keeps the membership check.
--
-- ⚠️ THE MONEY GUARD is the reason this is a function and not a DELETE. Closing a
-- day books wages inline (derive_muster_labor), and derive early-returns unless a
-- closure exists — so deleting a closure under CURRENT wage rows would leave a
-- labor_logs row whose basis can then be edited away, unretractable (derive's
-- retract loop walks muster_attendance). It refuses instead, and says so.
-- The check is an ANTI-JOIN, not `exists`: a retraction is a null-fraction
-- supersede row (ADR 0009/0015), so a bare exists() would freeze an
-- already-retracted day forever. Same shape muster_undo_scan already uses.
--
-- Live today: `labor_logs` has ZERO rows all-time (no worker carries
-- cost_confirmed_at, which derive requires), so the guard cannot fire yet — it is
-- built now because spec 368 U2 turns it on.

create or replace function public.reopen_muster_day(
  p_project uuid,
  p_date date,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true (the
  -- rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'site_admin', 'super_admin', 'procurement_manager', 'procurement'
  ) then
    raise exception 'reopen_muster_day: role not permitted' using errcode = '42501';
  end if;

  if p_project is null or p_date is null then
    raise exception 'reopen_muster_day: project and date are required' using errcode = 'P0001';
  end if;

  -- The reason IS the feature: an un-finalised day with no recorded why is a hole
  -- in the audit trail that this function would be creating.
  if v_reason is null then
    raise exception 'reopen_muster_day: a reason is required' using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project.
  if v_role <> 'procurement' and not public.can_see_project(p_project) then
    raise exception 'reopen_muster_day: not a member of this project' using errcode = '42501';
  end if;

  -- Serialise against derive_muster_labor on the same day using ITS key. Without
  -- this, close_muster_day could commit a closure and derive wages between the
  -- money guard below and the delete, leaving exactly the stranded row the guard
  -- exists to prevent.
  perform pg_advisory_xact_lock(hashtextextended(p_project::text || '|' || p_date::text, 0));

  if not exists (
    select 1 from public.muster_day_closures
     where project_id = p_project and work_date = p_date
  ) then
    raise exception 'reopen_muster_day: this day is not closed' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.labor_logs ll
      join public.muster_attendance a on a.id = ll.source_muster_id
      join public.muster_teams t on t.id = a.team_id
     where t.project_id = p_project
       and a.work_date = p_date
       and ll.day_fraction is not null
       and not exists (
         select 1 from public.labor_logs n where n.superseded_by = ll.id
       )
  ) then
    raise exception 'reopen_muster_day: wages are already booked for this day'
      using errcode = 'P0001';
  end if;

  -- Audit BEFORE the delete: the closure row carries closed_at/closed_by and is
  -- about to stop existing, so the payload is the only surviving copy. Convention
  -- follows muster_undo_scan — an existing action plus a `kind`, never a new enum
  -- value. target_id is the PROJECT: muster_day_closures has a composite key and
  -- no id column, and (project, date) is what a reader searches by.
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  select 'crew_change', auth.uid(), v_role, 'muster_day_closures', p_project,
         jsonb_build_object(
           'kind', 'muster_day_reopen',
           'project_id', p_project,
           'work_date', p_date,
           'reason', v_reason,
           'closure', to_jsonb(c))
    from public.muster_day_closures c
   where c.project_id = p_project and c.work_date = p_date;

  delete from public.muster_day_closures
   where project_id = p_project and work_date = p_date;
end;
$function$;

revoke all on function public.reopen_muster_day(uuid, date, text) from public, anon;
grant execute on function public.reopen_muster_day(uuid, date, text) to authenticated;

-- muster_undo_scan: admit `procurement`, with the same cross-project arm.
--
-- The body is otherwise UNCHANGED from the live definition (sourced from
-- pg_get_functiondef, not from the migration file that first created it). Two
-- edits only: the role allowlist, and the can_see_project arm folded into the
-- lookup — which had to move with it, because for `procurement` that predicate is
-- false, so the row would have read as ABSENT and the caller would have met
-- "no check-in to undo" instead of a refusal or a success.
create or replace function public.muster_undo_scan(
  p_worker uuid,
  p_date date,
  p_session public.muster_session
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_att  public.muster_attendance%rowtype;
  v_team public.muster_teams%rowtype;
begin
  -- Parity with muster_scan_in / muster_scan_out, PLUS procurement (spec 397 U3):
  -- the tier that reopens a day must be able to remove the row it reopened for.
  if v_role is null or v_role not in (
    'site_admin', 'super_admin', 'procurement_manager', 'procurement'
  ) then
    raise exception 'muster_undo_scan: role not permitted' using errcode = '42501';
  end if;

  -- (worker, date, session) is the live unique key, so this identifies exactly
  -- one row.
  --
  -- The visibility predicate is folded INTO the lookup rather than checked after
  -- it, so an invisible row reads as an absent one. Split the other way, the two
  -- SQLSTATEs form an existence oracle: a site_admin of another project could
  -- tell "no such check-in" from "not yours" and learn whether a given worker
  -- uuid was mustered on a given date in a project she cannot see. The sibling
  -- RPCs avoid this by construction — they take a team id and gate before they
  -- touch attendance at all. `procurement` is cross-project (spec 397: it reads
  -- every project's attendance in the audit report), so the oracle it would open
  -- is over data it is already entitled to read.
  --
  -- FOR UPDATE OF a: the snapshot written to audit_log is the only surviving
  -- copy of this row, so a concurrent scan_out / move / auto-out landing between
  -- here and the delete would make the trace describe a state the row was never
  -- in. It also serialises two concurrent undos, which would otherwise both pass
  -- every guard and both write an audit row for one deletion.
  select a.* into v_att
    from public.muster_attendance a
    join public.muster_teams t on t.id = a.team_id
   where a.worker_id = p_worker and a.work_date = p_date and a.session = p_session
     and (v_role = 'procurement' or public.can_see_project(t.project_id))
     for update of a;
  if not found then
    raise exception 'muster_undo_scan: no check-in to undo' using errcode = 'P0001';
  end if;

  -- team_id is NOT NULL with an FK to muster_teams, so this cannot miss; it is
  -- read for the project, not as a guard.
  select * into v_team from public.muster_teams where id = v_att.team_id;

  -- Serialise against derive_muster_labor on the same day, using ITS key.
  -- Without this the closure check below is a TOCTOU: close_muster_day could
  -- commit a closure and derive wages between the check and the delete, leaving
  -- a CURRENT labor_logs row whose source_muster_id points at a row that no
  -- longer exists. That wage could never be retracted afterwards, because
  -- derive's retract loop walks muster_attendance — and the row is gone.
  perform pg_advisory_xact_lock(
    hashtextextended(v_team.project_id::text || '|' || p_date::text, 0));

  -- Closing the day books wages (close_muster_day calls derive_muster_labor
  -- inline). Retracting underneath a closure would strand a labor_logs row
  -- whose basis vanished — and labor_logs.source_muster_id carries NO foreign
  -- key, so nothing at the database level would cascade or complain.
  -- Spec 397 U3: reopen_muster_day is the way past this, and it carries its own
  -- (stricter) money guard.
  if exists (
    select 1 from public.muster_day_closures
     where project_id = v_team.project_id and work_date = p_date
  ) then
    raise exception 'muster_undo_scan: the day is already closed' using errcode = 'P0001';
  end if;

  -- Insurance, not a live path: derive_muster_labor early-returns unless a
  -- closure exists for the day, and it is the only writer of
  -- labor_logs.source_muster_id, so the check above already excludes every way
  -- a wage row can exist today. This guard is what keeps that true now that an
  -- un-close path exists.
  --
  -- ANTI-JOIN, not a bare exists(): labor_logs is append-only and a retraction
  -- is a null-fraction supersede row (ADR 0009/0015), so a day that was derived
  -- and then retracted still has rows pointing here. Counting those would
  -- freeze the attendance row forever for a wage that is no longer current.
  if exists (
    select 1
      from public.labor_logs ll
     where ll.source_muster_id = v_att.id
       and ll.day_fraction is not null
       and not exists (
         select 1 from public.labor_logs n where n.superseded_by = ll.id
       )
  ) then
    raise exception 'muster_undo_scan: wages are already booked for this check-in'
      using errcode = 'P0001';
  end if;

  -- muster_scan_in only opens an OT session AFTER a regular session on the same
  -- team, so deleting the regular row would strand the OT row against that
  -- invariant. The SA undoes the OT first.
  if p_session = 'regular' and exists (
    select 1 from public.muster_attendance
     where worker_id = p_worker and work_date = p_date and session = 'ot'
  ) then
    raise exception 'muster_undo_scan: undo the OT session first'
      using errcode = 'P0001';
  end if;

  -- Audit BEFORE the delete — after the next statement the row is gone, so the
  -- payload is the only surviving copy. Convention follows move_muster_worker:
  -- an existing action plus a `kind` in the payload, never a new enum value.
  -- to_jsonb(v_att) rather than a hand-listed set of keys: the delete is
  -- irreversible and this is the only surviving copy, so a column added to
  -- muster_attendance later must not silently stop being captured. Hand-listing
  -- had already dropped `note`, which 17 of 167 live rows carry. The flat keys
  -- stay alongside it because every existing reader of this action queries
  -- payload->>'kind' and payload->>'worker_id'.
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'muster_attendance', v_att.id,
          jsonb_build_object(
            'kind', 'muster_undo',
            'worker_id', p_worker,
            'work_date', p_date,
            'session', p_session,
            'team_id', v_att.team_id,
            'row', to_jsonb(v_att)));

  delete from public.muster_attendance where id = v_att.id;
  if not found then
    -- Unreachable while the row is held FOR UPDATE, but an audit row claiming a
    -- retraction that did not happen is worse than a failure.
    raise exception 'muster_undo_scan: the check-in vanished mid-undo'
      using errcode = 'P0001';
  end if;
end;
$function$;
