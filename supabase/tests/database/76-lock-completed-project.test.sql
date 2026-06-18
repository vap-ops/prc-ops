begin;
select plan(10);

-- ============================================================================
-- Spec 145 U1 — lock new work on a completed/archived project.
--   project_is_open(uuid) → status in (active, on_hold).
--   A BEFORE INSERT trigger on work_packages blocks inserts into a closed
--   project (P0002) — one chokepoint over every WP-creation path (manual /
--   template / copy / CSV). Reopen-for-defect is an UPDATE, so warranty rework
--   still works on a completed project (the key carve-out).
--
-- Setup seeds WPs while the project is still active, THEN flips it to completed
-- (so the seed itself doesn't trip the new trigger).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@lock-test.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@lock-test.local',    '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111111111';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333333';

-- PA stays active; PC is completed (with a complete WP seeded while open).
insert into public.projects (id, code, name, project_lead_id, project_type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRC-LOCK-PA', 'โครงการเปิด',
   '33333333-3333-3333-3333-333333333333', 'new_building'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PRC-LOCK-PC', 'โครงการปิด',
   '33333333-3333-3333-3333-333333333333', 'new_building');

-- Seed PC's complete WP while PC is still active, then close PC.
insert into public.work_packages (id, project_id, code, name, status) values
  ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'WP-DONE', 'งานเสร็จ', 'complete');
insert into public.work_packages (id, project_id, code, name) values
  ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'WP-SRC', 'งานต้นทาง');
update public.projects set status='completed' where id='cccccccc-cccc-cccc-cccc-cccccccccccc';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Helper + trigger catalog / behaviour.
select ok(to_regprocedure('public.project_is_open(uuid)') is not null, 'project_is_open exists');
select is(public.project_is_open('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), true, 'active project is open');
select is(public.project_is_open('cccccccc-cccc-cccc-cccc-cccccccccccc'), false, 'completed project is NOT open');
select is(public.project_is_open('00000000-0000-0000-0000-0000000000ff'), false, 'missing project is not open');

-- A.2 A direct INSERT into a completed project is blocked by the trigger (P0002)
--     — proves the chokepoint catches every path, not just the RPCs.
select throws_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'WP-NEW', 'งานใหม่') $$,
  'P0002', null, 'direct WP insert into a completed project is blocked');

-- B. The WP-creation RPCs under an authenticated PM.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';

-- B.1 create_work_package into a COMPLETED project → blocked.
select throws_ok(
  $$ select public.create_work_package('cccccccc-cccc-cccc-cccc-cccccccccccc', 'WP-X', 'x', null) $$,
  'P0002', null, 'create_work_package is blocked on a completed project');

-- B.2 create_work_package into an ACTIVE project → works.
select isnt(
  (select public.create_work_package('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'WP-NEW', 'งานใหม่', null)),
  null, 'create_work_package still works on an active project');

-- B.3 clone INTO a completed project → blocked (inserts trip the trigger).
select throws_ok(
  $$ select public.clone_work_packages('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc') $$,
  'P0002', null, 'clone into a completed project is blocked');

-- B.4 apply_wp_template on a completed project → blocked.
select throws_ok(
  $$ select public.apply_wp_template('cccccccc-cccc-cccc-cccc-cccccccccccc') $$,
  'P0002', null, 'apply_wp_template is blocked on a completed project');

-- C. WARRANTY CARVE-OUT: reopen-for-defect on a completed project's complete WP
--    STILL works (it's an UPDATE → trigger is INSERT-only).
select is(
  (select public.reopen_work_package_for_defect('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'รอยร้าวช่วงประกัน')),
  true, 'reopen-for-defect still works on a completed project (warranty rework)');

reset role;

select * from finish();
rollback;
