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
  select * into v_att
    from public.muster_attendance
   where worker_id = p_worker and work_date = p_date and session = p_session;
  if not found then
    raise exception 'muster_undo_scan: no check-in to undo' using errcode = 'P0001';
  end if;

  select * into v_team from public.muster_teams where id = v_att.team_id;
  if not found then
    raise exception 'muster_undo_scan: team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_team.project_id) then
    raise exception 'muster_undo_scan: not a member of this project' using errcode = '42501';
  end if;

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

  -- Defence in depth behind the closure check: derive_muster_labor is callable
  -- directly, not only through close_muster_day.
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
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'muster_attendance', v_att.id,
          jsonb_build_object(
            'kind', 'muster_undo',
            'worker_id', p_worker,
            'work_date', p_date,
            'session', p_session,
            'team_id', v_att.team_id,
            'in_at', v_att.in_at,
            'in_method', v_att.in_method,
            'out_at', v_att.out_at,
            'out_method', v_att.out_method,
            'out_auto', v_att.out_auto,
            'ot_hours', v_att.ot_hours,
            'scanned_by', v_att.scanned_by));

  delete from public.muster_attendance where id = v_att.id;
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
