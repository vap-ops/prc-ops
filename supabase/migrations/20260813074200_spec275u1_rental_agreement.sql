-- Spec 275 U1 / ADR 0078 — rental agreement: finish the vendor switch + agreement fields.
--
-- Extends merged spec 268 (which activated /equipment/rentals + rate_period). This unit:
--   (a) finishes U0's vendor unification on the CREATE path — 268's create RPC still set
--       owner_id, but U0's post_rental_batch_to_gl reads supplier_id, so a 268-recorded batch
--       posted rental GL with a NULL supplier party. Repoint the create RPC owner_id->supplier_id.
--   (b) adds the agreement fields 268 lacks: refundable deposit, minimum rental days, status.
-- rental_rate_tiers is NOT built (dropped — 268's rate_period monthly|daily is the rate model).
-- Additive: owner_id is RELAXED to nullable (kept for existing rows, deprecated per U0), not dropped.

-- ----------------------------------------------------------------------------
-- 1. Agreement status enum + the new columns on equipment_rental_batches (zero-grant money table).
create type public.rental_agreement_status as enum ('active', 'returned', 'settled', 'cancelled');

alter table public.equipment_rental_batches
  add column deposit_amount    numeric(12,2) not null default 0 check (deposit_amount >= 0),
  add column deposit_paid_date date,
  add column min_rental_days   int check (min_rental_days is null or min_rental_days > 0),
  add column status            public.rental_agreement_status not null default 'active';

comment on column public.equipment_rental_batches.deposit_amount is
  'MONEY (spec 275 U1): refundable deposit PRC pays the vendor. A prepaid asset (acct 1320), NOT a reduction of rental cost — resolved refund/forfeit at settlement (U3). Zero-grant.';
comment on column public.equipment_rental_batches.status is
  'Rental agreement lifecycle (spec 275 U1): active -> returned -> settled, or cancelled.';

-- 2. Relax owner_id NOT NULL — new batches carry supplier_id (U0); owner_id kept for existing
--    rows only (deprecated). Zero-grant money table: no grant change.
alter table public.equipment_rental_batches alter column owner_id drop not null;

-- ----------------------------------------------------------------------------
-- 3. equipment_items gains the batch-grain rental link (field-visible tracking, NOT money).
alter table public.equipment_items
  add column rental_agreement_id uuid references public.equipment_rental_batches(id);
create index equipment_items_rental_agreement_idx
  on public.equipment_items (rental_agreement_id);
grant select (rental_agreement_id) on public.equipment_items to authenticated;
grant insert (rental_agreement_id) on public.equipment_items to authenticated;
grant update (rental_agreement_id) on public.equipment_items to authenticated;
comment on column public.equipment_items.rental_agreement_id is
  'The rental agreement (equipment_rental_batches) this item is rented under (spec 275 U1). NULL = owned / not rented. Batch-grain; field-visible tracking, not money.';

-- ----------------------------------------------------------------------------
-- 4. Repoint create_equipment_rental_batch owner_id -> supplier_id, + deposit/min-days args.
--    DROP the merged 6-arg (spec 268 `20260813071900`), CREATE a 9-arg. Body re-sourced from the
--    LIVE 6-arg — changes: p_owner_id->p_supplier_id, owner-exists guard -> suppliers, INSERT sets
--    supplier_id, audit key owner_id->supplier_id, + the 3 new trailing args flow into the INSERT.
--    5-role gate preserved verbatim. anon EXECUTE revoked EXPLICITLY (the 072000 lesson: a
--    DROP/CREATE re-opens anon's default execute).
drop function public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period);

create function public.create_equipment_rental_batch(
  p_supplier_id uuid,
  p_monthly_rate numeric,
  p_starts_on date,
  p_ends_on date default null,
  p_note text default null,
  p_rate_period public.equipment_rate_period default 'monthly',
  p_deposit_amount numeric default 0,
  p_deposit_paid_date date default null,
  p_min_rental_days int default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id   uuid;
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director') then
    raise exception 'create_equipment_rental_batch: role not permitted' using errcode = '42501';
  end if;

  perform 1 from public.suppliers where id = p_supplier_id;
  if not found then
    raise exception 'create_equipment_rental_batch: supplier not found' using errcode = 'P0001';
  end if;
  if p_monthly_rate is null or p_monthly_rate < 0 then
    raise exception 'create_equipment_rental_batch: invalid monthly rate' using errcode = 'P0001';
  end if;
  if p_starts_on is null then
    raise exception 'create_equipment_rental_batch: start date required' using errcode = 'P0001';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'create_equipment_rental_batch: end before start' using errcode = 'P0001';
  end if;
  if p_rate_period is null then
    raise exception 'create_equipment_rental_batch: rate period required' using errcode = 'P0001';
  end if;
  if p_deposit_amount is null or p_deposit_amount < 0 then
    raise exception 'create_equipment_rental_batch: invalid deposit' using errcode = 'P0001';
  end if;
  if p_min_rental_days is not null and p_min_rental_days <= 0 then
    raise exception 'create_equipment_rental_batch: invalid minimum rental days' using errcode = 'P0001';
  end if;

  insert into public.equipment_rental_batches
    (supplier_id, monthly_rate, rate_period, starts_on, ends_on, note,
     deposit_amount, deposit_paid_date, min_rental_days, created_by)
  values (p_supplier_id, p_monthly_rate, p_rate_period, p_starts_on, p_ends_on, p_note,
          coalesce(p_deposit_amount, 0), p_deposit_paid_date, p_min_rental_days, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_batch_create', auth.uid(), v_role,
          'equipment_rental_batches', v_id,
          jsonb_build_object('supplier_id', p_supplier_id, 'monthly_rate', p_monthly_rate,
                             'rate_period', p_rate_period,
                             'deposit_amount', coalesce(p_deposit_amount, 0),
                             'min_rental_days', p_min_rental_days,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$$;

revoke all on function public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period, numeric, date, int) from public, anon;
grant execute on function public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period, numeric, date, int) to authenticated;
