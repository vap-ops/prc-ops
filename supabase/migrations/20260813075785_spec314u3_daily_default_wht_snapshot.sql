-- Spec 314 U3 / ADR 0082 — technicians default to daily pay; day_rate is derived
-- from the firm level-standard (stored GROSS) at the confirm_worker_cost money
-- gate; the firm WHT % is FROZEN per labor_logs row at log time so a later config
-- change never restates a worked day.
--
-- Additive: a column default flip, a new nullable zero-grant money column, and
-- CREATE OR REPLACE of four DEFINER RPCs (bodies sourced VERBATIM from the LIVE
-- functions — pg_get_functiondef, not stale migration files — with only the
-- documented surgical lines added). CREATE OR REPLACE preserves each function's
-- ACL, so the existing revoke-anon / grant-authenticated posture is untouched.

-- ---- 1. pay_type defaults to daily (ADR 0082) --------------------------------
alter table public.workers alter column pay_type set default 'daily';

-- ---- 2. wht_pct_snapshot — frozen firm % per row -----------------------------
-- Zero-grant by omission: the labor_logs authenticated grant is column-scoped
-- (day_rate_snapshot / pay_type_snapshot carry no grant), so a new money-adjacent
-- column is service-role-read-only by default, like the other snapshots.
alter table public.labor_logs add column wht_pct_snapshot numeric(5,2);

-- ---- 3. approve_crew_registration — p_pay_type defaults to daily -------------
-- LIVE body verbatim; ONLY the signature default added (p_pay_type → 'daily').
create or replace function public.approve_crew_registration(p_id uuid, p_pay_type pay_type default 'daily'::pay_type, p_day_rate numeric default null::numeric, p_employment_type employment_type default 'permanent'::employment_type)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor   uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_reg     public.crew_registrations%rowtype;
  v_project uuid;
  v_default numeric;
  v_rate    numeric;
  v_worker  uuid;
begin
  if v_role is null or v_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'approve_crew_registration: role not permitted' using errcode = '42501';
  end if;
  select * into v_reg from public.crew_registrations where id = p_id;
  if not found then
    raise exception 'approve_crew_registration: registration not found' using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'approve_crew_registration: registration is not pending' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workers w where w.tax_id = v_reg.national_id) then
    raise exception 'approve_crew_registration: national-ID already on a worker' using errcode = 'P0001';
  end if;

  select project_id, default_day_rate into v_project, v_default from public.crews where id = v_reg.crew_id;
  v_rate := coalesce(p_day_rate, v_default);
  if v_rate is null or v_rate < 0 then
    raise exception 'approve_crew_registration: no day rate (pass p_day_rate or set the crew default)' using errcode = 'P0001';
  end if;

  -- INLINE the worker insert (NOT create_worker — a nested DEFINER re-resolves the
  -- original caller; also we need user_id NULL + employee_id copied). Phoneless: no user_id.
  insert into public.workers (name, pay_type, employment_type, user_id, employee_id, day_rate,
                              active, created_by, project_id, phone, tax_id, date_of_birth)
  values (v_reg.full_name, p_pay_type, p_employment_type, null, v_reg.employee_id, v_rate,
          true, v_actor, v_project, v_reg.phone, v_reg.national_id, v_reg.date_of_birth)
  returning id into v_worker;

  -- INLINE crew membership + project move (NOT assign_worker_to_project — its gate
  -- excludes procurement_manager and it re-resolves the caller under DEFINER).
  insert into public.crew_members (crew_id, worker_id, added_by) values (v_reg.crew_id, v_worker, v_actor);
  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (v_worker, v_project, v_actor, 'crew onboarding');

  update public.crew_registrations
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = v_reg.id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', v_actor, v_role, 'workers', v_worker,
          jsonb_build_object('kind', 'create', 'source', 'crew_registration', 'registration_id', v_reg.id,
                             'employee_id', v_reg.employee_id, 'crew_id', v_reg.crew_id,
                             'pay_type', p_pay_type, 'day_rate', v_rate));
  return v_worker;
end;
$function$;

-- ---- 4. confirm_worker_cost — derive day_rate from the level standard --------
-- LIVE body verbatim; the derive block (marked) added after the level set.
create or replace function public.confirm_worker_cost(p_worker uuid, p_level worker_level)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is distinct from 'super_admin' then
    raise exception 'confirm_worker_cost: only super_admin may confirm cost' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'confirm_worker_cost: worker not found' using errcode = 'P0001';
  end if;
  update public.workers set level = p_level where id = p_worker;
  -- Spec 314 U3: derive day_rate from the level standard (stored GROSS) when the
  -- level has one; keep the prior rate when the standard is unset (coalesce).
  update public.workers
     set day_rate = coalesce(public.level_gross_rate(p_level), day_rate)
   where id = p_worker;
  -- Cost-loggable once level + rate + pay-class + tenure are all set.
  update public.workers
     set cost_confirmed_at = now(), cost_confirmed_by = auth.uid()
   where id = p_worker
     and level is not null and day_rate is not null
     and pay_type is not null and employment_type is not null;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', p_worker,
          jsonb_build_object('kind', 'cost_confirm', 'level', p_level));
end;
$function$;

-- ---- 5. log_labor_day — freeze the firm WHT % into the row -------------------
-- LIVE body verbatim; wht_pct_snapshot added to the INSERT (col + value only).
create or replace function public.log_labor_day(p_wp uuid, p_worker uuid, p_date date, p_fraction day_fraction, p_note text default null::text)
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
     wht_pct_snapshot,
     entered_by, self_logged, note)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.pay_type,
     (select wht_pct from public.labor_wht_config where id = true),
     auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null,
     nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---- 6. correct_labor_log — copy the ORIGINAL frozen WHT % forward -----------
-- LIVE body verbatim; wht_pct_snapshot added to the INSERT, copied from v_orig
-- (freeze at original log time — never re-read the firm %).
create or replace function public.correct_labor_log(p_log uuid, p_reason text, p_fraction day_fraction default null::day_fraction, p_tombstone boolean default false, p_note text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_orig public.labor_logs%rowtype;
  v_worker_user uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'correct_labor_log: role not permitted' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'correct_labor_log: reason required (max 300 chars)'
      using errcode = 'P0001';
  end if;
  if not p_tombstone and p_fraction is null then
    raise exception 'correct_labor_log: new fraction required unless removing'
      using errcode = 'P0001';
  end if;

  select * into v_orig from public.labor_logs where id = p_log;
  if not found then
    raise exception 'correct_labor_log: log not found' using errcode = 'P0001';
  end if;
  if v_orig.day_fraction is null then
    raise exception 'correct_labor_log: cannot correct a removal'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_orig.work_package_id::text || '|'
                     || v_orig.worker_id::text || '|'
                     || v_orig.work_date::text, 0));

  if exists (select 1 from public.labor_logs newer
              where newer.superseded_by = p_log) then
    raise exception 'correct_labor_log: log already superseded'
      using errcode = 'P0001';
  end if;

  select w.user_id into v_worker_user
    from public.workers w where w.id = v_orig.worker_id;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, pay_type_snapshot,
     wht_pct_snapshot,
     entered_by, self_logged,
     superseded_by, correction_reason, note)
  values
    (v_orig.work_package_id, v_orig.worker_id, v_orig.work_date,
     case when p_tombstone then null else p_fraction end,
     v_orig.day_rate_snapshot, v_orig.worker_name_snapshot,
     v_orig.pay_type_snapshot,
     v_orig.wht_pct_snapshot,
     auth.uid(),
     v_worker_user is not distinct from auth.uid() and v_worker_user is not null,
     p_log, v_reason,
     case
       when p_tombstone then null
       when p_note is null then v_orig.note
       else nullif(btrim(p_note), '')
     end)
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---- 7. Re-assert the DEFINER execute posture (belt-and-suspenders) ----------
-- CREATE OR REPLACE preserves each function's ACL (verified post-push: anon has
-- no execute; authenticated + service_role do), so these are no-ops on the live
-- DB. Re-emitted so a fresh apply of this file reproduces the exact posture and
-- no DEFINER money/labor RPC is ever left executable by anon (spec 284 lesson).
revoke execute on function public.approve_crew_registration(uuid, public.pay_type, numeric, public.employment_type) from anon;
revoke execute on function public.confirm_worker_cost(uuid, public.worker_level) from anon;
revoke execute on function public.log_labor_day(uuid, uuid, date, public.day_fraction, text) from anon;
revoke execute on function public.correct_labor_log(uuid, text, public.day_fraction, boolean, text) from anon;
grant execute on function public.approve_crew_registration(uuid, public.pay_type, numeric, public.employment_type) to authenticated;
grant execute on function public.confirm_worker_cost(uuid, public.worker_level) to authenticated;
grant execute on function public.log_labor_day(uuid, uuid, date, public.day_fraction, text) to authenticated;
grant execute on function public.correct_labor_log(uuid, text, public.day_fraction, boolean, text) to authenticated;
