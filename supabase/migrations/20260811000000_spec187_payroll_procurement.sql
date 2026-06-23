-- Spec 187 — procurement gains project-director parity on the DC payroll surface.
-- It already owns DC onboarding + the pay rate (spec 172 Phase C); the operator
-- extends that to viewing + PAYING the DC payroll roll-up. The /payroll page gate
-- moves to PAYROLL_ROLES (= PM_ROLES + procurement) in app code; this migration
-- admits procurement to the money definer so the record-payment action it now
-- sees does not 42501.
--
-- CREATE OR REPLACE, signature UNCHANGED → the authenticated-only EXECUTE
-- lockdown (no re-grant of anon) is preserved and `db:types` needs no regen.
-- Body reproduced VERBATIM from the live catalog (pg_get_functiondef,
-- 2026-06-23); the ONLY change is appending 'procurement' to the role gate.
-- project_director stays in the list (rides along, spec 152 / file 91 doctrine).

create or replace function public.record_dc_payment(
  p_worker uuid, p_from date, p_to date, p_paid_amount numeric, p_paid_at date,
  p_method dc_payment_method, p_reference text, p_note text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_amount numeric(12,2);
  v_days   numeric(6,1);
  v_id     uuid;
begin
  -- Money: pm/super/director/procurement only (site_admin refused, like
  -- freeze_wp_labor_cost). Spec 187 adds procurement (project-director parity on
  -- payroll); project_director rides along per spec 152 / ADR 0058.
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'record_dc_payment: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly (v1 access is
  -- role-level per ADR 0013, so existence is the only guard available).
  perform 1 from public.workers where id = p_worker;
  if not found then
    raise exception 'record_dc_payment: worker not found' using errcode = 'P0001';
  end if;

  if p_to < p_from then
    raise exception 'record_dc_payment: period_to before period_from' using errcode = 'P0001';
  end if;
  if p_paid_amount is null or p_paid_amount < 0 then
    raise exception 'record_dc_payment: paid_amount must be >= 0' using errcode = 'P0001';
  end if;

  -- Serialize per (worker, period) so two concurrent records cannot both
  -- pass the duplicate guard.
  perform pg_advisory_xact_lock(hashtext(p_worker::text || p_from::text || p_to::text));

  -- One current payment per (worker, exact period).
  if exists (
    select 1 from public.dc_payments d
    where d.worker_id = p_worker
      and d.period_from = p_from
      and d.period_to = p_to
      and not exists (select 1 from public.dc_payments n where n.superseded_by = d.id)
  ) then
    raise exception 'record_dc_payment: a payment already exists for this worker and period'
      using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded, non-tombstone) DC labor logs for this
  -- worker in the window. MUST match src/lib/labor/payroll.ts aggregatePayroll
  -- (the live owed shown on /payroll is computed the same way).
  select
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end)), 0),
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot), 0)
  into v_days, v_amount
  from public.labor_logs ll
  where ll.worker_type_snapshot = 'dc'
    and ll.worker_id = p_worker
    and ll.work_date between p_from and p_to
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  insert into public.dc_payments (
    worker_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, reference, note, paid_by)
  values (
    p_worker, p_from, p_to, v_amount, v_days,
    p_paid_amount, p_paid_at, p_method,
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('dc_payment_recorded', auth.uid(), public.current_user_role(),
          'dc_payments', v_id,
          jsonb_build_object('worker_id', p_worker,
                             'period_from', p_from, 'period_to', p_to,
                             'computed_amount', v_amount, 'computed_days', v_days,
                             'paid_amount', p_paid_amount, 'method', p_method));
  return v_id;
end;
$function$;
