-- Spec 268 U1 — equipment rental rate period (additive).
--
-- The procurement team records real rental deals: whole-project rentals are
-- month-priced, short custom-duration rentals (pump, crane) are day-priced.
-- Forcing a day-priced deal into monthly_rate records a wrong number, so the
-- batch header gains the unit its rate is quoted in.
--
-- 1) enum public.equipment_rate_period (monthly | daily). CREATE TYPE is
--    transactional — the enum-add ISOLATION rule binds ALTER TYPE ... ADD
--    VALUE, not CREATE TYPE — so enum + column + RPC ship in one migration.
-- 2) equipment_rental_batches.rate_period, not null default 'monthly'
--    (live table has 0 rows; the default preserves the old meaning).
-- 3) create_equipment_rental_batch: DROP the 5-arg, CREATE the 6-arg with a
--    trailing p_rate_period default 'monthly' (keeping both arities would
--    make named-notation calls ambiguous — the spec-217 DROP/CREATE
--    precedent). Body re-sourced VERBATIM from LIVE via pg_get_functiondef
--    (2026-07-05 — the 20260813071000 parity-sweep body, 5-role gate incl.
--    procurement_manager); exactly three additions: the p_rate_period null
--    guard, rate_period in the INSERT, rate_period in the audit payload.

create type public.equipment_rate_period as enum ('monthly', 'daily');

alter table public.equipment_rental_batches
  add column rate_period public.equipment_rate_period not null default 'monthly';

comment on column public.equipment_rental_batches.rate_period is
  'Unit monthly_rate is quoted in: per month (whole-project rentals) or per day (short custom-duration rentals). monthly_rate keeps its historical name (a rename is destructive break-glass); rate_period names its unit. MONEY table — zero authenticated grant (ADR 0055 decision 6).';

drop function public.create_equipment_rental_batch(uuid, numeric, date, date, text);

create function public.create_equipment_rental_batch(
  p_owner_id uuid,
  p_monthly_rate numeric,
  p_starts_on date,
  p_ends_on date default null,
  p_note text default null,
  p_rate_period public.equipment_rate_period default 'monthly'
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

  perform 1 from public.equipment_owners where id = p_owner_id;
  if not found then
    raise exception 'create_equipment_rental_batch: owner not found' using errcode = 'P0001';
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

  insert into public.equipment_rental_batches
    (owner_id, monthly_rate, rate_period, starts_on, ends_on, note, created_by)
  values (p_owner_id, p_monthly_rate, p_rate_period, p_starts_on, p_ends_on, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_batch_create', auth.uid(), v_role,
          'equipment_rental_batches', v_id,
          jsonb_build_object('owner_id', p_owner_id, 'monthly_rate', p_monthly_rate,
                             'rate_period', p_rate_period,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$$;

revoke all on function public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period) from public;
grant execute on function public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period) to authenticated;
