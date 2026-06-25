begin;
select plan(25);

-- ============================================================================
-- Spec 161 U2 / ADR 0060 — WP economic identity. wp_economics (one row per WP,
--   zero-grant MONEY table) holds the PD-set `budget` (the profit denominator,
--   hidden from non-HT DCs) + the internal/external flag. set_wp_budget is
--   PROJECT_DIRECTOR + super only (the PD sets budget, §1 — no project_manager
--   ref); set_wp_external is pm + director + super (PM classifies — director
--   rides along, ADR 0058). Setters upsert + preserve the other column. Nothing
--   reads these into a profit number yet (U3).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110199', 'super@wpe.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550199', 'dir@wpe.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330199', 'pm@wpe.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220199', 'sa@wpe.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880199', 'vis@wpe.local',   '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110199';
update public.users set role='project_director'  where id='55555555-5555-5555-5555-555555550199';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330199';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220199';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('a1a10199-0199-0199-0199-a1a1a1a10199', 'PRC-199-P1', 'โครงการ');
insert into public.work_packages (id, project_id, code, name) values
  ('c0010199-0199-0199-0199-c0c0c0c10199', 'a1a10199-0199-0199-0199-a1a1a1a10199', 'WP-1', 'งานหนึ่ง');

-- A. Catalog + money posture (as owner).
select has_table('public', 'wp_economics', 'wp_economics table exists');
select col_is_pk('public', 'wp_economics', 'work_package_id', 'work_package_id is the PK');
select fk_ok('public', 'wp_economics', 'work_package_id', 'public', 'work_packages', 'id',
  'work_package_id FK references work_packages.id');
select has_column('public', 'wp_economics', 'budget', 'has budget');
select has_column('public', 'wp_economics', 'is_external', 'has is_external');
select ok(not has_table_privilege('authenticated', 'public.wp_economics', 'SELECT'),
  'authenticated has no SELECT on wp_economics (budget is money)');
-- Execute lockdown (hardening 20260813002400): anon must never reach either money
-- setter; authenticated keeps it (the app call path). The original 20260761000000
-- did NO grant management, so Supabase's ALTER DEFAULT PRIVILEGES left anon with
-- EXECUTE on both. Mirrors file 226 (set_wp_labor_budget). Guards a future
-- DROP+CREATE that would re-open the hole.
select is(
  has_function_privilege('anon', 'public.set_wp_budget(uuid, numeric)', 'EXECUTE'),
  false, 'anon cannot execute set_wp_budget (money write)');
select is(
  has_function_privilege('authenticated', 'public.set_wp_budget(uuid, numeric)', 'EXECUTE'),
  true, 'authenticated can execute set_wp_budget');
select is(
  has_function_privilege('anon', 'public.set_wp_external(uuid, boolean)', 'EXECUTE'),
  false, 'anon cannot execute set_wp_external (money-table write)');
select is(
  has_function_privilege('authenticated', 'public.set_wp_external(uuid, boolean)', 'EXECUTE'),
  true, 'authenticated can execute set_wp_external');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- B. set_wp_budget — project_director + super only (PD sets budget).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550199"}';
select lives_ok(
  $$ select public.set_wp_budget('c0010199-0199-0199-0199-c0c0c0c10199', 100000) $$,
  'project_director sets the WP budget');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110199"}';
select lives_ok(
  $$ select public.set_wp_budget('c0010199-0199-0199-0199-c0c0c0c10199', 120000) $$,
  'super_admin re-sets the WP budget (upsert)');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330199"}';
select throws_ok(
  $$ select public.set_wp_budget('c0010199-0199-0199-0199-c0c0c0c10199', 90000) $$,
  '42501', null, 'project_manager cannot set the budget (PD only)');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880199"}';
select throws_ok(
  $$ select public.set_wp_budget('c0010199-0199-0199-0199-c0c0c0c10199', 90000) $$,
  '42501', null, 'visitor cannot set the budget');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550199"}';
select throws_ok(
  $$ select public.set_wp_budget('dddddddd-0199-0199-0199-dddddddd0199', 100) $$,
  'P0001', null, 'an unknown WP is rejected');
select throws_ok(
  $$ select public.set_wp_budget('c0010199-0199-0199-0199-c0c0c0c10199', -1) $$,
  'P0001', null, 'a negative budget is rejected');

-- C. set_wp_external — pm + director + super (PM classifies).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330199"}';
select lives_ok(
  $$ select public.set_wp_external('c0010199-0199-0199-0199-c0c0c0c10199', true) $$,
  'project_manager marks the WP external');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220199"}';
select throws_ok(
  $$ select public.set_wp_external('c0010199-0199-0199-0199-c0c0c0c10199', true) $$,
  '42501', null, 'site_admin cannot classify the WP');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880199"}';
select throws_ok(
  $$ select public.set_wp_external('c0010199-0199-0199-0199-c0c0c0c10199', true) $$,
  '42501', null, 'visitor cannot classify the WP');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330199"}';
select throws_ok(
  $$ select public.set_wp_external('dddddddd-0199-0199-0199-dddddddd0199', true) $$,
  'P0001', null, 'an unknown WP is rejected (external)');

-- Null-safe gate (hardening): a session with no sub → auth.uid() NULL →
-- current_user_role() NULL → both setters must REJECT, not fall through into the
-- money write (the original gates evaluated `NULL not in (...)` = NULL = no raise).
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.set_wp_budget('c0010199-0199-0199-0199-c0c0c0c10199', 90000) $$,
  '42501', null, 'a null-role / anon session cannot set the budget (null-safe gate)');
select throws_ok(
  $$ select public.set_wp_external('c0010199-0199-0199-0199-c0c0c0c10199', true) $$,
  '42501', null, 'a null-role / anon session cannot classify the WP (null-safe gate)');

reset role;

-- D. The upsert preserved both inputs; the changes were audited (owner read —
--    zero authenticated grant).
select is(
  (select budget from public.wp_economics where work_package_id='c0010199-0199-0199-0199-c0c0c0c10199'),
  120000::numeric, 'budget is the last value set (upsert)');
select is(
  (select is_external from public.wp_economics where work_package_id='c0010199-0199-0199-0199-c0c0c0c10199'),
  true, 'is_external was set while budget was preserved (upsert)');
select is(
  (select count(*)::int from public.audit_log
     where target_table='wp_economics'
       and target_id='c0010199-0199-0199-0199-c0c0c0c10199' and action='update'),
  3, 'each successful set was audited (2 budget + 1 external)');

select * from finish();
rollback;
