begin;
select plan(14);

-- ============================================================================
-- Operator directive 2026-07-26 (follows #766 "procurement_manager owns the
-- on-site teams"): *"yes, she can manage project members."*
--
-- The team map's staff tier calls addProjectMember / removeProjectMember, which
-- write `project_members` DIRECTLY under the caller's session client — there is
-- no DEFINER RPC in between. So RLS is the real gate, and before this migration
-- both the INSERT and DELETE policies allowed PM / project_director /
-- super_admin only. Widening the server action alone would have shipped an
-- affordance-then-refuse at the row-security layer.
--
-- What must hold after the widening:
--   • procurement_manager may INSERT and DELETE a membership row
--   • the added_by = auth.uid() self-stamp survives (it is what makes the audit
--     trail honest — a widened policy must not become a forge-any-adder policy)
--   • plain procurement, site_admin and a field role still cannot write
--   • the existing PM / PD / super_admin arms are untouched
--   • SELECT is unchanged (it already admitted both procurement tiers)
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0361-0361-0361-000000000001', 'super@s361.local', '{}'::jsonb),
  ('70000000-0361-0361-0361-000000000002', 'pmgr@s361.local',  '{}'::jsonb),
  ('70000000-0361-0361-0361-000000000003', 'proc@s361.local',  '{}'::jsonb),
  ('70000000-0361-0361-0361-000000000004', 'sa@s361.local',    '{}'::jsonb),
  ('70000000-0361-0361-0361-000000000005', 'pm@s361.local',    '{}'::jsonb),
  ('70000000-0361-0361-0361-00000000000a', 'target1@s361.local', '{}'::jsonb),
  ('70000000-0361-0361-0361-00000000000b', 'target2@s361.local', '{}'::jsonb),
  ('70000000-0361-0361-0361-00000000000c', 'target3@s361.local', '{}'::jsonb);

update public.users set role = 'super_admin'         where id = '70000000-0361-0361-0361-000000000001';
update public.users set role = 'procurement_manager' where id = '70000000-0361-0361-0361-000000000002';
update public.users set role = 'procurement'         where id = '70000000-0361-0361-0361-000000000003';
update public.users set role = 'site_admin'          where id = '70000000-0361-0361-0361-000000000004';
update public.users set role = 'project_manager'     where id = '70000000-0361-0361-0361-000000000005';
update public.users set role = 'site_admin'          where id = '70000000-0361-0361-0361-00000000000a';
update public.users set role = 'site_admin'          where id = '70000000-0361-0361-0361-00000000000b';
update public.users set role = 'site_admin'          where id = '70000000-0361-0361-0361-00000000000c';

insert into public.projects (id, code, name) values
  ('c1000000-0361-0361-0361-000000000001', 'PRC-361-A', 'โครงการทดสอบ 361');

-- ============================================================================
-- A. procurement_manager: the new arm, both directions.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0361-0361-0361-000000000002"}';

select lives_ok(
  $$insert into public.project_members (project_id, user_id, added_by)
    values ('c1000000-0361-0361-0361-000000000001',
            '70000000-0361-0361-0361-00000000000a',
            '70000000-0361-0361-0361-000000000002')$$,
  'procurement_manager may add a project member');

select is(
  (select count(*)::int from public.project_members
    where project_id = 'c1000000-0361-0361-0361-000000000001'
      and user_id = '70000000-0361-0361-0361-00000000000a'),
  1, 'the row is really there (the INSERT was not silently filtered)');

select lives_ok(
  $$delete from public.project_members
     where project_id = 'c1000000-0361-0361-0361-000000000001'
       and user_id = '70000000-0361-0361-0361-00000000000a'$$,
  'procurement_manager may remove a project member');

select is(
  (select count(*)::int from public.project_members
    where project_id = 'c1000000-0361-0361-0361-000000000001'
      and user_id = '70000000-0361-0361-0361-00000000000a'),
  0, 'the DELETE really removed it (not a no-op filtered by USING)');

-- The self-stamp survives the widening: she cannot attribute the add to someone
-- else. Without this, "who put this person on the project" stops being evidence.
select throws_ok(
  $$insert into public.project_members (project_id, user_id, added_by)
    values ('c1000000-0361-0361-0361-000000000001',
            '70000000-0361-0361-0361-00000000000b',
            '70000000-0361-0361-0361-000000000005')$$,
  '42501', null,
  'procurement_manager cannot forge added_by');

reset role;

-- ============================================================================
-- B. The roles that must STILL be refused. plain procurement is the near miss:
--    it shares is_back_office() with procurement_manager, and SELECT already
--    admits it — so only the write policies keep them apart.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0361-0361-0361-000000000003"}';
select throws_ok(
  $$insert into public.project_members (project_id, user_id, added_by)
    values ('c1000000-0361-0361-0361-000000000001',
            '70000000-0361-0361-0361-00000000000b',
            '70000000-0361-0361-0361-000000000003')$$,
  '42501', null, 'plain procurement still may not add a member');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0361-0361-0361-000000000004"}';
select throws_ok(
  $$insert into public.project_members (project_id, user_id, added_by)
    values ('c1000000-0361-0361-0361-000000000001',
            '70000000-0361-0361-0361-00000000000b',
            '70000000-0361-0361-0361-000000000004')$$,
  '42501', null, 'site_admin still may not add a member');
reset role;

-- ============================================================================
-- C. The pre-existing arms are untouched (a widening must not be a rewrite).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0361-0361-0361-000000000005"}';
select lives_ok(
  $$insert into public.project_members (project_id, user_id, added_by)
    values ('c1000000-0361-0361-0361-000000000001',
            '70000000-0361-0361-0361-00000000000c',
            '70000000-0361-0361-0361-000000000005')$$,
  'project_manager may still add a member');
select lives_ok(
  $$delete from public.project_members
     where project_id = 'c1000000-0361-0361-0361-000000000001'
       and user_id = '70000000-0361-0361-0361-00000000000c'$$,
  'project_manager may still remove a member');
reset role;

-- ============================================================================
-- D. Policy shape — the eval-once wrapper must survive the drop+create. An
--    unwrapped current_user_role() re-evaluates PER ROW (the 40-rls-eval-once
--    guard exists because that has bitten this repo before).
-- ============================================================================
select is(
  (select count(*)::int from pg_policies
    where tablename = 'project_members' and cmd = 'INSERT'),
  1, 'exactly one INSERT policy (the widening replaced, not stacked)');

select is(
  (select count(*)::int from pg_policies
    where tablename = 'project_members' and cmd = 'DELETE'),
  1, 'exactly one DELETE policy');

select ok(
  (select with_check like '%( SELECT current_user_role()%' from pg_policies
    where tablename = 'project_members' and cmd = 'INSERT'),
  'INSERT policy keeps the eval-once (select …) wrapper');

select ok(
  (select qual like '%( SELECT current_user_role()%' from pg_policies
    where tablename = 'project_members' and cmd = 'DELETE'),
  'DELETE policy keeps the eval-once (select …) wrapper');

select ok(
  (select with_check like '%added_by%' from pg_policies
    where tablename = 'project_members' and cmd = 'INSERT'),
  'INSERT policy still self-stamps added_by');

-- SELECT was already open to both procurement tiers; the widening must not have
-- touched it (a policy count of 2 is the pre-existing shape).
select is(
  (select count(*)::int from pg_policies
    where tablename = 'project_members' and cmd = 'SELECT'),
  2, 'the two SELECT policies are unchanged');

select * from finish();
rollback;
