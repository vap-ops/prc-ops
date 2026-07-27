begin;
select plan(22);

-- ============================================================================
-- Spec 367 U1 — the fields the equipment registry never had.
--
-- Live grounding this unit answers (prod, 2026-07-27): 64 equipment_items, but
-- brand/model/serial live crammed inside free-text `name`, there is no image,
-- no condition, no description, and `equipment_status` has nowhere to put an
-- asset that has been sold. The PRI transfer (spec 367 §3) cannot be priced
-- without them.
--
-- Two things this file guards that are easy to get wrong:
--
--   1. equipment_items is COLUMN-GRANTED. A new column is invisible to the RLS
--      client until granted — PostgREST refuses the read outright, it does not
--      return null. So the six new columns are pinned as READABLE...
--   2. ...while the three MONEY columns (acquisition_cost, acquired_at,
--      daily_rate) must stay UNREADABLE by `authenticated` (ADR 0055 decision
--      6). Section D pins that wall in the negative direction, so a future
--      blanket `grant select on equipment_items` reds here instead of silently
--      publishing the purchase prices.
-- ============================================================================

-- ============================================================================
-- A. The six new columns exist.
-- ============================================================================
select has_column('public', 'equipment_items', 'brand',       'equipment_items.brand exists');
select has_column('public', 'equipment_items', 'model',       'equipment_items.model exists');
select has_column('public', 'equipment_items', 'serial_no',   'equipment_items.serial_no exists');
select has_column('public', 'equipment_items', 'condition',   'equipment_items.condition exists');
select has_column('public', 'equipment_items', 'description', 'equipment_items.description exists');
select has_column('public', 'equipment_items', 'image_path',  'equipment_items.image_path exists');

-- ============================================================================
-- B. The condition enum, and the disposal state on the status enum.
-- ============================================================================
select has_type('public', 'equipment_condition', 'equipment_condition enum exists');
select enum_has_labels('public', 'equipment_condition',
  ARRAY['new', 'good', 'fair', 'needs_repair'],
  'equipment_condition has the four grades');

-- An asset sold to PRI needs somewhere to go. Pinned as a SUPERSET check of the
-- six pre-existing labels plus `disposed`, deliberately updating the sibling
-- assertion in 65-equipment-registry.test.sql rather than weakening it.
select enum_has_labels('public', 'equipment_status',
  ARRAY['available', 'on_site', 'in_use', 'maintenance', 'returned', 'lost', 'disposed'],
  'equipment_status gained disposed and kept the original six');

-- ============================================================================
-- C. The six new columns are READABLE by authenticated (the column-grant trap).
-- ============================================================================
select is(has_column_privilege('authenticated', 'public.equipment_items', 'brand', 'SELECT'),
  true, 'authenticated may read brand');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'model', 'SELECT'),
  true, 'authenticated may read model');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'serial_no', 'SELECT'),
  true, 'authenticated may read serial_no');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'condition', 'SELECT'),
  true, 'authenticated may read condition');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'description', 'SELECT'),
  true, 'authenticated may read description');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'image_path', 'SELECT'),
  true, 'authenticated may read image_path');

-- ============================================================================
-- D. The money wall stays up (ADR 0055 decision 6) — the NEGATIVE direction.
-- ============================================================================
select is(has_column_privilege('authenticated', 'public.equipment_items', 'acquisition_cost', 'SELECT'),
  false, 'authenticated may NOT read acquisition_cost');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'acquired_at', 'SELECT'),
  false, 'authenticated may NOT read acquired_at');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'daily_rate', 'SELECT'),
  false, 'authenticated may NOT read daily_rate');

-- ============================================================================
-- E. The equipment-images bucket, mirroring catalog-images' SHAPE.
-- ============================================================================
select is(
  (select count(*)::int from storage.buckets where id = 'equipment-images'),
  1,
  'storage.buckets has a row with id = ''equipment-images'''
);
select is(
  (select public from storage.buckets where id = 'equipment-images'),
  false,
  'equipment-images is PRIVATE (reads go through server-minted signed URLs)'
);

-- ============================================================================
-- F. The upload policy exists and admits the equipment_items INSERT audience.
--
-- NOT catalog-images' role list: that one names four roles and omits
-- procurement_manager, who CAN create equipment items. Copying it would ship
-- affordance-then-refuse — she creates the row, then the upload 42501s. This
-- asserts the two agree on procurement_manager specifically, which is the one
-- that would silently drift.
-- ============================================================================
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and with_check like '%equipment-images%' and cmd = 'INSERT'),
  1,
  'exactly one INSERT policy scoped to equipment-images'
);
select ok(
  (select bool_or(with_check like '%procurement_manager%') from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and with_check like '%equipment-images%' and cmd = 'INSERT'),
  'the equipment-images upload policy admits procurement_manager (parity with equipment_items INSERT)'
);

select * from finish();
rollback;
