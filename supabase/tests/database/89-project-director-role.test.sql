begin;
select plan(8);

-- ============================================================================
-- Spec 152 U1 / ADR 0058 — project_director = see-all project_manager.
--
-- The differentiator: a project_director with NO project_members row and who is
-- NOT the project lead still sees the project + its WP + its photo_log (see-all,
-- like super_admin/project_coordinator), whereas a membership-scoped
-- project_manager who is likewise uninvolved sees nothing. Only can_see_project
-- changed (its see-all branch); can_see_wp / can_see_photo_log inherit by
-- delegation — proven behaviourally on each table here.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'director@pd-test.local', '{}'::jsonb),
  ('d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2', 'pmother@pd-test.local',  '{}'::jsonb),
  ('d3d3d3d3-d3d3-d3d3-d3d3-d3d3d3d3d3d3', 'lead@pd-test.local',     '{}'::jsonb);

update public.users set role='project_director' where id='d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';
update public.users set role='project_manager'  where id='d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2';
update public.users set role='project_manager'  where id='d3d3d3d3-d3d3-d3d3-d3d3-d3d3d3d3d3d3';

-- Project led by d3 (NOT the director, NOT pm_other); no project_members at all.
insert into public.projects (id, code, name, project_lead_id) values
  ('dddddddd-1111-1111-1111-111111111111', 'PRC-PD-1', 'โครงการกรรมการ',
   'd3d3d3d3-d3d3-d3d3-d3d3-d3d3d3d3d3d3');

insert into public.work_packages (id, project_id, code, name) values
  ('dddddddd-2222-2222-2222-222222222222',
   'dddddddd-1111-1111-1111-111111111111', 'WP-PD', 'งานกรรมการ');

insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('dddddddd-3333-3333-3333-333333333333',
   'dddddddd-2222-2222-2222-222222222222',
   'before'::public.photo_phase,
   'projects/PD/before/fixture.jpg',
   'd3d3d3d3-d3d3-d3d3-d3d3-d3d3d3d3d3d3');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- A. project_director — helper see-all (no membership, not lead).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1"}';
select is((select public.can_see_project('dddddddd-1111-1111-1111-111111111111')), true,
          'director: can_see_project true (see-all, uninvolved)');
select is((select public.can_see_wp('dddddddd-2222-2222-2222-222222222222')), true,
          'director: can_see_wp true (delegates)');
select is((select public.can_see_photo_log('dddddddd-3333-3333-3333-333333333333')), true,
          'director: can_see_photo_log true (delegates)');

-- ============================================================================
-- B. project_director — behavioural SELECT through RLS on each table.
-- ============================================================================
select is((select count(*)::int from public.projects
             where id='dddddddd-1111-1111-1111-111111111111'), 1,
          'director sees the project row');
select is((select count(*)::int from public.work_packages
             where id='dddddddd-2222-2222-2222-222222222222'), 1,
          'director sees the work_package row');
select is((select count(*)::int from public.photo_logs
             where id='dddddddd-3333-3333-3333-333333333333'), 1,
          'director sees the photo_log row');

-- ============================================================================
-- C. uninvolved project_manager — membership-scoped, sees nothing (the contrast).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2"}';
select is((select public.can_see_project('dddddddd-1111-1111-1111-111111111111')), false,
          'pm_other: can_see_project false (not involved)');
select is((select count(*)::int from public.projects
             where id='dddddddd-1111-1111-1111-111111111111'), 0,
          'pm_other does NOT see the project row');

reset role;

select * from finish();
rollback;
