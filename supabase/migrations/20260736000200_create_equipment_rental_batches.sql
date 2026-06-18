-- Spec 146 U1 — equipment_rental_batches: the inbound deal header. PRC rents a
-- set of units from an owner for a period at a MONTHLY rate (ADR 0055 decision
-- 5). PRC's fixed cost. Batch<->items membership is U2's allocation concern;
-- this unit is the header only (owner + monthly rate + period).
--
-- MONEY TABLE = ZERO GRANT (the wp_labor_costs posture, spec 68): RLS enabled
-- (project rule: every table) then REVOKE ALL from anon/authenticated. With no
-- authenticated grant there is no read/write policy to add — the table is
-- written ONLY by the SECURITY DEFINER create_equipment_rental_batch RPC and
-- read ONLY via the service-role admin client behind requireRole(pm/super/
-- procurement). NO delete (a rental record is permanent history; an ended batch
-- carries ends_on, it is never removed). Never on a site_admin screen (spec 46).

create table public.equipment_rental_batches (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.equipment_owners(id),
  monthly_rate numeric(12,2) not null,
  starts_on    date not null,
  ends_on      date null,
  note         text null,
  created_by   uuid not null references public.users(id),
  created_at   timestamptz not null default now(),
  constraint equipment_rental_batches_monthly_rate_nonneg
    check (monthly_rate >= 0),
  constraint equipment_rental_batches_period_order
    check (ends_on is null or ends_on >= starts_on)
);

create index equipment_rental_batches_owner_idx
  on public.equipment_rental_batches (owner_id);

alter table public.equipment_rental_batches enable row level security;
-- Zero grant: money. Written only by the SECURITY DEFINER RPC below; read only
-- via the admin client. No authenticated grant => no policy to write (RLS stays
-- enabled per the project rule). No delete grant/policy.
revoke all on public.equipment_rental_batches from anon, authenticated;

comment on table public.equipment_rental_batches is
  'Inbound equipment rental deal header (spec 146 / ADR 0055): PRC rents a set from an owner for a period at a MONTHLY rate (PRC fixed cost). MONEY: zero authenticated grant, admin-read only, written via create_equipment_rental_batch. Batch<->items membership is U2 (allocations). No delete.';
comment on column public.equipment_rental_batches.monthly_rate is
  'MONEY (spec 146): the monthly rate PRC pays the owner for this rented set. No authenticated grant; admin-read only behind requireRole(pm/super/procurement).';
