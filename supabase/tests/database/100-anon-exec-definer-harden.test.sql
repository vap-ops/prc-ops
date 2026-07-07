begin;
select plan(24);

-- ============================================================================
-- Security (anon-exec definer sweep, mig 20260813002500). Eight SECURITY DEFINER
-- WRITE rpcs shared the defect class fixed for the wp_economics setters in
-- 20260813002400: anon kept the auto-granted EXECUTE, AND the gate was null-unsafe
-- (`current_user_role() not in (...)` is NULL for anon → no 42501 raise → the body
-- fell through to the write). Combined, an unauthenticated PostgREST call could write
-- the equipment money/usage tables, wp_labor_costs, and the HT/worker assignments,
-- stamping NULL-actor audit rows. This asserts both protections per function:
-- anon EXECUTE revoked, authenticated kept, and a null-role caller refused at the gate.
-- RED before the migration (anon had EXECUTE; the gate fell through to a P0001).
-- ============================================================================

-- A. Privilege lockdown (catalog check — role-independent).
select is(has_function_privilege('anon', 'public.set_equipment_daily_rate(uuid, numeric)', 'EXECUTE'), false, 'anon cannot execute set_equipment_daily_rate');
-- Spec 268 added p_rate_period (6-arg); spec 275 U1 repointed owner->supplier + added
-- deposit/deposit_paid_date/min_rental_days (9-arg).
select is(has_function_privilege('anon', 'public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period, numeric, date, integer)', 'EXECUTE'), false, 'anon cannot execute create_equipment_rental_batch');
select is(has_function_privilege('anon', 'public.create_equipment_project_allocation(uuid, uuid, date, date, text)', 'EXECUTE'), false, 'anon cannot execute create_equipment_project_allocation');
select is(has_function_privilege('anon', 'public.check_out_equipment(uuid, uuid, date)', 'EXECUTE'), false, 'anon cannot execute check_out_equipment');
select is(has_function_privilege('anon', 'public.check_in_equipment(uuid, date)', 'EXECUTE'), false, 'anon cannot execute check_in_equipment');
select is(has_function_privilege('anon', 'public.freeze_wp_labor_cost(uuid)', 'EXECUTE'), false, 'anon cannot execute freeze_wp_labor_cost');
select is(has_function_privilege('anon', 'public.assign_project_ht(uuid, uuid)', 'EXECUTE'), false, 'anon cannot execute assign_project_ht');
select is(has_function_privilege('anon', 'public.assign_worker_to_project(uuid, uuid, text)', 'EXECUTE'), false, 'anon cannot execute assign_worker_to_project');

select is(has_function_privilege('authenticated', 'public.set_equipment_daily_rate(uuid, numeric)', 'EXECUTE'), true, 'authenticated can execute set_equipment_daily_rate');
select is(has_function_privilege('authenticated', 'public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period, numeric, date, integer)', 'EXECUTE'), true, 'authenticated can execute create_equipment_rental_batch');
select is(has_function_privilege('authenticated', 'public.create_equipment_project_allocation(uuid, uuid, date, date, text)', 'EXECUTE'), true, 'authenticated can execute create_equipment_project_allocation');
select is(has_function_privilege('authenticated', 'public.check_out_equipment(uuid, uuid, date)', 'EXECUTE'), true, 'authenticated can execute check_out_equipment');
select is(has_function_privilege('authenticated', 'public.check_in_equipment(uuid, date)', 'EXECUTE'), true, 'authenticated can execute check_in_equipment');
select is(has_function_privilege('authenticated', 'public.freeze_wp_labor_cost(uuid)', 'EXECUTE'), true, 'authenticated can execute freeze_wp_labor_cost');
select is(has_function_privilege('authenticated', 'public.assign_project_ht(uuid, uuid)', 'EXECUTE'), true, 'authenticated can execute assign_project_ht');
select is(has_function_privilege('authenticated', 'public.assign_worker_to_project(uuid, uuid, text)', 'EXECUTE'), true, 'authenticated can execute assign_worker_to_project');

-- B. Null-safe gate: a session with no sub → auth.uid() NULL → current_user_role()
--    NULL → each fn must REJECT with 42501 (not fall through to a P0001 not-found).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{}';

select throws_ok($$ select public.set_equipment_daily_rate('00000000-0000-0000-0000-000000000000', 1) $$, '42501', null, 'null-role refused: set_equipment_daily_rate');
select throws_ok($$ select public.create_equipment_rental_batch('00000000-0000-0000-0000-000000000000', 1, '2026-01-01') $$, '42501', null, 'null-role refused: create_equipment_rental_batch');
select throws_ok($$ select public.create_equipment_project_allocation('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', '2026-01-01') $$, '42501', null, 'null-role refused: create_equipment_project_allocation');
select throws_ok($$ select public.check_out_equipment('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', '2026-01-01') $$, '42501', null, 'null-role refused: check_out_equipment');
select throws_ok($$ select public.check_in_equipment('00000000-0000-0000-0000-000000000000', '2026-01-01') $$, '42501', null, 'null-role refused: check_in_equipment');
select throws_ok($$ select public.freeze_wp_labor_cost('00000000-0000-0000-0000-000000000000') $$, '42501', null, 'null-role refused: freeze_wp_labor_cost');
select throws_ok($$ select public.assign_project_ht('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000') $$, '42501', null, 'null-role refused: assign_project_ht');
select throws_ok($$ select public.assign_worker_to_project('00000000-0000-0000-0000-000000000000') $$, '42501', null, 'null-role refused: assign_worker_to_project');

reset role;

select * from finish();
rollback;
