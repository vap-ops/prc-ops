begin;
select plan(9);

-- ============================================================================
-- Spec 214 — product_code on catalog_items + create/update RPCs carry it.
--   A free 6-digit code (^[0-9]{6}$), nullable, unique when set. Bad format →
--   22023 (RPC guard); duplicate code → 23505 (partial-unique index).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333214', 'pm@cat214.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333214';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_column('public', 'catalog_items', 'product_code', 'catalog_items.product_code exists');
select col_is_null('public', 'catalog_items', 'product_code', 'product_code is nullable');
select ok(
  (select count(*) from pg_indexes
     where schemaname='public' and tablename='catalog_items'
       and indexname='catalog_items_product_code_uniq') = 1,
  'partial unique index on product_code exists');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333214"}';

-- B. Create stores a valid 6-digit code.
select isnt(
  (select public.create_catalog_item('electrical', 'รหัสทดสอบ A', null, 'ชิ้น', true, null, '010120')),
  null, 'create with a 6-digit code returns id');
select is(
  (select product_code from public.catalog_items where base_item='รหัสทดสอบ A'),
  '010120', 'the 6-digit code is stored');

-- C. Null code allowed.
select isnt(
  (select public.create_catalog_item('electrical', 'รหัสทดสอบ B', null, 'ชิ้น', true, null, null)),
  null, 'create with a null code is allowed');

-- D. Bad format → 22023.
select throws_ok(
  $$ select public.create_catalog_item('electrical', 'รหัสทดสอบ C', null, 'ชิ้น', true, null, '12AB') $$,
  '22023', null, 'a non-6-digit code is rejected (22023)');

-- E. Duplicate code → 23505 (the partial-unique index).
select throws_ok(
  $$ select public.create_catalog_item('electrical', 'รหัสทดสอบ D', null, 'ชิ้น', true, null, '010120') $$,
  '23505', null, 'a duplicate product_code is rejected (23505)');

-- F. Update sets the code.
select lives_ok(
  $$ select public.update_catalog_item(
       (select id from public.catalog_items where base_item='รหัสทดสอบ B'),
       'electrical', 'รหัสทดสอบ B', null, 'ชิ้น', true, null, '020255') $$,
  'update sets a 6-digit code on an item');

reset role;
select * from finish();
rollback;
