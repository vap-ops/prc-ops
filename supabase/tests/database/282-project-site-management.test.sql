begin;
select plan(11);

-- ============================================================================
-- Spec 282 U1 (approach A) — project_site_management(p_project): a scoped
-- SECURITY DEFINER read of a project's ฝ่ายไซต์ (site-access) bucket for the SA
-- site team board. An SA can read project_members but NOT other users' role/name
-- (users RLS = own-row-only), so the site_admin/site_owner members (id + name)
-- need a definer read, gated on can_see_project(p_project). Returns id + name
-- only — no money, no other roles; anon-revoked (229 class).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110282', 'super@sm.local',  '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220282', 'sa@sm.local',     '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440282', 'sa2@sm.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660282', 'owner@sm.local',  '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330282', 'pm@sm.local',     '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880282', 'vis@sm.local',    '{}'::jsonb),
  ('99999999-9999-9999-9999-999999990282', 'sap2@sm.local',   '{}'::jsonb);
-- sa: full_name NULL → name falls back to line_display_name.
update public.users set role='super_admin', full_name=null
  where id='11111111-1111-1111-1111-111111110282';
update public.users set role='site_admin', full_name=null, line_display_name='เอสเอ ไลน์'
  where id='22222222-2222-2222-2222-222222220282';
update public.users set role='site_admin', full_name='เอสเอ สอง'
  where id='44444444-4444-4444-4444-444444440282';
update public.users set role='site_owner', full_name='เจ้าของ ไซต์'
  where id='66666666-6666-6666-6666-666666660282';
update public.users set role='project_manager', full_name='ผู้จัดการ'
  where id='33333333-3333-3333-3333-333333330282';
-- '8888…' stays visitor.
update public.users set role='site_admin', full_name='เอสเอ พีสอง'
  where id='99999999-9999-9999-9999-999999990282';

insert into public.projects (id, code, name) values
  ('a1a10282-0282-0282-0282-a1a1a1a10282', 'PRC-282-P1', 'โครงการหนึ่ง'),
  ('a2a20282-0282-0282-0282-a2a2a2a20282', 'PRC-282-P2', 'โครงการสอง');

-- P1 members: sa (site_admin), owner (site_owner), pm (project_manager).
-- sa2 + visitor are NOT members of P1. sap2 is a site_admin member of P2 only.
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a10282-0282-0282-0282-a1a1a1a10282', '22222222-2222-2222-2222-222222220282',
   '11111111-1111-1111-1111-111111110282'),
  ('a1a10282-0282-0282-0282-a1a1a1a10282', '66666666-6666-6666-6666-666666660282',
   '11111111-1111-1111-1111-111111110282'),
  ('a1a10282-0282-0282-0282-a1a1a1a10282', '33333333-3333-3333-3333-333333330282',
   '11111111-1111-1111-1111-111111110282'),
  ('a2a20282-0282-0282-0282-a2a2a2a20282', '99999999-9999-9999-9999-999999990282',
   '11111111-1111-1111-1111-111111110282');

-- The behaviour block below asserts while `set local role authenticated`, so
-- the collector role needs write access to the runner's temp buffer.
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- --------------------------------------------------------------- A. Catalog
select has_function('public', 'project_site_management', array['uuid'],
  'project_site_management(uuid) exists');
select ok(
  not has_function_privilege('anon', 'public.project_site_management(uuid)', 'execute'),
  'anon cannot execute project_site_management (229 class)');
select ok(
  has_function_privilege('authenticated', 'public.project_site_management(uuid)', 'execute'),
  'authenticated can execute project_site_management');

-- --------------------------------------------------------------- B. Behaviour
set local role authenticated;

-- As the SA member of P1: returns exactly the site_admin + site_owner members
-- (pm is a member but a non-site role → excluded).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220282"}';
select set_eq(
  $$ select user_id from public.project_site_management('a1a10282-0282-0282-0282-a1a1a1a10282') $$,
  $$ values ('22222222-2222-2222-2222-222222220282'::uuid),
            ('66666666-6666-6666-6666-666666660282'::uuid) $$,
  'SA sees only the site_admin + site_owner members of their project');
-- owner name = full_name; sa name = line_display_name fallback.
select is(
  (select display_name from public.project_site_management('a1a10282-0282-0282-0282-a1a1a1a10282')
    where user_id='66666666-6666-6666-6666-666666660282'),
  'เจ้าของ ไซต์', 'name resolves from full_name');
select is(
  (select display_name from public.project_site_management('a1a10282-0282-0282-0282-a1a1a1a10282')
    where user_id='22222222-2222-2222-2222-222222220282'),
  'เอสเอ ไลน์', 'name falls back to line_display_name when full_name is null');

-- Gate: a site_admin who is NOT a member of P1 sees nothing (can_see_project false).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440282"}';
select is(
  (select count(*)::int from public.project_site_management('a1a10282-0282-0282-0282-a1a1a1a10282')),
  0, 'a non-member site_admin is gated out (can_see_project false)');

-- Gate: a visitor (non-member) sees nothing.
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880282"}';
select is(
  (select count(*)::int from public.project_site_management('a1a10282-0282-0282-0282-a1a1a1a10282')),
  0, 'a visitor non-member is gated out');

-- A PM member of P1 can read the project's site bucket.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330282"}';
select is(
  (select count(*)::int from public.project_site_management('a1a10282-0282-0282-0282-a1a1a1a10282')),
  2, 'a PM member reads the project site bucket');

-- Project scoping: super_admin sees all, but P1''s bucket excludes P2''s site member.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110282"}';
select ok(
  not exists (
    select 1 from public.project_site_management('a1a10282-0282-0282-0282-a1a1a1a10282')
     where user_id='99999999-9999-9999-9999-999999990282'
  ), 'the P2-only site_admin is not in P1''s bucket (project-scoped)');
select is(
  (select count(*)::int from public.project_site_management('a1a10282-0282-0282-0282-a1a1a1a10282')),
  2, 'super_admin reads P1 site bucket (2 members)');

reset role;

select * from finish();
rollback;
