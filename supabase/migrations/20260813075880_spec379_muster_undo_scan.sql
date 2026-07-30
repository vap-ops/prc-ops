-- Spec 379 U1 — muster_undo_scan: retract ONE worker's muster check-in.
--
-- Of the seven muster RPCs, none offered a per-worker retraction. The only
-- repairs were move_muster_worker (asserts a different team) and
-- muster_scan_out (asserts they were here and left) — neither says "this did
-- not happen", so the SA had been forcing corrections through the move door
-- (13 times since 2026-07-19). Attendance feeds derive_muster_labor ->
-- labor_logs -> wages, so a mis-scan becomes a mis-payment the moment the
-- cost gate opens; this lands before that.
--
-- The row is DELETED rather than tombstoned. muster_attendance carries no
-- triggers and is not in the append-only family, and a tombstone column would
-- have to be honoured by every reader (derive_muster_labor, the cockpit board,
-- the spec-374 per-worker calendar, the spec-358 audit report) — each one that
-- forgot the filter would keep counting a retracted person. Instead the whole
-- row is written into the append-only audit_log FIRST, so the trace outlives
-- the record.
--
-- One non-RPC delete path already exists and is deliberately untouched:
-- muster_attendance_team_id_fkey is ON DELETE CASCADE from muster_teams.

create or replace function public.muster_undo_scan(
  p_worker  uuid,
  p_date    date,
  p_session public.muster_session
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_att  public.muster_attendance%rowtype;
  v_team public.muster_teams%rowtype;
begin
  -- Parity with muster_scan_in / muster_scan_out. The affordance, the server
  -- action and this function must admit the same set, or the SA meets a button
  -- her own server refuses.
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'muster_undo_scan: role not permitted' using errcode = '42501';
  end if;

  -- (worker, date, session) is the live unique key, so this identifies exactly
  -- one row.
  --
  -- can_see_project is folded INTO the lookup rather than checked after it, so
  -- an invisible row reads as an absent one. Split the other way, the two
  -- SQLSTATEs form an existence oracle: a site_admin of another project could
  -- tell "no such check-in" from "not yours" and learn whether a given worker
  -- uuid was mustered on a given date in a project she cannot see. The sibling
  -- RPCs avoid this by construction — they take a team id and gate before they
  -- touch attendance at all.
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
     and public.can_see_project(t.project_id)
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
  if exists (
    select 1 from public.muster_day_closures
     where project_id = v_team.project_id and work_date = p_date
  ) then
    raise exception 'muster_undo_scan: the day is already closed' using errcode = 'P0001';
  end if;

  -- Insurance, not a live path: derive_muster_labor early-returns unless a
  -- closure exists for the day, and it is the only writer of
  -- labor_logs.source_muster_id, so the check above already excludes every way
  -- a wage row can exist today. This guard is what keeps that true if an
  -- un-close or a partial-retract path is ever added.
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
$$;

-- A NEW function carries a default PUBLIC EXECUTE grant, so the revoke must
-- name `public` as well as `anon` — naming only `anon` leaves it callable
-- through PUBLIC (#833).
revoke all on function public.muster_undo_scan(uuid, date, public.muster_session)
  from public, anon;
grant execute on function public.muster_undo_scan(uuid, date, public.muster_session)
  to authenticated;

comment on function public.muster_undo_scan(uuid, date, public.muster_session) is
  'Spec 379 — retract one worker''s muster check-in for a date+session. Deletes '
  'the row after snapshotting it into audit_log (crew_change / kind=muster_undo). '
  'Refuses once the day is closed, once a CURRENT derived labor_logs row points '
  'at it, or while an OT session depends on the regular one.';
