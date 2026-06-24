begin;
select plan(20);

-- ============================================================================
-- Spec 195 Phase 1 / ADR 0063 — project-level purchasing: a purchase request's
-- work package is OPTIONAL. The PR is scoped to a project (project_id NOT NULL);
-- work_package_id is nullable. This file proves the security-sensitive parts:
--
--   * SELECT gains an `OR can_see_project(project_id)` arm so a WP-less PR is
--     visible to project members / project-view roles — WITHOUT widening
--     WP-bound PR visibility (for a WP-bound row can_see_project(project_id) is
--     exactly can_see_wp(work_package_id), the same project) and keeping the
--     requester self-read + procurement cross-project read.
--   * INSERT gains a parallel WP-less arm: the sa/pm/super/director set may
--     raise a WP-less PR gated on can_see_project(project_id), beside the
--     existing WP-bound can_see_wp arm and the procurement cross-project arm.
--   * A BEFORE INSERT trigger derives project_id from the WP for a WP-bound PR
--     (so it can never carry a mismatched project_id, and a WP-bound insert may
--     omit project_id entirely).
--
-- Roles: super (all), pm_member (lead of P1), pm_other (on nothing),
-- site_member (member of P1), site_other (nothing), procurement (all),
-- visitor (nothing). P1 has involvement; P2 has none.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@p195.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pmmem@p195.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'pmoth@p195.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555555555', 'sitem@p195.local', '{}'::jsonb),
  ('66666666-6666-6666-6666-666666666666', 'sitoth@p195.local', '{}'::jsonb),
  ('77777777-7777-7777-7777-777777777777', 'proc@p195.local', '{}'::jsonb),
  ('88888888-8888-8888-8888-888888888888', 'vis@p195.local', '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111111111';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333333';
update public.users set role='project_manager' where id='44444444-4444-4444-4444-444444444444';
update public.users set role='site_admin'      where id='55555555-5555-5555-5555-555555555555';
update public.users set role='site_admin'      where id='66666666-6666-6666-6666-666666666666';
update public.users set role='procurement'     where id='77777777-7777-7777-7777-777777777777';
-- '8888…' stays visitor.

-- P1: lead = pm_member; member = site_member. P2: nobody.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'PRC-195-P1', 'โครงการหนึ่ง',
   '33333333-3333-3333-3333-333333333333'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'PRC-195-P2', 'โครงการสอง', null);

insert into public.project_members (project_id, user_id, added_by) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   '55555555-5555-5555-5555-555555555555',
   '11111111-1111-1111-1111-111111111111');

insert into public.work_packages (id, project_id, code, name) values
  ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'WP-1', 'งานหนึ่ง');

-- Seed PRs (as postgres — bypasses RLS; the BEFORE INSERT trigger still fires).
--   pr_wpless_p1  — project P1, no WP (the new shape).
--   pr_wpbound_p1 — project P1, bound to WP1 (classic shape; visibility unchanged).
--   pr_wpless_p2  — project P2, no WP (a non-member must NOT see it).
insert into public.purchase_requests
  (id, project_id, work_package_id, item_description, quantity, unit, requested_by)
values
  ('d1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', null,
   'Cement (store)', 10, 'bag', '11111111-1111-1111-1111-111111111111'),
  ('d2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
   'Rebar (WP-bound)', 50, 'rod', '11111111-1111-1111-1111-111111111111'),
  ('d3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', null,
   'Sand (P2 store)', 5, 'tonne', '11111111-1111-1111-1111-111111111111');

-- ============================================================================
-- A. Policy wiring (catalog) — the new arm is present, the old arms are kept.
-- ============================================================================
select ok((select qual from pg_policies where tablename='purchase_requests'
             and policyname='purchase_requests select own or privileged') like '%can_see_project%',
  'PR SELECT gains the can_see_project arm (WP-less visibility)');
select ok((select qual from pg_policies where tablename='purchase_requests'
             and policyname='purchase_requests select own or privileged') like '%can_see_wp%',
  'PR SELECT keeps the can_see_wp arm (WP-bound visibility unchanged)');
select ok((select with_check from pg_policies where tablename='purchase_requests'
             and policyname='purchase_requests insert by wp-readers') like '%can_see_project%',
  'PR INSERT gains the can_see_project arm (WP-less insert)');
select ok((select with_check from pg_policies where tablename='purchase_requests'
             and policyname='purchase_requests insert by wp-readers') like '%can_see_wp%',
  'PR INSERT keeps the can_see_wp arm (WP-bound insert gate)');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- B. SELECT visibility.
-- ============================================================================

-- pm_member (lead of P1) sees both P1 PRs (WP-less via project arm, WP-bound
-- unchanged) but NOT P2's WP-less PR.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select is((select count(*)::int from public.purchase_requests
            where id='d1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 1,
  'pm_member sees the WP-less P1 PR (can_see_project arm)');
select is((select count(*)::int from public.purchase_requests
            where id='d2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 1,
  'pm_member sees the WP-bound P1 PR (can_see_wp arm, unchanged)');
select is((select count(*)::int from public.purchase_requests
            where id='d3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  'pm_member does NOT see the WP-less P2 PR (not a member of P2)');

-- pm_other (on nothing) sees neither P1 PR — the project arm did NOT widen
-- visibility to a non-member, and the WP-bound row is still scoped.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is((select count(*)::int from public.purchase_requests
            where id='d1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  'pm_other does NOT see the WP-less P1 PR (no membership)');
select is((select count(*)::int from public.purchase_requests
            where id='d2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  'pm_other does NOT see the WP-bound P1 PR (WP-bound visibility not widened)');

-- site_member (member of P1) sees the WP-less P1 PR.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555"}';
select is((select count(*)::int from public.purchase_requests
            where id='d1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 1,
  'site_member (project_members) sees the WP-less P1 PR');

-- procurement sees the WP-less P1 PR (cross-project arm).
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777777"}';
select is((select count(*)::int from public.purchase_requests
            where id='d1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 1,
  'procurement sees the WP-less P1 PR (cross-project read)');

-- visitor sees none of the three.
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';
select is((select count(*)::int from public.purchase_requests
            where id in ('d1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         'd2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         'd3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa')), 0,
  'visitor sees no purchase_requests');

-- ============================================================================
-- C. INSERT — WP-less arm gated on can_see_project; WP-bound arm unchanged.
-- ============================================================================

-- pm_member may raise a WP-less PR for P1 (lead → can_see_project true).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ insert into public.purchase_requests
       (project_id, item_description, quantity, unit, requested_by)
     values ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid,
             'Plywood', 4, 'sheet', '33333333-3333-3333-3333-333333333333'::uuid) $$,
  'pm_member inserts a WP-less PR for a project it can see');

-- pm_other may NOT raise a WP-less PR for P1 (can_see_project false → 42501).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ insert into public.purchase_requests
       (project_id, item_description, quantity, unit, requested_by)
     values ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid,
             'Plywood', 4, 'sheet', '44444444-4444-4444-4444-444444444444'::uuid) $$,
  '42501', null,
  'pm_other is denied a WP-less PR for a project it cannot see');

-- site_member may raise a WP-less PR for P1 (member → can_see_project true).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555"}';
select lives_ok(
  $$ insert into public.purchase_requests
       (project_id, item_description, quantity, unit, requested_by)
     values ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid,
             'Nails', 5, 'kg', '55555555-5555-5555-5555-555555555555'::uuid) $$,
  'site_member inserts a WP-less PR for a project it is a member of');

-- procurement may raise a WP-less PR for any project (cross-project arm).
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777777"}';
select lives_ok(
  $$ insert into public.purchase_requests
       (project_id, item_description, quantity, unit, requested_by)
     values ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid,
             'Paint', 2, 'litre', '77777777-7777-7777-7777-777777777777'::uuid) $$,
  'procurement inserts a WP-less PR (cross-project, no membership gate)');

-- visitor may NOT raise a WP-less PR.
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';
select throws_ok(
  $$ insert into public.purchase_requests
       (project_id, item_description, quantity, unit, requested_by)
     values ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid,
             'Nails', 5, 'kg', '88888888-8888-8888-8888-888888888888'::uuid) $$,
  '42501', null,
  'visitor is denied a WP-less PR');

-- WP-bound insert is still gated on can_see_wp: pm_other cannot insert against
-- a WP it cannot see (the project arm did not loosen the WP-bound path).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid,
             'Steel', 3, 'rod', '44444444-4444-4444-4444-444444444444'::uuid) $$,
  '42501', null,
  'pm_other is denied a WP-bound PR for a WP it cannot see (can_see_wp gate kept)');

-- ============================================================================
-- D. Derive trigger — project_id is authoritatively the WP's project.
-- ============================================================================

-- super inserts a WP-bound PR but passes a WRONG project_id (P2). The trigger
-- overwrites it to the WP's project (P1).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
insert into public.purchase_requests
  (id, work_package_id, project_id, item_description, quantity, unit, requested_by)
values
  ('e1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
   'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid,
   'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid,
   'Tile', 8, 'box', '11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (select project_id::text from public.purchase_requests
     where id='e1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  'trigger overwrites a mismatched project_id to the WP''s project');

-- super inserts a WP-bound PR OMITTING project_id; the trigger fills it before
-- the NOT NULL constraint is checked (so the insert lives + project_id = P1).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by)
values
  ('e2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
   'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid,
   'Grout', 2, 'bag', '11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (select project_id::text from public.purchase_requests
     where id='e2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  'trigger fills an omitted project_id from the WP (NOT NULL satisfied)');

reset role;

select * from finish();
rollback;
