-- Spec 328 §2.4 — the muster wage derive must SKIP contractor-tied workers.
--
-- Spec 328 states this rule for this exact function ("when spec 306 U5 lands, the
-- derive MUST skip contractor-tied workers: their labor cost lives inside the WP
-- contract price"), and spec 306 U5a (#740) shipped without it. Verified live
-- before writing this: v_ok gated on active + cost_confirmed_at + day_rate > 0 +
-- WP shape only, with no contractor_id conjunct. log_labor_day is equally bare —
-- that is pre-existing and out of scope here (spec 328 U3 owns the capture picker).
--
-- Why it matters now rather than later: workers.contractor_id was set on 0 rows at
-- spec 328's gap-check (2026-07-18); today it is 3 active workers, all pointing at
-- a 'contractor'-category firm (ช่างอวย). They are held out of the derive today
-- ONLY by the cost gate (0 of 29 workers are cost-confirmed). The first PM bulk
-- confirm opens the hole.
--
-- Why a blanket contractor_id IS NULL is the right test: workers.worker_type and
-- the old workers_dc_has_contractor CHECK are both GONE from the live schema
-- (pay_type is now daily|monthly), and every contractor row is
-- contractor_category='contractor' — there are zero 'dc'-category firms. So
-- contractor_id cleanly means "subcon member, pay-exempt" per 328 §2.4. If DC
-- firms are ever linked through this column, revisit this conjunct.
--
-- Body sourced from the LIVE function via pg_get_functiondef and re-emitted with
-- exactly one added conjunct; CREATE OR REPLACE keeps the signature, so no
-- dependent grant or pgTAP signature pin moves.

CREATE OR REPLACE FUNCTION public.derive_muster_labor(p_project uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- Spec 328 §2.4 money wall: a subcontractor firm's crew are paid BY THE
        -- FIRM out of the work package's contract price — PRC never owes them a
        -- daily wage. Without this, one PM bulk-confirming subcon rates books a
        -- SECOND payment for people the firm already pays. Every v_ok=false case
        -- also RETRACTS existing derived rows below, so reclassifying a worker as
        -- contractor crew removes the PRC cost they should never have carried.
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
end; $function$
