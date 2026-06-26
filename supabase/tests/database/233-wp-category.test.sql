begin;
select plan(17);

-- ============================================================================
-- Spec 207 U2 / feedback 1a556584 — one-category-per-WP binding.
--   work_packages.category_id: a single NULLABLE FK to project_categories
--   (ON DELETE SET NULL). Set ONLY via set_work_package_category — SECURITY
--   DEFINER, pm/super/director, membership-gated (can_see_wp). NULL =
--   uncategorise. A non-null category must EXIST + be is_active + share the WP's
--   project, else 22023.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333233', 'pm-mem@wpcat233.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666666233', 'pm-nonmem@wpcat233.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222233', 'site@wpcat233.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444233', 'visit@wpcat233.local',     '{}'::jsonb);

update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333233';
update public.users set role='project_manager' where id='66666666-6666-6666-6666-666666666233';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222222233';
-- '4444…' stays visitor.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-ccccccccc233', 'PRC-TEST-WPCAT-233',  'WP-category fixture'),
  ('dddddddd-dddd-dddd-dddd-ddddddddd233', 'PRC-TEST-WPCAT2-233', 'WP-category other project');

-- Enrol ONLY the member PM (33…) in the WP's project (cccc…); 66… stays out.
insert into public.project_members (project_id, user_id, added_by) values
  ('cccccccc-cccc-cccc-cccc-ccccccccc233',
   '33333333-3333-3333-3333-333333333233',
   '33333333-3333-3333-3333-333333333233');

insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeee233',
   'cccccccc-cccc-cccc-cccc-ccccccccc233', 'WP-1', 'งานทดสอบหมวด');

-- Categories (inserted directly as owner — bypasses the RPC, which U1 already
-- pins): one active in the WP's project, one INACTIVE in the WP's project, one
-- active in the OTHER project.
insert into public.project_categories (id, project_id, code, name, sort_order, is_active, created_by) values
  ('a1111111-1111-1111-1111-111111111233', 'cccccccc-cccc-cccc-cccc-ccccccccc233',
   'STRUCT', 'งานโครงสร้าง', 1, true,  '33333333-3333-3333-3333-333333333233'),
  ('a2222222-2222-2222-2222-222222222233', 'cccccccc-cccc-cccc-cccc-ccccccccc233',
   'OLD',    'หมวดเก่า',     2, false, '33333333-3333-3333-3333-333333333233'),
  ('a3333333-3333-3333-3333-333333333233', 'dddddddd-dddd-dddd-dddd-ddddddddd233',
   'OTHER',  'หมวดอีกโครงการ', 1, true, '33333333-3333-3333-3333-333333333233');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ---------------------------------------------------------------------------
-- A. Structure (as owner).
-- ---------------------------------------------------------------------------
select has_column('public', 'work_packages', 'category_id', 'work_packages.category_id exists');
select col_is_null('public', 'work_packages', 'category_id', 'category_id is nullable');
-- FK to project_categories with ON DELETE SET NULL (confdeltype 'n').
select is(
  (select confdeltype from pg_constraint
     where conrelid='public.work_packages'::regclass
       and confrelid='public.project_categories'::regclass
       and contype='f'),
  'n', 'category_id FK is ON DELETE SET NULL');

select ok(
  to_regprocedure('public.set_work_package_category(uuid, uuid)') is not null,
  'set_work_package_category exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.set_work_package_category(uuid, uuid)'::regprocedure),
  true, 'set_work_package_category is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.set_work_package_category(uuid, uuid)', 'EXECUTE'),
  false, 'anon cannot execute set_work_package_category');
select is(
  has_function_privilege('authenticated', 'public.set_work_package_category(uuid, uuid)', 'EXECUTE'),
  true, 'authenticated can execute set_work_package_category');

-- ---------------------------------------------------------------------------
-- B. Behaviour as the member PM.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333233"}';

select is(
  (select public.set_work_package_category(
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeee233', 'a1111111-1111-1111-1111-111111111233')),
  true, 'member PM binds the WP to an active same-project category');
select is(
  (select category_id from public.work_packages where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeee233'),
  'a1111111-1111-1111-1111-111111111233'::uuid, 'category_id is set on the WP');

-- NULL = uncategorise.
select is(
  (select public.set_work_package_category('eeeeeeee-eeee-eeee-eeee-eeeeeeeee233', null)),
  true, 'member PM can uncategorise (NULL)');
select is(
  (select category_id from public.work_packages where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeee233'),
  null, 'category_id cleared to NULL');

-- Guards: cross-project, inactive, unknown → 22023.
select throws_ok(
  $$ select public.set_work_package_category(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeee233', 'a3333333-3333-3333-3333-333333333233') $$,
  '22023', null, 'binding a category from another project rejected (22023)');
select throws_ok(
  $$ select public.set_work_package_category(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeee233', 'a2222222-2222-2222-2222-222222222233') $$,
  '22023', null, 'binding an inactive category rejected (22023)');
select throws_ok(
  $$ select public.set_work_package_category(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeee233', '09999999-9999-9999-9999-999999999233') $$,
  '22023', null, 'binding an unknown category rejected (22023)');

-- ---------------------------------------------------------------------------
-- C. Membership + role gates.
-- ---------------------------------------------------------------------------
-- Non-member PM: role ok but not a member of the WP's project → 42501.
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666233"}';
select throws_ok(
  $$ select public.set_work_package_category(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeee233', 'a1111111-1111-1111-1111-111111111233') $$,
  '42501', null, 'non-member PM denied (can_see_wp, 42501)');

-- site_admin and visitor: role gate → 42501.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222233"}';
select throws_ok(
  $$ select public.set_work_package_category(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeee233', 'a1111111-1111-1111-1111-111111111233') $$,
  '42501', null, 'site_admin denied (role gate, 42501)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444233"}';
select throws_ok(
  $$ select public.set_work_package_category(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeee233', 'a1111111-1111-1111-1111-111111111233') $$,
  '42501', null, 'visitor denied (role gate, 42501)');

reset role;

select * from finish();
rollback;
