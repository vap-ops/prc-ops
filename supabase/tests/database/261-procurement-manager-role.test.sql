begin;
select plan(22);

-- ============================================================================
-- Spec 261 / ADR 0070 — procurement_manager: full parity with procurement PLUS
-- a manager-only set. Proven three ways:
--   * Completeness (source-scan): NO procurement-gated function/policy is left
--     without procurement_manager (the assertions that cover the whole sweep at
--     once — mirrors the 90-project-director-rpc-gates pin).
--   * Helper behaviour: is_back_office admits it; is_manager does NOT (it is a
--     procurement-dept manager, not a project-manager tier member).
--   * Manager-only set: void PO (tightened OFF plain procurement), void PO charge,
--     and the approved→cancelled PR transition (but NOT the approve transition).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000261-0000-4000-8000-000000000001', 'pm@pm261.local',   '{}'::jsonb),
  ('a2000261-0000-4000-8000-000000000002', 'proc@pm261.local', '{}'::jsonb),
  ('a3000261-0000-4000-8000-000000000003', 'pmgr@pm261.local', '{}'::jsonb),
  ('a4000261-0000-4000-8000-000000000004', 'vis@pm261.local',  '{}'::jsonb);
update public.users set role = 'project_manager'      where id = 'a1000261-0000-4000-8000-000000000001';
update public.users set role = 'procurement'          where id = 'a2000261-0000-4000-8000-000000000002';
update public.users set role = 'procurement_manager'  where id = 'a3000261-0000-4000-8000-000000000003';
-- a4 stays visitor.

insert into public.projects (id, code, name) values
  ('c0000261-0000-4000-8000-000000000001', 'TAP-PM261', 'procurement_manager fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('e0000261-0000-4000-8000-000000000001',
   'c0000261-0000-4000-8000-000000000001', 'WP-PM261', 'pm261 WP', 'in_progress');
insert into public.suppliers (id, name, created_by) values
  ('b0000261-0000-4000-8000-000000000001', 'ร้านทดสอบ 261',
   'a1000261-0000-4000-8000-000000000001');
insert into public.purchase_requests
    (id, work_package_id, project_id, item_description, quantity, unit, status,
     source, requested_by) values
  -- pr-e: approved — procurement_manager bundles it into a PO (parity money path).
  ('fa000261-0000-4000-8000-000000000001',
   'e0000261-0000-4000-8000-000000000001', 'c0000261-0000-4000-8000-000000000001',
   'ปูน', 10, 'ถุง', 'approved', 'app', 'a1000261-0000-4000-8000-000000000001'),
  -- pr-cancel: approved — procurement_manager cancels it (item 3, allowed).
  ('fa000261-0000-4000-8000-000000000002',
   'e0000261-0000-4000-8000-000000000001', 'c0000261-0000-4000-8000-000000000001',
   'เหล็ก', 5, 'เส้น', 'approved', 'app', 'a1000261-0000-4000-8000-000000000001'),
  -- pr-approve: requested — procurement_manager must NOT approve it (item 3 blocked).
  ('fa000261-0000-4000-8000-000000000003',
   'e0000261-0000-4000-8000-000000000001', 'c0000261-0000-4000-8000-000000000001',
   'ทราย', 3, 'คิว', 'requested', 'app', 'a1000261-0000-4000-8000-000000000001'),
  -- pr-pmapprove: requested — PM can still approve (approval path unbroken).
  ('fa000261-0000-4000-8000-000000000004',
   'e0000261-0000-4000-8000-000000000001', 'c0000261-0000-4000-8000-000000000001',
   'ไม้', 2, 'แผ่น', 'requested', 'app', 'a1000261-0000-4000-8000-000000000001');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. The enum value exists.
-- ============================================================================
select ok(
  'procurement_manager' = any(enum_range(null::public.user_role)::text[]),
  'user_role enum contains procurement_manager');

-- ============================================================================
-- B/C. Parity source-scan — completeness (no gate missed).
-- ============================================================================
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%''procurement''%'
      and pg_get_functiondef(p.oid) not ilike '%''procurement_manager''%'),
  0, 'every procurement-gated function also admits procurement_manager');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') ilike '%''procurement''%'
      and coalesce(qual, '') not ilike '%''procurement_manager''%'),
  0, 'every policy USING that names procurement also names procurement_manager');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and coalesce(with_check, '') ilike '%''procurement''%'
      and coalesce(with_check, '') not ilike '%''procurement_manager''%'),
  0, 'every policy WITH CHECK that names procurement also names procurement_manager');

-- ============================================================================
-- D. Shared helpers — is_back_office admits it; is_manager does NOT.
-- ============================================================================
select is(public.is_back_office('procurement_manager'), true,
  'is_back_office admits procurement_manager (whole back-office batch parity)');
select is(public.is_back_office('procurement'), true,
  'is_back_office still admits plain procurement (parity is additive)');
select is(public.is_manager('procurement_manager'), false,
  'is_manager does NOT admit procurement_manager (it is not the project-manager tier)');

-- ============================================================================
-- E. Parity money path — procurement_manager bundles an approved PR into a PO.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3000261-0000-4000-8000-000000000003"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'b0000261-0000-4000-8000-000000000001'::uuid, date '2026-07-25',
       '[{"request_id":"fa000261-0000-4000-8000-000000000001","amount":100}]'::jsonb) $$,
  'procurement_manager may create_purchase_order (parity)');

-- procurement_manager reads back-office surfaces (RLS parity).
select ok(
  (select count(*) >= 1 from public.suppliers
    where id = 'b0000261-0000-4000-8000-000000000001'),
  'procurement_manager can read suppliers (readable-by-staff parity)');
select ok(
  (select count(*) >= 1 from public.purchase_orders),
  'procurement_manager can read purchase_orders (readable-by-back-office parity)');
reset role;

-- ============================================================================
-- F. Item 1 — void_purchase_order is manager-only (plain procurement REMOVED).
--    The gate runs before the not-found check, so a bogus id reveals the gate:
--    refused role → 42501; admitted role → P0001 (passed the gate, then 404).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000261-0000-4000-8000-000000000002"}';
select throws_ok(
  $$ select public.void_purchase_order('00000000-0000-0000-0000-000000000000'::uuid) $$,
  '42501', null, 'void_purchase_order REFUSES plain procurement (spec 261 item 1 walk-back)');
set local "request.jwt.claims" = '{"sub": "a3000261-0000-4000-8000-000000000003"}';
select throws_ok(
  $$ select public.void_purchase_order('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0001', null, 'void_purchase_order ADMITS procurement_manager (gate passes → not-found)');
set local "request.jwt.claims" = '{"sub": "a1000261-0000-4000-8000-000000000001"}';
select throws_ok(
  $$ select public.void_purchase_order('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0001', null, 'void_purchase_order still admits project_manager');
reset role;

-- ============================================================================
-- G. Item 2 — void_purchase_order_charge is is_manager() OR procurement_manager.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000261-0000-4000-8000-000000000002"}';
select throws_ok(
  $$ select public.void_purchase_order_charge('00000000-0000-0000-0000-000000000000'::uuid) $$,
  '42501', null, 'void_purchase_order_charge REFUSES plain procurement');
set local "request.jwt.claims" = '{"sub": "a3000261-0000-4000-8000-000000000003"}';
select throws_ok(
  $$ select public.void_purchase_order_charge('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0001', null, 'void_purchase_order_charge ADMITS procurement_manager (item 2)');
set local "request.jwt.claims" = '{"sub": "a1000261-0000-4000-8000-000000000001"}';
select throws_ok(
  $$ select public.void_purchase_order_charge('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0001', null, 'void_purchase_order_charge still admits the manager tier (is_manager)');
reset role;

-- ============================================================================
-- H. Item 3 — procurement_manager may CANCEL an approved PR but may NOT APPROVE a
--    requested one. Enforced at RLS: the transition-scoped policy admits only
--    approved→cancelled; no policy admits procurement_manager for requested→
--    approved, so that UPDATE silently affects 0 rows (approval stays PM-tier).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3000261-0000-4000-8000-000000000003"}';
with u_cancel as (
  update public.purchase_requests
     set status = 'cancelled', cancelled_at = now(),
         cancelled_by = 'a3000261-0000-4000-8000-000000000003'
   where id = 'fa000261-0000-4000-8000-000000000002' and status = 'approved'
  returning 1)
select is((select count(*)::int from u_cancel), 1,
  'procurement_manager CAN cancel an approved PR (approved→cancelled transition policy)');

with u_approve as (
  update public.purchase_requests
     set status = 'approved', approved_by = 'a3000261-0000-4000-8000-000000000003',
         decided_at = now()
   where id = 'fa000261-0000-4000-8000-000000000003' and status = 'requested'
  returning 1)
select is((select count(*)::int from u_approve), 0,
  'procurement_manager CANNOT approve a requested PR (RLS blocks; approval stays PM-tier)');
reset role;

-- the blocked PR is untouched (still requested).
select is(
  (select status::text from public.purchase_requests
    where id = 'fa000261-0000-4000-8000-000000000003'),
  'requested', 'the requested PR procurement_manager tried to approve is unchanged');

-- PM approval path is unbroken.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000261-0000-4000-8000-000000000001"}';
with u_pm as (
  update public.purchase_requests
     set status = 'approved', approved_by = 'a1000261-0000-4000-8000-000000000001',
         decided_at = now()
   where id = 'fa000261-0000-4000-8000-000000000004' and status = 'requested'
  returning 1)
select is((select count(*)::int from u_pm), 1,
  'project_manager can still approve a requested PR (approve path intact)');
reset role;

-- ============================================================================
-- I. roleHome parity is a TS concern (role-home.test.ts); here we pin that the
--    visitor is still refused every gate the enum add must not have loosened.
-- ============================================================================
select is(public.is_back_office('visitor'), false,
  'is_back_office still refuses visitor (enum add did not fall the gate open)');
select is(public.is_manager('site_admin'), false,
  'is_manager still refuses site_admin');

select * from finish();
rollback;
