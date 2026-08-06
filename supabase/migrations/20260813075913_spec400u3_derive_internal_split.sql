-- Spec 400 U3a, part 2 — let procurement's re-close derive wages WITHOUT giving
-- procurement the wage-derive authority.
--
-- WHY THIS EXISTS. 075912 widened close_muster_day to procurement per the
-- operator's ruling ("yes re-close too"). That was necessary and not sufficient:
-- close_muster_day PERFORMs derive_muster_labor, which carries its OWN gate —
-- {site_admin, project_manager, super_admin, project_director,
-- procurement_manager}, commented "Same authority as the labour engine
-- (log_labor_day). Money-writing." — plus a can_see_project check with no
-- cross-project arm. So procurement passed close's two gates and died at a THIRD
-- one layer down, i.e. affordance-then-refuse. Found behaviourally: a pgTAP
-- lives_ok reported `42501: derive_muster_labor: role not permitted`, which no
-- amount of reading close_muster_day's own body would have shown.
--
-- THE CHOICE, operator-ruled 2026-08-06. The cheap fix is to add 'procurement'
-- to derive_muster_labor's role list. That was REJECTED: derive is directly
-- executable by `authenticated`, so its role list is a real security boundary,
-- and widening it hands procurement the labour engine's own authority — broader
-- than "may re-close a day" and persisting after spec 368 U2 lights up the money.
-- Spec 400 §3 had already argued the principle ("a single narrow RPC keeps the
-- blast radius nameable"); this applies it.
--
-- THE SHAPE. Authorization at the entry points, mechanism in an unexported
-- helper:
--
--   derive_muster_labor(project, date)           PUBLIC, gate UNCHANGED  →┐
--   close_muster_day(project, date)              gate incl. procurement  →┤
--                                                                         ├→ derive_muster_labor_internal
--   derive_muster_labor_internal(project, date)  no gate, grants REVOKED  ←┘
--
-- Every caller is authorized before it reaches the mechanism; the mechanism
-- itself is unreachable from `authenticated` and `anon`. Procurement gains
-- exactly one new power (re-close a day, which derives as a consequence) and
-- gains NO ability to invoke a derive on its own.
--
-- BLAST RADIUS, measured not assumed. Exactly ONE live function really calls
-- derive_muster_labor — close_muster_day. log_labor_day, muster_undo_scan and
-- reopen_muster_day only NAME it in comments (checked with a regex for
-- `(perform|select)\s+public\.derive_muster_labor`, because a body-text match
-- cannot tell a call from prose). No application code calls it either: the only
-- `src/` hits are the generated database.types.ts.
--
-- Additive: no DROP, no DELETE, no column-type change, and no signature changes,
-- so no caller is broken and database.types.ts gains one function rather than
-- changing any.

-- ---------------------------------------------------------------------------
-- 1. The mechanism, verbatim from the live derive_muster_labor body minus its two
--    authorization gates. The null check stays: close_muster_day now calls this
--    directly, so it is the floor for both entry points.
--
--    `v_role` is dropped from the declare block — it existed ONLY to serve the
--    role gate that has moved out.
-- ---------------------------------------------------------------------------
create or replace function public.derive_muster_labor_internal(p_project uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wht    numeric := (select wht_pct from public.labor_wht_config where id = true);
  v_att    record;
  v_worker public.workers%rowtype;
  v_n      int;
  v_frac   public.day_fraction;
  v_ok     boolean;   -- this worker should carry derived rows on the team's leaf WPs
  v_wp     uuid;
  v_row    record;
  v_existing uuid;
begin
  -- ⚠️ NO AUTHORIZATION HERE BY DESIGN. This function is the mechanism; every
  -- entry point above it authorizes first, and its EXECUTE grant is revoked from
  -- public/anon/authenticated so it cannot be reached directly. Do NOT call it
  -- from a new function without gating that function.
  if p_project is null or p_date is null then
    raise exception 'derive_muster_labor: project and date are required' using errcode = 'P0001';
  end if;

  -- A closed day is the precondition (close_muster_day is the trigger; a cron /
  -- manual re-run keys off the same closure). No closure → nothing to derive.
  if not exists (select 1 from public.muster_day_closures
                  where project_id = p_project and work_date = p_date) then
    return;
  end if;

  -- Serialize concurrent derives on the same day (a re-close racing a cron run).
  perform pg_advisory_xact_lock(hashtextextended(p_project::text || '|' || p_date::text, 0));

  for v_att in
    select a.id, a.worker_id, a.team_id
      from public.muster_attendance a
      join public.muster_teams t on t.id = a.team_id
     where t.project_id = p_project and a.work_date = p_date
       and a.session = 'regular' and a.in_at is not null
  loop
    select * into v_worker from public.workers where id = v_att.worker_id;

    -- Whether this worker should carry derived rows today, and on how many WPs.
    -- Cost gate: an unconfirmed rate / day_rate ≤ 0 / inactive worker carries NONE
    -- (held; a re-derive backfills once confirmed — 271-U0 bug #2). Labor binds only
    -- to LEAF (งานย่อย) WPs — the DB forbids binding to a group (งาน) via
    -- wp_reject_group_binding — so a team on a group WP, a group+leaf mix, 3+ WPs,
    -- or 0 WPs is DEFERRED (v_ok=false). Every v_ok=false case RETRACTS the worker's
    -- existing derived rows below, so a shrunk/re-pointed/held day never over-counts.
    v_n := (select count(*) from public.muster_team_wps where team_id = v_att.team_id);
    v_ok := found and v_worker.active
        -- Spec 328 §2.4 money wall: a subcontractor firm's crew are paid BY THE
        -- FIRM out of the work package's contract price — PRC never owes them a
        -- daily wage. Without this, one PM bulk-confirming subcon rates books a
        -- SECOND payment for people the firm already pays.
        --
        -- Scope of the retract, stated precisely: v_ok=false also tombstones this
        -- worker's existing derived rows below, but ONLY on a derive of that day.
        --
        -- ⚠️ CORRECTED 2026-08-06 (spec 400 U3a). This comment used to reason from
        -- "a day that is already closed cannot be re-closed from any surface
        -- today", and concluded that tying a worker to a firm AFTER their days
        -- were closed does not claw back derived wages. That premise is now FALSE:
        -- procurement may reopen a day (spec 397 U3) and, as of this unit,
        -- re-close it — which re-derives and therefore DOES retract those rows.
        -- The retract-on-re-derive behaviour is unchanged; what changed is that a
        -- second surface can now reach it. Consequence is nil TODAY (labor_logs is
        -- 0 rows all-time and no worker has cost_confirmed_at, so nothing is
        -- derived to retract) and becomes real the moment spec 368 U2 confirms the
        -- first rate. Still not self-healing for history — it fires only on a
        -- derive of that specific day.
        and v_worker.contractor_id is null
        and v_worker.cost_confirmed_at is not null and coalesce(v_worker.day_rate, 0) > 0
        and v_n between 1 and 2
        and not exists (
          select 1 from public.muster_team_wps mtw
            join public.work_packages wp on wp.id = mtw.work_package_id
           where mtw.team_id = v_att.team_id and wp.is_group);
    v_frac := case when v_n = 1 then 'full'::public.day_fraction
                   else 'half'::public.day_fraction end;

    -- RETRACT: tombstone every CURRENT derived row for this attendance that no
    -- longer has a valid basis — the worker became ineligible (v_ok false) or the
    -- WP was dropped from the team. Without this, a shrunk / re-pointed / held
    -- team would leave stale rows current and over-count the day (fresh-eyes fix).
    -- A tombstone = a null-fraction supersede row (ADR 0015); cost reads ignore it.
    for v_row in
      select ll.id, ll.work_package_id, ll.day_rate_snapshot, ll.worker_name_snapshot,
             ll.pay_type_snapshot, ll.wht_pct_snapshot, ll.level_snapshot
        from public.labor_logs ll
       where ll.source_muster_id = v_att.id and ll.day_fraction is not null
         and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)
         and (not v_ok
              or not exists (select 1 from public.muster_team_wps mtw
                              where mtw.team_id = v_att.team_id
                                and mtw.work_package_id = ll.work_package_id))
    loop
      insert into public.labor_logs
        (work_package_id, worker_id, work_date, day_fraction,
         day_rate_snapshot, worker_name_snapshot, pay_type_snapshot, wht_pct_snapshot,
         level_snapshot, source_muster_id, entered_by, self_logged, superseded_by,
         correction_reason)
      values
        (v_row.work_package_id, v_att.worker_id, p_date, null,
         v_row.day_rate_snapshot, v_row.worker_name_snapshot, v_row.pay_type_snapshot,
         v_row.wht_pct_snapshot, v_row.level_snapshot, v_att.id, auth.uid(), false,
         v_row.id, 'muster_rederive');
    end loop;

    if not v_ok then continue; end if;

    -- UPSERT the desired leaf WPs (even split via the enum).
    for v_wp in
      select work_package_id from public.muster_team_wps where team_id = v_att.team_id
    loop
      -- Defer to a human/other-source current row for this (wp, worker, date):
      -- never double-log over a manual log_labor_day entry.
      if exists (
        select 1 from public.labor_logs ll
         where ll.work_package_id = v_wp and ll.worker_id = v_att.worker_id
           and ll.work_date = p_date and ll.day_fraction is not null
           and ll.source_muster_id is distinct from v_att.id
           and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)
      ) then
        continue;
      end if;

      -- This source's current row (real OR a tombstone) for the WP → skip only when
      -- it is a REAL row with EVERY snapshot matching; else supersede it (a wht /
      -- rate / level change must re-snapshot — money — and a re-added WP supersedes
      -- its retract tombstone).
      select ll.id into v_existing from public.labor_logs ll
        where ll.source_muster_id = v_att.id and ll.work_package_id = v_wp
          and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id);
      if v_existing is not null and exists (
        select 1 from public.labor_logs
         where id = v_existing and day_fraction = v_frac
           and day_rate_snapshot = v_worker.day_rate and wht_pct_snapshot = v_wht
           and pay_type_snapshot = v_worker.pay_type
           and level_snapshot is not distinct from v_worker.level
      ) then
        continue;   -- unchanged
      end if;

      insert into public.labor_logs
        (work_package_id, worker_id, work_date, day_fraction,
         day_rate_snapshot, worker_name_snapshot, pay_type_snapshot, wht_pct_snapshot,
         level_snapshot, source_muster_id, entered_by, self_logged, superseded_by,
         correction_reason)
      values
        (v_wp, v_att.worker_id, p_date, v_frac,
         v_worker.day_rate, v_worker.name, v_worker.pay_type, v_wht,
         v_worker.level, v_att.id, auth.uid(), false, v_existing,
         case when v_existing is not null then 'muster_rederive' else null end);
    end loop;
  end loop;
end; $function$;

-- A function is born EXECUTE-able by public in this project's default privileges,
-- so the revoke is the posture — not the absence of a grant. Without this the
-- "unexported helper" is a fiction and any signed-in user could derive wages on
-- any project, which is strictly worse than the widening this migration exists to
-- avoid.
revoke all on function public.derive_muster_labor_internal(uuid, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The public entry point keeps its gate EXACTLY as it was — same role list,
--    same can_see_project check, same error strings and SQLSTATEs. Procurement is
--    still refused here, deliberately: that refusal is the whole point of doing
--    the split instead of widening the list, and it is pinned in pgTAP.
-- ---------------------------------------------------------------------------
create or replace function public.derive_muster_labor(p_project uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- Same authority as the labour engine (log_labor_day). Money-writing.
  -- ⚠️ Do NOT add 'procurement' here. Procurement's re-close reaches the derive
  -- through close_muster_day, which gates it separately (spec 400 U3a); granting
  -- it here would additionally let procurement derive wages directly on any
  -- project, which the operator explicitly declined 2026-08-06.
  if v_role is null or v_role not in
     ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'derive_muster_labor: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null then
    raise exception 'derive_muster_labor: project and date are required' using errcode = 'P0001';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'derive_muster_labor: not a member of this project' using errcode = '42501';
  end if;

  perform public.derive_muster_labor_internal(p_project, p_date);
end; $function$;

-- ---------------------------------------------------------------------------
-- 3. close_muster_day now reaches the mechanism directly. Identical to 075912 in
--    every other respect; the only change is the PERFORM target.
-- ---------------------------------------------------------------------------
create or replace function public.close_muster_day(p_project uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role    public.user_role := public.current_user_role();
  v_day_end timestamptz;
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true (the
  -- rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'site_admin', 'super_admin', 'procurement_manager', 'procurement'
  ) then
    raise exception 'close_muster_day: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null then
    raise exception 'close_muster_day: project and date are required' using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project.
  if v_role <> 'procurement' and not public.can_see_project(p_project) then
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
