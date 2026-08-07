-- Spec 400 U6c — the attendance-CORRECTION audience becomes the attendance-AUDIT
-- audience: "if you can see the hole, you can fix it."
--
-- Operator, 2026-08-07: "let's enable them first, we trust the current team. we can
-- limit access in the future." U6b had to withhold the fix-screen doors from five
-- roles that READ the grid while every correction RPC refused them with 42501
-- (accounting 3 users, project_director 3, project_manager 1, hr 0,
-- project_coordinator 0).
--
-- THREE predicates move together per function, and the allowlist is the easy one:
--
--   ① THE ALLOWLIST → ATTENDANCE_AUDIT_ROLES (8). The four functions that also
--      serve the SA cockpit keep site_admin, so they name 9.
--
--   ② THE SCOPING ARM. `can_see_project` falls to `else false` for accounting and
--      hr, so widening the allowlist ALONE would land them a link and then a
--      42501 — affordance-then-refuse, shipped by the unit built to remove one.
--      The new arm mirrors the READ side verbatim: the same seven roles
--      `audit_attendance_summary` treats as cross-project. project_manager stays
--      scoped by membership (as the read scopes it) and so does site_admin — a
--      rewrite phrased as "everyone except project_manager" would have silently
--      made the field role cross-project.
--
--   ③ THE ARM SPLIT IN muster_scan_in. `v_role = 'procurement'` is not a scoping
--      check: it SELECTS the correction arm — regular-only (an OT session is x1.5
--      money, spec 351), open-days-only behind derive's own advisory key, and the
--      `muster_correction_scan_in` audit row U5's trail reads. Widening the
--      allowlist without extending it would have routed every new role down the SA
--      COCKPIT arm: free to create OT, free to write into a closed day, and
--      invisible to the correction trail — more power and less accountability than
--      the role being copied. super_admin and procurement_manager keep today's
--      cockpit behaviour deliberately (U3a's "the SA path is unchanged").
--
-- ⓘ close_muster_day performs derive_muster_labor_INTERNAL (verified live), so
--   U3a's third gate does not apply and no further widening is owed. Pinned.
--
-- ⚖️ hr and project_coordinator have ZERO users, so this grants them a
--   money-writing capability (closing a day derives wages) nobody holds today.
--   Deliberate: one rule is maintainable, a subset with two unexplained holes is
--   not. Narrowing later is one line per function.
--
-- Generated from the LIVE definitions and re-applied predicate-by-predicate, so
-- nothing else in these bodies changed. pgTAP: 400c-correction-audience.test.sql.


create or replace function public.muster_correct_session(p_team uuid, p_worker uuid, p_session muster_session, p_in_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_out_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager'
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
  if not (
    v_role in ('accounting', 'hr', 'project_director', 'project_coordinator',
                    'procurement_manager', 'procurement', 'super_admin')
    or public.can_see_project(v_team.project_id)
  ) then
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


create or replace function public.list_muster_teams_for_day(p_project uuid, p_date date)
 RETURNS TABLE(team_id uuid, kind muster_team_kind, lead_worker_id uuid, lead_name text, headcount integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true (the
  -- rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager'
  ) then
    raise exception 'list_muster_teams_for_day: role not permitted' using errcode = '42501';
  end if;

  if p_project is null or p_date is null then
    raise exception 'list_muster_teams_for_day: project and date are required'
      using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project.
  if not (
    v_role in ('accounting', 'hr', 'project_director', 'project_coordinator',
                    'procurement_manager', 'procurement', 'super_admin')
    or public.can_see_project(p_project)
  ) then
    raise exception 'list_muster_teams_for_day: not a member of this project'
      using errcode = '42501';
  end if;

  return query
    select t.id,
           t.kind,
           t.lead_worker_id,
           w.name,
           (select count(*)::int from public.muster_attendance a where a.team_id = t.id)
      from public.muster_teams t
      left join public.workers w on w.id = t.lead_worker_id
     where t.project_id = p_project
       and t.work_date = p_date
     -- Deterministic and human: by the label the picker shows, then by id so two
     -- teams under the same lead never swap places between renders.
     order by w.name nulls last, t.id;
end;
$function$;


create or replace function public.reopen_muster_day(p_project uuid, p_date date, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true (the
  -- rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager',
    'site_admin'
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
  if not (
    v_role in ('accounting', 'hr', 'project_director', 'project_coordinator',
                    'procurement_manager', 'procurement', 'super_admin')
    or public.can_see_project(p_project)
  ) then
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


create or replace function public.close_muster_day(p_project uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role    public.user_role := public.current_user_role();
  v_day_end timestamptz;
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true (the
  -- rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager',
    'site_admin'
  ) then
    raise exception 'close_muster_day: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null then
    raise exception 'close_muster_day: project and date are required' using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project.
  if not (
    v_role in ('accounting', 'hr', 'project_director', 'project_coordinator',
                    'procurement_manager', 'procurement', 'super_admin')
    or public.can_see_project(p_project)
  ) then
    raise exception 'close_muster_day: not a member of this project' using errcode = '42501';
  end if;

  v_day_end := (p_date + time '17:00') at time zone 'Asia/Bangkok';
  -- Auto-out at day-end, but never before the worker's own in_at (a post-17:00
  -- scan-in would otherwise get out_at < in_at → negative span into the U5 derive).
  -- Spec 351: REGULAR sessions only — an open ot session is left for the SA to
  -- close explicitly (the cockpit flags it).
  update public.muster_attendance a
     set out_at = greatest(v_day_end, a.in_at), out_auto = true
    from public.muster_teams t
   where t.id = a.team_id and t.project_id = p_project
     and a.work_date = p_date and a.out_at is null
     and a.session = 'regular';

  insert into public.muster_day_closures (project_id, work_date, closed_by)
  values (p_project, p_date, auth.uid())
  on conflict (project_id, work_date)
  do update set closed_at = now(), closed_by = excluded.closed_by;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'muster_day_closures', p_project,
          jsonb_build_object(
            'kind', 'muster_day_close',
            'project_id', p_project,
            'work_date', p_date));

  -- Spec 306 U5a — the money derive keys off this closure. Idempotent, so a
  -- re-close simply re-derives (picking up muster edits / newly-confirmed rates).
  -- Calls the INTERNAL mechanism: this function has already authorized the caller,
  -- and the public derive_muster_labor would refuse procurement (spec 400 U3a).
  perform public.derive_muster_labor_internal(p_project, p_date);
end; $function$;


create or replace function public.muster_undo_scan(p_worker uuid, p_date date, p_session muster_session)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_att  public.muster_attendance%rowtype;
  v_team public.muster_teams%rowtype;
begin
  -- Parity with muster_scan_in / muster_scan_out, PLUS procurement (spec 397 U3):
  -- the tier that reopens a day must be able to remove the row it reopened for.
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager',
    'site_admin'
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
     and (v_role in ('accounting', 'hr', 'project_director', 'project_coordinator',
                    'procurement_manager', 'procurement', 'super_admin')
         or public.can_see_project(t.project_id))
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


create or replace function public.muster_scan_in(p_team uuid, p_worker uuid, p_method muster_method, p_session muster_session DEFAULT 'regular'::muster_session)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role       public.user_role := public.current_user_role();
  v_team       public.muster_teams%rowtype;
  v_existing   public.muster_attendance%rowtype;
  v_other      text;
  v_other_prj  uuid;
  v_other_kind public.muster_team_kind;
  v_id         uuid;
begin
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager',
    'site_admin'
  ) then
    raise exception 'muster_scan_in: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'muster_scan_in: team not found' using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project.
  if not (
    v_role in ('accounting', 'hr', 'project_director', 'project_coordinator',
                    'procurement_manager', 'procurement', 'super_admin')
    or public.can_see_project(v_team.project_id)
  ) then
    raise exception 'muster_scan_in: not a member of this project' using errcode = '42501';
  end if;

  -- The bounds on the new correction arm (spec 400 U3a). NEW ARM ONLY — the SA path
  -- is deliberately unchanged; see 075912's header.
  if v_role in ('procurement', 'accounting', 'hr',
                   'project_director', 'project_coordinator', 'project_manager') then
    -- ① REGULAR only. An OT session is ×1.5 money and was not part of the ruling.
    if p_session <> 'regular' then
      raise exception 'muster_scan_in: a correction may only record a regular session'
        using errcode = 'P0001';
    end if;

    -- ② Open days only. Take derive_muster_labor's OWN advisory key, not one of our
    -- choosing: without it close_muster_day could commit a closure and derive wages
    -- between this check and the insert, leaving an attendance row on a day whose
    -- wages were already booked without it.
    perform pg_advisory_xact_lock(
      hashtextextended(v_team.project_id::text || '|' || v_team.work_date::text, 0));
    if exists (
      select 1 from public.muster_day_closures
       where project_id = v_team.project_id and work_date = v_team.work_date
    ) then
      raise exception 'muster_scan_in: this day is closed — reopen it first'
        using errcode = 'P0001';
    end if;
  end if;

  if p_method is null then
    raise exception 'muster_scan_in: method required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.workers w where w.id = p_worker) then
    raise exception 'muster_scan_in: unknown worker' using errcode = 'P0001';
  end if;

  -- Spec 351: an OT session continues the day's normal hours, so it may only be
  -- opened AFTER the worker's regular session that day, ON THE SAME TEAM.
  if p_session = 'ot' then
    if not exists (
      select 1 from public.muster_attendance
       where worker_id = p_worker and work_date = v_team.work_date
         and session = 'regular' and team_id = p_team) then
      raise exception 'muster_scan_in: no regular session on this team today' using errcode = 'P0001';
    end if;
  end if;

  select * into v_existing from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date and session = p_session;
  if found then
    if v_existing.team_id = p_team then
      return v_existing.id;
    end if;
    -- LEFT join (spec 397 U4): an office team has no lead, and an INNER join
    -- silently turned "they are in the office team" into "somewhere elsewhere".
    select t.project_id, t.kind, w.name into v_other_prj, v_other_kind, v_other
      from public.muster_teams t
      left join public.workers w on w.id = t.lead_worker_id
     where t.id = v_existing.team_id;
    if v_other_prj is not null and public.can_see_project(v_other_prj) then
      if v_other_kind = 'office' then
        raise exception 'muster_scan_in: worker is already in the office team today'
          using errcode = 'P0001';
      end if;
      raise exception 'muster_scan_in: worker already in team of % today', coalesce(v_other, '?')
        using errcode = 'P0001';
    else
      raise exception 'muster_scan_in: worker is already mustered elsewhere today'
        using errcode = 'P0001';
    end if;
  end if;

  -- Guard the concurrent-scan race (two phones, same worker+date+session): the
  -- unique (worker_id, work_date, session) constraint is the backstop; surface
  -- the friendly conflict.
  begin
    insert into public.muster_attendance (team_id, worker_id, work_date, session, in_method, scanned_by)
    values (p_team, p_worker, v_team.work_date, p_session, p_method, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'muster_scan_in: worker already mustered today (concurrent scan)' using errcode = 'P0001';
  end;

  -- Attribute the CORRECTION specifically. Only the new arm writes this: an SA's
  -- ordinary cockpit scan is not a correction, and labelling it one would make the
  -- audit trail useless for the question it exists to answer ("who edited this day
  -- after the fact?").
  if v_role in ('procurement', 'accounting', 'hr',
                   'project_director', 'project_coordinator', 'project_manager') then
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('crew_change', auth.uid(), v_role, 'muster_attendance', v_id,
            jsonb_build_object(
              'kind', 'muster_correction_scan_in',
              'project_id', v_team.project_id,
              'work_date', v_team.work_date,
              'team_id', p_team,
              'worker_id', p_worker,
              'session', p_session,
              'method', p_method));
  end if;

  return v_id;
end;
$function$;

