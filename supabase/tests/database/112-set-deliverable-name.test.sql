begin;
select plan(12);

-- ============================================================================
-- Spec 165 U1 / ADR 0059 — set_deliverable_name(p_deliverable_id, p_name).
--   SECURITY DEFINER; role gate PM/super/project_director (42501 else), then
--   membership via can_see_project on the งวด's project (unknown/invisible →
--   42501). Name trimmed, non-empty, ≤200 (22023). Mirrors set_work_package_name.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110165', 'super@dn-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220165', 'sa@dn-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330165', 'pm@dn-test.local',    '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550165', 'dir@dn-test.local',   '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660165', 'pmoth@dn-test.local', '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880165', 'vis@dn-test.local',   '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110165';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220165';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330165';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550165';
update public.users set role='project_manager' where id='66666666-6666-6666-6666-666666660165';
-- '8888…' stays visitor.

-- pm (3333) is lead + member; pm_other (6666) is NOT on the project.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1650165-0165-0165-0165-a1a1a1a10165', 'PRC-165-P1', 'โครงการงวด',
   '33333333-3333-3333-3333-333333330165');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1650165-0165-0165-0165-a1a1a1a10165',
   '33333333-3333-3333-3333-333333330165', '11111111-1111-1111-1111-111111110165');
insert into public.deliverables (id, project_id, code, name, sort_order) values
  ('d1650165-0165-0165-0165-d1d1d1d10165', 'a1650165-0165-0165-0165-a1a1a1a10165', 'D01', 'ชื่อเดิม', 1);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select ok(to_regprocedure('public.set_deliverable_name(uuid,text)') is not null,
  'set_deliverable_name(uuid,text) exists');
select is((select prosecdef from pg_proc
            where oid='public.set_deliverable_name(uuid,text)'::regprocedure),
  true, 'set_deliverable_name is SECURITY DEFINER');

set local role authenticated;

-- B. pm (member) renames → true; name changes.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330165"}';
select is(
  (select public.set_deliverable_name('d1650165-0165-0165-0165-d1d1d1d10165', '  ชื่อใหม่  ')),
  true, 'project_manager member renames the deliverable');
select is(
  (select name from public.deliverables where id='d1650165-0165-0165-0165-d1d1d1d10165'),
  'ชื่อใหม่', 'the name is trimmed and saved');

-- C. super_admin (see-all) renames → true.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110165"}';
select is(
  (select public.set_deliverable_name('d1650165-0165-0165-0165-d1d1d1d10165', 'ชื่อโดยซุปเปอร์')),
  true, 'super_admin renames (see-all)');

-- D. project_director (see-all) renames → true.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550165"}';
select is(
  (select public.set_deliverable_name('d1650165-0165-0165-0165-d1d1d1d10165', 'ชื่อโดยไดเรกเตอร์')),
  true, 'project_director renames (see-all)');

-- E. a project_manager NOT on the project → 42501 (membership).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660165"}';
select throws_ok(
  $$ select public.set_deliverable_name('d1650165-0165-0165-0165-d1d1d1d10165', 'x') $$,
  '42501', null, 'a non-member project_manager denied by membership');

-- F. site_admin → 42501 (role).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220165"}';
select throws_ok(
  $$ select public.set_deliverable_name('d1650165-0165-0165-0165-d1d1d1d10165', 'x') $$,
  '42501', null, 'site_admin denied by role');

-- G. visitor → 42501.
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880165"}';
select throws_ok(
  $$ select public.set_deliverable_name('d1650165-0165-0165-0165-d1d1d1d10165', 'x') $$,
  '42501', null, 'visitor denied');

-- H. validation + unknown id (as the member pm).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330165"}';
select throws_ok(
  $$ select public.set_deliverable_name('d1650165-0165-0165-0165-d1d1d1d10165', '   ') $$,
  '22023', null, 'empty name rejected');
select throws_ok(
  format($$ select public.set_deliverable_name('d1650165-0165-0165-0165-d1d1d1d10165', %L) $$,
         repeat('x', 201)),
  '22023', null, 'over-long name rejected');
select throws_ok(
  $$ select public.set_deliverable_name('00000000-0000-0000-0000-000000000165', 'x') $$,
  '42501', null, 'unknown deliverable id → 42501 (not visible)');

reset role;

select * from finish();
rollback;
