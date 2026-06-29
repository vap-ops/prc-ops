begin;
select plan(18);

-- ============================================================================
-- Spec 221 U2 — category_id becomes the source of truth; the item_category enum
--   is kept VESTIGIAL (nullable). The write RPCs gain a trailing p_category_id
--   (uuid); old enum-only calls still resolve (derive category_id from the enum).
--   A NEW user-category (no enum value) can be used via p_category_id with a NULL
--   enum. Subcategory identity + the category-match guard move onto category_id.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333222', 'pm@cat222.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333222';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Signatures + security (the new arities) -------------------------------
select ok(
  to_regprocedure('public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid)') is not null,
  'create_catalog_item 9-arg (+ p_category_id) exists');
select ok(
  to_regprocedure('public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid)') is not null,
  'update_catalog_item 10-arg (+ p_category_id) exists');
select ok(
  to_regprocedure('public.create_catalog_subcategory(public.item_category, text, text, smallint, uuid)') is not null,
  'create_catalog_subcategory 5-arg (+ p_category_id) exists');
select ok(
  (select prosecdef from pg_proc
     where oid='public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid)'::regprocedure),
  'create_catalog_item is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon',
    'public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid)', 'execute'),
  'anon cannot execute create_catalog_item');

-- B. Constraints moved onto category_id ------------------------------------
select col_is_null('public', 'catalog_items', 'category', 'catalog_items.category is now nullable');
select col_is_null('public', 'catalog_subcategories', 'category', 'catalog_subcategories.category is now nullable');
select ok(
  (select count(*) from pg_constraint where conname='catalog_subcategories_category_id_code_uniq')=1,
  'unique (category_id, code) exists');
select ok(
  (select count(*) from pg_constraint where conname='catalog_subcategories_id_category_id_uniq')=1,
  'unique (id, category_id) exists');
select ok(
  (select count(*) from pg_constraint
     where conname='catalog_items_subcategory_category_id_fk' and contype='f')=1,
  'composite FK on (subcategory_id, category_id) exists');

-- C. Sync trigger no-overwrite (direct insert, owner) ----------------------
-- category_id preset + category set → the trigger must NOT overwrite category_id.
insert into public.catalog_items (category, category_id, base_item, unit)
  values ('electrical',
          (select id from public.catalog_categories where code='01'),  -- deliberately steel, != electrical
          'u2-trigger-nooverwrite', 'ชิ้น');
select is(
  (select category_id from public.catalog_items where base_item='u2-trigger-nooverwrite'),
  (select id from public.catalog_categories where code='01'),
  'sync trigger leaves a preset category_id untouched (no overwrite)');

-- D. RPC behaviour as a back-office user -----------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333222"}';

-- D1. A NEW user-category (no enum value) + an item under it via p_category_id.
select isnt(
  (select public.create_catalog_category('90', 'หมวดใหม่ U2', 0::smallint)), null,
  'create a user category (no enum value)');
select isnt(
  (select public.create_catalog_item(
     p_category := null, p_base_item := 'ของในหมวดใหม่', p_spec_attrs := null, p_unit := 'ชิ้น',
     p_stockable := true, p_note := null,
     p_category_id := (select id from public.catalog_categories where code='90'))),
  null, 'create_catalog_item under a user-category (enum NULL, p_category_id set) returns id');
select is(
  (select category_id from public.catalog_items where base_item='ของในหมวดใหม่'),
  (select id from public.catalog_categories where code='90'),
  'the user-category item carries the explicit category_id (enum is NULL)');

-- D2. Old enum-only call still resolves category_id from the enum (back-compat).
select isnt(
  (select public.create_catalog_item('electrical', 'enum-only U2', null, 'ม้วน', true, null)),
  null, 'an enum-only create returns id');
select is(
  (select category_id from public.catalog_items where base_item='enum-only U2'),
  (select id from public.catalog_categories where legacy_category='electrical'),
  'the enum-only call derived category_id from the enum');

-- D3. The subcategory-match guard is now on category_id (cross-category → 22023).
select throws_ok(
  $$ select public.create_catalog_item(
       p_category := null, p_base_item := 'ผิดหมวด U2', p_spec_attrs := null, p_unit := 'ชิ้น',
       p_stockable := true, p_note := null,
       p_category_id := (select id from public.catalog_categories where code='90'),
       p_subcategory_id := (select id from public.catalog_subcategories
                              where category_id=(select id from public.catalog_categories where code='01') limit 1)) $$,
  '22023', null, 'a subcategory from a different category_id is rejected (22023)');

reset role;
select * from finish();
rollback;
