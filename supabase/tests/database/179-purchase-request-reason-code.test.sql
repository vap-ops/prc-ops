begin;
select plan(15);

-- Spec 176 U4 — reactive-PR reason codes. Every purchase request (the
-- scramble order relative to the frozen supply plan) carries a reason code
-- saying WHY it wasn't drawn from the plan/store. Only `unplanned_miss`
-- counts against the PM (the scoring rule lives in U5 — this unit captures
-- the tag). Required on BOTH create paths: the form path (createPurchaseRequest
-- → RLS insert) and the on-site quick-record (record_site_purchase RPC).
--
-- Posture: enum + a NULLABLE column (no default — legacy rows stay null =
-- pre-feature, unscored). Required-ness lives on the write paths (validator +
-- the RPC's required param), NOT a column NOT NULL or DB CHECK — matching the
-- requester-field posture of priority/needed_by (ADR 0026). The insert RLS
-- policy is untouched, so the existing owner-role fixtures keep working.

-- ============================================================================
-- A. Enum.
-- ============================================================================
select has_type('public', 'purchase_request_reason_code', 'reason-code enum exists');
select enum_has_labels(
  'public', 'purchase_request_reason_code',
  array['unplanned_miss', 'rework', 'breakage', 'scope_change', 'unforeseeable'],
  'reason-code enum has exactly the five locked labels in order');

-- ============================================================================
-- B. Column — nullable, correct type, no default.
-- ============================================================================
select has_column('public', 'purchase_requests', 'reason_code', 'reason_code column exists');
select col_type_is('public', 'purchase_requests', 'reason_code',
  'purchase_request_reason_code', 'reason_code is the enum type');
select col_is_null('public', 'purchase_requests', 'reason_code',
  'reason_code is nullable (legacy rows unscored)');
select col_hasnt_default('public', 'purchase_requests', 'reason_code',
  'reason_code has no DB default (no dishonest backfill)');

-- ============================================================================
-- C. Column-scoped grants — INSERT on reason_code, but no UPDATE (set once).
-- ============================================================================
select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'reason_code', 'INSERT'),
  true, 'authenticated can INSERT reason_code');
select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'reason_code', 'UPDATE'),
  false, 'authenticated cannot UPDATE reason_code (set once at create)');

-- ============================================================================
-- D. record_site_purchase — new signature requires reason_code.
-- ============================================================================
-- New signature: (uuid, text, numeric, text, reason_code, numeric amount,
-- numeric vat_rate). The required reason_code is placed BEFORE the defaulted
-- p_amount / p_vat_rate; the live VAT param (20260701000200) is preserved.
select has_function('public', 'record_site_purchase',
  array['uuid', 'text', 'numeric', 'text', 'purchase_request_reason_code', 'numeric', 'numeric'],
  'record_site_purchase gained a required reason_code param (VAT preserved)');
-- The old reason-less VAT signature is gone (DROP+CREATE).
select hasnt_function('public', 'record_site_purchase',
  array['uuid', 'text', 'numeric', 'text', 'numeric', 'numeric'],
  'the old reason-less signature is gone');
-- anon cannot execute the new function.
select is(
  has_function_privilege('anon',
    'public.record_site_purchase(uuid, text, numeric, text, public.purchase_request_reason_code, numeric, numeric)',
    'EXECUTE'),
  false, 'anon cannot execute record_site_purchase');

-- ============================================================================
-- E. Behaviour — fixtures (postgres bypasses RLS for setup).
-- ============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000179', 'sa@rc-test.local', '{}'::jsonb);
update public.users set role = 'site_admin', full_name = 'ช่างรหัส'
  where id = '11111111-1111-1111-1111-000000000179';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-000000000179', 'PRC-RC', 'Reason code fixture');
insert into public.project_members (project_id, user_id, added_by) values
  ('cccccccc-cccc-cccc-cccc-000000000179',
   '11111111-1111-1111-1111-000000000179',
   '11111111-1111-1111-1111-000000000179');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-000000000179',
   'cccccccc-cccc-cccc-cccc-000000000179', 'WP-RC', 'RC fixture WP');

-- Role-sim authenticated (the runner's _tap_buf needs the grant — file 33 pattern).
grant insert on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000179"}';

-- E.1 a null reason_code is rejected by the RPC guard.
select throws_ok(
  $$ select public.record_site_purchase(
       'eeeeeeee-eeee-eeee-eeee-000000000179', 'ปูน', 5, 'ถุง', null) $$,
  'P0001', null, 'record_site_purchase rejects a null reason_code');

-- E.2 a reason code records the site purchase and stores the code.
select lives_ok(
  $$ select public.record_site_purchase(
       'eeeeeeee-eeee-eeee-eeee-000000000179', 'RC-BUY', 5, 'ถุง',
       'breakage'::public.purchase_request_reason_code, 1500) $$,
  'SA records a site purchase with a reason code');
select is(
  (select reason_code::text from public.purchase_requests where item_description = 'RC-BUY'),
  'breakage', 'site purchase stores the supplied reason_code');

-- E.3 the audit payload carries the reason code.
select is(
  (select payload->>'reason_code' from public.audit_log
     where target_id = (select id from public.purchase_requests where item_description = 'RC-BUY')
       and action = 'insert'),
  'breakage', 'audit payload carries reason_code');

reset role;

select * from finish();
rollback;
