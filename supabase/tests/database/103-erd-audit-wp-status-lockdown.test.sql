begin;
select plan(8);

-- ============================================================================
-- ERD audit (2026-06-29) — finding M2. status / rework_round on work_packages
-- can no longer be set by a direct user-context UPDATE (the column grant is
-- revoked); they change only through the definer status-machine RPCs. The PM
-- on-hold toggle moves into set_work_package_hold (lifted out of the RLS client).
--
-- Fixture seeded as postgres (bypasses RLS); assertions run under
-- `set local role authenticated` so BOTH RLS and the column grant apply.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@m2-test.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@m2-test.local',     '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@m2-test.local',       '{}'::jsonb),
  ('66666666-6666-6666-6666-666666666666', 'pmother@m2-test.local',  '{}'::jsonb);

update public.users set role = 'super_admin'      where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'       where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager'  where id = '33333333-3333-3333-3333-333333333333';
update public.users set role = 'project_manager'  where id = '66666666-6666-6666-6666-666666666666';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PRC-M2-LOCK', 'M2 lockdown fixture');

-- Enrol super/site/pm as members (NOT 6666 — the non-member PM for the
-- membership-denial assertion).
insert into public.project_members (project_id, user_id, added_by) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');

-- wp1: in_progress, no photos (release should land on not_started).
-- wp2: on_hold, with a CURRENT During photo (release should land on in_progress).
insert into public.work_packages (id, project_id, code, name, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'WP-M2-1', 'wp one', 'in_progress'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'WP-M2-2', 'wp two', 'on_hold');

insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'during', 'projects/m2/during/f.jpg',
   '11111111-1111-1111-1111-111111111111');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ----------------------------------------------------------------------------
-- A. set_work_package_hold — the RPC path still performs the transitions.
-- ----------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';

select is(
  (select public.set_work_package_hold('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true)),
  'on_hold',
  'M2: PM holds an in_progress WP -> on_hold (via RPC)'
);
select is(
  (select public.set_work_package_hold('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false)),
  'not_started',
  'M2: release with NO current During photo -> not_started'
);
select is(
  (select public.set_work_package_hold('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false)),
  'in_progress',
  'M2: release WITH a current During photo -> in_progress'
);

-- ----------------------------------------------------------------------------
-- B. RPC role + membership gates.
-- ----------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ select public.set_work_package_hold('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true) $$,
  '42501', null, 'M2: site_admin cannot hold (role gate)'
);
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666666"}';
select throws_ok(
  $$ select public.set_work_package_hold('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true) $$,
  '42501', null, 'M2: a non-member PM cannot hold (membership gate)'
);

-- ----------------------------------------------------------------------------
-- C. The lockdown: a direct user-context UPDATE of status / rework_round is
--    rejected by the column grant; non-status columns still update.
-- ----------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select throws_ok(
  $$ update public.work_packages set status = 'complete'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'M2: PM cannot directly UPDATE status (column grant revoked)'
);
select throws_ok(
  $$ update public.work_packages set rework_round = 5
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'M2: PM cannot directly UPDATE rework_round (column grant revoked)'
);
update public.work_packages set name = 'pm-edited-name'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(
  (select name from public.work_packages where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'pm-edited-name',
  'M2: PM CAN still UPDATE non-status columns (name) — not over-revoked'
);

select * from finish();
rollback;
