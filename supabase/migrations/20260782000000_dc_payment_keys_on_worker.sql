-- Spec 170 / ADR 0062 U3 — DC payment keys on the worker.
--
-- A DC is a worker (the payee), not a contractor party. Repoint the per-period
-- DC payment ledger off the contractor and onto the worker:
--   * dc_payments.contractor_id → worker_id (FK → workers; index swapped).
--   * record_dc_payment(p_worker, …) sums CURRENT DC labor_logs by worker_id,
--     one payment per (worker, period).
--   * get_my_dc_payments() is a transitional bridge — the portal binding is
--     still by contractor until U4, so a DC reads the payments of the workers
--     bound to their contractor.
--
-- CLEAN RESHAPE: prod has zero dc_payments rows (2026-06-21 audit), so the
-- column rename + FK swap carry no data. The append-only trigger and the
-- zero-grant money posture are unchanged (DDL doesn't fire the trigger; RLS /
-- grants are table-level, not column-level).

-- ----------------------------------------------------------------------------
-- 1. dc_payments: contractor_id → worker_id.
-- ----------------------------------------------------------------------------
drop index public.dc_payments_contractor_period_idx;

alter table public.dc_payments
  drop constraint dc_payments_contractor_id_fkey;

alter table public.dc_payments
  rename column contractor_id to worker_id;

alter table public.dc_payments
  add constraint dc_payments_worker_id_fkey
    foreign key (worker_id) references public.workers(id);

create index dc_payments_worker_period_idx
  on public.dc_payments (worker_id, period_from, period_to);

-- ----------------------------------------------------------------------------
-- 2. record_dc_payment(p_worker, …): recompute the worker's owed for the period
-- from the CURRENT DC labor logs (the filter MUST match aggregatePayroll, spec
-- 69 / spec 170 U3: worker_type_snapshot='dc', worker_id, current-state, in
-- window), snapshot it, and record what was actually paid. DROP+CREATE because
-- the leading parameter is renamed (contractor → worker); CREATE OR REPLACE
-- cannot rename a parameter. The DROP resets EXECUTE to the PUBLIC default, so
-- the spec-127 lockdown (revoke from public/anon, grant authenticated) is
-- re-applied below for the new signature.
-- ----------------------------------------------------------------------------
drop function public.record_dc_payment(uuid, date, date, numeric, date,
  public.dc_payment_method, text, text);

create function public.record_dc_payment(
  p_worker       uuid,
  p_from         date,
  p_to           date,
  p_paid_amount  numeric,
  p_paid_at      date,
  p_method       public.dc_payment_method,
  p_reference    text,
  p_note         text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,2);
  v_days   numeric(6,1);
  v_id     uuid;
begin
  -- Money: pm/super/director only (site_admin refused, like freeze_wp_labor_cost
  -- — project_director rides along per spec 152 / ADR 0058).
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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
$$;

-- Re-apply the spec-127 EXECUTE lockdown for the NEW signature (the DROP reset
-- it to the PUBLIC default). anon must not even reach it; authenticated callers
-- still hit the internal pm/super/director gate.
revoke all on function public.record_dc_payment(uuid, date, date, numeric, date,
  public.dc_payment_method, text, text) from public, anon;
grant execute on function public.record_dc_payment(uuid, date, date, numeric, date,
  public.dc_payment_method, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. get_my_dc_payments() — transitional bridge. dc_payments is now worker-keyed
-- but the portal binding is still by contractor (real portal repoint is U4), so
-- a DC reads the payments of the workers bound to their contractor. An internal
-- session (NULL contractor) matches no workers → zero rows. Current-state only
-- (supersede anti-join). Signature unchanged → the spec-130 grant is preserved.
-- ----------------------------------------------------------------------------
create or replace function public.get_my_dc_payments()
returns setof public.dc_payments
language sql
stable
security definer
set search_path = public
as $$
  select d.*
  from public.dc_payments d
  where public.current_user_contractor_id() is not null
    and d.worker_id in (
      select w.id from public.workers w
      where w.contractor_id = public.current_user_contractor_id()
    )
    and not exists (select 1 from public.dc_payments n where n.superseded_by = d.id);
$$;
