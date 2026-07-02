begin;
select plan(12);

-- ============================================================================
-- Spec 173 U1 — procurement reads deliverables + work_package_dependencies.
--
-- procurement is a cross-project read-only browse role (spec 102/143). Its arm
-- already exists on projects + work_packages SELECT, but deliverables (งวดงาน) and
-- work_package_dependencies post-dated that work and only gate on
-- can_see_project / can_see_wp — which are FALSE for procurement (it's not a
-- member of any project). Result: the schedule swimlanes + งวดงาน grouping render
-- empty for procurement. U1 adds a `current_user_role()='procurement'` OR-arm to
-- both SELECT policies, KEEPING the can_see_* predicate (the membership-scoped
-- path for PM/site_admin is unchanged; files 70/73 pin that the qual still names
-- those helpers). No write arm — read-only widening.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('73000000-0173-0173-0173-730000000173', 'proc@s173-test.local', '{}'::jsonb),
  ('73100000-0173-0173-0173-731000000173', 'pmmem@s173-test.local', '{}'::jsonb);

update public.users set role='procurement'     where id='73000000-0173-0173-0173-730000000173';
update public.users set role='project_manager' where id='73100000-0173-0173-0173-731000000173';

-- P1: pm_member is the lead (membership-scoped). P2: nobody — procurement reaches
-- it only via the cross-project arm.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1730000-0173-0173-0173-a17300000001', 'PRC-173-P1', 'โครงการหนึ่ง',
   '73100000-0173-0173-0173-731000000173'),
  ('a2730000-0173-0173-0173-a27300000002', 'PRC-173-P2', 'โครงการสอง', null);

insert into public.work_packages (id, project_id, code, name) values
  ('c1730000-0173-0173-0173-c17300000001', 'a1730000-0173-0173-0173-a17300000001', 'WP-173-1A', 'งาน1A'),
  ('c1730000-0173-0173-0173-c17300000002', 'a1730000-0173-0173-0173-a17300000001', 'WP-173-1B', 'งาน1B'),
  ('c2730000-0173-0173-0173-c27300000001', 'a2730000-0173-0173-0173-a27300000002', 'WP-173-2A', 'งาน2A'),
  ('c2730000-0173-0173-0173-c27300000002', 'a2730000-0173-0173-0173-a27300000002', 'WP-173-2B', 'งาน2B');

insert into public.deliverables (project_id, code, name, sort_order) values
  ('a1730000-0173-0173-0173-a17300000001', 'D-173-1', 'งวด1', 1),
  ('a2730000-0173-0173-0173-a27300000002', 'D-173-2', 'งวด2', 1);

insert into public.work_package_dependencies (predecessor_id, successor_id) values
  ('c1730000-0173-0173-0173-c17300000001', 'c1730000-0173-0173-0173-c17300000002'),
  ('c2730000-0173-0173-0173-c27300000001', 'c2730000-0173-0173-0173-c27300000002');

-- A team member on P1 — the project-info team list procurement now needs to read.
insert into public.project_members (project_id, user_id, added_by) values
  ('a1730000-0173-0173-0173-a17300000001', '73100000-0173-0173-0173-731000000173',
   '73100000-0173-0173-0173-731000000173');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Catalog — the procurement arm was added, the can_see_* predicate kept.
-- ============================================================================
select ok((select qual from pg_policies where tablename='deliverables'
            and policyname='deliverables readable by privileged roles') like '%can_see_project%',
  'deliverables SELECT still names can_see_project (file-70 pin holds)');
select ok((select qual from pg_policies where tablename='deliverables'
            and policyname='deliverables readable by privileged roles') like '%procurement%',
  'deliverables SELECT now carries the procurement arm');
select ok((select qual from pg_policies where tablename='work_package_dependencies'
            and policyname='wp_dependencies readable by privileged roles') like '%can_see_wp%',
  'work_package_dependencies SELECT still names can_see_wp (file-73 pin holds)');
select ok((select qual from pg_policies where tablename='work_package_dependencies'
            and policyname='wp_dependencies readable by privileged roles') like '%procurement%',
  'work_package_dependencies SELECT now carries the procurement arm');
select ok((select qual from pg_policies where tablename='project_members'
            and policyname='project members readable by staff') like '%procurement%',
  'project_members SELECT now carries the procurement arm (team-list read)');

-- ============================================================================
-- B. Behaviour — procurement reads cross-project งวด + dependency links.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "73000000-0173-0173-0173-730000000173"}';

select is((select count(*)::int from public.deliverables
            where project_id='a2730000-0173-0173-0173-a27300000002'), 1,
  'procurement reads a deliverable on a project it is not a member of');
select is((select count(*)::int from public.work_package_dependencies
            where predecessor_id='c2730000-0173-0173-0173-c27300000001'), 1,
  'procurement reads a dependency on a project it is not a member of');
-- Scope to the fixture projects: prod is a LIVE shared DB — real deliverables/
-- dependencies would inflate a global count (a real deliverable broke this).
select is((select count(*)::int from public.deliverables
            where project_id in ('a1730000-0173-0173-0173-a17300000001',
                                 'a2730000-0173-0173-0173-a27300000002')), 2,
  'procurement reads ALL deliverables (cross-project, like its projects/WPs read)');
select is((select count(*)::int from public.work_package_dependencies
            where predecessor_id in (select id from public.work_packages
                                      where project_id in ('a1730000-0173-0173-0173-a17300000001',
                                                           'a2730000-0173-0173-0173-a27300000002'))), 2,
  'procurement reads ALL dependencies (cross-project)');
select is((select count(*)::int from public.project_members
            where project_id='a1730000-0173-0173-0173-a17300000001'), 1,
  'procurement reads the project team list (project_members)');

-- ============================================================================
-- C. Leak control — the procurement arm did NOT open the scope for a PM.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "73100000-0173-0173-0173-731000000173"}';
select is((select count(*)::int from public.deliverables
            where project_id='a1730000-0173-0173-0173-a17300000001'), 1,
  'pm_member (lead of P1) reads the P1 deliverable');
select is((select count(*)::int from public.deliverables
            where project_id='a2730000-0173-0173-0173-a27300000002'), 0,
  'pm_member does NOT read the P2 deliverable (membership scope intact)');

reset role;

select * from finish();
rollback;
