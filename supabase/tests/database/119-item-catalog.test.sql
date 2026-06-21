begin;
select plan(10);

-- ============================================================================
-- Spec 175 U1 — item catalog (storage / inventory foundation).
--   catalog_items (reference data: category, base_item, spec_attrs, unit,
--     stockable, ...) — read-only to authenticated; seeded by migration.
--   item_category enum (12 labels). Unique identity on (base_item, spec_attrs).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333175', 'pm@cat-test.local', '{}'::jsonb);
update public.users set role='project_manager'
  where id='33333333-3333-3333-3333-333333333175';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure (as owner).
select has_table('public', 'catalog_items', 'catalog_items table exists');
select is(
  (select relrowsecurity from pg_class where oid='public.catalog_items'::regclass),
  true, 'RLS enabled on catalog_items');
select enum_has_labels(
  'public', 'item_category',
  array['steel_fixing','plumbing_sanitary','site_safety','roofing','ceiling_tile',
        'electrical','door_fire','paint','masonry_tools','paving','tank_septic',
        'custom_fabrication'],
  'item_category enum has the 12 spec labels');
select is(
  has_table_privilege('anon', 'public.catalog_items', 'SELECT'),
  false, 'anon cannot select catalog_items');
select is(
  has_table_privilege('authenticated', 'public.catalog_items', 'SELECT'),
  true, 'authenticated can select catalog_items');
-- Unique identity: re-inserting a seeded (base_item, spec_attrs) is rejected.
select throws_ok(
  $$ insert into public.catalog_items (category, base_item, spec_attrs, unit)
       values ('steel_fixing', 'เหล็กข้ออ้อย', '12 มิล', 'ท่อน') $$,
  '23505', null, 'duplicate (base_item, spec_attrs) rejected — one identity per item');

-- B. Seed present + readable by staff.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333175"}';
select cmp_ok(
  (select count(*)::int from public.catalog_items),
  '>', 0, 'catalog seeded, readable by staff');
select is(
  (select count(*)::int from public.catalog_items
     where base_item='เหล็กข้ออ้อย' and spec_attrs='12 มิล'),
  1, 'a known seed item is present');
select cmp_ok(
  (select count(*)::int from public.catalog_items where stockable),
  '>', 0, 'stockable items exist');
select cmp_ok(
  (select count(*)::int from public.catalog_items where not stockable),
  '>', 0, 'non-stockable (direct-to-WP) items exist');

reset role;

select * from finish();
rollback;
