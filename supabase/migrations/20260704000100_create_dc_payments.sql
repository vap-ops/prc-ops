-- Spec 127 U1 — dc_payments: the per-period DC payment ledger, plus
-- record_dc_payment(...) that recomputes what's owed and records a payment.
--
-- MONEY POSTURE: the whole table is money and every reaching surface is PM-only
-- (/payroll, requireRole(PM_ROLES)). So, exactly like wp_labor_costs (spec 68):
-- NO authenticated grant, RLS enabled, no policies. Read only via the
-- service-role admin client behind requireRole(pm/super); written only by the
-- SECURITY DEFINER RPC below, invoked under the caller's authenticated session.
--
-- APPEND-ONLY (money / DC-entries mandate, labor_logs precedent): a recorded
-- payment is never UPDATEd or DELETEd. A future void/correction (spec 127 U3) is
-- a superseding row; the supersede columns ship now so the table's shape is
-- final. Enforced by a BEFORE UPDATE/DELETE trigger that fires even for
-- SECURITY DEFINER / service-role callers (triggers run regardless of RLS
-- bypass). The current state is a supersede anti-join (ADR 0009) + a tombstone
-- filter (paid_amount IS NULL, ADR 0015).

create type public.dc_payment_method as enum ('bank_transfer', 'cash', 'cheque');

create table public.dc_payments (
  id                uuid primary key default gen_random_uuid(),
  contractor_id     uuid          not null references public.contractors(id),
  period_from       date          not null,
  period_to         date          not null,
  computed_amount   numeric(12,2) not null,   -- owed @ record time (server recompute)
  computed_days     numeric(6,1)  not null,
  paid_amount       numeric(12,2) null,       -- actually paid; NULL only on a tombstone
  paid_at           date          not null,   -- Bangkok payment date
  method            public.dc_payment_method not null,
  reference         text          null,
  note              text          null,
  paid_by           uuid          not null references public.users(id),
  superseded_by     uuid          null references public.dc_payments(id),
  correction_reason text          null,
  created_at        timestamptz   not null default now(),
  constraint dc_payments_period_order check (period_to >= period_from),
  constraint dc_payments_tombstone_shape check (paid_amount is not null or superseded_by is not null),
  constraint dc_payments_reason_iff_supersede check ((correction_reason is null) = (superseded_by is null)),
  constraint dc_payments_reference_len check (reference is null or length(reference) <= 120),
  constraint dc_payments_note_len      check (note      is null or length(note)      <= 500)
);

create index dc_payments_contractor_period_idx
  on public.dc_payments (contractor_id, period_from, period_to);

alter table public.dc_payments enable row level security;
-- Zero grant: money. With no authenticated grant there is no policy to write
-- (every table still has RLS enabled per the project rule). Read via the admin
-- client; write via the SECURITY DEFINER RPC below.
revoke all on public.dc_payments from anon, authenticated;

-- Append-only third layer (audit_log / labor_logs posture). The zero grant
-- already blocks authenticated UPDATE/DELETE; this trigger blocks even
-- SECURITY DEFINER / service-role mutation so a recorded payment is immutable.
create function public.dc_payments_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'dc_payments is append-only (spec 127): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger dc_payments_no_update_delete
  before update or delete on public.dc_payments
  for each row execute function public.dc_payments_block_mutation();

-- ----------------------------------------------------------------------------
-- record_dc_payment: recompute the contractor's owed for the period from the
-- CURRENT labor logs (the filter MUST match aggregatePayroll, spec 69:
-- worker_type_snapshot='dc', contractor_id_snapshot, current-state, in window),
-- snapshot it, and record what was actually paid. Mirrors freeze_wp_labor_cost's
-- role gate + audit write. Invoked under the caller's authenticated session
-- (auth.uid() and current_user_role() must resolve), never the service-role
-- admin client — service-role has no JWT, so current_user_role() would be NULL
-- and the gate would refuse it.
-- ----------------------------------------------------------------------------
create function public.record_dc_payment(
  p_contractor   uuid,
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
  -- Money: pm/super only (site_admin refused, like freeze_wp_labor_cost).
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'record_dc_payment: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly (v1 access is
  -- role-level per ADR 0013, so existence is the only guard available).
  perform 1 from public.contractors where id = p_contractor;
  if not found then
    raise exception 'record_dc_payment: contractor not found' using errcode = 'P0001';
  end if;

  if p_to < p_from then
    raise exception 'record_dc_payment: period_to before period_from' using errcode = 'P0001';
  end if;
  if p_paid_amount is null or p_paid_amount < 0 then
    raise exception 'record_dc_payment: paid_amount must be >= 0' using errcode = 'P0001';
  end if;

  -- Serialize per (contractor, period) so two concurrent records cannot both
  -- pass the duplicate guard.
  perform pg_advisory_xact_lock(hashtext(p_contractor::text || p_from::text || p_to::text));

  -- One current payment per (contractor, exact period).
  if exists (
    select 1 from public.dc_payments d
    where d.contractor_id = p_contractor
      and d.period_from = p_from
      and d.period_to = p_to
      and not exists (select 1 from public.dc_payments n where n.superseded_by = d.id)
  ) then
    raise exception 'record_dc_payment: a payment already exists for this contractor and period'
      using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded, non-tombstone) DC labor logs for this
  -- contractor in the window. MUST match src/lib/labor/payroll.ts
  -- aggregatePayroll (the live owed shown on /payroll is computed the same way).
  select
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end)), 0),
    coalesce(sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot), 0)
  into v_days, v_amount
  from public.labor_logs ll
  where ll.worker_type_snapshot = 'dc'
    and ll.contractor_id_snapshot = p_contractor
    and ll.work_date between p_from and p_to
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  insert into public.dc_payments (
    contractor_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, reference, note, paid_by)
  values (
    p_contractor, p_from, p_to, v_amount, v_days,
    p_paid_amount, p_paid_at, p_method,
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('dc_payment_recorded', auth.uid(), public.current_user_role(),
          'dc_payments', v_id,
          jsonb_build_object('contractor_id', p_contractor,
                             'period_from', p_from, 'period_to', p_to,
                             'computed_amount', v_amount, 'computed_days', v_days,
                             'paid_amount', p_paid_amount, 'method', p_method));
  return v_id;
end;
$$;

-- This function WRITES money. anon must not even reach it; authenticated callers
-- still hit the internal pm/super gate (same posture as freeze_wp_labor_cost).
revoke all on function public.record_dc_payment(uuid, date, date, numeric, date,
  public.dc_payment_method, text, text) from public, anon;
grant execute on function public.record_dc_payment(uuid, date, date, numeric, date,
  public.dc_payment_method, text, text) to authenticated;
