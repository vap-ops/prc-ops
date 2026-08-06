-- Spec 400 U4 — record a session's REAL times after the fact. Both directions,
-- one migration, because they are the same defect twice and shipping half of it
-- gives the operator a surface that can record an arrival but not a departure.
--
-- ============================================================================
-- THE TWO HOLES (re-measured live 2026-08-06, not inherited)
-- ============================================================================
--
-- ① muster_scan_in names no `in_at`; the column default is now(). So U3a's
--    correction arm, adding a missing person to 08-04, stamps the CORRECTION
--    moment — and close_muster_day's auto-out is greatest(day_end 17:00, in_at)
--    = in_at, i.e. a ZERO-LENGTH session. The surface built to find anomalies
--    would manufacture one. (U3b shipped WITHOUT add-person for exactly this.)
--
-- ② No RPC records a check-out at a past time. 33 sessions are open, and the
--    single "34% have no check-out" figure hides two different populations:
--
--      24 regular rows, 07-31…08-05, days NOT closed  → close_muster_day would
--         auto-out these at 17:00; U3b just gave procurement that affordance.
--       9 OT rows, ALL 2026-07-24, on a day that IS closed → close_muster_day
--         skips session='ot' by design (its own comment leaves it "for the SA",
--         and the SA has no control for it), so these nine are the genuinely
--         unbookable ones and their ot_hours is NULL forever.
--
--    ⇒ the stuck population is NINE ROWS ON ONE DAY, not thirty-three.
--
-- ⚠️ AND THE SECOND HOLE IS NOT "REFUSED", IT IS "PERMITTED AND WRONG".
--    muster_scan_out carried no date check and no closure check, so a site_admin
--    or procurement_manager could close those nine TODAY: out_at = now() and
--    ot_hours = floor((now() − in_at)/3600 × 2)/2 ≈ 13 DAYS of overtime. Nothing
--    would have failed. Part 2 below closes it.
--
-- ============================================================================
-- WHAT MONEY DOES AND DOES NOT SEE (read from the live bodies)
-- ============================================================================
-- derive_muster_labor_internal iterates `session='regular' and in_at is not null`
-- and takes day_fraction from the muster_team_wps COUNT. It never reads the
-- VALUE of in_at or out_at, and never reads ot_hours. So neither timestamp moves
-- a derived wage today — which is precisely why this defect is invisible to every
-- money test, and why the window to fix it is open while labor_logs is still 0
-- rows all-time.
--
-- ot_hours is NOT inert, though: muster_scan_out prices it, and
-- attendance-month.ts, attendance-sessions.ts and attendance-audit.ts all read
-- it. A back-dated check-out therefore re-prices from (out_at − in_at) and never
-- from now(); writing now()'s span would replace a missing number with a wrong
-- one, which is worse.
--
-- ============================================================================
-- THE FOUR OPERATOR RULINGS (spec 400 §2, decided 2026-08-06)
-- ============================================================================
-- 1. SHAPE — one NEW function, not optional params on the two cockpit RPCs.
--    The out-side is what decides it: `p_out_at` on muster_scan_out would force
--    widening that RPC's role list to procurement, handing the live cockpit write
--    path to a role that has no cockpit — the dead-privilege / affordance-then-
--    refuse shape U3a and U3b spent two units on. A new function also keeps the
--    blast radius nameable and gives the correction ONE audit kind.
--    ⚠️ U3a's lesson runs in reverse for the rejected option: widening a role list
--    widens every optional parameter, and ADDING an optional parameter exposes it
--    to every role already on that gate.
--
-- 2. AUDIENCE — {super_admin, procurement_manager, procurement} only.
--    site_admin holds muster_scan_in/_out and the whole cockpit and is
--    deliberately absent: every surface that reaches a past day is gated on
--    ATTENDANCE_AUDIT_ROLES, which has no site_admin, so the grant would be
--    privilege with no door.
--
-- 3. BOUNDS — in_at must fall on the row's own Bangkok work_date (else the cell
--    the grid renders and its own timestamp disagree); out_at must be >= in_at,
--    not in the future, and no later than 06:00 the next morning so a night OT
--    crossing midnight stays recordable. Live precedent for that spill: ZERO of
--    228 closed sessions ever crossed midnight — headroom, not an observed case,
--    and said out loud so nobody later reads it as evidence.
--
-- 4. OVERWRITE — close_muster_day keeps auto-outing open REGULAR sessions at
--    17:00 (so U3b's shipped disclosure copy stays true). A correction may
--    replace that FABRICATED stamp (out_auto = true; 17 live rows carry one) and
--    is refused on a human-recorded check-out, matching muster_scan_out's own
--    "already checked out" refusal.
--
-- ============================================================================
-- WHAT GUARDS A CLOSED DAY HERE, AND WHY IT IS NOT THE CLOSURE
-- ============================================================================
-- The nine stuck OT rows are ON a closed day, so refusing closed days outright
-- would leave U4 unable to repair the exact rows it exists for. The real
-- precondition is the one muster_undo_scan and reopen_muster_day already use:
-- no CURRENT wage row. So:
--
--   retiming an EXISTING row  → allowed on any day whose wages are not booked
--   ADDING a missing person   → open days only (unchanged from U3a; a closed day
--                               still needs reopen_muster_day, which they hold)
--
-- The wage check is an ANTI-JOIN, not a bare exists(): labor_logs is append-only
-- and a retraction is a null-fraction supersede row (ADR 0009/0015), so counting
-- tombstones would freeze a row forever for a wage that is no longer current.

-- ============================================================================
-- PART 1 — muster_correct_session
-- ============================================================================
create or replace function public.muster_correct_session(
  p_team    uuid,
  p_worker  uuid,
  p_session public.muster_session,
  p_in_at   timestamptz default null,
  p_out_at  timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role     public.user_role := public.current_user_role();
  v_team     public.muster_teams%rowtype;
  v_att      public.muster_attendance%rowtype;
  v_before   jsonb;
  v_in       timestamptz;
  v_out      timestamptz;
  v_ot       numeric;
  v_day_end  timestamptz;
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true (the
  -- rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'super_admin', 'procurement_manager', 'procurement'
  ) then
    raise exception 'muster_correct_session: role not permitted' using errcode = '42501';
  end if;

  if p_team is null or p_worker is null or p_session is null then
    raise exception 'muster_correct_session: team, worker and session are required'
      using errcode = 'P0001';
  end if;

  -- A call that changes no timestamp must not reach the audit insert: a trail
  -- row claiming a correction that did not happen is worse than no row.
  if p_in_at is null and p_out_at is null then
    raise exception 'muster_correct_session: nothing to correct' using errcode = 'P0001';
  end if;

  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'muster_correct_session: team not found' using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project
  -- (can_see_project falls to `else false` for it — spec 397, verified live), so
  -- it needs the same arm reopen_muster_day and close_muster_day already carry.
  if v_role <> 'procurement' and not public.can_see_project(v_team.project_id) then
    raise exception 'muster_correct_session: not a member of this project'
      using errcode = '42501';
  end if;

  -- Take derive_muster_labor's OWN advisory key, not one of our choosing: our
  -- write can invalidate ITS precondition, so a lock on any other key would let
  -- close_muster_day commit a closure and derive wages between the wage check
  -- below and the update.
  perform pg_advisory_xact_lock(
    hashtextextended(v_team.project_id::text || '|' || v_team.work_date::text, 0));

  select * into v_att from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date and session = p_session
     for update;

  if not found then
    -- ------------------------------------------------------------------
    -- INSERT PATH — the missing person. U3a's correction bounds are applied
    -- to EVERY caller here, not only to procurement: this function IS the
    -- correction path, so "a correction may only add a regular session on an
    -- open day" is a property of the surface, not of one role.
    -- ------------------------------------------------------------------
    if p_in_at is null then
      raise exception 'muster_correct_session: a check-in time is required to add a missing person'
        using errcode = 'P0001';
    end if;
    if p_session <> 'regular' then
      -- An OT session is ×1.5 money (spec 351) and creating one after the fact
      -- was never part of the ruling. Retiming an EXISTING ot row is — that is
      -- the nine rows this unit exists for — and falls to the update path below.
      raise exception 'muster_correct_session: a correction may only add a regular session'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.muster_day_closures
       where project_id = v_team.project_id and work_date = v_team.work_date
    ) then
      raise exception 'muster_correct_session: a missing person may only be added to an open day'
        using errcode = 'P0001';
    end if;

    -- Delegate the INSERT rather than restating it. muster_scan_in owns the
    -- invariants — already mustered on another team, OT only after a regular
    -- session on the same team, unknown worker, the concurrent-scan unique
    -- violation — and re-implementing them here would fork them. It re-checks
    -- its own gate against the same caller, which is strictly narrower than
    -- ours for procurement and equal for the other two. Method is 'manual' with
    -- no parameter: a correction is by definition typed, never scanned.
    perform public.muster_scan_in(p_team, p_worker, 'manual'::public.muster_method, p_session);

    select * into v_att from public.muster_attendance
     where worker_id = p_worker and work_date = v_team.work_date and session = p_session
       for update;
    if not found then
      raise exception 'muster_correct_session: the check-in vanished mid-correction'
        using errcode = 'P0001';
    end if;
  else
    -- ------------------------------------------------------------------
    -- UPDATE PATH — an existing row, possibly on a closed day.
    -- ------------------------------------------------------------------
    if v_att.team_id is distinct from p_team then
      raise exception 'muster_correct_session: worker is in another team today — move first'
        using errcode = 'P0001';
    end if;
  end if;

  -- The money precondition, in the form muster_undo_scan uses. ANTI-JOIN, not a
  -- bare exists(): a retracted wage is a null-fraction supersede row, and
  -- counting it would freeze this attendance row forever.
  if exists (
    select 1
      from public.labor_logs ll
     where ll.source_muster_id = v_att.id
       and ll.day_fraction is not null
       and not exists (
         select 1 from public.labor_logs n where n.superseded_by = ll.id
       )
  ) then
    raise exception 'muster_correct_session: wages are already booked for this check-in'
      using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_att);
  v_in     := coalesce(p_in_at, v_att.in_at);
  v_out    := coalesce(p_out_at, v_att.out_at);

  -- BOUNDS (ruling 3). in_at is checked against the work DATE first, so a future
  -- stamp on another day is answered by the more specific message.
  if p_in_at is not null then
    if (p_in_at at time zone 'Asia/Bangkok')::date <> v_att.work_date then
      raise exception 'muster_correct_session: check-in time must fall on the work date'
        using errcode = 'P0001';
    end if;
    if p_in_at > now() then
      raise exception 'muster_correct_session: a time cannot be in the future'
        using errcode = 'P0001';
    end if;
  end if;

  if p_out_at is not null then
    -- Fork 4: a fabricated auto-out may be replaced; a recorded one may not.
    -- Same claim muster_scan_out's "already checked out" refusal makes, one
    -- surface over.
    if v_att.out_at is not null and not v_att.out_auto then
      raise exception 'muster_correct_session: a recorded check-out cannot be replaced'
        using errcode = 'P0001';
    end if;
    if p_out_at > now() then
      raise exception 'muster_correct_session: a time cannot be in the future'
        using errcode = 'P0001';
    end if;
    -- The spill bound. 06:00 the next morning, so a night OT crossing midnight
    -- is recordable and a stamp days later is not. (Zero live rows have ever
    -- crossed midnight — this is headroom, not a modelled case.)
    v_day_end := ((v_att.work_date + 1) + time '06:00') at time zone 'Asia/Bangkok';
    if p_out_at > v_day_end then
      raise exception 'muster_correct_session: check-out is too late for this work date'
        using errcode = 'P0001';
    end if;
  end if;

  -- ORDER MATTERS, and this check covers BOTH directions on purpose. Written as
  -- `p_out_at < v_in` inside the block above, it could only ever see a bad
  -- CHECK-OUT — so moving in_at alone, past an out_at the caller never mentioned,
  -- would have produced an inverted session. That is the defect
  -- attendance-audit.ts exists to FLAG ("the out-BEFORE-in defect"), which would
  -- have made this the second correction path to manufacture the anomaly its own
  -- surface reports (U3b finding 1 was the first). Zero of 228 closed live
  -- sessions are inverted today, so this closes the hole before it has an
  -- instance rather than after.
  if v_out is not null and v_out < v_in then
    raise exception 'muster_correct_session: check-out cannot precede check-in'
      using errcode = 'P0001';
  end if;

  -- Spec 351: an ot session's OT is its real span, floored to the half hour.
  -- Priced from the SPAN and never from now() — that difference is the whole
  -- reason the nine open rows could not simply be scanned out.
  if p_session = 'ot' and v_out is not null then
    v_ot := floor((extract(epoch from (v_out - v_in)) / 3600.0) * 2) / 2;
    if v_ot <= 0 then
      v_ot := null;
    end if;
  else
    v_ot := v_att.ot_hours;
  end if;

  update public.muster_attendance
     set in_at      = v_in,
         out_at     = v_out,
         -- A corrected departure is a recorded fact, so it stops being "auto".
         -- Untouched when the correction only moves in_at, or the flag would lie
         -- about an auto-out this call never looked at.
         out_auto   = case when p_out_at is not null then false else out_auto end,
         out_method = case when p_out_at is not null then 'manual'::public.muster_method
                           else out_method end,
         ot_hours   = v_ot
   where id = v_att.id;

  -- Attribution. Convention per reopen_muster_day / muster_undo_scan: an
  -- EXISTING action plus a payload `kind`, never a new enum value. `before` is
  -- the whole prior row (to_jsonb, not a hand-listed set of keys) because it is
  -- the only surviving copy of what the record said, and hand-listing has
  -- already silently dropped a column once in this table's history.
  --
  -- Written for EVERY corrector, not only procurement: unlike an SA's ordinary
  -- cockpit scan, there is no non-correction way to reach this function, so the
  -- role is a fact about the row rather than a reason to skip it.
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'muster_attendance', v_att.id,
          jsonb_build_object(
            'kind', 'muster_correction_time',
            'project_id', v_team.project_id,
            'work_date', v_att.work_date,
            'team_id', p_team,
            'worker_id', p_worker,
            'session', p_session,
            'in_at', v_in,
            'out_at', v_out,
            'before', v_before));

  return v_att.id;
end;
$function$;

comment on function public.muster_correct_session(uuid, uuid, public.muster_session, timestamptz, timestamptz) is
  'Spec 400 U4. Records a session''s real check-in / check-out times after the fact, for the correction audience only ({super_admin, procurement_manager, procurement}). Retiming an existing row is allowed on any day whose wages are not booked, including a closed one — that is the 2026-07-24 OT population. Adding a missing person stays open-days-and-regular-only, per U3a.';

-- A function is born PUBLIC in this project: the default grants hand EXECUTE to
-- anon and authenticated, so the revoke is the posture and the absence of a
-- grant statement proves nothing.
revoke all on function public.muster_correct_session(uuid, uuid, public.muster_session, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.muster_correct_session(uuid, uuid, public.muster_session, timestamptz, timestamptz)
  to authenticated;

-- ============================================================================
-- PART 2 — muster_scan_out stops stamping now() onto an old session.
--
-- This is a NARROWING and it removes a capability from site_admin,
-- super_admin and procurement_manager. It is a bad capability: the RPC has no
-- date or closure check, so its only use on an old session is to price a span of
-- days as overtime. The fork-2 ruling took it deliberately, and the correction
-- function above is where a real past time now goes.
--
-- The window matches ruling 3's spill bound exactly, so "which times may be
-- recorded" has ONE answer across both functions: up to 06:00 the next morning.
-- Everything else in this body is untouched — the gate, the FOR UPDATE, the
-- already-out refusal, the OT pricing.
-- ============================================================================
create or replace function public.muster_scan_out(
  p_team uuid, p_worker uuid, p_method public.muster_method,
  p_session public.muster_session default 'regular'
) returns uuid
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

  -- ADDED (spec 400 U4). This RPC writes out_at = now(), so once the day is over
  -- it can only ever write a wrong time — and for an ot session it also prices
  -- that wrong span into ot_hours. Nine live rows (2026-07-24) sat reachable by
  -- this path with ~13 days of overtime waiting to be written.
  --
  -- Placed AFTER the gate and the team lookup so a caller who may not act here
  -- at all still hears that first, and BEFORE the attendance lookup so the
  -- refusal does not depend on whether a row exists.
  --
  -- The wording is pinned in pgTAP and mapped in scanErrorToThai: falling
  -- through to the generic copy would tell the SA to try again at something
  -- permanently refused.
  if now() > (((v_team.work_date + 1) + time '06:00') at time zone 'Asia/Bangkok') then
    raise exception 'muster_scan_out: this session belongs to an earlier day'
      using errcode = 'P0001';
  end if;

  -- `for update`. Without it the guard below is a TOCTOU — two concurrent
  -- scan-outs both read out_at null and both reach the update.
  select * into v_att from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date and session = p_session
     for update;
  if not found then
    raise exception 'muster_scan_out: no attendance for this worker on the team''s date' using errcode = 'P0001';
  end if;
  if v_att.team_id is distinct from p_team then
    raise exception 'muster_scan_out: worker is in another team today — move first' using errcode = 'P0001';
  end if;

  -- The already-out guard, placed AFTER the team-mismatch check on purpose:
  -- "move first" is the more actionable answer when both apply. The time is
  -- carried in the message so the client can tell the SA WHEN the worker went
  -- out rather than only that the tap did nothing. `scanErrorToThai` matches on
  -- substrings in order, and its `no attendance` arm answers the opposite claim;
  -- the wording here is pinned in pgTAP so a reword cannot re-route the copy.
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
