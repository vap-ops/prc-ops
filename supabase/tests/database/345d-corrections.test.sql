begin;
select plan(40);

-- ============================================================================
-- Spec 345 U4 — corrections (danger-path: money RPC gates).
--   Widen five existing money-correction RPCs to include `accounting`:
--     correct_stock_receipt / decide_receipt_correction_request (spec 324) —
--       role gate is_back_office -> is_back_office OR accounting, AND the
--       membership exemption gains accounting (can_see_project(accounting)=false).
--     supersede_client_receipt / supersede_subcontract_payment — is_manager
--       -> is_manager OR accounting.
--     supersede_rental_settlement — accounting added to the explicit role list.
--   Create two new gated correction RPCs:
--     supersede_wage_payment (is_back_office+accounting; carries computed_*,
--       writes superseded_by + correction_reason per dc_payments_reason_iff_supersede),
--     correct_office_expense (accounting+super; plain UPDATE amount+expense_date).
--   Each new correction audits action='other' + payload->>'event'='money_review_corrected'.
--   correct_purchase_amount is DEFERRED (store-first purchases have no PR-level GL
--   to repost) — asserted absent below; purchases stay flag-only in U4.
--   Pre-existing authorized callers (procurement on stock, super_admin on the
--   supersedes) are re-asserted to guard the verbatim CREATE-OR-REPLACE bodies.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000345', 'acc@u4.local',  '{}'::jsonb),
  ('50000000-0000-0000-0000-000000000345', 'sa@u4.local',   '{}'::jsonb),
  ('b0000000-0000-0000-0000-000000000345', 'proc@u4.local', '{}'::jsonb),
  ('c0000000-0000-0000-0000-000000000345', 'vis@u4.local',  '{}'::jsonb),
  ('90000000-0000-0000-0000-000000000345', 'super@u4.local','{}'::jsonb);
update public.users set role='accounting'  where id='a0000000-0000-0000-0000-000000000345';
update public.users set role='site_admin'  where id='50000000-0000-0000-0000-000000000345';
update public.users set role='procurement' where id='b0000000-0000-0000-0000-000000000345';
update public.users set role='super_admin' where id='90000000-0000-0000-0000-000000000345';
-- c0…345 stays visitor (default). The accounting user is NOT a project member —
-- so a successful stock correct/decide proves the widened membership exemption.
-- procurement (is_back_office) + super_admin (is_manager) are the PRE-EXISTING
-- authorized callers — asserting they still pass guards the verbatim reproduction.

insert into public.projects (id, code, name) values
  ('40000000-0000-0000-0000-000000000345', 'U4-PROJ', 'แก้ไข U4');
insert into public.suppliers (id, name, created_by) values
  ('51000000-0000-0000-0000-000000000345', 'ผู้ขาย U4', 'b0000000-0000-0000-0000-000000000345');

-- Stock: one clean receipt + on-hand pool for the accounting correction.
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('11000000-0000-0000-0000-000000000345', 'electrical', 'clean U4', 'ชิ้น', true);
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, received_at) values
  ('a1000000-0000-0000-0000-000000000345', '40000000-0000-0000-0000-000000000345', '11000000-0000-0000-0000-000000000345', 100, 'ชิ้น', 10, 0, '51000000-0000-0000-0000-000000000345', '2026-07-16 10:00:00+00');
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('40000000-0000-0000-0000-000000000345', '11000000-0000-0000-0000-000000000345', 100, 1000);

-- A second receipt + a pending correction flag for the decide-reject path.
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('12000000-0000-0000-0000-000000000345', 'electrical', 'flag U4', 'ชิ้น', true);
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, received_at) values
  ('a2000000-0000-0000-0000-000000000345', '40000000-0000-0000-0000-000000000345', '12000000-0000-0000-0000-000000000345', 50, 'ชิ้น', 10, 0, '51000000-0000-0000-0000-000000000345', '2026-07-16 10:00:00+00');
insert into public.receipt_correction_requests (id, receipt_id, proposed_qty, reason, requested_by) values
  ('cc000000-0000-0000-0000-000000000345', 'a2000000-0000-0000-0000-000000000345', 40, 'น้อยกว่าสั่ง', '50000000-0000-0000-0000-000000000345');

-- Worker + a wage payment to supersede.
insert into public.workers (id, name, created_by) values
  ('d0000000-0000-0000-0000-000000000345', 'DC U4', 'b0000000-0000-0000-0000-000000000345');
insert into public.wage_payments (id, worker_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, paid_by) values
  ('e0000000-0000-0000-0000-000000000345', 'd0000000-0000-0000-0000-000000000345',
   '2026-06-01', '2026-06-30', 5700, 15, 5700, '2026-07-01', 'bank_transfer',
   'b0000000-0000-0000-0000-000000000345');

-- Office expense to correct.
insert into public.office_expense_categories (id, label_th, sort, is_active) values
  ('f0000000-0000-0000-0000-000000000345', 'ทดสอบ U4', 1, true);
insert into public.office_expenses (id, project_id, category_id, description, amount, expense_date,
    payment_source, submitted_by) values
  ('f1000000-0000-0000-0000-000000000345', '40000000-0000-0000-0000-000000000345',
   'f0000000-0000-0000-0000-000000000345', 'ค่าใช้จ่าย U4', 500, '2026-07-10',
   'company_direct', 'b0000000-0000-0000-0000-000000000345');

-- Note: correct_purchase_amount is DEFERRED (see the migration header) — 100% of
-- live purchase money events are store-first (wp-null), so a plain PR.amount UPDATE
-- would never repost the inventory GL. Purchases are flag-only in U4.

-- ── Structure (owner) ──────────────────────────────────────────────────────
select ok(to_regprocedure('public.supersede_wage_payment(uuid,numeric,date,public.wage_payment_method,text,text,text)') is not null,
  'supersede_wage_payment exists');
select ok(to_regprocedure('public.correct_office_expense(uuid,numeric,date,text)') is not null,
  'correct_office_expense exists');
select ok(to_regprocedure('public.correct_purchase_amount(uuid,numeric,numeric,text)') is null,
  'correct_purchase_amount is NOT created (deferred — store-first purchases have no PR-level GL to repost)');
select is(has_function_privilege('anon','public.supersede_wage_payment(uuid,numeric,date,public.wage_payment_method,text,text,text)','EXECUTE'),
  false, 'anon cannot execute supersede_wage_payment');
select is(has_function_privilege('anon','public.correct_office_expense(uuid,numeric,date,text)','EXECUTE'),
  false, 'anon cannot execute correct_office_expense');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ── correct_stock_receipt widening (role gate + membership exemption) ───────
set local "request.jwt.claims" = '{"sub":"50000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000345', 80, 'x') $$,
  '42501', null, 'correct_stock_receipt still refuses site_admin');
set local "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.correct_stock_receipt('00000000-0000-0000-0000-0000000000ff', 80, 'x') $$,
  '22023', null, 'procurement (pre-existing back-office) still passes the role gate — reproduction preserved');
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000345"}';
select lives_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000345', 80, 'accounting fix') $$,
  'accounting (non-member) can correct a stock receipt — role + membership widened');

-- ── decide_receipt_correction_request widening ─────────────────────────────
set local "request.jwt.claims" = '{"sub":"50000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.decide_receipt_correction_request('cc000000-0000-0000-0000-000000000345', false, null, 'no') $$,
  '42501', null, 'decide_receipt_correction_request still refuses site_admin');
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000345"}';
select lives_ok($$ select public.decide_receipt_correction_request('cc000000-0000-0000-0000-000000000345', false, null, 'ปฏิเสธโดยบัญชี') $$,
  'accounting (non-member) can reject a correction flag — role + membership widened');

-- ── supersede_client_receipt widening (bogus id proves the gate) ───────────
set local "request.jwt.claims" = '{"sub":"50000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_client_receipt('00000000-0000-0000-0000-0000000000ff', 100, '2026-07-01', 'cash', null, null) $$,
  '42501', null, 'supersede_client_receipt still refuses site_admin');
set local "request.jwt.claims" = '{"sub":"90000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_client_receipt('00000000-0000-0000-0000-0000000000ff', 100, '2026-07-01', 'cash', null, null) $$,
  'P0001', null, 'super_admin (pre-existing is_manager) still passes the supersede_client_receipt gate');
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_client_receipt('00000000-0000-0000-0000-0000000000ff', 100, '2026-07-01', 'cash', null, null) $$,
  'P0001', null, 'accounting passes the supersede_client_receipt gate (fails later: receipt not found)');

-- ── supersede_subcontract_payment widening ─────────────────────────────────
set local "request.jwt.claims" = '{"sub":"50000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_subcontract_payment('00000000-0000-0000-0000-0000000000ff', 'advance', 100, '2026-07-01', 'cash', null) $$,
  '42501', null, 'supersede_subcontract_payment still refuses site_admin');
set local "request.jwt.claims" = '{"sub":"90000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_subcontract_payment('00000000-0000-0000-0000-0000000000ff', 'advance', 100, '2026-07-01', 'cash', null) $$,
  'P0001', null, 'super_admin (pre-existing is_manager) still passes the supersede_subcontract_payment gate');
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_subcontract_payment('00000000-0000-0000-0000-0000000000ff', 'advance', 100, '2026-07-01', 'cash', null) $$,
  'P0001', null, 'accounting passes the supersede_subcontract_payment gate (fails later: payment not found)');

-- ── supersede_rental_settlement widening ───────────────────────────────────
set local "request.jwt.claims" = '{"sub":"50000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_rental_settlement('00000000-0000-0000-0000-0000000000ff','INV',date '2026-07-01',0,0,0,0,0,0,'cash','reason',null) $$,
  '42501', null, 'supersede_rental_settlement still refuses site_admin');
set local "request.jwt.claims" = '{"sub":"90000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_rental_settlement('00000000-0000-0000-0000-0000000000ff','INV',date '2026-07-01',0,0,0,0,0,0,'cash','reason',null) $$,
  'P0001', null, 'super_admin (pre-existing) still passes the supersede_rental_settlement gate');
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_rental_settlement('00000000-0000-0000-0000-0000000000ff','INV',date '2026-07-01',0,0,0,0,0,0,'cash','reason',null) $$,
  'P0001', null, 'accounting passes the supersede_rental_settlement gate (fails later: settlement not found)');

-- ── supersede_wage_payment (new) ───────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"50000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_wage_payment('e0000000-0000-0000-0000-000000000345', 6000, '2026-07-02', 'cash', null, null, 'fix') $$,
  '42501', null, 'supersede_wage_payment refuses site_admin (money surface)');
set local "request.jwt.claims" = '{"sub":"c0000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_wage_payment('e0000000-0000-0000-0000-000000000345', 6000, '2026-07-02', 'cash', null, null, 'fix') $$,
  '42501', null, 'supersede_wage_payment refuses visitor');
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.supersede_wage_payment('e0000000-0000-0000-0000-000000000345', 6000, '2026-07-02', 'cash', null, null, '') $$,
  'P0001', null, 'supersede_wage_payment requires a correction_reason');
select throws_ok($$ select public.supersede_wage_payment('e0000000-0000-0000-0000-000000000345', -1, '2026-07-02', 'cash', null, null, 'fix') $$,
  'P0001', null, 'supersede_wage_payment rejects negative paid_amount');
select throws_ok($$ select public.supersede_wage_payment('00000000-0000-0000-0000-0000000000ff', 6000, '2026-07-02', 'cash', null, null, 'fix') $$,
  'P0001', null, 'supersede_wage_payment raises on unknown payment');
select lives_ok($$ select public.supersede_wage_payment('e0000000-0000-0000-0000-000000000345', 6000, '2026-07-02', 'cash', 'CHK-1', 'note', 'จ่ายผิดยอด') $$,
  'accounting supersedes a wage payment with the corrected amount');
select throws_ok($$ select public.supersede_wage_payment('e0000000-0000-0000-0000-000000000345', 6100, '2026-07-03', 'cash', null, null, 'again') $$,
  'P0001', null, 'supersede_wage_payment refuses to supersede an already-superseded payment');

-- ── correct_office_expense (new) ───────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.correct_office_expense('f1000000-0000-0000-0000-000000000345', 650, '2026-07-11', 'fix') $$,
  '42501', null, 'correct_office_expense refuses procurement (accounting+super only)');
set local "request.jwt.claims" = '{"sub":"50000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.correct_office_expense('f1000000-0000-0000-0000-000000000345', 650, '2026-07-11', 'fix') $$,
  '42501', null, 'correct_office_expense refuses site_admin');
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000345"}';
select throws_ok($$ select public.correct_office_expense('f1000000-0000-0000-0000-000000000345', 650, '2026-07-11', '') $$,
  'P0001', null, 'correct_office_expense requires a reason');
select throws_ok($$ select public.correct_office_expense('f1000000-0000-0000-0000-000000000345', 0, '2026-07-11', 'fix') $$,
  'P0001', null, 'correct_office_expense rejects non-positive amount');
select lives_ok($$ select public.correct_office_expense('f1000000-0000-0000-0000-000000000345', 650, '2026-07-11', 'ยอดผิด') $$,
  'accounting corrects an office expense amount + date');

reset role;

-- ── Effects (owner reads, RLS bypassed) ────────────────────────────────────
select is((select count(*) from public.wage_payments where superseded_by='e0000000-0000-0000-0000-000000000345'),
  1::bigint, 'exactly one superseding wage row points at the original');
select is((select correction_reason from public.wage_payments where superseded_by='e0000000-0000-0000-0000-000000000345'),
  'จ่ายผิดยอด', 'the superseding wage row carries the correction_reason (dc_payments_reason_iff_supersede satisfied)');
select is((select paid_amount from public.wage_payments where superseded_by='e0000000-0000-0000-0000-000000000345'),
  6000::numeric, 'the superseding wage row carries the corrected paid_amount');
select is((select computed_amount from public.wage_payments where superseded_by='e0000000-0000-0000-0000-000000000345'),
  5700::numeric, 'the superseding wage row carries the computed_amount from the original');

select is((select amount from public.office_expenses where id='f1000000-0000-0000-0000-000000000345'),
  650::numeric, 'office expense amount corrected to 650');
select is((select expense_date from public.office_expenses where id='f1000000-0000-0000-0000-000000000345'),
  date '2026-07-11', 'office expense date corrected');
select is((select count(*) from public.audit_log where action='other'
    and payload->>'event'='money_review_corrected' and target_id='f1000000-0000-0000-0000-000000000345'),
  1::bigint, 'correct_office_expense wrote one money_review_corrected audit row');

select is((select status from public.receipt_correction_requests where id='cc000000-0000-0000-0000-000000000345'),
  'rejected', 'accounting reject set the correction flag to rejected');
select is((select removed_qty from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000345'),
  20::numeric, 'accounting stock correction removed 20 (100 -> 80)');

select * from finish();
rollback;
