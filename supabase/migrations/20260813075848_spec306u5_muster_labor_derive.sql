-- Spec 306 U5a — muster → labor_logs money derive (minimal enum-only engine).
--
-- Turns a closed muster day's REGULAR attendance into payable labor_logs rows:
-- one row per main WP of the worker's team, even-split via the day_fraction enum
-- (1 WP → full, 2 WPs → half). A team on 3+ WPs is SKIPPED (the 1/N precision
-- past half needs day_fraction_num, deferred — it would ripple through 7 money
-- RPCs and no team is on even one WP yet; operator call 2026-07-24). A derived
-- row is indistinguishable from a manual log_labor_day row (enum + snapshots), so
-- the cost engine / GL / payroll read paths are untouched.
--
-- Live at build: labor_logs=0, muster_team_wps=0 assignments, 0/26 cost-confirmed
-- → the derive produces zero rows until SAs assign team WPs AND PMs confirm rates
-- (the real gate to labor money, upstream of this). Proven by pgTAP, not fill.
--
-- OT costing (session='ot' rows, operator rule ×1.5 hourly) and the PM pending-
-- cost queue + cron backstop are deferred (U5b / OT follow-up).

-- ---------------------------------------------------------------------------
-- Additive columns: the worker's level snapshot (271-U0 bug #1) + the source
-- attendance row (idempotency / attribution). No day_fraction_num (deferred).
-- ---------------------------------------------------------------------------
alter table public.labor_logs
  add column level_snapshot public.worker_level,
  add column source_muster_id uuid;

create index labor_logs_source_muster_id_idx
  on public.labor_logs (source_muster_id)
  where source_muster_id is not null;

-- ---------------------------------------------------------------------------
-- derive_muster_labor(project, date) — the money derive. Idempotent, gated,
-- cost-guarded. Called inline by close_muster_day (below); safe to re-run.
-- ---------------------------------------------------------------------------
create function public.derive_muster_labor(p_project uuid, p_date date)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_role   public.user_role := public.current_user_role();
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
  -- Same authority as the labour engine (log_labor_day). Money-writing.
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

revoke all     on function public.derive_muster_labor(uuid, date) from public;
revoke execute on function public.derive_muster_labor(uuid, date) from anon;
grant  execute on function public.derive_muster_labor(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- close_muster_day — trigger the derive inline (same txn) after the closure is
-- recorded. Body is the LIVE spec-351 version + the derive call; nothing else
-- changes. (Sourced from pg_get_functiondef 2026-07-24.)
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
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'close_muster_day: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null then
    raise exception 'close_muster_day: project and date are required' using errcode = 'P0001';
  end if;
  if not public.can_see_project(p_project) then
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

  -- Spec 306 U5a — the money derive keys off this closure. Idempotent, so a
  -- re-close simply re-derives (picking up muster edits / newly-confirmed rates).
  perform public.derive_muster_labor(p_project, p_date);
end; $function$;
