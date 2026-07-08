begin;
select plan(13);

-- ============================================================================
-- Spec 279 U7b / ADR 0079 — SA read-grant on crews for the /sa/crew team view.
--
-- U1 shipped crews/crew_members readable ONLY by the onboarding back office OR a
-- crew's own bound lead — site_admin is EXCLUDED from is_back_office. U7b adds a
-- THIRD, project-scoped arm so a site_admin may SELECT the crews (and their
-- members) on the projects they can see — the SAME visibility the /sa/crew page
-- already derives its worker roster from (work_packages RLS = can_see_project).
--
-- New SECURITY DEFINER helper current_user_sa_visible_crew_ids() = the crew ids a
-- site_admin may see (role = site_admin AND can_see_project(crews.project_id));
-- added as a disjunct to both SELECT policies (mirrors current_user_led_crew_ids()).
-- default_day_rate (money) stays zero-grant — never widened by this read arm.
-- View-only: NO write path is granted to the SA (moves are U5, PM-owned).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0283-0283-0283-700000000283', 'sa-mem@s283.local',  '{}'::jsonb),
  ('75000000-0283-0283-0283-750000000283', 'super@s283.local',   '{}'::jsonb),
  ('76000000-0283-0283-0283-760000000283', 'pm@s283.local',      '{}'::jsonb),
  ('72000000-0283-0283-0283-720000000283', 'visitor@s283.local', '{}'::jsonb);
update public.users set role = 'site_admin'      where id = '70000000-0283-0283-0283-700000000283';
update public.users set role = 'super_admin'     where id = '75000000-0283-0283-0283-750000000283';
update public.users set role = 'project_manager' where id = '76000000-0283-0283-0283-760000000283';
-- 7200… stays visitor (negative control — the read arm must not fall open).

-- Project A the SA is a member of (→ can_see_project true); project B they are NOT.
insert into public.projects (id, code, name) values
  ('73000000-0283-4000-8000-0000000000aa', 'TAP-283-A', 'Spec 283 fixture project A'),
  ('73000000-0283-4000-8000-0000000000bb', 'TAP-283-B', 'Spec 283 fixture project B');
insert into public.project_members (project_id, user_id, added_by) values
  ('73000000-0283-4000-8000-0000000000aa', '70000000-0283-0283-0283-700000000283',
   '75000000-0283-0283-0283-750000000283');

-- A lead + a member on A, a member on B (each in its own crew).
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('7d000000-0283-4000-8000-0000000000aa', 'หัวหน้า A', 'daily', 'permanent', 500, true,
     '75000000-0283-0283-0283-750000000283'),
  ('7e000000-0283-4000-8000-0000000000aa', 'ลูกทีม A',  'daily', 'permanent', 400, true,
     '75000000-0283-0283-0283-750000000283'),
  ('7e000000-0283-4000-8000-0000000000bb', 'ลูกทีม B',  'daily', 'permanent', 400, true,
     '75000000-0283-0283-0283-750000000283');

insert into public.crews (id, project_id, name, lead_worker_id, kind, active, created_by) values
  ('7c000000-0283-4000-8000-0000000000aa', '73000000-0283-4000-8000-0000000000aa',
     'ทีม A', '7d000000-0283-4000-8000-0000000000aa', 'dc', true,
     '75000000-0283-0283-0283-750000000283'),
  ('7c000000-0283-4000-8000-0000000000bb', '73000000-0283-4000-8000-0000000000bb',
     'ทีม B', null, 'dc', true, '75000000-0283-0283-0283-750000000283');
insert into public.crew_members (crew_id, worker_id, added_by) values
  ('7c000000-0283-4000-8000-0000000000aa', '7e000000-0283-4000-8000-0000000000aa',
     '75000000-0283-0283-0283-750000000283'),
  ('7c000000-0283-4000-8000-0000000000bb', '7e000000-0283-4000-8000-0000000000bb',
     '75000000-0283-0283-0283-750000000283');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. The helper exists, is a locked-down SECURITY DEFINER, money stays hidden.
-- ============================================================================
select has_function('public'::name, 'current_user_sa_visible_crew_ids'::name,
  'current_user_sa_visible_crew_ids() exists');
select ok(
  (select prosecdef from pg_proc where oid = 'public.current_user_sa_visible_crew_ids()'::regprocedure),
  'current_user_sa_visible_crew_ids() is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.current_user_sa_visible_crew_ids()', 'EXECUTE'),
  false, 'anon cannot execute current_user_sa_visible_crew_ids (229-class lockdown)');
select is(
  has_function_privilege('authenticated', 'public.current_user_sa_visible_crew_ids()', 'EXECUTE'),
  true, 'authenticated can execute current_user_sa_visible_crew_ids');
-- The read arm must NOT widen money: default_day_rate stays zero authenticated grant.
select is(
  has_column_privilege('authenticated', 'public.crews', 'default_day_rate', 'SELECT'),
  false, 'authenticated still has NO SELECT on crews.default_day_rate (money zero-grant preserved)');

-- ============================================================================
-- B. As the project-member site_admin — sees OWN project's crews, NOT others'.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0283-0283-0283-700000000283"}';

select ok(
  exists(select 1 from public.crews where id = '7c000000-0283-4000-8000-0000000000aa')
    and not exists(select 1 from public.crews where id = '7c000000-0283-4000-8000-0000000000bb'),
  'site_admin sees the crew on their project (A), NOT the crew on a project they cannot see (B)');
select ok(
  exists(select 1 from public.crew_members
           where crew_id = '7c000000-0283-4000-8000-0000000000aa'),
  'site_admin sees the members of their own project''s crew');
select ok(
  not exists(select 1 from public.crew_members
               where crew_id = '7c000000-0283-4000-8000-0000000000bb'),
  'site_admin does NOT see the members of a crew on a project they cannot see');
select ok(
  '7c000000-0283-4000-8000-0000000000aa' in (select public.current_user_sa_visible_crew_ids())
    and '7c000000-0283-4000-8000-0000000000bb' not in (select public.current_user_sa_visible_crew_ids()),
  'the helper returns the SA''s own-project crew only (scoped by can_see_project)');

-- ============================================================================
-- C. Negative control — a visitor gets nothing (the arm never falls open).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "72000000-0283-0283-0283-720000000283"}';
select ok(
  not exists(select 1 from public.crews
               where id in ('7c000000-0283-4000-8000-0000000000aa',
                            '7c000000-0283-4000-8000-0000000000bb')),
  'a visitor sees no crews (role gate did not fall open)');
select is(
  (select count(*)::int from public.current_user_sa_visible_crew_ids()),
  0, 'a visitor''s helper set is empty');

-- ============================================================================
-- D. Regression — the back office still sees ALL crews (existing arm intact).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "76000000-0283-0283-0283-760000000283"}';
select ok(
  exists(select 1 from public.crews where id = '7c000000-0283-4000-8000-0000000000aa')
    and exists(select 1 from public.crews where id = '7c000000-0283-4000-8000-0000000000bb'),
  'a project_manager (is_back_office) still sees crews on BOTH projects');
select ok(
  exists(select 1 from public.crew_members where crew_id = '7c000000-0283-4000-8000-0000000000aa')
    and exists(select 1 from public.crew_members where crew_id = '7c000000-0283-4000-8000-0000000000bb'),
  'a project_manager still sees crew_members on BOTH crews');

reset role;
select * from finish();
rollback;
