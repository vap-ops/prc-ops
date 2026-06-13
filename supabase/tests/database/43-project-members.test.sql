begin;
select plan(14);

-- ============================================================================
-- Spec 80 — project_members team join table: mutable membership, PM/super
-- manage, staff read. (Eval-once policy posture is covered globally by file 40.)
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('80000000-0000-0000-0000-0000000000a1', 'sa@s80.local',      '{}'::jsonb),
  ('80000000-0000-0000-0000-0000000000b2', 'pm@s80.local',      '{}'::jsonb),
  ('80000000-0000-0000-0000-0000000000c3', 'super@s80.local',   '{}'::jsonb),
  ('80000000-0000-0000-0000-0000000000d4', 'visitor@s80.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '80000000-0000-0000-0000-0000000000a1';
update public.users set role = 'project_manager' where id = '80000000-0000-0000-0000-0000000000b2';
update public.users set role = 'super_admin'     where id = '80000000-0000-0000-0000-0000000000c3';
-- d4 keeps default 'visitor'.

insert into public.projects (id, code, name, status) values
  ('80111111-1111-1111-1111-111111111111', 'PRC-TEST-80', 'S80 fixture project', 'active');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ---- A. Structure / grants (owner context) ---------------------------------

select has_table('public', 'project_members', 'project_members table exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_members'::regclass),
  true, 'project_members has RLS enabled');
select has_index('public', 'project_members', 'project_members_user_idx',
  'user_id index exists');
select col_is_pk('public', 'project_members', array['project_id', 'user_id'],
  'composite PK (project_id, user_id)');
select is(
  has_table_privilege('authenticated', 'public.project_members', 'DELETE'),
  true, 'authenticated holds DELETE (membership is mutable)');
select is(
  has_column_privilege('authenticated', 'public.project_members', 'project_id', 'INSERT'),
  true, 'authenticated holds column-scoped INSERT');

-- ---- B. Role-sim behavior --------------------------------------------------

set local role authenticated;

-- PM adds a member (added_by pinned to the caller).
set local "request.jwt.claims" = '{"sub": "80000000-0000-0000-0000-0000000000b2"}';
select lives_ok(
  $$ insert into public.project_members (project_id, user_id, added_by)
     values ('80111111-1111-1111-1111-111111111111',
             '80000000-0000-0000-0000-0000000000c3',
             '80000000-0000-0000-0000-0000000000b2') $$,
  'PM adds a team member');
-- Duplicate (project,user) rejected by the composite PK.
select throws_ok(
  $$ insert into public.project_members (project_id, user_id, added_by)
     values ('80111111-1111-1111-1111-111111111111',
             '80000000-0000-0000-0000-0000000000c3',
             '80000000-0000-0000-0000-0000000000b2') $$,
  '23505', null, 'duplicate membership rejected by PK');

-- SA: INSERT throws (WITH CHECK violation); DELETE is a no-op (USING excludes
-- all rows → 0 deleted, no error); SELECT is allowed (staff read).
set local "request.jwt.claims" = '{"sub": "80000000-0000-0000-0000-0000000000a1"}';
select throws_ok(
  $$ insert into public.project_members (project_id, user_id, added_by)
     values ('80111111-1111-1111-1111-111111111111',
             '80000000-0000-0000-0000-0000000000a1',
             '80000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'site_admin cannot add a member');
select lives_ok(
  $$ delete from public.project_members
     where project_id = '80111111-1111-1111-1111-111111111111' $$,
  'site_admin delete runs without error (RLS makes it a no-op)');
select is(
  (select count(*)::int from public.project_members
    where project_id = '80111111-1111-1111-1111-111111111111'),
  1, 'the member survives — site_admin removed nothing, and can read it');

-- Visitor sees none.
set local "request.jwt.claims" = '{"sub": "80000000-0000-0000-0000-0000000000d4"}';
select is(
  (select count(*)::int from public.project_members), 0,
  'visitor sees no members (SELECT policy excludes)');

-- PM removes the member.
set local "request.jwt.claims" = '{"sub": "80000000-0000-0000-0000-0000000000b2"}';
select lives_ok(
  $$ delete from public.project_members
     where project_id = '80111111-1111-1111-1111-111111111111'
       and user_id = '80000000-0000-0000-0000-0000000000c3' $$,
  'PM removes the team member');

reset role;

-- ---- C. Outcome ------------------------------------------------------------

select is(
  (select count(*)::int from public.project_members
    where project_id = '80111111-1111-1111-1111-111111111111'),
  0, 'membership row is gone after the PM delete');

select * from finish();
rollback;
