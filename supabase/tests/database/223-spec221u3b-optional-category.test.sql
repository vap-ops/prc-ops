begin;
select plan(7);

-- ============================================================================
-- Spec 221 U3b — the catalog write RPCs' p_category (enum) is now OPTIONAL, so a
-- brand-new user-category (no enum value) can be used by category_id alone. The
-- param TYPES are unchanged (pins/positional calls still valid); only defaults
-- were added. base_item/unit stay genuinely required (friendly 22023, not 23502).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333223', 'pm@cat223.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333223';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- Spec 224 added the trailing facet params (defaults) → the facet arity resolves.
select ok(
  to_regprocedure('public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)') is not null,
  'create_catalog_item facet arity exists (defaults keep old callers valid)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333223"}';

-- A brand-new user category (no enum value).
select isnt(
  (select public.create_catalog_category('91', 'หมวด U3b', 0::smallint)), null,
  'create a user category 91');

-- create_catalog_item OMITTING p_category (category_id only) — the new capability.
select isnt(
  (select public.create_catalog_item(
     p_base_item := 'no-enum item', p_unit := 'ชิ้น', p_stockable := true,
     p_category_id := (select id from public.catalog_categories where code='91'))),
  null, 'create_catalog_item works with p_category OMITTED (category_id only)');
select is(
  (select category from public.catalog_items where base_item='no-enum item'),
  null, 'the item enum category is NULL (user-category)');
select is(
  (select category_id from public.catalog_items where base_item='no-enum item'),
  (select id from public.catalog_categories where code='91'),
  'the item carries the user category_id');

-- create_catalog_subcategory OMITTING p_category too.
select isnt(
  (select public.create_catalog_subcategory(
     p_code := '01', p_name := 'ย่อยใต้หมวดใหม่',
     p_category_id := (select id from public.catalog_categories where code='91'))),
  null, 'create_catalog_subcategory works with p_category OMITTED');

-- base_item is still required — omitting it raises the friendly 22023 (not 23502).
select throws_ok(
  $$ select public.create_catalog_item(
       p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='91')) $$,
  '22023', null, 'omitting base_item still raises 22023 (null-safe)');

reset role;
select * from finish();
rollback;
