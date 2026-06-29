begin;
select plan(11);

-- ============================================================================
-- Spec 175 U2 — create_catalog_item(category, base_item, spec_attrs, unit,
--   stockable, note) returns uuid — SECURITY DEFINER, back-office only
--   (pm/super/procurement/director). Trims; unique (base_item, spec_attrs) →
--   23505; blank base/unit → 22023; wrong role → 42501.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333120', 'pm@cat2.local',    '{}'::jsonb),
  ('55555555-5555-5555-5555-555555555120', 'proc@cat2.local',  '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222120', 'site@cat2.local',  '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444120', 'visit@cat2.local', '{}'::jsonb);

update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333120';
update public.users set role='procurement'     where id='55555555-5555-5555-5555-555555555120';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222222120';
-- '4444…' stays visitor.

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select ok(
  to_regprocedure('public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid)') is not null,
  'create_catalog_item exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid)'::regprocedure),
  true, 'create_catalog_item is SECURITY DEFINER');
select is(
  has_function_privilege('anon',
    'public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid)', 'EXECUTE'),
  false, 'anon cannot execute create_catalog_item');
select is(
  has_function_privilege('authenticated',
    'public.create_catalog_item(public.item_category, text, text, text, boolean, text, text, uuid, uuid)', 'EXECUTE'),
  true, 'authenticated can execute create_catalog_item');

set local role authenticated;

-- B. PM creates (returns id + row lands).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333120"}';
select isnt(
  (select public.create_catalog_item('electrical', 'ทดสอบสายไฟ', 'รุ่นทดสอบ', 'ม้วน', true, null)),
  null, 'PM creates a catalog item — returns id');
select is(
  (select count(*)::int from public.catalog_items
     where base_item='ทดสอบสายไฟ' and spec_attrs='รุ่นทดสอบ'),
  1, 'the created item is present');

-- C. Procurement creates too (back-office set incl. procurement).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555120"}';
select isnt(
  (select public.create_catalog_item('plumbing_sanitary', 'ทดสอบปูน', null, 'ถุง', true, null)),
  null, 'procurement creates a catalog item');

-- D. Validation + identity.
select throws_ok(
  $$ select public.create_catalog_item('electrical', '   ', 'x', 'ม้วน', true, null) $$,
  '22023', null, 'blank base_item rejected (22023)');
select throws_ok(
  $$ select public.create_catalog_item('electrical', 'ทดสอบสายไฟ', 'รุ่นทดสอบ', 'ม้วน', true, null) $$,
  '23505', null, 'duplicate (base_item, spec_attrs) rejected (23505)');

-- E. Role gate.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222120"}';
select throws_ok(
  $$ select public.create_catalog_item('electrical', 'ของหน้างาน', null, 'ชิ้น', true, null) $$,
  '42501', null, 'site_admin denied (42501)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444120"}';
select throws_ok(
  $$ select public.create_catalog_item('electrical', 'ของวิสิเตอร์', null, 'ชิ้น', true, null) $$,
  '42501', null, 'visitor denied (42501)');

reset role;

select * from finish();
rollback;
