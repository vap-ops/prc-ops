begin;
select plan(12);

-- ============================================================================
-- Spec 143 U4 / ADR 0056 — scope photo_markups, recursion-free.
--   photo_markups' INSERT policy self-joined photo_markups (tombstone target),
--   which recurses (42P17) once SELECT is function-based (the U3 attempt). Fix:
--   a SECURITY DEFINER photo_markup_tombstone_target_ok() does the self-read
--   (bypassing RLS → no recursion); the policy calls it instead of an inline
--   self-EXISTS. SELECT gates on can_see_photo_log (recreated). This test
--   reproduces the exact content+tombstone INSERT that recursed before and
--   asserts it now succeeds for a member, plus the read-leak is closed.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'pmmem@pm4-test.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'pmoth@pm4-test.local', '{}'::jsonb),
  ('88888888-8888-8888-8888-888888888888', 'vis@pm4-test.local',   '{}'::jsonb);

update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333333';
update public.users set role='project_manager' where id='44444444-4444-4444-4444-444444444444';
-- '8888…' stays visitor.

-- P1: pm_member is lead. WP1 + a photo_log + a content markup by pm_member.
insert into public.projects (id, code, name, project_lead_id) values
  ('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'PRC-PM4-P1', 'โครงการสี่',
   '33333333-3333-3333-3333-333333333333');
insert into public.work_packages (id, project_id, code, name) values
  ('c4c4c4c4-c4c4-c4c4-c4c4-c4c4c4c4c4c4', 'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4', 'WP-1', 'งานหนึ่ง');
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4', 'c4c4c4c4-c4c4-c4c4-c4c4-c4c4c4c4c4c4',
   'before', 'a4a4/c4c4/x.jpg', '33333333-3333-3333-3333-333333333333');
insert into public.photo_markups (id, photo_log_id, comment, created_by) values
  ('77777777-0000-0000-0000-000000000001', 'b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4',
   'ทำเครื่องหมายไว้', '33333333-3333-3333-3333-333333333333');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Catalog: helpers + policy wiring.
-- ============================================================================
select ok(to_regprocedure('public.can_see_photo_log(uuid)') is not null,
  'can_see_photo_log(uuid) exists (recreated)');
select ok(to_regprocedure('public.photo_markup_tombstone_target_ok(uuid,uuid)') is not null,
  'photo_markup_tombstone_target_ok(uuid,uuid) exists');
select is((select prosecdef from pg_proc
            where oid='public.photo_markup_tombstone_target_ok(uuid,uuid)'::regprocedure),
  true, 'tombstone-target helper is SECURITY DEFINER');
select ok((select qual from pg_policies where tablename='photo_markups'
            and policyname='photo_markups readable by privileged roles') like '%can_see_photo_log%',
  'photo_markups SELECT gates on can_see_photo_log');
select ok((select with_check from pg_policies where tablename='photo_markups'
            and policyname='photo_markups insert content or own tombstone') like '%can_see_photo_log%',
  'photo_markups INSERT gates on can_see_photo_log');
select ok((select with_check from pg_policies where tablename='photo_markups'
            and policyname='photo_markups insert content or own tombstone') like '%tombstone_target_ok%',
  'photo_markups INSERT uses the definer tombstone-target helper (no self-join)');

-- ============================================================================
-- B. Behaviour — the content+tombstone INSERT that recursed in U3 now works
--    for a member; the read-leak is closed.
-- ============================================================================
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ insert into public.photo_markups (photo_log_id, comment, created_by)
     values ('b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4', 'ใหม่',
             '33333333-3333-3333-3333-333333333333') $$,
  'member content markup INSERT succeeds (no recursion)');
select lives_ok(
  $$ insert into public.photo_markups (photo_log_id, superseded_by, created_by)
     values ('b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4',
             '77777777-0000-0000-0000-000000000001',
             '33333333-3333-3333-3333-333333333333') $$,
  'member tombstone of own markup succeeds (definer target check)');
select cmp_ok(
  (select count(*)::int from public.photo_markups
     where photo_log_id='b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4'),
  '>', 0, 'member sees the markups on their project');

-- pm_other (not on P1): cannot see, cannot insert.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is(
  (select count(*)::int from public.photo_markups
     where photo_log_id='b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4'),
  0, 'non-member sees zero markups (leak closed)');
select throws_ok(
  $$ insert into public.photo_markups (photo_log_id, comment, created_by)
     values ('b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4', 'x',
             '44444444-4444-4444-4444-444444444444') $$,
  '42501', null, 'non-member content INSERT is denied');

-- visitor: sees nothing.
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';
select is(
  (select count(*)::int from public.photo_markups
     where photo_log_id='b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4'),
  0, 'visitor sees zero markups');

reset role;

select * from finish();
rollback;
