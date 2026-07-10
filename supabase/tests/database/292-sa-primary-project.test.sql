begin;
select plan(27);

-- ============================================================================
-- Spec 292 U1 — SA primary site: project_members.is_primary + the two DEFINER
-- setters (set_primary_project self-serve, set_primary_project_for PM-sets-for-SA).
--
-- A multi-project site_admin pins ONE primary site. The flag lives on the
-- project_members row can_see_project already trusts; "exactly one primary per
-- user" is a partial-unique index (user_id) where is_primary; both setters
-- clear-then-set (a single multi-row UPDATE would transiently hold two true rows
-- and trip the partial-unique index — see The setter in the spec).
--
-- Gates:
--   set_primary_project(p_project)      — caller must be a member of p_project (self-serve).
--   set_primary_project_for(p_user, p_project) — caller ∈ PM_ROLES
--     (project_manager/super_admin/project_director) AND can_see_project(p_project)
--     AND the TARGET is a site_admin member of p_project.
--
-- UUIDs HEX-ONLY (recurring pgTAP lesson).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110292', 'super@sap.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330292', 'pm1@sap.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220292', 'sa1@sap.local',   '{}'::jsonb),
  ('2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292', 'sa2@sap.local',   '{}'::jsonb),
  ('2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0292', 'sa3@sap.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440292', 'tech1@sap.local', '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110292';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330292';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220292';
update public.users set role='site_admin'      where id='2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292';
update public.users set role='site_admin'      where id='2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0292';
update public.users set role='technician'      where id='44444444-4444-4444-4444-444444440292';

-- Two projects.
insert into public.projects (id, code, name) values
  ('a0a00292-0292-0292-0292-a0a0a0a00292', 'PRC-292-A', 'โครงการ A'),
  ('b0b00292-0292-0292-0292-b0b0b0b00292', 'PRC-292-B', 'โครงการ B');

-- Memberships (added_by = super). super is NOT a member (sees all via role).
--   sa1  ∈ A, B    (self-serve subject / multi-project SA)
--   sa2  ∈ A, B    (PM-sets target — has a prior to clear)
--   sa3  ∈ A        (target-not-member-of-B case; non-member self-serve case)
--   pm1  ∈ A        (PM caller WITHOUT can_see_project(B))
--   tech1∈ A        (non-site_admin target case)
insert into public.project_members (project_id, user_id, added_by) values
  ('a0a00292-0292-0292-0292-a0a0a0a00292', '22222222-2222-2222-2222-222222220292', '11111111-1111-1111-1111-111111110292'),
  ('b0b00292-0292-0292-0292-b0b0b0b00292', '22222222-2222-2222-2222-222222220292', '11111111-1111-1111-1111-111111110292'),
  ('a0a00292-0292-0292-0292-a0a0a0a00292', '2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292', '11111111-1111-1111-1111-111111110292'),
  ('b0b00292-0292-0292-0292-b0b0b0b00292', '2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292', '11111111-1111-1111-1111-111111110292'),
  ('a0a00292-0292-0292-0292-a0a0a0a00292', '2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0292', '11111111-1111-1111-1111-111111110292'),
  ('a0a00292-0292-0292-0292-a0a0a0a00292', '33333333-3333-3333-3333-333333330292', '11111111-1111-1111-1111-111111110292'),
  ('a0a00292-0292-0292-0292-a0a0a0a00292', '44444444-4444-4444-4444-444444440292', '11111111-1111-1111-1111-111111110292');

-- ============================================================================
-- Structural — the column, its shape, the partial-unique index, both setters.
-- ============================================================================
select has_column('public', 'project_members', 'is_primary', 'project_members.is_primary exists');
select col_type_is('public', 'project_members', 'is_primary', 'boolean', 'is_primary is boolean');
select col_not_null('public', 'project_members', 'is_primary', 'is_primary is NOT NULL');
select col_default_is('public', 'project_members', 'is_primary', false, 'is_primary defaults to false');
select has_index('public', 'project_members', 'project_members_primary_per_user_idx',
  'partial-unique index (one is_primary per user) exists');
select has_function('public', 'set_primary_project', ARRAY['uuid'],
  'set_primary_project(uuid) exists');
select has_function('public', 'set_primary_project_for', ARRAY['uuid', 'uuid'],
  'set_primary_project_for(uuid, uuid) exists');

-- Grant posture — authenticated executes, anon does not (DEFINER-anon lesson).
select is(has_function_privilege('authenticated', 'public.set_primary_project(uuid)', 'EXECUTE'),
  true, 'authenticated can execute set_primary_project');
select is(has_function_privilege('anon', 'public.set_primary_project(uuid)', 'EXECUTE'),
  false, 'anon cannot execute set_primary_project');
select is(has_function_privilege('authenticated', 'public.set_primary_project_for(uuid, uuid)', 'EXECUTE'),
  true, 'authenticated can execute set_primary_project_for');
select is(has_function_privilege('anon', 'public.set_primary_project_for(uuid, uuid)', 'EXECUTE'),
  false, 'anon cannot execute set_primary_project_for');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- set_primary_project — self-serve (member-gated).
-- ============================================================================
-- A NON-member is rejected (sa3 is not a member of B).
set local "request.jwt.claims" = '{"sub": "2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0292"}';
select throws_ok(
  $$ select public.set_primary_project('b0b00292-0292-0292-0292-b0b0b0b00292') $$,
  '42501', 'set_primary_project: not a project member',
  'set_primary_project: a NON-member is rejected 42501');

-- A member sets their primary.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220292"}';
select lives_ok(
  $$ select public.set_primary_project('a0a00292-0292-0292-0292-a0a0a0a00292') $$,
  'set_primary_project: a MEMBER (sa1) may pin project A');

-- The same member switches to B — clear-then-set must survive the partial-unique
-- index (A cleared before B set; a single multi-row UPDATE would trip 23505).
select lives_ok(
  $$ select public.set_primary_project('b0b00292-0292-0292-0292-b0b0b0b00292') $$,
  'set_primary_project: sa1 switches primary A -> B (clear-then-set, no unique violation)');

-- ============================================================================
-- set_primary_project_for — PM sets an SA's primary.
-- ============================================================================
-- A non-PM caller (sa1 is a site_admin) is rejected regardless of membership.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220292"}';
select throws_ok(
  $$ select public.set_primary_project_for(
       '2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292', 'a0a00292-0292-0292-0292-a0a0a0a00292') $$,
  '42501', 'set_primary_project_for: not permitted',
  'set_primary_project_for: a NON-PM caller (site_admin) is rejected 42501');

-- A PM-tier caller WITHOUT can_see_project(B) is rejected (pm1 is a member of A only).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330292"}';
select throws_ok(
  $$ select public.set_primary_project_for(
       '22222222-2222-2222-2222-222222220292', 'b0b00292-0292-0292-0292-b0b0b0b00292') $$,
  '42501', 'set_primary_project_for: not permitted',
  'set_primary_project_for: a PM without can_see_project is rejected 42501');

-- Give the target (sa2) a prior primary (self-serve) so the _for path can clear it.
set local "request.jwt.claims" = '{"sub": "2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292"}';
select lives_ok(
  $$ select public.set_primary_project('a0a00292-0292-0292-0292-a0a0a0a00292') $$,
  'setup: target sa2 self-pins A (prior primary to be cleared by the PM setter)');

-- A PM-tier caller with can_see_project (super_admin, sees all) sets the TARGET's
-- primary to B — clearing sa2's prior A.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110292"}';
select lives_ok(
  $$ select public.set_primary_project_for(
       '2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292', 'b0b00292-0292-0292-0292-b0b0b0b00292') $$,
  'set_primary_project_for: a PM-tier caller sets the target SA''s primary (clears prior)');

-- Target is not a member of the project (sa3 ∈ A only) → rejected.
select throws_ok(
  $$ select public.set_primary_project_for(
       '2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0292', 'b0b00292-0292-0292-0292-b0b0b0b00292') $$,
  '42501', 'set_primary_project_for: not permitted',
  'set_primary_project_for: a target that is not a member is rejected 42501');

-- Target is a member but not a site_admin (tech1) → rejected.
select throws_ok(
  $$ select public.set_primary_project_for(
       '44444444-4444-4444-4444-444444440292', 'a0a00292-0292-0292-0292-a0a0a0a00292') $$,
  '42501', 'set_primary_project_for: not permitted',
  'set_primary_project_for: a non-site_admin target is rejected 42501');

reset role;

-- ============================================================================
-- State — exactly one primary per user; the switch cleared the prior.
-- ============================================================================
select is(
  (select is_primary from public.project_members
    where user_id='22222222-2222-2222-2222-222222220292'
      and project_id='b0b00292-0292-0292-0292-b0b0b0b00292'),
  true, 'sa1 primary is B after the switch');
select is(
  (select is_primary from public.project_members
    where user_id='22222222-2222-2222-2222-222222220292'
      and project_id='a0a00292-0292-0292-0292-a0a0a0a00292'),
  false, 'sa1 prior primary A was cleared');
select is(
  (select count(*) from public.project_members
    where user_id='22222222-2222-2222-2222-222222220292' and is_primary),
  1::bigint, 'sa1 has exactly one primary');
select is(
  (select is_primary from public.project_members
    where user_id='2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292'
      and project_id='b0b00292-0292-0292-0292-b0b0b0b00292'),
  true, 'sa2 primary is B (set by the PM)');
select is(
  (select is_primary from public.project_members
    where user_id='2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292'
      and project_id='a0a00292-0292-0292-0292-a0a0a0a00292'),
  false, 'sa2 prior primary A was cleared by the PM setter');
select is(
  (select count(*) from public.project_members
    where user_id='2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a0292' and is_primary),
  1::bigint, 'sa2 has exactly one primary');

-- The partial-unique index ENFORCES the invariant: a direct second is_primary for
-- one user (sa1 already primary on B) fails with a unique violation.
select throws_ok(
  $$ update public.project_members set is_primary = true
      where user_id='22222222-2222-2222-2222-222222220292'
        and project_id='a0a00292-0292-0292-0292-a0a0a0a00292' $$,
  '23505', NULL,
  'partial-unique index blocks a second is_primary=true for one user');

select * from finish();
rollback;
