begin;
select plan(11);

-- ============================================================================
-- Spec 165 U2 — swap_deliverable_order(p_a, p_b). SECURITY DEFINER; role gate
--   PM/super/project_director (42501 else), membership via can_see_project; both
--   งวด must share a project (22023 else); unknown/invisible → 42501. Swaps the
--   two rows' sort_order.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110166', 'super@so-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220166', 'sa@so-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330166', 'pm@so-test.local',    '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550166', 'dir@so-test.local',   '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660166', 'pmoth@so-test.local', '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880166', 'vis@so-test.local',   '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110166';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220166';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330166';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550166';
update public.users set role='project_manager' where id='66666666-6666-6666-6666-666666660166';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1660166-0166-0166-0166-a1a1a1a10166', 'PRC-166-P1', 'โครงการเรียง',
   '33333333-3333-3333-3333-333333330166'),
  ('a2660166-0166-0166-0166-a2a2a2a20166', 'PRC-166-P2', 'โครงการอื่น', null);
insert into public.project_members (project_id, user_id, added_by) values
  ('a1660166-0166-0166-0166-a1a1a1a10166',
   '33333333-3333-3333-3333-333333330166', '11111111-1111-1111-1111-111111110166');
insert into public.deliverables (id, project_id, code, name, sort_order) values
  ('d1660166-0166-0166-0166-d1d1d1d10166', 'a1660166-0166-0166-0166-a1a1a1a10166', 'D01', 'หนึ่ง', 1),
  ('d2660166-0166-0166-0166-d2d2d2d20166', 'a1660166-0166-0166-0166-a1a1a1a10166', 'D02', 'สอง', 2),
  ('e2660166-0166-0166-0166-e2e2e2e20166', 'a2660166-0166-0166-0166-a2a2a2a20166', 'D01', 'อื่น', 1);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select ok(to_regprocedure('public.swap_deliverable_order(uuid,uuid)') is not null,
  'swap_deliverable_order(uuid,uuid) exists');
select is((select prosecdef from pg_proc
            where oid='public.swap_deliverable_order(uuid,uuid)'::regprocedure),
  true, 'swap_deliverable_order is SECURITY DEFINER');

set local role authenticated;

-- B. pm (member) swaps D01<->D02 → orders flip.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330166"}';
select is(
  (select public.swap_deliverable_order(
     'd1660166-0166-0166-0166-d1d1d1d10166', 'd2660166-0166-0166-0166-d2d2d2d20166')),
  true, 'project_manager member swaps order');
select is(
  (select sort_order from public.deliverables where id='d1660166-0166-0166-0166-d1d1d1d10166'),
  2, 'D01 now sort_order 2');
select is(
  (select sort_order from public.deliverables where id='d2660166-0166-0166-0166-d2d2d2d20166'),
  1, 'D02 now sort_order 1');

-- C. super_admin (see-all) swaps back → true.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110166"}';
select is(
  (select public.swap_deliverable_order(
     'd1660166-0166-0166-0166-d1d1d1d10166', 'd2660166-0166-0166-0166-d2d2d2d20166')),
  true, 'super_admin swaps (see-all)');

-- D. project_director (see-all) swaps → true.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550166"}';
select is(
  (select public.swap_deliverable_order(
     'd1660166-0166-0166-0166-d1d1d1d10166', 'd2660166-0166-0166-0166-d2d2d2d20166')),
  true, 'project_director swaps (see-all)');

-- E. cross-project swap rejected (22023).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330166"}';
select throws_ok(
  $$ select public.swap_deliverable_order(
       'd1660166-0166-0166-0166-d1d1d1d10166', 'e2660166-0166-0166-0166-e2e2e2e20166') $$,
  '22023', null, 'a งวด from another project is rejected');

-- F. a non-member project_manager → 42501.
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660166"}';
select throws_ok(
  $$ select public.swap_deliverable_order(
       'd1660166-0166-0166-0166-d1d1d1d10166', 'd2660166-0166-0166-0166-d2d2d2d20166') $$,
  '42501', null, 'a non-member project_manager denied by membership');

-- G. site_admin → 42501 (role).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220166"}';
select throws_ok(
  $$ select public.swap_deliverable_order(
       'd1660166-0166-0166-0166-d1d1d1d10166', 'd2660166-0166-0166-0166-d2d2d2d20166') $$,
  '42501', null, 'site_admin denied by role');

-- H. visitor → 42501.
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880166"}';
select throws_ok(
  $$ select public.swap_deliverable_order(
       'd1660166-0166-0166-0166-d1d1d1d10166', 'd2660166-0166-0166-0166-d2d2d2d20166') $$,
  '42501', null, 'visitor denied');

reset role;

select * from finish();
rollback;
