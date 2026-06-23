begin;
select plan(6);

-- ============================================================================
-- Spec 189 U1 — multi-supply-plan: a project may have MANY supply plans.
-- create_supply_plan changes from get-or-create (idempotent) to always-create a
-- new draft; the one-plan-per-project unique constraint is dropped. The planner
-- tier + membership gates are unchanged.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1911111-1111-1111-1111-111111111191', 'super@sp191.local', '{}'::jsonb),
  ('a2911111-1111-1111-1111-111111111191', 'sa@sp191.local',    '{}'::jsonb),
  ('a3911111-1111-1111-1111-111111111191', 'pm@sp191.local',    '{}'::jsonb);
update public.users set role='super_admin'     where id='a1911111-1111-1111-1111-111111111191';
update public.users set role='site_admin'      where id='a2911111-1111-1111-1111-111111111191';
update public.users set role='project_manager' where id='a3911111-1111-1111-1111-111111111191';

insert into public.projects (id, code, name) values
  ('aa911111-0000-0000-0000-000000000191', 'SP191', 'multi-plan 191');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- 1. anon cannot execute the RPC.
select is(has_function_privilege('anon', 'public.create_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute create_supply_plan');

-- super_admin sees all projects (no membership needed) — the happy planner path.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1911111-1111-1111-1111-111111111191"}';

-- 2. Two calls now create TWO DISTINCT plans (no longer idempotent).
select isnt(
  (select public.create_supply_plan('aa911111-0000-0000-0000-000000000191')),
  (select public.create_supply_plan('aa911111-0000-0000-0000-000000000191')),
  'two calls create distinct plans (no longer get-or-create)');

-- 3. Both plans persisted for the project (the unique(project_id) is gone).
select is(
  (select count(*)::int from public.supply_plans where project_id='aa911111-0000-0000-0000-000000000191'),
  2, 'both plans persisted for the project');

-- 4. site_admin is not a planner — role gate.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2911111-1111-1111-1111-111111111191"}';
select throws_ok(
  $$ select public.create_supply_plan('aa911111-0000-0000-0000-000000000191') $$,
  '42501', null, 'site_admin cannot create a supply plan (role gate)');

-- 5. A PM who is not a project member is blocked — membership gate.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3911111-1111-1111-1111-111111111191"}';
select throws_ok(
  $$ select public.create_supply_plan('aa911111-0000-0000-0000-000000000191') $$,
  '42501', null, 'a non-member PM is blocked (membership gate)');

-- 6. Unknown project rejected.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1911111-1111-1111-1111-111111111191"}';
select throws_ok(
  $$ select public.create_supply_plan('00000000-0000-0000-0000-0000000000ff') $$,
  '22023', null, 'unknown project rejected (22023)');

reset role;

select * from finish();
rollback;
