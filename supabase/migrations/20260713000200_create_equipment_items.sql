-- Spec 141 U1 / ADR 0055 — equipment_items: the serialized-first asset
-- registry. tracking='unit' is one physical unit (asset_tag, no quantity);
-- tracking='bulk' is fungible stock (quantity >= 1, no asset_tag). The
-- invariants are DB-enforced (CHECKs below) and mirrored by the pure validator
-- src/lib/equipment/validate-equipment-item.ts.
--
-- MONEY POSTURE (ADR 0055 decision 6; mirrors workers.day_rate, spec 46):
-- acquisition_cost and acquired_at get NO authenticated grant — the
-- column-scoped grants below OMIT them, so a field/PM session cannot read them
-- even with a hand-crafted query; the only reader is the service-role admin
-- client behind requireRole(pm/super/procurement). The rest of the registry is
-- field-visible (the field receives and moves equipment).
--
-- No DELETE ever (masters posture): a returned/lost asset is a STATUS, not a
-- deletion; the asset's history stays.

create type public.equipment_status as enum
  ('available', 'on_site', 'in_use', 'maintenance', 'returned', 'lost');

create type public.equipment_tracking as enum ('unit', 'bulk');

create table public.equipment_items (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid not null references public.equipment_categories(id),
  owner_id         uuid not null references public.equipment_owners(id),
  name             text not null,
  tracking         public.equipment_tracking not null default 'unit',
  asset_tag        text null,
  quantity         integer null,
  status           public.equipment_status not null default 'available',
  acquisition_cost numeric(12,2) null,
  acquired_at      date null,
  created_by       uuid not null references public.users(id),
  created_at       timestamptz not null default now(),
  constraint equipment_items_name_nonblank check (length(trim(name)) > 0),
  constraint equipment_items_name_cap check (length(name) <= 120),
  constraint equipment_items_asset_tag_form
    check (asset_tag is null or (length(trim(asset_tag)) > 0 and length(asset_tag) <= 80)),
  constraint equipment_items_unit_no_quantity
    check (tracking <> 'unit' or quantity is null),
  constraint equipment_items_bulk_has_quantity
    check (tracking <> 'bulk' or (quantity is not null and quantity >= 1)),
  constraint equipment_items_bulk_no_asset_tag
    check (tracking <> 'bulk' or asset_tag is null),
  constraint equipment_items_acq_cost_nonneg
    check (acquisition_cost is null or acquisition_cost >= 0)
);

-- One physical unit per asset tag (partial: bulk rows carry no tag).
create unique index equipment_items_asset_tag_uniq
  on public.equipment_items (asset_tag) where asset_tag is not null;
create index equipment_items_category_idx on public.equipment_items (category_id);
create index equipment_items_owner_idx on public.equipment_items (owner_id);
create index equipment_items_status_idx on public.equipment_items (status);

alter table public.equipment_items enable row level security;
revoke all on public.equipment_items from anon, authenticated;

-- Column-scoped grants — the money columns (acquisition_cost, acquired_at) are
-- OMITTED from every authenticated grant (admin-client only; workers pattern).
grant select (id, category_id, owner_id, name, tracking, asset_tag, quantity,
              status, created_by, created_at)
  on public.equipment_items to authenticated;
grant insert (id, category_id, owner_id, name, tracking, asset_tag, quantity,
              status, created_by)
  on public.equipment_items to authenticated;
grant update (category_id, owner_id, name, tracking, asset_tag, quantity, status)
  on public.equipment_items to authenticated;
-- NO delete grant/policy.

create policy "equipment_items readable by staff"
  on public.equipment_items for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'procurement', 'super_admin'));

create policy "equipment_items insert by back office"
  on public.equipment_items for insert to authenticated
  with check ((select public.current_user_role())
                in ('project_manager', 'procurement', 'super_admin')
              and created_by = (select auth.uid()));

create policy "equipment_items update by back office"
  on public.equipment_items for update to authenticated
  using ((select public.current_user_role())
         in ('project_manager', 'procurement', 'super_admin'))
  with check ((select public.current_user_role())
              in ('project_manager', 'procurement', 'super_admin'));

comment on table public.equipment_items is
  'Equipment asset registry (spec 141 / ADR 0055). Serialized-first: tracking=unit (asset_tag, no qty) or bulk (qty>=1, no tag). owner_id -> equipment_owners (sister co). acquisition_cost/acquired_at are money (no authenticated grant, admin-read only). No delete (returned/lost = status).';

comment on column public.equipment_items.acquisition_cost is
  'MONEY (ADR 0055): the price the owner paid for this asset. No authenticated grant; admin-read only behind requireRole(pm/super/procurement).';
comment on column public.equipment_items.acquired_at is
  'Owner-private metadata (ADR 0055): acquisition date for the owner''s asset accounting. Same admin-only posture as acquisition_cost.';
