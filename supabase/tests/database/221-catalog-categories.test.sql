begin;
select plan(18);

-- ============================================================================
-- Spec 221 U1 — managed category taxonomy, additive foundation.
--   New public.catalog_categories (managed main category: code, name, …) seeded
--   with the 13 item_category enum values. catalog_items + catalog_subcategories
--   gain a nullable category_id FK, backfilled from the enum via a transient
--   legacy_category map column; a BEFORE INSERT/UPDATE trigger keeps category_id
--   synced while the app still writes the enum (pre-cutover). create/update_
--   catalog_category RPCs (back-office). No drops — the enum is dropped at U2.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333221', 'pm@cat221.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333221';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure --------------------------------------------------------------
select has_table('public', 'catalog_categories', 'catalog_categories table exists');
select has_column('public', 'catalog_categories', 'code', 'has code');
select has_column('public', 'catalog_categories', 'name', 'has name');
select has_column('public', 'catalog_items', 'category_id', 'catalog_items has category_id');
select col_is_null('public', 'catalog_items', 'category_id', 'category_id nullable (pre-cutover)');
select has_column('public', 'catalog_subcategories', 'category_id', 'catalog_subcategories has category_id');
select ok(
  (select relrowsecurity from pg_class where oid='public.catalog_categories'::regclass),
  'RLS enabled on catalog_categories');
select ok(
  has_table_privilege('authenticated', 'public.catalog_categories', 'select'),
  'authenticated may SELECT catalog_categories');
select ok(
  not has_table_privilege('anon', 'public.catalog_categories', 'select'),
  'anon may NOT SELECT catalog_categories');

-- B. Seed + backfill --------------------------------------------------------
select is(
  (select count(*)::int from public.catalog_categories), 13, 'seeded the 13 enum categories');
select is(
  (select code from public.catalog_categories where legacy_category='steel_fixing'),
  '01', 'steel_fixing seeded as code 01');
select is(
  (select count(*)::int from public.catalog_items where category_id is null), 0,
  'every catalog_item was backfilled with a category_id');
select ok(
  (select ci.category_id = cc.id
     from public.catalog_items ci
     join public.catalog_categories cc on cc.legacy_category = ci.category
    limit 1),
  'a catalog_item category_id matches its category mapping');

-- C. Sync trigger (direct insert as owner; trigger derives category_id) ------
insert into public.catalog_items (category, base_item, unit)
  values ('electrical', 'trigger-test 221', 'ชิ้น');
select is(
  (select category_id from public.catalog_items where base_item='trigger-test 221'),
  (select id from public.catalog_categories where legacy_category='electrical'),
  'the sync trigger sets category_id from the enum on insert');

-- D. RPCs as a back-office user ---------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333221"}';

select isnt(
  (select public.create_catalog_category('80', 'หมวดทดสอบ', 0::smallint)),
  null, 'create_catalog_category returns id');
select throws_ok(
  $$ select public.create_catalog_category('80', 'ซ้ำ', 0::smallint) $$,
  '23505', null, 'a duplicate category code is rejected (23505)');
select throws_ok(
  $$ select public.create_catalog_category('8', 'สั้น', 0::smallint) $$,
  '22023', null, 'a non-2-digit code is rejected (22023)');
select lives_ok(
  $$ select public.update_catalog_category(
       (select id from public.catalog_categories where code='80'),
       '81', 'หมวดทดสอบแก้ไข', 5::smallint, true) $$,
  'update_catalog_category recodes + renames the category');

reset role;
select * from finish();
rollback;
