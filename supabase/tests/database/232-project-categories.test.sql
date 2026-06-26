begin;
select plan(37);

-- ============================================================================
-- Spec 207 U1 / feedback 1a556584 — project_categories: per-project work-category
--   taxonomy (หมวดงาน). Read by project members (can_see_project); written only
--   via the create/update/reorder/set-active SECURITY DEFINER RPCs
--   (pm/super/director, membership-gated). Deactivate-not-delete (no delete
--   grant/policy). Strictly additive.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333207', 'pm-mem@cat207.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666666207', 'pm-nonmem@cat207.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222207', 'site@cat207.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444207', 'visit@cat207.local',     '{}'::jsonb);

update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333207';
update public.users set role='project_manager' where id='66666666-6666-6666-6666-666666666207';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222222207';
-- '4444…' stays visitor.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-ccccccccc207', 'PRC-TEST-CAT-207', 'Category fixture project');

-- Enrol ONLY the member PM (33…); the non-member PM (66…) is deliberately left out.
insert into public.project_members (project_id, user_id, added_by) values
  ('cccccccc-cccc-cccc-cccc-ccccccccc207',
   '33333333-3333-3333-3333-333333333207',
   '33333333-3333-3333-3333-333333333207');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ---------------------------------------------------------------------------
-- A. Structure (as owner).
-- ---------------------------------------------------------------------------
select has_table('public', 'project_categories', 'project_categories table exists');
select is(
  (select relrowsecurity from pg_class where oid='public.project_categories'::regclass),
  true, 'RLS enabled on project_categories');

-- create_project_category
select ok(
  to_regprocedure('public.create_project_category(uuid, text, text, integer)') is not null,
  'create_project_category exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.create_project_category(uuid, text, text, integer)'::regprocedure),
  true, 'create_project_category is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.create_project_category(uuid, text, text, integer)', 'EXECUTE'),
  false, 'anon cannot execute create_project_category');
select is(
  has_function_privilege('authenticated', 'public.create_project_category(uuid, text, text, integer)', 'EXECUTE'),
  true, 'authenticated can execute create_project_category');

-- update_project_category
select ok(
  to_regprocedure('public.update_project_category(uuid, text, integer)') is not null,
  'update_project_category exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.update_project_category(uuid, text, integer)'::regprocedure),
  true, 'update_project_category is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.update_project_category(uuid, text, integer)', 'EXECUTE'),
  false, 'anon cannot execute update_project_category');

-- reorder_project_categories
select ok(
  to_regprocedure('public.reorder_project_categories(uuid, uuid[])') is not null,
  'reorder_project_categories exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.reorder_project_categories(uuid, uuid[])'::regprocedure),
  true, 'reorder_project_categories is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.reorder_project_categories(uuid, uuid[])', 'EXECUTE'),
  false, 'anon cannot execute reorder_project_categories');

-- set_project_category_active
select ok(
  to_regprocedure('public.set_project_category_active(uuid, boolean)') is not null,
  'set_project_category_active exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.set_project_category_active(uuid, boolean)'::regprocedure),
  true, 'set_project_category_active is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.set_project_category_active(uuid, boolean)', 'EXECUTE'),
  false, 'anon cannot execute set_project_category_active');

-- Table grants: read for authenticated, no anon read, NO delete/insert (RPC-only write).
select is(
  has_table_privilege('anon', 'public.project_categories', 'SELECT'),
  false, 'anon cannot select project_categories');
select is(
  has_table_privilege('authenticated', 'public.project_categories', 'SELECT'),
  true, 'authenticated can select project_categories');
select is(
  has_table_privilege('authenticated', 'public.project_categories', 'DELETE'),
  false, 'no DELETE for authenticated (deactivate-not-delete)');
select is(
  has_table_privilege('authenticated', 'public.project_categories', 'INSERT'),
  false, 'no direct INSERT for authenticated (writes go through the DEFINER RPCs)');

-- ---------------------------------------------------------------------------
-- B. Behaviour as the member PM.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333207"}';

select isnt(
  (select public.create_project_category(
     'cccccccc-cccc-cccc-cccc-ccccccccc207', 'STRUCT', 'งานโครงสร้าง', 1)),
  null, 'member PM creates a category — returns id');
select is(
  (select count(*)::int from public.project_categories
     where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='STRUCT'),
  1, 'the created category is present');
select is(
  (select count(*)::int from public.project_categories
     where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207'),
  1, 'member PM can read the project categories (SELECT policy)');

select throws_ok(
  $$ select public.create_project_category(
       'cccccccc-cccc-cccc-cccc-ccccccccc207', 'STRUCT', 'ชื่อซ้ำ', 2) $$,
  '23505', null, 'duplicate (project_id, code) rejected (23505)');
select throws_ok(
  $$ select public.create_project_category(
       'cccccccc-cccc-cccc-cccc-ccccccccc207', 'X', '   ', 1) $$,
  '22023', null, 'blank name rejected (22023)');
select throws_ok(
  $$ select public.create_project_category(
       'cccccccc-cccc-cccc-cccc-ccccccccc207', '   ', 'ชื่อ', 1) $$,
  '22023', null, 'blank code rejected (22023)');

-- Rename + reorder via update.
select lives_ok(
  $$ select public.update_project_category(
       (select id from public.project_categories
          where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='STRUCT'),
       'งานโครงสร้างหลัก', 5) $$,
  'member PM updates a category');
select is(
  (select name from public.project_categories
     where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='STRUCT'),
  'งานโครงสร้างหลัก', 'category name updated');

-- Deactivate (not delete).
select lives_ok(
  $$ select public.set_project_category_active(
       (select id from public.project_categories
          where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='STRUCT'),
       false) $$,
  'member PM deactivates a category');
select is(
  (select is_active from public.project_categories
     where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='STRUCT'),
  false, 'category is_active flipped to false (deactivate-not-delete)');

-- Reorder by ordinality (ARCH then STRUCT → 1, 2).
select isnt(
  (select public.create_project_category(
     'cccccccc-cccc-cccc-cccc-ccccccccc207', 'ARCH', 'งานสถาปัตย์', 2)),
  null, 'member PM creates a second category');
select lives_ok(
  $$ select public.reorder_project_categories(
       'cccccccc-cccc-cccc-cccc-ccccccccc207',
       array[
         (select id from public.project_categories
            where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='ARCH'),
         (select id from public.project_categories
            where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='STRUCT')
       ]) $$,
  'member PM reorders categories');
select is(
  (select sort_order from public.project_categories
     where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='ARCH'),
  1, 'reorder set ARCH sort_order = 1 (ordinality)');
select is(
  (select sort_order from public.project_categories
     where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207' and code='STRUCT'),
  2, 'reorder set STRUCT sort_order = 2 (ordinality)');

-- ---------------------------------------------------------------------------
-- C. Membership + role gates.
-- ---------------------------------------------------------------------------
-- Non-member PM: role ok, but not a member → 42501 (membership gate).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666207"}';
select throws_ok(
  $$ select public.create_project_category(
       'cccccccc-cccc-cccc-cccc-ccccccccc207', 'NM', 'ไม่ใช่สมาชิก', 1) $$,
  '42501', null, 'non-member PM denied create on an unseen project (42501)');
select is(
  (select count(*)::int from public.project_categories
     where project_id='cccccccc-cccc-cccc-cccc-ccccccccc207'),
  0, 'non-member PM reads zero categories (SELECT policy)');

-- site_admin and visitor: role gate → 42501 (not in pm/super/director).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222207"}';
select throws_ok(
  $$ select public.create_project_category(
       'cccccccc-cccc-cccc-cccc-ccccccccc207', 'SA', 'ไซต์', 1) $$,
  '42501', null, 'site_admin denied create (role gate, 42501)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444207"}';
select throws_ok(
  $$ select public.create_project_category(
       'cccccccc-cccc-cccc-cccc-ccccccccc207', 'V', 'วิสิเตอร์', 1) $$,
  '42501', null, 'visitor denied create (role gate, 42501)');

reset role;

select * from finish();
rollback;
