begin;
select plan(11);

-- ============================================================================
-- Spec 165 U4 / ADR 0016 amend — delete_deliverable(p_deliverable_id). SECURITY
--   DEFINER; role PM/super/project_director (42501 else), membership via
--   can_see_project; REFUSES (P0001) if any work_packages reference the งวด
--   (empty-only — the FK is SET NULL, so this guard is what enforces it).
--   Audited. Mirrors delete_work_package (spec 157).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110167', 'super@dd-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220167', 'sa@dd-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330167', 'pm@dd-test.local',    '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550167', 'dir@dd-test.local',   '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660167', 'pmoth@dd-test.local', '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880167', 'vis@dd-test.local',   '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110167';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220167';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330167';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550167';
update public.users set role='project_manager' where id='66666666-6666-6666-6666-666666660167';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1670167-0167-0167-0167-a1a1a1a10167', 'PRC-167-P1', 'โครงการลบงวด',
   '33333333-3333-3333-3333-333333330167');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1670167-0167-0167-0167-a1a1a1a10167',
   '33333333-3333-3333-3333-333333330167', '11111111-1111-1111-1111-111111110167');
insert into public.deliverables (id, project_id, code, name, sort_order) values
  ('d1670167-0167-0167-0167-d1d1d1d10167', 'a1670167-0167-0167-0167-a1a1a1a10167', 'D01', 'ว่างหนึ่ง', 1),
  ('d2670167-0167-0167-0167-d2d2d2d20167', 'a1670167-0167-0167-0167-a1a1a1a10167', 'D02', 'ว่างสอง', 2),
  ('d3670167-0167-0167-0167-d3d3d3d30167', 'a1670167-0167-0167-0167-a1a1a1a10167', 'D03', 'ว่างสาม', 3),
  ('d4670167-0167-0167-0167-d4d4d4d40167', 'a1670167-0167-0167-0167-a1a1a1a10167', 'D04', 'มีงาน', 4);
-- D04 has a งาน bound → not deletable.
insert into public.work_packages (id, project_id, code, name, deliverable_id) values
  ('c4670167-0167-0167-0167-c4c4c4c40167', 'a1670167-0167-0167-0167-a1a1a1a10167', 'WP-1', 'งาน',
   'd4670167-0167-0167-0167-d4d4d4d40167');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select ok(to_regprocedure('public.delete_deliverable(uuid)') is not null,
  'delete_deliverable(uuid) exists');
select is((select prosecdef from pg_proc
            where oid='public.delete_deliverable(uuid)'::regprocedure),
  true, 'delete_deliverable is SECURITY DEFINER');

set local role authenticated;

-- B. pm (member) deletes empty D01 → true; row gone.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330167"}';
select is(
  (select public.delete_deliverable('d1670167-0167-0167-0167-d1d1d1d10167')),
  true, 'project_manager member deletes an empty งวด');
select ok(
  not exists (select 1 from public.deliverables where id='d1670167-0167-0167-0167-d1d1d1d10167'),
  'the งวด is gone');

-- C. super_admin deletes empty D02; project_director deletes empty D03.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110167"}';
select is((select public.delete_deliverable('d2670167-0167-0167-0167-d2d2d2d20167')),
  true, 'super_admin deletes empty (see-all)');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550167"}';
select is((select public.delete_deliverable('d3670167-0167-0167-0167-d3d3d3d30167')),
  true, 'project_director deletes empty (see-all)');

-- D. D04 has a งาน → P0001.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330167"}';
select throws_ok(
  $$ select public.delete_deliverable('d4670167-0167-0167-0167-d4d4d4d40167') $$,
  'P0001', null, 'a งวด with งาน is refused (empty-only)');

-- E. role / membership denials (use D04, which still exists).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660167"}';
select throws_ok(
  $$ select public.delete_deliverable('d4670167-0167-0167-0167-d4d4d4d40167') $$,
  '42501', null, 'a non-member project_manager denied by membership');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220167"}';
select throws_ok(
  $$ select public.delete_deliverable('d4670167-0167-0167-0167-d4d4d4d40167') $$,
  '42501', null, 'site_admin denied by role');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880167"}';
select throws_ok(
  $$ select public.delete_deliverable('d4670167-0167-0167-0167-d4d4d4d40167') $$,
  '42501', null, 'visitor denied');

-- F. the empty deletes were audited. Read as the OWNER: audit_log SELECT is
-- scoped to privileged internal roles (rls-audit-2026-07 F2) — the visitor
-- session left by section E sees no audit rows.
reset role;
select ok(
  exists (select 1 from public.audit_log
            where target_table='deliverables' and action='other'
              and payload->>'event'='deliverable_deleted'),
  'delete writes an audit_log row');

select * from finish();
rollback;
