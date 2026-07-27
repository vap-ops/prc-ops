-- Spec 367 U1 — the fields the equipment registry never had.
--
-- Live grounding (prod, 2026-07-27): 64 equipment_items, and brand/model/serial
-- are crammed inside free-text `name` (`เครื่องทดสอบรอยรั่ว  ยี่ห้อ ASADA TEST
-- PUMP TP50E`). There is no image, no condition, no description, and
-- `equipment_status` has nowhere to put an asset that has been sold. PRC is
-- selling the whole registry to sister company PRI and renting it back
-- (spec 367 §3) — that transfer cannot be priced or scheduled without these.
--
-- Additive only. No data is rewritten; every column is nullable, so all 64
-- existing rows stay valid and the fill happens through the U2/U3 export→import
-- round trip rather than a backfill guess.

-- ---------------------------------------------------------------------------
-- 1. Condition grade.
--
-- An enum, not free text — CLAUDE.md: "All status fields use Postgres enums,
-- never free-text strings." Thai labels live in EQUIPMENT_CONDITION_LABEL
-- (src/lib/i18n/labels.ts) as a Record over the generated enum, so adding a
-- grade later trips exhaustiveness on purpose.
-- ---------------------------------------------------------------------------
create type public.equipment_condition as enum ('new', 'good', 'fair', 'needs_repair');

-- ---------------------------------------------------------------------------
-- 2. A disposal state.
--
-- Without this an asset sold to PRI would have to sit at `available` (a lie the
-- store would act on) or `lost` (a lie the accounts would act on).
--
-- NOTE: the new value is added but NOT used anywhere in this migration —
-- Postgres forbids using an enum value in the same transaction that adds it.
-- The sibling assertion in 65-equipment-registry.test.sql is updated to the
-- seven labels in this unit, deliberately, never by weakening the guard.
-- ---------------------------------------------------------------------------
alter type public.equipment_status add value if not exists 'disposed';

-- ---------------------------------------------------------------------------
-- 3. The columns.
--
-- `description` and `image_path` reuse names already established elsewhere in
-- this schema (15 and 3 uses respectively) rather than inventing synonyms;
-- `serial_no` follows `rental_settlements.invoice_no`.
-- ---------------------------------------------------------------------------
alter table public.equipment_items
  add column brand       text,
  add column model       text,
  add column serial_no   text,
  add column condition   public.equipment_condition,
  add column description text,
  add column image_path  text;

comment on column public.equipment_items.serial_no is
  'Manufacturer serial. Per-asset identity for the spec 367 §3 PRI transfer schedule.';
comment on column public.equipment_items.image_path is
  'Object path in the private equipment-images bucket. Reads via server-minted signed URLs.';

-- ---------------------------------------------------------------------------
-- 4. Column grants — the trap this unit exists to avoid.
--
-- equipment_items is COLUMN-granted: `authenticated` holds SELECT on twelve
-- named columns and NOT on acquisition_cost / acquired_at / daily_rate (ADR
-- 0055 decision 6 — money is zero-authenticated-grant, read only through the
-- admin client after the canManageRegistry gate).
--
-- A new column without a grant is not merely null to the RLS client: PostgREST
-- REFUSES the read outright. These six are not money and take non-money parity.
-- The money wall is untouched here and pinned in the negative direction by
-- 367-equipment-fields.test.sql section D, so a future blanket
-- `grant select on public.equipment_items` reds instead of silently publishing
-- what every tool cost.
--
-- RLS itself needs no change — the three existing policies already carry the
-- right audiences (SELECT: site_admin + five back-office; INSERT/UPDATE: the
-- five back-office) and are already (select current_user_role())-wrapped.
-- ---------------------------------------------------------------------------
grant select (brand, model, serial_no, condition, description, image_path)
  on public.equipment_items to authenticated;
grant insert (brand, model, serial_no, condition, description, image_path)
  on public.equipment_items to authenticated;
grant update (brand, model, serial_no, condition, description, image_path)
  on public.equipment_items to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Image storage.
--
-- Mirrors catalog-images' SHAPE: private bucket, INSERT policy only, no SELECT
-- policy — reads are server-minted signed URLs (src/lib/storage/signed-urls.ts).
--
-- It deliberately does NOT mirror catalog-images' ROLE LIST. That policy names
-- four roles and omits procurement_manager, who CAN create equipment items (the
-- equipment_items INSERT policy admits five). Copying it verbatim would ship
-- affordance-then-refuse: she creates the item, then the upload 42501s. This
-- takes the equipment_items INSERT audience instead, and the pgTAP pins that
-- the two agree.
--
-- (catalog-images has the same gap on the materials side. Out of scope here —
-- recorded in spec 367 §10 rather than widened in passing.)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipment-images', 'equipment-images', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

-- Object path = {equipment_item_id}/{filename}. coalesce-to-false on the role
-- check: current_user_role() is NULL for an unbound caller, and a bare NULL
-- predicate would leave the gate neither open nor closed (rls-self-check-coalesce).
create policy "equipment-images uploads by back office"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'equipment-images'
    and coalesce((select public.current_user_role()) in
         ('project_manager', 'procurement', 'procurement_manager',
          'super_admin', 'project_director'), false)
    and array_length(storage.foldername(objects.name), 1) = 1
  );
