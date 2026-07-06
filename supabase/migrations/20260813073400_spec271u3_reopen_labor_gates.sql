-- Spec 271 U3 / ADR 0075 §4.7 — reopen source rule + labor date bound.
--
-- reopen_work_package_for_defect: auditor joins the callers (their D5
-- internal-catch path), and the source becomes role-conditional — auditor and
-- site_admin file INTERNAL only; PM/PD/super file both (D2: client defects are
-- a PM/PD act). Tightens site_admin, who could previously file client rows.
-- (The งาน-signer guard — a signer may not file that งาน's client defect —
-- needs wp_signoffs and lands with U5.)
--
-- log_labor_day: work_date bounded to the Bangkok today (§3 anti-forgery — a
-- future-dated entry could stage tomorrow's actual_start; the ≤3-day entry-lag
-- rule in the variance lib handles backdating, which stays legal for payroll).
--
-- Both bodies sourced VERBATIM from LIVE; the marked blocks are the only
-- changes. Signatures unchanged (no DROP needed).

create or replace function public.reopen_work_package_for_defect(
  p_wp uuid,
  p_reason text,
  p_source rework_source default 'internal'::rework_source
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status public.work_package_status;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_uid    uuid := auth.uid();
  v_role   public.user_role := public.current_user_role();
  v_round  smallint;
begin
  -- U3: auditor added.
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'auditor') then
    raise exception 'reopen_work_package_for_defect: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'reopen_work_package_for_defect: not a member of this project'
      using errcode = '42501';
  end if;
  -- U3 (D2/D5): client defects are a PM-tier act — auditor and site_admin
  -- file internal only.
  if p_source = 'client' and v_role in ('site_admin', 'auditor') then
    raise exception 'reopen_work_package_for_defect: only PM tier may file a client defect'
      using errcode = '42501';
  end if;
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'reopen_work_package_for_defect: reason required (<= 1000 chars)'
      using errcode = '22023';
  end if;

  select status into v_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'reopen_work_package_for_defect: unknown work package' using errcode = '22023';
  end if;
  if v_status <> 'complete' then
    raise exception 'reopen_work_package_for_defect: only a complete work package can be reopened'
      using errcode = '22023';
  end if;

  -- Spec 216: advance the rework cycle and capture which round this reopen opened.
  update public.work_packages
     set status = 'rework', rework_round = rework_round + 1
   where id = p_wp
  returning rework_round into v_round;

  -- Spec 217: stamp the source (internal/client) alongside the reason + round.
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_wp,
    jsonb_build_object(
      'event', 'wp_reopened_for_defect',
      'reason', v_reason,
      'round', v_round,
      'source', p_source
    )
  );

  return true;
end;
$function$;

create or replace function public.log_labor_day(
  p_wp uuid,
  p_worker uuid,
  p_date date,
  p_fraction day_fraction,
  p_note text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker public.workers%rowtype;
  v_wp_status public.work_package_status;
  v_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'log_labor_day: role not permitted' using errcode = '42501';
  end if;
  if p_fraction is null then
    raise exception 'log_labor_day: day fraction required' using errcode = 'P0001';
  end if;
  -- U3 (spec 271 §3): the labor actual_start anchor must not be stageable
  -- ahead of time.
  if p_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'log_labor_day: work_date cannot be in the future' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_wp::text || '|' || p_worker::text || '|' || p_date::text, 0));

  select status into v_wp_status
    from public.work_packages where id = p_wp;
  if not found then
    raise exception 'log_labor_day: work package not found' using errcode = 'P0001';
  end if;
  if v_wp_status = 'complete' then
    raise exception 'log_labor_day: work package is complete'
      using errcode = 'P0001';
  end if;

  select * into v_worker from public.workers where id = p_worker;
  if not found then
    raise exception 'log_labor_day: worker not found' using errcode = 'P0001';
  end if;
  if not v_worker.active then
    raise exception 'log_labor_day: worker is inactive' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.labor_logs ll
     where ll.work_package_id = p_wp
       and ll.worker_id = p_worker
       and ll.work_date = p_date
       and ll.day_fraction is not null
       and not exists (select 1 from public.labor_logs newer
                        where newer.superseded_by = ll.id)
  ) then
    raise exception 'log_labor_day: entry already exists for this worker and day'
      using errcode = 'P0001';
  end if;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, pay_type_snapshot,
     entered_by, self_logged, note)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.pay_type,
     auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null,
     nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$function$;
