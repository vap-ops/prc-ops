begin;
select plan(15);

-- ============================================================================
-- Spec 275 U0 / ADR 0078 — equipment-rental vendor unification.
-- PRI is generalized to just-another-rental-vendor, so the payee moves off the
-- dedicated equipment_owners master onto suppliers, and the rental GL credit
-- repoints from 2120 (AP-intercompany) to 2100 (AP-trade) with a supplier party.
-- Pins:
--   A. suppliers gains contact_status / tax_id / is_vat_registered (vendor parity).
--   B. equipment_items + equipment_rental_batches gain supplier_id; owner_id is
--      RETAINED (additive deprecation, not dropped); the backfill invariant holds
--      (every owner mirrored into suppliers; supplier_id backfilled where owner set).
--   C. post_rental_batch_to_gl credits 2100 with the supplier party (NOT 2120 owner).
-- UUIDs HEX-ONLY (the recurring pgTAP lesson). Poster called directly (owner/definer
-- context), mirroring 83-post-purchase-to-gl.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110275', 'pm@rentgl.local', '{}'::jsonb);
update public.users set role='super_admin' where id='11111111-1111-1111-1111-111111110275';

-- A rental vendor as a supplier, and the SAME id as an equipment_owner — this is
-- exactly the migrated state (the migration mirrors owners into suppliers, id-preserving).
insert into public.suppliers (id, name, created_by) values
  ('5a020275-0275-4275-8275-5a5a5a020275', 'บริษัทเช่าอุปกรณ์', '11111111-1111-1111-1111-111111110275');
insert into public.equipment_owners (id, name, created_by) values
  ('5a020275-0275-4275-8275-5a5a5a020275', 'บริษัทเช่าอุปกรณ์', '11111111-1111-1111-1111-111111110275');

-- A rental batch whose payee (supplier_id) and legacy owner_id are the SAME party.
insert into public.equipment_rental_batches (id, owner_id, supplier_id, monthly_rate, starts_on, created_by) values
  ('ba020275-0275-4275-8275-babababa0275',
   '5a020275-0275-4275-8275-5a5a5a020275', '5a020275-0275-4275-8275-5a5a5a020275',
   50000, date '2026-07-07', '11111111-1111-1111-1111-111111110275');

-- ============================================================================
-- A. suppliers gained vendor-parity columns.
-- ============================================================================
select has_column('public', 'suppliers', 'contact_status', 'suppliers.contact_status exists');
select has_column('public', 'suppliers', 'tax_id',         'suppliers.tax_id exists');
select has_column('public', 'suppliers', 'is_vat_registered', 'suppliers.is_vat_registered exists');
select ok(
  (select column_default from information_schema.columns
     where table_schema='public' and table_name='suppliers' and column_name='is_vat_registered') = 'false',
  'suppliers.is_vat_registered defaults false');

-- ============================================================================
-- B. supplier_id added to items + batches; owner_id retained; backfill invariant.
-- ============================================================================
select has_column('public', 'equipment_items',           'supplier_id', 'equipment_items.supplier_id exists');
select has_column('public', 'equipment_rental_batches',   'supplier_id', 'equipment_rental_batches.supplier_id exists');
select has_column('public', 'equipment_items',            'owner_id',    'equipment_items.owner_id retained (deprecation, not drop)');
select fk_ok('public', 'equipment_rental_batches', 'supplier_id', 'public', 'suppliers', 'id');

select is_empty(
  $$ select 1 from public.equipment_owners eo
       where not exists (select 1 from public.suppliers s where s.id = eo.id) $$,
  'every equipment_owner is mirrored into suppliers (id-preserving migration)');
select is_empty(
  $$ select 1 from public.equipment_items
       where owner_id is not null and supplier_id is null $$,
  'equipment_items.supplier_id backfilled wherever owner_id is set');
select is_empty(
  $$ select 1 from public.equipment_rental_batches
       where owner_id is not null and supplier_id is null $$,
  'equipment_rental_batches.supplier_id backfilled wherever owner_id is set');

-- ============================================================================
-- C. post_rental_batch_to_gl credits 2100 (trade AP) with the supplier party.
-- ============================================================================
select lives_ok(
  $$ select public.post_rental_batch_to_gl('ba020275-0275-4275-8275-babababa0275') $$,
  'post_rental_batch_to_gl posts the rental batch');

select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
        where source_table='equipment_rental_batches'
          and source_id='ba020275-0275-4275-8275-babababa0275'
          and source_event='rental_batch')
       and account_id = (select id from public.gl_accounts where code='2100')
       and credit = 50000
       and supplier_id = '5a020275-0275-4275-8275-5a5a5a020275'),
  1::bigint, 'credit line = AP-trade (2100) 50000 with the supplier party');

select is(
  (select sum(debit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
        where source_table='equipment_rental_batches'
          and source_id='ba020275-0275-4275-8275-babababa0275'
          and source_event='rental_batch')),
  (select sum(credit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
        where source_table='equipment_rental_batches'
          and source_id='ba020275-0275-4275-8275-babababa0275'
          and source_event='rental_batch')),
  'the rental entry balances (Σdebit = Σcredit)');

select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
        where source_table='equipment_rental_batches'
          and source_id='ba020275-0275-4275-8275-babababa0275'
          and source_event='rental_batch')
       and account_id = (select id from public.gl_accounts where code='2120')),
  0::bigint, 'no 2120 (intercompany) line — the payable is trade AP now');

select * from finish();
rollback;
