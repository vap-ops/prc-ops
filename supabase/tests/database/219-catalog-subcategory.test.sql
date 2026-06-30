begin;
select plan(21);

-- ============================================================================
-- Spec 219 U1 — catalog subcategory taxonomy.
--   New public.catalog_subcategories (category enum, 2-digit code, name, …); a
--   nullable composite FK catalog_items(subcategory_id, category) ->
--   catalog_subcategories(id, category) so an item's category MUST match its
--   subcategory's. create/update_catalog_subcategory RPCs (back-office only);
--   create/update_catalog_item extended with p_subcategory_id (category-match
--   guard → 22023). Main level stays the item_category enum.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333219', 'pm@cat219.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333219';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure ---------------------------------------------------------------
select has_table('public', 'catalog_subcategories', 'catalog_subcategories table exists');
select has_column('public', 'catalog_subcategories', 'category', 'has category');
select has_column('public', 'catalog_subcategories', 'code', 'has code');
select has_column('public', 'catalog_subcategories', 'name', 'has name');
select has_column('public', 'catalog_items', 'subcategory_id', 'catalog_items has subcategory_id');
select col_is_null('public', 'catalog_items', 'subcategory_id', 'subcategory_id is nullable');
select ok(
  (select count(*) from pg_constraint where conname='catalog_subcategories_category_code_uniq')=1,
  'unique (category, code) exists');
select ok(
  (select count(*) from pg_constraint where conname='catalog_subcategories_id_category_uniq')=1,
  'unique (id, category) exists (backs the composite FK)');
select ok(
  (select count(*) from pg_constraint
     where conname='catalog_items_subcategory_fk' and contype='f')=1,
  'composite FK catalog_items(subcategory_id, category) exists');
select ok(
  (select relrowsecurity from pg_class where oid='public.catalog_subcategories'::regclass),
  'RLS enabled on catalog_subcategories');
select ok(
  has_table_privilege('authenticated', 'public.catalog_subcategories', 'select'),
  'authenticated may SELECT catalog_subcategories');
select ok(
  not has_table_privilege('anon', 'public.catalog_subcategories', 'select'),
  'anon may NOT SELECT catalog_subcategories');

-- B. Seed anchor (spec 214 example) ------------------------------------------
select is(
  (select count(*)::int from public.catalog_subcategories
     where category='steel_fixing' and code='01' and name='วัสดุโครงสร้าง'),
  1, 'seed anchor (steel_fixing, 01, วัสดุโครงสร้าง) present');

-- C. RPC behaviour as a back-office user -------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333219"}';

-- create_catalog_subcategory
select isnt(
  (select public.create_catalog_subcategory('steel_fixing', '02', 'อุปกรณ์ยึด', 0::smallint)),
  null, 'create_catalog_subcategory returns id');
select is(
  (select name from public.catalog_subcategories where category='steel_fixing' and code='02'),
  'อุปกรณ์ยึด', 'the subcategory name is stored');
select throws_ok(
  $$ select public.create_catalog_subcategory('steel_fixing', '2', 'รหัสสั้น', 0::smallint) $$,
  '22023', null, 'a non-2-digit code is rejected (22023)');
select throws_ok(
  $$ select public.create_catalog_subcategory('steel_fixing', '02', 'ซ้ำ', 0::smallint) $$,
  '23505', null, 'a duplicate (category, code) is rejected (23505)');

-- update_catalog_subcategory
select lives_ok(
  $$ select public.update_catalog_subcategory(
       (select id from public.catalog_subcategories where category='steel_fixing' and code='02'),
       'อุปกรณ์ยึดเหล็ก', 5::smallint, true) $$,
  'update_catalog_subcategory renames the subcategory');
select throws_ok(
  $$ select public.update_catalog_subcategory(
       '00000000-0000-0000-0000-000000000000', 'x', 0::smallint, true) $$,
  '22023', null, 'updating an unknown subcategory id → 22023');

-- create_catalog_item carries subcategory_id (category must match)
select isnt(
  (select public.create_catalog_item(
     'steel_fixing', 'เหล็กทดสอบ 219', null, 'เส้น', true, null, null,
     (select id from public.catalog_subcategories where category='steel_fixing' and code='02'))),
  null, 'create_catalog_item with a matching-category subcategory returns id');
select throws_ok(
  $$ select public.create_catalog_item(
       'electrical', 'ผิดหมวด 219', null, 'ชิ้น', true, null, null,
       (select id from public.catalog_subcategories where category='steel_fixing' and code='02')) $$,
  '22023', null, 'a subcategory from a different category is rejected (22023)');

reset role;
select * from finish();
rollback;
