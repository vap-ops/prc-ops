-- Spec 306 §5 — muster_scan_out must refuse a worker who is already checked out.
--
-- The shipped function had NO already-out guard. Its final statement ran
-- unconditionally:
--
--   update public.muster_attendance
--      set out_at = now(), out_method = p_method, ot_hours = v_ot, out_auto = false
--
-- so a second scan on an already-closed session destroyed THREE values:
--
--   ① out_at    the real departure, overwritten with the moment of the re-scan.
--   ② ot_hours  an `ot` session is RE-PRICED from now() − in_at, so overtime
--               INFLATES on every extra scan.
--               ⚠️ NOT a money bug TODAY, and an earlier draft of this header
--               said it was. Checked live: derive_muster_labor does not read
--               ot_hours and carries no ×1.5 — OT costing is deferred to spec
--               306 U5b (see 20260813075848). Every current consumer is
--               DISPLAY: attendance-month, attendance-sessions,
--               attendance-audit, load-muster, get_my_attendance. So an
--               inflated value is a lie on a worker's own screen now, and
--               becomes wrong MONEY the day U5b starts pricing it — which is
--               worse, because by then the inflation is historical and
--               unattributable.
--   ③ out_auto  flipped to false, converting an auto-closed day into a recorded
--               departure and erasing the ปิดอัตโนมัติ signal — which spec 388 U2
--               now renders to the WORKER, on their own attendance screen.
--
-- It was reachable. Three client sites hand-code the workaround, each with a
-- comment naming the missing guard (muster-cockpit's partial-cure re-tap,
-- sweep.ts twice, actions.ts) — the rule lived only at the affordance layer,
-- written by hand, three times, so any path nobody thought of walked through.
--
-- TWO changes, and the second is not optional: the row was read WITHOUT a lock,
-- so a bare guard would be a TOCTOU — two concurrent scan-outs would both read
-- out_at null and both write. `for update` is what makes the check hold.
--
-- Sourced from the LIVE function definition (pg_get_functiondef), not from an
-- older migration file, per the house rule: migration files go stale, the
-- running database does not. Everything outside the two marked blocks is
-- byte-identical to what was live.
--
-- NOT fixed here, recorded instead (own unit, needs an operator decision):
-- close_muster_day auto-outs REGULAR sessions ONLY, so an `ot` session can still
-- be open after a day closes, and closing it the next day prices garbage from
-- now() − in_at. `closeOpenOt` cures that from the client before ปิดวัน; the
-- server-side refusal is a separate call because refusing outright would strand
-- an SA whose OT is already open past closure with no way to close it.

create or replace function public.muster_scan_out(
  p_team uuid,
  p_worker uuid,
  p_method public.muster_method,
  p_session public.muster_session default 'regular'::public.muster_session
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_team public.muster_teams%rowtype;
  v_att  public.muster_attendance%rowtype;
  v_ot   numeric;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'muster_scan_out: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'muster_scan_out: team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_team.project_id) then
    raise exception 'muster_scan_out: not a member of this project' using errcode = '42501';
  end if;
  if p_method is null then
    raise exception 'muster_scan_out: method required' using errcode = 'P0001';
  end if;

  -- CHANGED: `for update`. Without it the guard below is a TOCTOU — two
  -- concurrent scan-outs both read out_at null and both reach the update, which
  -- is exactly the destroy-on-repeat this migration exists to stop. Same
  -- reasoning (and same shape) as muster_undo_scan's `for update of a`.
  select * into v_att from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date and session = p_session
     for update;
  if not found then
    raise exception 'muster_scan_out: no attendance for this worker on the team''s date' using errcode = 'P0001';
  end if;
  if v_att.team_id is distinct from p_team then
    raise exception 'muster_scan_out: worker is in another team today — move first' using errcode = 'P0001';
  end if;

  -- CHANGED: the already-out guard.
  --
  -- Placed AFTER the team-mismatch check on purpose: "move first" is the more
  -- actionable answer when both apply, and it is the message the SA's board
  -- already teaches.
  --
  -- The time is rendered in Bangkok wall clock and carried in the message so
  -- the client can tell the SA WHEN the worker went out rather than only that
  -- the tap did nothing — a refusal that explains itself. `scanErrorToThai`
  -- matches on substrings in order, and its `no attendance` arm answers
  -- ยังไม่ได้เช็คชื่อ, the opposite claim; the wording here is pinned in pgTAP so a
  -- reword cannot silently re-route the copy to that arm.
  if v_att.out_at is not null then
    raise exception 'muster_scan_out: already checked out at %',
      to_char(v_att.out_at at time zone 'Asia/Bangkok', 'HH24:MI')
      using errcode = 'P0001';
  end if;

  -- Spec 351: an ot session's OT = its real span (out − in), floored to 0.5h.
  -- A regular session never carries OT (that derivation moved to the ot session).
  if p_session = 'ot' then
    v_ot := floor((extract(epoch from (now() - v_att.in_at)) / 3600.0) * 2) / 2;
    if v_ot <= 0 then
      v_ot := null;
    end if;
  else
    v_ot := null;
  end if;

  update public.muster_attendance
     set out_at = now(), out_method = p_method, ot_hours = v_ot, out_auto = false
   where id = v_att.id;
  return v_att.id;
end; $function$;

-- A `create or replace` keeps existing grants, but state them anyway: this
-- function is called only by signed-in staff through the server action, and a
-- default PUBLIC execute on a SECURITY DEFINER is the standing hazard (#833).
revoke all on function public.muster_scan_out(uuid, uuid, public.muster_method, public.muster_session)
  from public, anon;
grant execute on function public.muster_scan_out(uuid, uuid, public.muster_method, public.muster_session)
  to authenticated;
