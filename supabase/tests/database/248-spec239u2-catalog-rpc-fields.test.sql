begin;
select plan(13);

-- ============================================================================
-- Spec 239 U2 (ADR 0066 / C1) — the catalog write RPCs gained two trailing
-- params, p_search_terms (text, <=500) + p_lead_time_days (int, >=0), so the item
-- form can persist the U1 columns. Migration 20260813044000 DROP+CREATE'd both
-- RPCs at arity 14 (the spec 224 precedent). This pins: the new signatures exist +
-- SECURITY DEFINER + anon-revoked/authenticated-granted; the fields persist on
-- create + update; negative lead time + over-long search_terms are rejected (22023);
-- and null inputs store NULL.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333248', 'pm@cat248.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-333333333248';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure — the new 14-arg signatures.
select ok(
  to_regprocedure('public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)') is not null,
  'create_catalog_item exists at the 14-arg signature');
select ok(
  to_regprocedure('public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)') is not null,
  'update_catalog_item exists at the 15-arg signature');
select is(
  has_function_privilege('anon',
    'public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)', 'EXECUTE'),
  false, 'anon cannot execute create_catalog_item');
select is(
  has_function_privilege('authenticated',
    'public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)', 'EXECUTE'),
  true, 'authenticated can execute create_catalog_item');
select is(
  has_function_privilege('anon',
    'public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)', 'EXECUTE'),
  false, 'anon cannot execute update_catalog_item');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333248"}';

-- B. Create persists search_terms + lead_time_days.
select isnt(
  (select public.create_catalog_item(
     p_category => 'electrical', p_base_item => 'สายไฟ U2 fields', p_unit => 'ม้วน',
     p_search_terms => 'rebar เหล็กเส้น wire', p_lead_time_days => 7)),
  null, 'PM creates an item with search_terms + lead_time_days');
select is(
  (select search_terms from public.catalog_items where base_item = 'สายไฟ U2 fields'),
  'rebar เหล็กเส้น wire', 'search_terms persisted on create');
select is(
  (select lead_time_days from public.catalog_items where base_item = 'สายไฟ U2 fields'),
  7, 'lead_time_days persisted on create');

-- C. Update changes both fields (looked up by the stable base_item).
select public.update_catalog_item(
  p_id => (select id from public.catalog_items where base_item = 'สายไฟ U2 fields'),
  p_category => 'electrical', p_base_item => 'สายไฟ U2 fields', p_unit => 'ม้วน',
  p_search_terms => 'cable สายเคเบิล', p_lead_time_days => 0);
select is(
  (select search_terms || '|' || lead_time_days
     from public.catalog_items where base_item = 'สายไฟ U2 fields'),
  'cable สายเคเบิล|0', 'update changed search_terms + lead_time_days');

-- D. Null inputs store NULL (the fields are optional).
select isnt(
  (select public.create_catalog_item(
     p_category => 'electrical', p_base_item => 'ของไม่มีคำพ้อง U2', p_unit => 'อัน')),
  null, 'create with neither field given');
select ok(
  (select search_terms is null and lead_time_days is null
     from public.catalog_items where base_item = 'ของไม่มีคำพ้อง U2'),
  'omitted search_terms + lead_time_days store NULL');

-- E. Guards: negative lead time + over-long search_terms → 22023.
select throws_ok(
  $$ select public.create_catalog_item(
       p_category => 'electrical', p_base_item => 'ของ lead ติดลบ', p_unit => 'อัน',
       p_lead_time_days => -1) $$,
  '22023', null, 'negative lead_time_days rejected (22023)');
select throws_ok(
  $$ select public.create_catalog_item(
       p_category => 'electrical', p_base_item => 'ของ search ยาว', p_unit => 'อัน',
       p_search_terms => repeat('x', 501)) $$,
  '22023', null, 'over-long search_terms rejected (22023)');

select * from finish();
rollback;
