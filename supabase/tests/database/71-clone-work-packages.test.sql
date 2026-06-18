begin;
select plan(11);

-- ============================================================================
-- Spec 142 U6 — clone_work_packages(p_src_project_id, p_dst_project_id) returns
--   integer. SECURITY DEFINER, PM/super. Copies the WP SKELETON (code/name/
--   description) from src into dst, skipping codes dst already has (composite
--   unique → on conflict do nothing). No logs/photos/status/owner/schedule —
--   a fresh project starts those clean. Returns the number of rows inserted.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@clone-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@clone-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@clone-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@clone-test.local', '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111111111';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222222222';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333333';
-- '4444…' stays visitor.

-- src has 2 WPs; dst starts empty; dst2 already has one of src's codes.
insert into public.projects (id, code, name) values
  ('51c51c51-c51c-c51c-c51c-c51c51c51c51', 'PRC-CLONE-SRC', 'แหล่งคัดลอก'),
  ('d57d57d5-7d57-d57d-57d5-7d57d57d57d5', 'PRC-CLONE-DST', 'ปลายทางว่าง'),
  ('d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2', 'PRC-CLONE-DST2', 'ปลายทางมีงานซ้ำ');

-- Spec 143 / ADR 0056: the PM-session verification reads below need membership —
-- enrol the PM in all three clone fixtures (the clone RPC itself is definer and
-- works regardless).
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-CLONE-SRC', 'PRC-CLONE-DST', 'PRC-CLONE-DST2')
     and u.id in (select au.id from auth.users au where au.email like '%@clone-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

insert into public.work_packages (project_id, code, name, description) values
  ('51c51c51-c51c-c51c-c51c-c51c51c51c51', 'WP-A', 'งานเอ', 'รายละเอียดเอ'),
  ('51c51c51-c51c-c51c-c51c-c51c51c51c51', 'WP-B', 'งานบี', null);
insert into public.work_packages (project_id, code, name) values
  ('d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2', 'WP-A', 'งานเอที่มีอยู่แล้ว');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select ok(
  to_regprocedure('public.clone_work_packages(uuid,uuid)') is not null,
  'clone_work_packages(uuid,uuid) exists');
select is(
  (select prosecdef from pg_proc where oid='public.clone_work_packages(uuid,uuid)'::regprocedure),
  true, 'clone_work_packages is SECURITY DEFINER');

set local role authenticated;

-- B.1 PM clones src → empty dst: 2 rows.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select is(
  (select public.clone_work_packages(
     '51c51c51-c51c-c51c-c51c-c51c51c51c51', 'd57d57d5-7d57-d57d-57d5-7d57d57d57d5')),
  2, 'PM clone copies both work packages');

-- B.2 The skeleton landed (codes + names + description copied; status default).
select is(
  (select count(*)::int from public.work_packages where project_id='d57d57d5-7d57-d57d-57d5-7d57d57d57d5'),
  2, 'dst now has 2 work packages');
select is(
  (select description from public.work_packages
     where project_id='d57d57d5-7d57-d57d-57d5-7d57d57d57d5' and code='WP-A'),
  'รายละเอียดเอ', 'description copied');
select is(
  (select status::text from public.work_packages
     where project_id='d57d57d5-7d57-d57d-57d5-7d57d57d57d5' and code='WP-A'),
  'not_started', 'cloned WP starts not_started (skeleton only)');

-- B.3 Re-clone is idempotent: 0 new rows.
select is(
  (select public.clone_work_packages(
     '51c51c51-c51c-c51c-c51c-c51c51c51c51', 'd57d57d5-7d57-d57d-57d5-7d57d57d57d5')),
  0, 're-clone inserts nothing (codes already present)');

-- B.4 Partial: dst2 already has WP-A, so only WP-B is copied (1 row).
select is(
  (select public.clone_work_packages(
     '51c51c51-c51c-c51c-c51c-c51c51c51c51', 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2')),
  1, 'clone skips codes the destination already has');

-- B.5 site_admin denied (42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ select public.clone_work_packages(
       '51c51c51-c51c-c51c-c51c-c51c51c51c51', 'd57d57d5-7d57-d57d-57d5-7d57d57d57d5') $$,
  '42501', null, 'site_admin clone is denied (42501)');

-- B.6 Same src = dst rejected (22023). Back to PM.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select throws_ok(
  $$ select public.clone_work_packages(
       '51c51c51-c51c-c51c-c51c-c51c51c51c51', '51c51c51-c51c-c51c-c51c-c51c51c51c51') $$,
  '22023', null, 'cloning a project into itself is rejected (22023)');

-- B.7 Unknown source rejected (22023).
select throws_ok(
  $$ select public.clone_work_packages(
       '00000000-0000-0000-0000-0000000000ff', 'd57d57d5-7d57-d57d-57d5-7d57d57d57d5') $$,
  '22023', null, 'unknown source project rejected (22023)');

reset role;

select * from finish();
rollback;
