begin;
select plan(21);

-- ============================================================================
-- Spec 205 U1 — per-WP labor budget. wp_economics gains a money (baht)
--   labor_budget column (zero-grant, like budget) + set_wp_labor_budget. The
--   setter is PM + DIRECTOR + super (the PM or PD sets the labor cost ceiling —
--   names project_manager, so project_director rides along, ADR 0058 / file 90).
--   Upsert preserves budget + is_external. labor_budget is a display target only
--   (not read into wp_profit). Mirrors file 99 (wp_economics).
--   Hardening (20260813002300): anon has NO execute (revoked) and the gate is
--   null-safe — a null-role/anon session is rejected, not let through.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110205', 'super@wlb.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550205', 'dir@wlb.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330205', 'pm@wlb.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220205', 'sa@wlb.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880205', 'vis@wlb.local',   '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110205';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550205';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330205';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220205';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('a1a10205-0205-0205-0205-a1a1a1a10205', 'PRC-205-P1', 'โครงการ');
insert into public.work_packages (id, project_id, code, name) values
  ('c0010205-0205-0205-0205-c0c0c0c10205', 'a1a10205-0205-0205-0205-a1a1a1a10205', 'WP-1', 'งานหนึ่ง');

-- A. Catalog + money posture for the new column (as owner).
select has_column('public', 'wp_economics', 'labor_budget', 'has labor_budget');
select col_has_check('public', 'wp_economics', 'labor_budget',
  'labor_budget carries the non-negative check');
select ok(not has_column_privilege('authenticated', 'public.wp_economics', 'labor_budget', 'SELECT'),
  'authenticated has no SELECT on labor_budget (it is money)');
-- Execute lockdown (hardening 20260813002300): anon must never reach the setter;
-- authenticated keeps it (the app call path). Guards a future DROP+CREATE.
select is(
  has_function_privilege('anon', 'public.set_wp_labor_budget(uuid, numeric)', 'EXECUTE'),
  false, 'anon cannot execute set_wp_labor_budget (money write)');
select is(
  has_function_privilege('authenticated', 'public.set_wp_labor_budget(uuid, numeric)', 'EXECUTE'),
  true, 'authenticated can execute set_wp_labor_budget');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- Seed budget (PD) + is_external (PM) first, to prove the labor_budget upsert
-- preserves them later. These are real setters, asserted as such.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550205"}';
select lives_ok(
  $$ select public.set_wp_budget('c0010205-0205-0205-0205-c0c0c0c10205', 100000) $$,
  'project_director seeds the WP budget (revenue side)');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330205"}';
select lives_ok(
  $$ select public.set_wp_external('c0010205-0205-0205-0205-c0c0c0c10205', true) $$,
  'project_manager marks the WP external');

-- B. set_wp_labor_budget — PM + director + super.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330205"}';
select lives_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', 50000) $$,
  'project_manager sets the labor budget');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550205"}';
select lives_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', 60000) $$,
  'project_director sets the labor budget (rides along, ADR 0058)');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110205"}';
select lives_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', 70000) $$,
  'super_admin re-sets the labor budget (upsert)');
-- 0 is a legitimate value (budgeted-but-zero), distinct from NULL (unset). Set it
-- last so the persisted-state read proves 0 is stored, not coalesced to NULL.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330205"}';
select lives_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', 0) $$,
  'a zero labor budget is accepted (distinct from unset)');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220205"}';
select throws_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', 40000) $$,
  '42501', null, 'site_admin cannot set the labor budget (money)');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880205"}';
select throws_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', 40000) $$,
  '42501', null, 'visitor cannot set the labor budget');
-- Null-safe gate (hardening): a session with no sub → auth.uid() NULL →
-- current_user_role() NULL → must be rejected, not fall through.
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', 40000) $$,
  '42501', null, 'a null-role / anon session is rejected (null-safe gate)');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330205"}';
select throws_ok(
  $$ select public.set_wp_labor_budget('dddddddd-0205-0205-0205-dddddddd0205', 100) $$,
  'P0001', null, 'an unknown WP is rejected');
select throws_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', -1) $$,
  'P0001', null, 'a negative labor budget is rejected');
select throws_ok(
  $$ select public.set_wp_labor_budget('c0010205-0205-0205-0205-c0c0c0c10205', null) $$,
  'P0001', null, 'a null labor budget is rejected');

reset role;

-- C. The upsert kept the last labor budget (0, proving 0 ≠ NULL) and preserved
--    budget + is_external; each successful labor-budget set was audited (owner
--    read — zero grant).
select is(
  (select labor_budget from public.wp_economics where work_package_id='c0010205-0205-0205-0205-c0c0c0c10205'),
  0::numeric, 'labor_budget is the last value set — 0, stored distinct from NULL (upsert)');
select is(
  (select budget from public.wp_economics where work_package_id='c0010205-0205-0205-0205-c0c0c0c10205'),
  100000::numeric, 'budget was preserved by the labor_budget upsert');
select is(
  (select is_external from public.wp_economics where work_package_id='c0010205-0205-0205-0205-c0c0c0c10205'),
  true, 'is_external was preserved by the labor_budget upsert');
select is(
  (select count(*)::int from public.audit_log
     where target_table='wp_economics'
       and target_id='c0010205-0205-0205-0205-c0c0c0c10205'
       and action='update'
       and payload->>'field' = 'labor_budget'),
  4, 'each successful labor-budget set was audited (50k, 60k, 70k, 0)');

select * from finish();
rollback;
