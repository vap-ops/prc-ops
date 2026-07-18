begin;
select plan(9);

-- ============================================================================
-- Spec 327 follow-up (chip task_b1cddf5a) — project_categories SELECT gains the
--   procurement arm, mirroring "work_packages readable by privileged roles"
--   (spec 173 / migration 071000 pattern: procurement tiers are cross-project
--   read-only browsers, not members, so the can_see_project-only qual read ZERO
--   rows and blanked the spec-277 category letter/color/icon on the /procurement
--   scope view — U2 #627 papered over it with an admin-client seam).
--   Widening = ALTER POLICY qual-only: procurement OR-arm prepended, the
--   membership path (can_see_project) and the client full-tier policy KEPT.
--   Read-only widening — no write arm.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('32700000-0327-0327-0327-327000000001', 'proc@s327-test.local',    '{}'::jsonb),
  ('32700000-0327-0327-0327-327000000002', 'procmgr@s327-test.local', '{}'::jsonb),
  ('32700000-0327-0327-0327-327000000003', 'pmmem@s327-test.local',   '{}'::jsonb),
  ('32700000-0327-0327-0327-327000000004', 'pmnon@s327-test.local',   '{}'::jsonb);

update public.users set role='procurement'         where id='32700000-0327-0327-0327-327000000001';
update public.users set role='procurement_manager' where id='32700000-0327-0327-0327-327000000002';
update public.users set role='project_manager'     where id='32700000-0327-0327-0327-327000000003';
update public.users set role='project_manager'     where id='32700000-0327-0327-0327-327000000004';

insert into public.projects (id, code, name) values
  ('a3270000-0327-0327-0327-a32700000001', 'PRC-327-P1', 'โครงการทดสอบหมวดงาน');

-- Enrol ONLY the member PM; procurement/procurement_manager/non-member PM stay
-- non-members — the widened arm is their only way in.
insert into public.project_members (project_id, user_id, added_by) values
  ('a3270000-0327-0327-0327-a32700000001',
   '32700000-0327-0327-0327-327000000003',
   '32700000-0327-0327-0327-327000000003');

insert into public.project_categories (project_id, code, name, sort_order, created_by) values
  ('a3270000-0327-0327-0327-a32700000001', 'S01', 'งานโครงสร้าง', 1,
   '32700000-0327-0327-0327-327000000003'),
  ('a3270000-0327-0327-0327-a32700000001', 'A01', 'งานสถาปัตย์', 2,
   '32700000-0327-0327-0327-327000000003');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Policy qual pins — arm added, membership path kept.
-- ============================================================================
select ok((select qual from pg_policies where tablename='project_categories'
            and policyname='project_categories readable by project members') like '%can_see_project%',
  'project_categories SELECT still names can_see_project (member path kept)');
select ok((select qual from pg_policies where tablename='project_categories'
            and policyname='project_categories readable by project members') like '%''procurement''::user_role%',
  'project_categories SELECT names bare procurement (arm added; not just the _manager substring)');
select ok((select qual from pg_policies where tablename='project_categories'
            and policyname='project_categories readable by project members') like '%procurement_manager%',
  'project_categories SELECT names procurement_manager (arm added)');

-- ============================================================================
-- B. Behaviour per role.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "32700000-0327-0327-0327-327000000001"}';
select is(
  (select count(*)::int from public.project_categories
     where project_id='a3270000-0327-0327-0327-a32700000001'),
  2, 'procurement (non-member) reads the project categories via the new arm');

set local "request.jwt.claims" = '{"sub": "32700000-0327-0327-0327-327000000002"}';
select is(
  (select count(*)::int from public.project_categories
     where project_id='a3270000-0327-0327-0327-a32700000001'),
  2, 'procurement_manager (non-member) reads the project categories via the new arm');

set local "request.jwt.claims" = '{"sub": "32700000-0327-0327-0327-327000000003"}';
select is(
  (select count(*)::int from public.project_categories
     where project_id='a3270000-0327-0327-0327-a32700000001'),
  2, 'member PM still reads the project categories (membership path unchanged)');

set local "request.jwt.claims" = '{"sub": "32700000-0327-0327-0327-327000000004"}';
select is(
  (select count(*)::int from public.project_categories
     where project_id='a3270000-0327-0327-0327-a32700000001'),
  0, 'non-member PM still reads ZERO (no wide-open widening)');

-- Unbound caller (no sub claim): current_user_role() is NULL — NULL = ANY(...)
-- must not open the gate (rls-self-check-coalesce class), can_see_project false.
set local "request.jwt.claims" = '{}';
select is(
  (select count(*)::int from public.project_categories
     where project_id='a3270000-0327-0327-0327-a32700000001'),
  0, 'unbound authenticated caller reads ZERO (NULL-role does not open the arm)');

reset role;

select is(
  has_table_privilege('anon', 'public.project_categories', 'SELECT'),
  false, 'anon still has no SELECT privilege at all');

select * from finish();
rollback;
