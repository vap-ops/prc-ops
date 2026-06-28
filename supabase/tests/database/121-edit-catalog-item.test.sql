begin;
select plan(14);

-- ============================================================================
-- Spec 175 U3 — update_catalog_item + set_catalog_item_active.
--   Both SECURITY DEFINER, back-office only (pm/super/procurement/director).
--   update: trims, validates, unknown id → 22023, duplicate identity → 23505.
--   set_active: soft delete/restore, unknown id → 22023.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333121', 'pm@cat3.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222121', 'site@cat3.local',  '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444121', 'visit@cat3.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333121';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222222121';
-- '4444…' stays visitor.

-- Two items to edit / collide with.
insert into public.catalog_items (id, category, base_item, spec_attrs, unit) values
  ('a1a1a1a1-0000-0000-0000-000000000121', 'electrical', 'ทดสอบแก้ไข A', 'x', 'ม้วน'),
  ('b2b2b2b2-0000-0000-0000-000000000121', 'electrical', 'ทดสอบแก้ไข B', 'y', 'ม้วน');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select ok(
  to_regprocedure('public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text)') is not null,
  'update_catalog_item exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text)'::regprocedure),
  true, 'update_catalog_item is SECURITY DEFINER');
select ok(
  to_regprocedure('public.set_catalog_item_active(uuid, boolean)') is not null,
  'set_catalog_item_active exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.set_catalog_item_active(uuid, boolean)'::regprocedure),
  true, 'set_catalog_item_active is SECURITY DEFINER');
select is(
  has_function_privilege('anon',
    'public.update_catalog_item(uuid, public.item_category, text, text, text, boolean, text, text)', 'EXECUTE'),
  false, 'anon cannot execute update_catalog_item');
select is(
  has_function_privilege('anon', 'public.set_catalog_item_active(uuid, boolean)', 'EXECUTE'),
  false, 'anon cannot execute set_catalog_item_active');

set local role authenticated;

-- B. PM edits item A (proves authenticated EXECUTE too).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333121"}';
select lives_ok(
  $$ select public.update_catalog_item('a1a1a1a1-0000-0000-0000-000000000121',
       'plumbing_sanitary', 'ทดสอบแก้ไข A2', 'x2', 'ชิ้น', false, 'หมายเหตุ') $$,
  'PM updates item A');
select is(
  (select base_item || '|' || category::text || '|' || stockable::text
     from public.catalog_items where id='a1a1a1a1-0000-0000-0000-000000000121'),
  'ทดสอบแก้ไข A2|plumbing_sanitary|false',
  'item A reflects the edit (name + category + stockable)');

-- C. Validation + identity.
select throws_ok(
  $$ select public.update_catalog_item('cccccccc-0000-0000-0000-000000000121',
       'electrical', 'ไม่มีจริง', null, 'ชิ้น', true, null) $$,
  '22023', null, 'update unknown id → 22023');
-- Edit A onto B's identity (B = 'ทดสอบแก้ไข B' / 'y') → duplicate.
select throws_ok(
  $$ select public.update_catalog_item('a1a1a1a1-0000-0000-0000-000000000121',
       'electrical', 'ทดสอบแก้ไข B', 'y', 'ม้วน', true, null) $$,
  '23505', null, 'editing onto another item identity → 23505');

-- D. Soft delete.
select lives_ok(
  $$ select public.set_catalog_item_active('a1a1a1a1-0000-0000-0000-000000000121', false) $$,
  'PM deactivates item A');
select is(
  (select is_active from public.catalog_items where id='a1a1a1a1-0000-0000-0000-000000000121'),
  false, 'item A is now inactive');

-- E. Role gate.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222121"}';
select throws_ok(
  $$ select public.update_catalog_item('b2b2b2b2-0000-0000-0000-000000000121',
       'electrical', 'แก้โดย SA', null, 'ชิ้น', true, null) $$,
  '42501', null, 'site_admin update denied (42501)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444121"}';
select throws_ok(
  $$ select public.set_catalog_item_active('b2b2b2b2-0000-0000-0000-000000000121', false) $$,
  '42501', null, 'visitor set_active denied (42501)');

reset role;

select * from finish();
rollback;
