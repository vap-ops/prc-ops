begin;
select plan(18);

-- ============================================================================
-- Spec 367 §10.4 — `set_equipment_acquisition`, the write path for
-- `acquisition_cost` + `acquired_at`.
--
-- Why it must be a DEFINER RPC and not a plain UPDATE: both columns are
-- MONEY-WALLED. `equipment_items` is column-granted (ADR 0055 decision 6) and
-- neither column carries ANY grant to `authenticated` — so an RLS-client write
-- 42501s and an RLS-client read returns nothing. That wall is why the CSV
-- importer refuses a filled price cell (spec 367 U3) and why the PRI transfer
-- schedule (§3) has had no way to record what the fleet cost.
--
-- What this file guards, in the order the traps actually bite:
--
--   1. The wall STAYS. Every assertion about the RPC is worthless if a future
--      blanket `grant update on equipment_items` quietly opens the columns, so
--      the negative pins come first.
--   2. The function is DEFINER, executable by `authenticated`, and NOT by
--      `anon`/PUBLIC — the default-grant hazard this repo has been bitten by.
--   3. The gate is asserted BEHAVIOURALLY by impersonation, not by grepping the
--      body: a role list in a body can be reached through a helper, and a body
--      scan cannot see that.
--   4. Every accepted write leaves an `audit_log` row under its OWN action.
--      `equipment_rate_change` was deliberately NOT reused: equipment_item_history
--      hardcodes that action's kind as `rate_change`, which the UI renders as a
--      RENT change — a cost filed there would be a true row with a false label.
--   5. Refusals are typed: a negative cost and a future acquisition date are
--      P0001 (fixable input), a caller outside the money audience is 42501.
--
-- Fixtures reuse whatever category/owner the live DB already has rather than
-- creating them: `equipment_owners` is id-mirrored into `suppliers` (spec 275),
-- so inventing one here would need both halves and would drift from the real
-- shape. Only the SKU and the item are created, and both are rolled back.
-- ============================================================================

create temporary table t367c (k text primary key, v uuid) on commit drop;
-- The assertions below run under `set local role authenticated`, and a temp table
-- is NOT readable by that role by default — the same trap as the `_tap_buf` grant
-- below. Without this the whole file errors 42501 before an assertion runs.
grant select on t367c to authenticated;

insert into t367c (k, v)
select 'cat', id from public.equipment_categories order by name limit 1;
insert into t367c (k, v)
select 'owner', id from public.equipment_owners order by name limit 1;
insert into t367c (k, v)
select 'author', id from public.users order by created_at limit 1;
-- The money audience is the five back-office roles; pick a REAL member so the
-- happy path runs as a principal production actually has.
insert into t367c (k, v)
select 'money_actor', id from public.users
 where role in ('project_manager', 'super_admin', 'procurement',
                'procurement_manager', 'project_director')
 order by created_at limit 1;
-- ...and a real caller OUTSIDE it. site_admin can MOVE equipment
-- (EQUIPMENT_MOVE_ROLES) but must never reach the money.
insert into t367c (k, v)
select 'outsider', id from public.users where role = 'site_admin'
 order by created_at limit 1;

insert into t367c (k, v) values ('sku', gen_random_uuid()), ('item', gen_random_uuid());

insert into public.equipment_catalog_items (id, name, category_id, default_tracking, created_by)
select (select v from t367c where k = 'sku'),
       'test-367c-sku ' || (select v from t367c where k = 'sku'),
       (select v from t367c where k = 'cat'), 'unit',
       (select v from t367c where k = 'author');

insert into public.equipment_items
  (id, name, category_id, owner_id, supplier_id, tracking, status,
   equipment_catalog_item_id, created_by)
select (select v from t367c where k = 'item'),
       'test-367c-item No.1',
       (select v from t367c where k = 'cat'),
       (select v from t367c where k = 'owner'),
       (select v from t367c where k = 'owner'),
       'unit', 'available',
       (select v from t367c where k = 'sku'),
       (select v from t367c where k = 'author');

-- ============================================================================
-- A. The money wall stays shut (the assertions everything else depends on).
-- ============================================================================
select is(has_column_privilege('authenticated', 'public.equipment_items', 'acquisition_cost', 'UPDATE'),
  false, 'authenticated may NOT write acquisition_cost directly - the RPC is the only door');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'acquisition_cost', 'SELECT'),
  false, 'authenticated may NOT read acquisition_cost - money stays admin-seam only');
select is(has_column_privilege('authenticated', 'public.equipment_items', 'acquired_at', 'UPDATE'),
  false, 'authenticated may NOT write acquired_at directly');

-- ============================================================================
-- B. The function's shape and its execute posture.
-- ============================================================================
select has_function('public', 'set_equipment_acquisition',
  array['uuid', 'numeric', 'date'],
  'set_equipment_acquisition(uuid, numeric, date) exists');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_equipment_acquisition'),
  true, 'it is SECURITY DEFINER - it exists to cross the money wall');
select is(
  has_function_privilege('authenticated', 'public.set_equipment_acquisition(uuid, numeric, date)', 'EXECUTE'),
  true, 'authenticated may execute it (the gate is inside)');
-- has_function_privilege resolves PUBLIC through role inheritance, which is the
-- form that actually catches the default grant (the bespoke role_routine_grants
-- variant cannot - spec 363 U2a).
select is(
  has_function_privilege('anon', 'public.set_equipment_acquisition(uuid, numeric, date)', 'EXECUTE'),
  false, 'anon may NOT execute it - signed-out callers never reach the money');

-- The runner rewrites every assertion into `insert into _tap_buf(...)`, and the
-- assertions below EXECUTE while role = authenticated, which has no INSERT on a
-- fresh temp table. Without these grants the first post-switch assertion aborts
-- 42501 and the whole file reports `not ok` with ZERO assertions run (which is
-- exactly how this file failed twice before the grants were added).
-- Convention carried by ~205 test files; memory: pgtap-tapbuf-grant-role-switch.
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- C. The gate, driven behaviourally as a real non-member.
-- ============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from t367c where k = 'outsider'))::text, true);
set local role authenticated;

select throws_ok(
  format($$select public.set_equipment_acquisition(%L::uuid, 1000, '2026-01-01'::date)$$,
         (select v from t367c where k = 'item')),
  '42501',
  null,
  'a site_admin - who may move equipment - is refused the money 42501');

reset role;

-- ============================================================================
-- D. The happy path, as a real back-office user.
-- ============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from t367c where k = 'money_actor'))::text, true);
set local role authenticated;

select lives_ok(
  format($$select public.set_equipment_acquisition(%L::uuid, 12500.50, '2025-03-04'::date)$$,
         (select v from t367c where k = 'item')),
  'a back-office caller may record cost + acquired-on');

reset role;

select is(
  (select acquisition_cost from public.equipment_items
    where id = (select v from t367c where k = 'item')),
  12500.50::numeric,
  'the cost landed');
select is(
  (select acquired_at from public.equipment_items
    where id = (select v from t367c where k = 'item')),
  '2025-03-04'::date,
  'the acquisition date landed');

-- Null CLEARS rather than "leave unchanged": one meaning per argument, so the
-- caller can never wonder which it got (the collapsed-semantics rule).
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from t367c where k = 'money_actor'))::text, true);
set local role authenticated;

select lives_ok(
  format($$select public.set_equipment_acquisition(%L::uuid, null, null)$$,
         (select v from t367c where k = 'item')),
  'nulls are accepted and CLEAR both columns');

reset role;

select is(
  (select acquisition_cost from public.equipment_items
    where id = (select v from t367c where k = 'item')),
  null::numeric,
  'a null cost clears the column rather than leaving the old value');

-- The app relies on the DEFAULTs: supabase's type generator emits a parameter as
-- optional only when it carries one, so setEquipmentAcquisition OMITS a blank
-- field rather than sending an explicit null. Pin that the omitted form is the
-- clearing form, or a future signature edit silently turns "clear" into a no-op.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from t367c where k = 'money_actor'))::text, true);
set local role authenticated;

select lives_ok(
  format($$select public.set_equipment_acquisition(p_id => %L::uuid)$$,
         (select v from t367c where k = 'item')),
  'the 1-arg form is callable - both value params default to null (= clear)');

reset role;

-- ============================================================================
-- E. The audit trail, under its OWN action.
-- ============================================================================
select is(
  (select count(*)::int from public.audit_log
    where target_table = 'equipment_items'
      and target_id = (select v from t367c where k = 'item')
      and action = 'equipment_acquisition_change'),
  3,
  'every accepted write left an audit row under equipment_acquisition_change');

-- ============================================================================
-- F. Typed refusals - a fixable input is P0001, not a generic failure.
-- ============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from t367c where k = 'money_actor'))::text, true);
set local role authenticated;

select throws_ok(
  format($$select public.set_equipment_acquisition(%L::uuid, -1, null)$$,
         (select v from t367c where k = 'item')),
  'P0001',
  null,
  'a negative cost is refused');
select throws_ok(
  format($$select public.set_equipment_acquisition(%L::uuid, 100,
            ((now() at time zone 'Asia/Bangkok')::date + 1))$$,
         (select v from t367c where k = 'item')),
  'P0001',
  null,
  'a future acquisition date is refused - Bangkok civil date, not UTC');
select throws_ok(
  $$select public.set_equipment_acquisition(
      '00000000-0000-4000-8000-0000000000ff'::uuid, 100, null)$$,
  'P0001',
  null,
  'an unknown item is refused explicitly (DEFINER bypasses RLS, so it must probe)');

reset role;

select * from finish();
rollback;
