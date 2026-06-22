begin;
select plan(11);

-- ============================================================================
-- Spec 181 U1 — procurement plans supply in the PM's stead. Procurement is
-- cross-project (NOT a project member); its arm on the supply-plan RPCs + read
-- RLS carries no membership gate (spec 171/172 pattern). It can create / add /
-- remove / submit + READ a plan, but CANNOT approve (PD/super only). A non-member
-- PM stays denied — the procurement arm did not widen PM.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111181', 'proc@sp181.local',  '{}'::jsonb),
  ('a2222222-2222-2222-2222-222222222181', 'pmout@sp181.local', '{}'::jsonb);
update public.users set role='procurement'     where id='a1111111-1111-1111-1111-111111111181';
update public.users set role='project_manager' where id='a2222222-2222-2222-2222-222222222181';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000181', 'SP181', 'แผนจัดหา procurement 181');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000181', 'aa000000-0000-0000-0000-000000000181', 'WP181', 'งาน 181');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000181', 'electrical', 'วัสดุ 181', 'ชิ้น', true);
-- No project_members row for either user: both are non-members. Procurement is
-- admitted by its cross-project arm; the PM is not.

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. anon still cannot execute the widened RPCs (CREATE OR REPLACE preserves the
--    revoke; no Supabase default-priv re-grant like a DROP+CREATE would risk).
select is(has_function_privilege('anon', 'public.create_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute create_supply_plan');
select is(has_function_privilege('anon', 'public.submit_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute submit_supply_plan');

set local role authenticated;

-- B. procurement (cross-project, non-member) drives the plan in PM's stead.
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111181"}';
select isnt(
  (select public.create_supply_plan('aa000000-0000-0000-0000-000000000181')),
  null, 'procurement (non-member) creates a plan');
select is(
  (select count(*)::int from public.supply_plans where project_id='aa000000-0000-0000-0000-000000000181'),
  1, 'procurement reads the plan (RLS procurement arm)');
select isnt(
  (select public.add_supply_plan_line(
     (select id from public.supply_plans where project_id='aa000000-0000-0000-0000-000000000181'),
     'ee000000-0000-0000-0000-000000000181', 'cc000000-0000-0000-0000-000000000181', 10, null)),
  null, 'procurement adds a plan line');
select is(
  (select count(*)::int from public.supply_plan_lines l
     join public.supply_plans sp on sp.id = l.supply_plan_id
    where sp.project_id='aa000000-0000-0000-0000-000000000181'),
  1, 'procurement reads the plan line (RLS procurement arm)');
select lives_ok(
  $$ select public.remove_supply_plan_line(
       (select l.id from public.supply_plan_lines l
          join public.supply_plans sp on sp.id = l.supply_plan_id
         where sp.project_id='aa000000-0000-0000-0000-000000000181' limit 1)) $$,
  'procurement removes a plan line');
select lives_ok(
  $$ select public.submit_supply_plan(
       (select id from public.supply_plans where project_id='aa000000-0000-0000-0000-000000000181')) $$,
  'procurement submits the plan (PM stead)');
select is(
  (select status::text from public.supply_plans where project_id='aa000000-0000-0000-0000-000000000181'),
  'submitted', 'plan is now submitted');
select throws_ok(
  $$ select public.approve_supply_plan(
       (select id from public.supply_plans where project_id='aa000000-0000-0000-0000-000000000181')) $$,
  '42501', null, 'procurement CANNOT approve (PD/super only — separation of duties)');

-- C. A non-member PM stays denied (the procurement arm did not widen PM).
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222181"}';
select throws_ok(
  $$ select public.create_supply_plan('aa000000-0000-0000-0000-000000000181') $$,
  '42501', null, 'non-member PM create still denied');

reset role;

select * from finish();
rollback;
