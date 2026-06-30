begin;
select plan(41);

-- ============================================================================
-- Spec 224 — Catalog item facets (ADR 0066 / S2, decision D3). Three facet
-- columns land on catalog_items: kind (catalog_item_kind enum), fulfillment_mode
-- (catalog_fulfillment_mode enum), owner_supplied (boolean). fulfillment_mode is
-- the SSOT for stocking; `stockable` is DERIVED on write —
--   v_mode := coalesce(p_fulfillment_mode,
--               case when coalesce(p_stockable,true) then 'off_shelf' else 'made_to_order' end);
--   stockable := (v_mode = 'off_shelf')
-- so the explicit fulfillment_mode WINS over the legacy p_stockable, and an
-- old-arity caller (no facet args) still derives correctly from p_stockable.
-- create/update_catalog_item are DROP+CREATE'd to add the three trailing-default
-- facet params (LIVE body preserved, role gate upgraded to the null-safe captured
-- form per ADR 0066 D8). Existing rows are backfilled: kind=material,
-- fulfillment_mode from stockable, owner_supplied=false.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333224', 'pm@cat224.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444224', 'visitor@cat224.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333224';
-- the visitor user keeps the default 'visitor' role; sub 5555… has NO users row
-- (→ current_user_role() is null → exercises the null-safe gate).

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure — facet columns + enum types ---------------------------------
select has_column('public', 'catalog_items', 'kind', 'catalog_items has kind');
select has_column('public', 'catalog_items', 'fulfillment_mode', 'catalog_items has fulfillment_mode');
select has_column('public', 'catalog_items', 'owner_supplied', 'catalog_items has owner_supplied');
select has_type('public', 'catalog_item_kind', 'catalog_item_kind enum exists');
select has_type('public', 'catalog_fulfillment_mode', 'catalog_fulfillment_mode enum exists');
select col_not_null('public', 'catalog_items', 'kind', 'kind is NOT NULL');
select col_not_null('public', 'catalog_items', 'fulfillment_mode', 'fulfillment_mode is NOT NULL');
select col_not_null('public', 'catalog_items', 'owner_supplied', 'owner_supplied is NOT NULL');

-- B. Backfill of EXISTING rows (runs before any test insert) -----------------
-- The derivation invariant holds for every pre-existing row: stockable=true ⇔
-- off_shelf, stockable=false ⇔ made_to_order (the C1 half-encoded signal).
select is(
  (select count(*)::int from public.catalog_items
     where stockable is true and fulfillment_mode <> 'off_shelf'),
  0, 'no stockable row is mis-classed (off_shelf)');
select is(
  (select count(*)::int from public.catalog_items
     where stockable is false and fulfillment_mode <> 'made_to_order'),
  0, 'every non-stockable row backfilled to made_to_order');
select is(
  (select count(*)::int from public.catalog_items where kind is null),
  0, 'every catalog item has a non-null kind (S2 defaulted material; spec 239 re-homed tools/equipment/assembly off the default)');
select is(
  (select count(*)::int from public.catalog_items where owner_supplied),
  0, 'all existing rows backfilled owner_supplied=false');

-- C. RPC posture on the NEW arity (12-arg create, 13-arg update) -------------
select is(
  (select prosecdef from pg_proc where oid=
     'public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)'::regprocedure),
  true, 'create_catalog_item (facet arity) is SECURITY DEFINER');
select is(
  (select prosecdef from pg_proc where oid=
     'public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)'::regprocedure),
  true, 'update_catalog_item (facet arity) is SECURITY DEFINER');
select is(
  has_function_privilege('anon',
    'public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)', 'EXECUTE'),
  false, 'anon cannot execute create_catalog_item');
select is(
  has_function_privilege('anon',
    'public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)', 'EXECUTE'),
  false, 'anon cannot execute update_catalog_item');
select is(
  has_function_privilege('authenticated',
    'public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)', 'EXECUTE'),
  true, 'authenticated can execute create_catalog_item');
select is(
  has_function_privilege('authenticated',
    'public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid, public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int)', 'EXECUTE'),
  true, 'authenticated can execute update_catalog_item');
-- The old arities were DROP+CREATE'd away (replaced by the facet arity).
select ok(
  to_regprocedure('public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid)') is null,
  'the old 9-arg create_catalog_item arity is gone');
select ok(
  to_regprocedure('public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid)') is null,
  'the old 10-arg update_catalog_item arity is gone');

-- D. Behaviour — derivation (as a back-office PM) ----------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333224"}';

-- a user category to home the test items.
select isnt((select public.create_catalog_category('92', 'หมวด S2', 0::smallint)), null, 'create user category 92');

-- made_to_order WINS over the (defaulted true) p_stockable.
select lives_ok(
  $$ select public.create_catalog_item(
       p_base_item := 'mto item', p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='92'),
       p_fulfillment_mode := 'made_to_order') $$,
  'create a made_to_order item');
select is(
  (select fulfillment_mode::text from public.catalog_items where base_item='mto item'),
  'made_to_order', 'fulfillment_mode persisted made_to_order');
select is(
  (select stockable from public.catalog_items where base_item='mto item'),
  false, 'stockable DERIVED false from made_to_order (wins over p_stockable=true)');
select is(
  (select kind::text from public.catalog_items where base_item='mto item'),
  'material', 'kind defaults to material when omitted');

select lives_ok(
  $$ select public.create_catalog_item(
       p_base_item := 'osf item', p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='92'),
       p_fulfillment_mode := 'off_shelf') $$,
  'create an off_shelf item');
select is(
  (select stockable from public.catalog_items where base_item='osf item'),
  true, 'stockable DERIVED true from off_shelf');

select lives_ok(
  $$ select public.create_catalog_item(
       p_base_item := 'tool item', p_unit := 'อัน',
       p_category_id := (select id from public.catalog_categories where code='92'),
       p_kind := 'tool', p_owner_supplied := true) $$,
  'create with kind=tool + owner_supplied=true');
select is(
  (select kind::text from public.catalog_items where base_item='tool item'),
  'tool', 'kind persisted tool');
select is(
  (select owner_supplied from public.catalog_items where base_item='tool item'),
  true, 'owner_supplied persisted true');

-- E. Back-compat: the old positional arity (no facet args) still resolves and
--    bootstraps fulfillment_mode from the legacy p_stockable.
select lives_ok(
  $$ select public.create_catalog_item('electrical'::public.item_category, 'oldcall mto', null, 'ชิ้น', false, null) $$,
  'old 6-positional-arg call (p_stockable=false) still resolves');
select is(
  (select fulfillment_mode::text from public.catalog_items where base_item='oldcall mto'),
  'made_to_order', 'old-arity p_stockable=false bootstraps made_to_order');
select is(
  (select stockable from public.catalog_items where base_item='oldcall mto'),
  false, 'old-arity derived stockable=false');
select lives_ok(
  $$ select public.create_catalog_item('electrical'::public.item_category, 'oldcall osf', null, 'ชิ้น', true, null) $$,
  'old 6-positional-arg call (p_stockable=true) still resolves');
select is(
  (select fulfillment_mode::text from public.catalog_items where base_item='oldcall osf'),
  'off_shelf', 'old-arity p_stockable=true bootstraps off_shelf');

-- F. Update derives stockable too -------------------------------------------
select lives_ok(
  $$ select public.update_catalog_item(
       p_id := (select id from public.catalog_items where base_item='osf item'),
       p_base_item := 'osf item', p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='92'),
       p_fulfillment_mode := 'made_to_order') $$,
  'update osf item to made_to_order');
select is(
  (select stockable from public.catalog_items where base_item='osf item'),
  false, 'update DERIVED stockable=false');
select is(
  (select fulfillment_mode::text from public.catalog_items where base_item='osf item'),
  'made_to_order', 'update persisted fulfillment_mode=made_to_order');

-- G. Role gate (null-safe per ADR 0066 D8) ----------------------------------
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555224"}';
select throws_ok(
  $$ select public.create_catalog_item(
       p_base_item := 'denynull', p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='92')) $$,
  '42501', null, 'a null/unbound role is denied (null-safe gate)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444224"}';
select throws_ok(
  $$ select public.create_catalog_item(
       p_base_item := 'denyvis', p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='92')) $$,
  '42501', null, 'a disallowed role (visitor) is denied');

-- H. Existing 22023 path preserved + typed-enum rejection -------------------
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333224"}';
select throws_ok(
  $$ select public.create_catalog_item(
       p_base_item := '   ', p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='92')) $$,
  '22023', null, 'blank base_item still raises 22023');
-- The facet params are enum-TYPED, so an invalid value is rejected by Postgres at
-- the cast boundary (22P02) — there is no free-text path into kind/fulfillment.
select throws_ok(
  $$ select 'nonsense'::public.catalog_item_kind $$,
  '22P02', null, 'an invalid catalog_item_kind value is rejected (typed enum)');

reset role;
select * from finish();
rollback;
