begin;
select plan(30);

-- ============================================================================
-- Spec 143 U1 / ADR 0056 — membership-scoped project visibility.
--   can_see_project(uuid) / can_see_wp(uuid) helpers (SECURITY DEFINER) +
--   rewritten SELECT policies on the 7 project-scoped tables.
--
-- Roles: super (all), coordinator (all), procurement (all projects/WPs/PRs),
-- pm_member (lead of P1), pm_other (on nothing), site_member (member of P1),
-- site_other (on nothing), visitor (nothing). P1 has involvement; P2 has none.
-- Helper behaviour + projects/work_packages end-to-end are tested behaviourally;
-- the WP-scoped child policies (photo_logs/approvals/purchase_requests) and the
-- project-scoped deliverables/reports are verified by catalog wiring (qual
-- references the right helper) — the helpers carry the logic, proven below.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@vis-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'coord@vis-test.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pmmem@vis-test.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'pmoth@vis-test.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555555555', 'sitem@vis-test.local', '{}'::jsonb),
  ('66666666-6666-6666-6666-666666666666', 'sitoth@vis-test.local', '{}'::jsonb),
  ('77777777-7777-7777-7777-777777777777', 'proc@vis-test.local', '{}'::jsonb),
  ('88888888-8888-8888-8888-888888888888', 'vis@vis-test.local', '{}'::jsonb);

update public.users set role='super_admin'        where id='11111111-1111-1111-1111-111111111111';
update public.users set role='project_coordinator' where id='22222222-2222-2222-2222-222222222222';
update public.users set role='project_manager'    where id='33333333-3333-3333-3333-333333333333';
update public.users set role='project_manager'    where id='44444444-4444-4444-4444-444444444444';
update public.users set role='site_admin'         where id='55555555-5555-5555-5555-555555555555';
update public.users set role='site_admin'         where id='66666666-6666-6666-6666-666666666666';
update public.users set role='procurement'        where id='77777777-7777-7777-7777-777777777777';
-- '8888…' stays visitor.

-- P1: lead = pm_member; member = site_member. P2: nobody.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'PRC-VIS-P1', 'โครงการหนึ่ง',
   '33333333-3333-3333-3333-333333333333'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'PRC-VIS-P2', 'โครงการสอง', null);

insert into public.project_members (project_id, user_id, added_by) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   '55555555-5555-5555-5555-555555555555',
   '11111111-1111-1111-1111-111111111111');

insert into public.work_packages (id, project_id, code, name) values
  ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'WP-1', 'งานหนึ่ง'),
  ('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'WP-2', 'งานสอง');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- A. can_see_project helper.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select is((select public.can_see_project('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')), true, 'super: P1 true');
select is((select public.can_see_project('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2')), true, 'super: P2 true');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select is((select public.can_see_project('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2')), true, 'coordinator: P2 true (see-all)');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select is((select public.can_see_project('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')), true, 'pm_member: P1 true (lead)');
select is((select public.can_see_project('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2')), false, 'pm_member: P2 false (not involved)');

set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is((select public.can_see_project('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')), false, 'pm_other: P1 false');

set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555"}';
select is((select public.can_see_project('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')), true, 'site_member: P1 true (member)');
select is((select public.can_see_project('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2')), false, 'site_member: P2 false');

set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777777"}';
select is((select public.can_see_project('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')), false, 'procurement: helper false (table policies grant its reach)');

set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';
select is((select public.can_see_project('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1')), false, 'visitor: P1 false');

-- ============================================================================
-- B. can_see_wp helper.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select is((select public.can_see_wp('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1')), true, 'pm_member: wp1 true');
select is((select public.can_see_wp('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2')), false, 'pm_member: wp2 false');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is((select public.can_see_wp('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1')), false, 'pm_other: wp1 false');

-- ============================================================================
-- C. projects SELECT (per-row visibility, immune to other rows in the DB).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select is((select count(*)::int from public.projects where id='a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'), 1, 'super sees P1');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select is((select count(*)::int from public.projects where id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'), 1, 'coordinator sees P2');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select is((select count(*)::int from public.projects where id='a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'), 1, 'pm_member sees P1');
select is((select count(*)::int from public.projects where id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'), 0, 'pm_member does NOT see P2');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is((select count(*)::int from public.projects where id='a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'), 0, 'pm_other does NOT see P1');
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777777"}';
select is((select count(*)::int from public.projects where id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'), 1, 'procurement sees P2 (keeps cross-project read)');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';
select is((select count(*)::int from public.projects where id='a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'), 0, 'visitor sees no project');

-- ============================================================================
-- D. work_packages SELECT.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select is((select count(*)::int from public.work_packages where id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'), 1, 'pm_member sees wp1');
select is((select count(*)::int from public.work_packages where id='c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2'), 0, 'pm_member does NOT see wp2');
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777777"}';
select is((select count(*)::int from public.work_packages where id='c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2'), 1, 'procurement sees wp2');
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666666"}';
select is((select count(*)::int from public.work_packages where id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'), 0, 'site_other does NOT see wp1');

-- ============================================================================
-- E. Child-policy wiring (qual references the right helper + keeps exceptions).
-- ============================================================================
select ok((select qual from pg_policies where tablename='photo_logs'
             and policyname='photo_logs readable by privileged roles') like '%can_see_wp%',
          'photo_logs SELECT gates on can_see_wp');
select ok((select qual from pg_policies where tablename='approvals'
             and policyname='approvals readable by sa/pm/super') like '%can_see_wp%',
          'approvals SELECT gates on can_see_wp');
select ok((select qual from pg_policies where tablename='deliverables'
             and policyname='deliverables readable by privileged roles') like '%can_see_project%',
          'deliverables SELECT gates on can_see_project');
select ok((select qual from pg_policies where tablename='purchase_requests'
             and policyname='purchase_requests select own or privileged') like '%can_see_wp%',
          'purchase_requests SELECT gates on can_see_wp');
select ok((select qual from pg_policies where tablename='purchase_requests'
             and policyname='purchase_requests select own or privileged') like '%requested_by%',
          'purchase_requests SELECT keeps the requester self-read');
select ok((select qual from pg_policies where tablename='reports'
             and policyname='reports readable by pm or super_admin') like '%site_admin%',
          'reports SELECT still excludes site_admin');

reset role;

select * from finish();
rollback;
