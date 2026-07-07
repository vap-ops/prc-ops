-- Spec 275 U0 / ADR 0078 — equipment-rental vendor unification.
-- PRI is generalized to just-another-rental-vendor (its owner/ROI app is separate),
-- so the rental payee moves off the dedicated equipment_owners master onto suppliers.
--
-- ADDITIVE by design: the live equipment_items.owner_id / equipment_rental_batches.owner_id
-- FKs are DEPRECATED (kept, unused), NOT dropped — a new supplier_id is added + backfilled.
-- The destructive owner_id drop + equipment_owners teardown is a later operator-held
-- cleanup (break-glass Procedure B), out of this unit. See docs/feature-specs/275 §U0.

-- ----------------------------------------------------------------------------
-- 1. suppliers gains blacklist parity: only contact_status is new. tax_id (spec 84,
--    20260628000100) and is_vat_registered (spec 191 U2, 20260811000600) ALREADY exist
--    on suppliers with their own grants — do NOT re-add them. contact_status reuses the
--    existing enum (mirrors contractors/service_providers).
alter table public.suppliers
  add column if not exists contact_status public.contact_status not null default 'active';

-- Extend the column-scoped UPDATE grant so back office can set the blacklist status
-- (SELECT is table-wide already; a new supplier defaults to 'active').
grant update (contact_status) on public.suppliers to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Mirror equipment_owners into suppliers, PRESERVING id — this makes the supplier_id
--    backfill an identity copy (supplier_id = owner_id). on conflict do nothing: an owner
--    id already present as a supplier is left as-is (no real overlap today — a single PRI
--    owner). A name-collision reconciliation is unnecessary at this scale (noted in tracker).
insert into public.suppliers (id, name, phone, created_by, created_at)
  select eo.id, eo.name, eo.phone, eo.created_by, eo.created_at
    from public.equipment_owners eo
  on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Add + backfill supplier_id on the two rental-bearing tables. owner_id is kept
--    (deprecated). supplier_id = owner_id by the id-preserving mirror above.
alter table public.equipment_items
  add column if not exists supplier_id uuid references public.suppliers(id);
alter table public.equipment_rental_batches
  add column if not exists supplier_id uuid references public.suppliers(id);

update public.equipment_items
   set supplier_id = owner_id where owner_id is not null and supplier_id is null;
update public.equipment_rental_batches
   set supplier_id = owner_id where owner_id is not null and supplier_id is null;

create index if not exists equipment_items_supplier_idx          on public.equipment_items (supplier_id);
create index if not exists equipment_rental_batches_supplier_idx on public.equipment_rental_batches (supplier_id);

-- supplier_id on equipment_items is field-visible tracking metadata (exactly like
-- owner_id), NOT money — add it to the same column-scoped grants owner_id carries.
grant select (supplier_id) on public.equipment_items to authenticated;
grant insert (supplier_id) on public.equipment_items to authenticated;
grant update (supplier_id) on public.equipment_items to authenticated;
-- equipment_rental_batches is a ZERO-GRANT money table (no authenticated grant); the new
-- supplier_id needs no grant — it is read/written only via the admin client + the
-- SECURITY DEFINER rental-agreement RPCs (which land in U1).

comment on column public.equipment_items.owner_id is
  'DEPRECATED (spec 275 U0 / ADR 0078): use supplier_id. Kept for continuity; dropped in a later operator-held cleanup.';
comment on column public.equipment_rental_batches.owner_id is
  'DEPRECATED (spec 275 U0 / ADR 0078): use supplier_id. Kept for continuity; dropped in a later operator-held cleanup.';
comment on column public.equipment_items.supplier_id is
  'The rental vendor (suppliers) this item is rented from (ADR 0078). NULL = owned / not rented. Field-visible tracking, not money.';
comment on column public.equipment_rental_batches.supplier_id is
  'The rental vendor (suppliers) PRC pays for this agreement (ADR 0078; supersedes owner_id). Zero-grant money table.';
