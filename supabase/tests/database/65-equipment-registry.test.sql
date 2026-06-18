begin;
select plan(22);

-- ============================================================================
-- Spec 141 U1 / ADR 0055 — equipment registry data layer.
-- Pins: catalog (3 tables + 2 enums), the serialized/bulk CHECK invariants,
-- the money anti-grant (acquisition_cost/acquired_at unreadable by
-- authenticated), back-office-only writes with a created_by pin, staff SELECT,
-- anon denial, and no-delete.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110141', 'pm@equip.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220141', 'sa@equip.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110141';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220141';

-- FK targets, seeded as the table owner (RLS bypassed).
insert into public.equipment_owners (id, name, created_by) values
  ('b0000001-0000-4000-8000-000000000141', 'Sister Co Equipment',
   '11111111-1111-1111-1111-111111110141');
insert into public.equipment_categories (id, name, created_by) values
  ('c0000001-0000-4000-8000-000000000141', 'Generators',
   '11111111-1111-1111-1111-111111110141');

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_table('public', 'equipment_owners',     'equipment_owners exists');
select has_table('public', 'equipment_categories', 'equipment_categories exists');
select has_table('public', 'equipment_items',       'equipment_items exists');
select has_type('public', 'equipment_status',   'equipment_status enum exists');
select enum_has_labels('public', 'equipment_status',
  ARRAY['available', 'on_site', 'in_use', 'maintenance', 'returned', 'lost'],
  'equipment_status has the six lifecycle labels');
select has_type('public', 'equipment_tracking', 'equipment_tracking enum exists');
select col_is_pk('public', 'equipment_items', 'id', 'equipment_items.id is the PK');
select ok((select relrowsecurity from pg_class where oid = 'public.equipment_items'::regclass),
  'RLS enabled on equipment_items');
select ok((select relrowsecurity from pg_class where oid = 'public.equipment_owners'::regclass),
  'RLS enabled on equipment_owners');
select ok((select relrowsecurity from pg_class where oid = 'public.equipment_categories'::regclass),
  'RLS enabled on equipment_categories');

-- ============================================================================
-- B. CHECK invariants (run as table owner — RLS bypassed, the CHECK fires).
-- ============================================================================
select throws_ok(
  $$ insert into public.equipment_items (category_id, owner_id, name, tracking, quantity, created_by)
     values ('c0000001-0000-4000-8000-000000000141', 'b0000001-0000-4000-8000-000000000141',
             'bad', 'unit', 5, '11111111-1111-1111-1111-111111110141') $$,
  '23514', null, 'a unit item cannot carry a quantity');
select throws_ok(
  $$ insert into public.equipment_items (category_id, owner_id, name, tracking, created_by)
     values ('c0000001-0000-4000-8000-000000000141', 'b0000001-0000-4000-8000-000000000141',
             'bad', 'bulk', '11111111-1111-1111-1111-111111110141') $$,
  '23514', null, 'a bulk item must have a quantity');
select throws_ok(
  $$ insert into public.equipment_items (category_id, owner_id, name, tracking, quantity, asset_tag, created_by)
     values ('c0000001-0000-4000-8000-000000000141', 'b0000001-0000-4000-8000-000000000141',
             'bad', 'bulk', 10, 'TAG-1', '11111111-1111-1111-1111-111111110141') $$,
  '23514', null, 'a bulk item cannot carry an asset tag');
select throws_ok(
  $$ insert into public.equipment_items (category_id, owner_id, name, created_by)
     values ('c0000001-0000-4000-8000-000000000141', 'b0000001-0000-4000-8000-000000000141',
             '   ', '11111111-1111-1111-1111-111111110141') $$,
  '23514', null, 'a blank name is rejected');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- C. Money anti-grant + staff read (authenticated = site_admin).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220141"}';

select throws_ok(
  $$ select acquisition_cost from public.equipment_items limit 1 $$,
  '42501', null, 'authenticated cannot read acquisition_cost (money, no grant)');
select throws_ok(
  $$ select acquired_at from public.equipment_items limit 1 $$,
  '42501', null, 'authenticated cannot read acquired_at (money-adjacent, no grant)');
select lives_ok(
  $$ select id, name, status from public.equipment_items limit 1 $$,
  'staff can read the non-money columns');
select throws_ok(
  $$ insert into public.equipment_items (category_id, owner_id, name, created_by)
     values ('c0000001-0000-4000-8000-000000000141', 'b0000001-0000-4000-8000-000000000141',
             'SA item', '22222222-2222-2222-2222-222222220141') $$,
  '42501', null, 'site_admin cannot insert an equipment item (back-office only)');

-- ============================================================================
-- D. Back-office write path (authenticated = project_manager).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110141"}';

select lives_ok(
  $$ insert into public.equipment_items (id, category_id, owner_id, name, tracking, created_by)
     values ('d0000001-0000-4000-8000-000000000141',
             'c0000001-0000-4000-8000-000000000141', 'b0000001-0000-4000-8000-000000000141',
             'Generator 5kVA #1', 'unit', '11111111-1111-1111-1111-111111110141') $$,
  'project_manager inserts a serialized item');
select throws_ok(
  $$ insert into public.equipment_items (category_id, owner_id, name, created_by)
     values ('c0000001-0000-4000-8000-000000000141', 'b0000001-0000-4000-8000-000000000141',
             'spoofed', '22222222-2222-2222-2222-222222220141') $$,
  '42501', null, 'created_by must equal the caller (pin)');
select throws_ok(
  $$ delete from public.equipment_items where id = 'd0000001-0000-4000-8000-000000000141' $$,
  '42501', null, 'no one can delete an equipment item (no delete grant)');

-- ============================================================================
-- E. Anon is denied entirely.
-- ============================================================================
set local role anon;
select throws_ok(
  $$ select id from public.equipment_items limit 1 $$,
  '42501', null, 'anon cannot read equipment_items');

reset role;
select * from finish();
rollback;
