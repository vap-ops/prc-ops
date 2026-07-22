begin;
select plan(10);

-- ============================================================================
-- Spec 175 U1 — item catalog (storage / inventory foundation).
--   catalog_items (reference data: category, base_item, spec_attrs, unit,
--     stockable, ...) — read-only to authenticated; seeded by migration.
--   item_category enum (13 labels). Unique identity on (base_item, spec_attrs).
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
        'electrical','door_fire','paint','masonry_tools','machinery_tools','paving',
        'tank_septic','custom_fabrication'],
  'item_category enum has the 13 spec labels');
select is(
  has_table_privilege('anon', 'public.catalog_items', 'SELECT'),
  false, 'anon cannot select catalog_items');
select is(
  has_table_privilege('authenticated', 'public.catalog_items', 'SELECT'),
  true, 'authenticated can select catalog_items');
-- Unique identity: re-inserting an EXISTING (base_item, spec_attrs) is rejected.
-- Derived from a live row (not a hard-coded seed value) so an operator catalog
-- edit can't make this stale — the catalog is operator-editable (spec 175).
select throws_ok(
  $$ insert into public.catalog_items (category, base_item, spec_attrs, unit)
       select category, base_item, spec_attrs, unit from public.catalog_items limit 1 $$,
  '23505', null, 'duplicate (base_item, spec_attrs) rejected — one identity per item');

-- B. Seed present + readable by staff.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333175"}';
select cmp_ok(
  (select count(*)::int from public.catalog_items),
  '>', 0, 'catalog seeded, readable by staff');
-- A known seed base_item is present. The assertion was written as an EXACT
-- match on the reasoning that only spec_attrs would be edited (spec 175) — but
-- the operator has since renamed the base_item itself, and every live row now
-- reads 'เหล็กข้ออ้อยDB…'. That made this red on real data (found 2026-07-22
-- while running spec 337 U5b), and because pgTAP runs on the MERGE ref an
-- unpinned red EJECTS green PRs from the merge queue. Matching the PREFIX keeps
-- the original intent — "a known seed family survived" — while tolerating the
-- catalog edits the comment already anticipated. Same drift class as the pinned
-- 221-catalog-categories; fix the assertion rather than quarantine the file.
select cmp_ok(
  (select count(*)::int from public.catalog_items where base_item like 'เหล็กข้ออ้อย%'),
  '>', 0, 'a known seed item family (เหล็กข้ออ้อย…) is present');
select cmp_ok(
  (select count(*)::int from public.catalog_items where stockable),
  '>', 0, 'stockable items exist');
select cmp_ok(
  (select count(*)::int from public.catalog_items where not stockable),
  '>', 0, 'non-stockable (direct-to-WP) items exist');

reset role;

select * from finish();
rollback;
