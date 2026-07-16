begin;
select plan(33);

-- ============================================================================
-- Spec 324 U2 — correct_stock_receipt RPC + reverse_stock_receipt mutual guard.
--   BO-only, null-safe gate; range (0 <= true_qty < CURRENT effective qty, i.e.
--   qty - already-removed); use-now origin refuse (note marker); fresh-pool gate
--   (no issue/return/count since received_at) under the on-hand lock + value
--   floor; VAT-residual removed_net/vat/gross; on-hand decremented by the
--   identical removed_net; cumulative corrections compose (removed relative to
--   current effective); cross-guard with reverse_stock_receipt both ways; the
--   dangling-flag auto-resolver (reverse → pending flags obsolete).
-- All movement timestamps are EXPLICIT (now() is transaction-stable in pgTAP).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000324', 'bo@rc2.local',  '{}'::jsonb),
  ('a0000000-0000-0000-0000-000000000324', 'sa@rc2.local',  '{}'::jsonb),
  ('c0000000-0000-0000-0000-000000000324', 'vis@rc2.local', '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000324', 'pm@rc2.local',  '{}'::jsonb);
update public.users set role='procurement'     where id='b0000000-0000-0000-0000-000000000324';
update public.users set role='site_admin'      where id='a0000000-0000-0000-0000-000000000324';
update public.users set role='project_manager' where id='70000000-0000-0000-0000-000000000324';
-- c0…324 stays visitor (default); the project_manager (70…324) is NOT a project member.

insert into public.projects (id, code, name) values
  ('40000000-0000-0000-0000-000000000324', 'RC2-PROJ', 'แก้จำนวน U2');
insert into public.suppliers (id, name, created_by) values
  ('50000000-0000-0000-0000-000000000324', 'ผู้ขาย U2', 'b0000000-0000-0000-0000-000000000324');
insert into public.work_packages (id, project_id, code, name) values
  ('60000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', 'WP-U2', 'งาน U2');

-- One catalog item per scenario so each (project,item) pool is isolated.
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('11000000-0000-0000-0000-000000000324', 'electrical', 'happy VAT',    'ชิ้น', true),
  ('12000000-0000-0000-0000-000000000324', 'electrical', 'fresh issue',  'ชิ้น', true),
  ('13000000-0000-0000-0000-000000000324', 'electrical', 'fresh count',  'ชิ้น', true),
  ('14000000-0000-0000-0000-000000000324', 'electrical', 'fresh return', 'ชิ้น', true),
  ('15000000-0000-0000-0000-000000000324', 'electrical', 'use now',      'ชิ้น', true),
  ('16000000-0000-0000-0000-000000000324', 'electrical', 'xguard rev',   'ชิ้น', true),
  ('17000000-0000-0000-0000-000000000324', 'electrical', 'value floor',  'ชิ้น', true),
  ('18000000-0000-0000-0000-000000000324', 'electrical', 'xguard corr',  'ชิ้น', true),
  ('19000000-0000-0000-0000-000000000324', 'electrical', 'flag resolver','ชิ้น', true);

insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, received_at) values
  ('a1000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '11000000-0000-0000-0000-000000000324', 100, 'ชิ้น', 10, 7, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00'),
  ('a2000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '12000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00'),
  ('a3000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '13000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00'),
  ('a4000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '14000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00'),
  ('a6000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '16000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00'),
  ('a7000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '17000000-0000-0000-0000-000000000324', 100, 'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00'),
  ('a8000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '18000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00'),
  ('a9000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '19000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00');
-- The use-now receipt carries its default note at INSERT (stock_receipts is
-- append-only — it cannot be UPDATEd after the fact).
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, received_at, note) values
  ('a5000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '15000000-0000-0000-0000-000000000324', 50, 'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', '2026-07-16 10:00:00+00', 'ซื้อใช้หน้างาน');

insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('40000000-0000-0000-0000-000000000324', '11000000-0000-0000-0000-000000000324', 100, 1000),
  ('40000000-0000-0000-0000-000000000324', '12000000-0000-0000-0000-000000000324', 50,  500),
  ('40000000-0000-0000-0000-000000000324', '13000000-0000-0000-0000-000000000324', 50,  500),
  ('40000000-0000-0000-0000-000000000324', '14000000-0000-0000-0000-000000000324', 50,  500),
  ('40000000-0000-0000-0000-000000000324', '15000000-0000-0000-0000-000000000324', 50,  500),
  ('40000000-0000-0000-0000-000000000324', '16000000-0000-0000-0000-000000000324', 50,  500),
  ('40000000-0000-0000-0000-000000000324', '17000000-0000-0000-0000-000000000324', 100, 50),
  ('40000000-0000-0000-0000-000000000324', '18000000-0000-0000-0000-000000000324', 50,  500),
  ('40000000-0000-0000-0000-000000000324', '19000000-0000-0000-0000-000000000324', 50,  500);

-- Dirty-pool movements (created_at AFTER the 10:00 receipt).
insert into public.stock_issues (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, created_at) values
  ('e2000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '12000000-0000-0000-0000-000000000324', '60000000-0000-0000-0000-000000000324', 5, 'ชิ้น', 10, '2026-07-16 11:00:00+00'),
  -- I4's issue is BEFORE the receipt (does NOT trip fresh-pool); the RETURN of it is after.
  ('e4000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '14000000-0000-0000-0000-000000000324', '60000000-0000-0000-0000-000000000324', 5, 'ชิ้น', 10, '2026-07-16 09:00:00+00');
insert into public.stock_counts (id, project_id, catalog_item_id, system_qty, counted_qty, unit, unit_cost, counted_at) values
  ('f3000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '13000000-0000-0000-0000-000000000324', 50, 48, 'ชิ้น', 10, '2026-07-16 11:00:00+00');
insert into public.stock_returns (id, project_id, catalog_item_id, issue_id, work_package_id, qty, unit, unit_cost, created_at) values
  ('d4000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '14000000-0000-0000-0000-000000000324', 'e4000000-0000-0000-0000-000000000324', '60000000-0000-0000-0000-000000000324', 2, 'ชิ้น', 10, '2026-07-16 11:00:00+00');

-- A pending flag on I9's receipt, to prove the reverse auto-resolver.
insert into public.receipt_correction_requests (id, receipt_id, proposed_qty, reason, requested_by) values
  ('c9000000-0000-0000-0000-000000000324', 'a9000000-0000-0000-0000-000000000324', 40, 'น้อยกว่าที่สั่ง', 'a0000000-0000-0000-0000-000000000324');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- Structure
select ok(to_regprocedure('public.correct_stock_receipt(uuid,numeric,text,uuid)') is not null,
  'correct_stock_receipt exists');
select is(has_function_privilege('anon', 'public.correct_stock_receipt(uuid,numeric,text,uuid)', 'EXECUTE'),
  false, 'anon cannot execute correct_stock_receipt');

set local role authenticated;

-- Role gate — site_admin + visitor denied (null-safe BO-only).
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000324"}';
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 80, 'x') $$,
  '42501', null, 'site_admin cannot correct (back-office only)');
set local "request.jwt.claims" = '{"sub":"c0000000-0000-0000-0000-000000000324"}';
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 80, 'x') $$,
  '42501', null, 'visitor cannot correct');
-- Membership scope: a project_manager who is NOT a member of the receipt's project
-- is denied (parity with reverse_stock_receipt); procurement below is cross-project.
set local "request.jwt.claims" = '{"sub":"70000000-0000-0000-0000-000000000324"}';
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 80, 'x') $$,
  '42501', null, 'non-member project_manager denied (membership scope)');

set local "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000324"}';

-- Range + reason
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', -1, 'x') $$,
  'P0001', null, 'negative true_qty rejected');
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 100, 'x') $$,
  'P0001', null, 'true_qty == booked rejected (no reduction)');
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 120, 'x') $$,
  'P0001', null, 'true_qty > booked rejected');
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 80, '') $$,
  'P0001', null, 'empty reason rejected');

-- Use-now origin (note marker).
select throws_ok($$ select public.correct_stock_receipt('a5000000-0000-0000-0000-000000000324', 40, 'x') $$,
  'P0001', null, 'use-now receipt refused (note marker)');

-- Fresh-pool gate — issue / count / return since received_at each block (22023).
select throws_ok($$ select public.correct_stock_receipt('a2000000-0000-0000-0000-000000000324', 40, 'x') $$,
  '22023', null, 'fresh-pool: an issue since received_at blocks');
select throws_ok($$ select public.correct_stock_receipt('a3000000-0000-0000-0000-000000000324', 40, 'x') $$,
  '22023', null, 'fresh-pool: a count since received_at blocks');
select throws_ok($$ select public.correct_stock_receipt('a4000000-0000-0000-0000-000000000324', 40, 'x') $$,
  '22023', null, 'fresh-pool: a return since received_at blocks');

-- Value floor (clean pool, but total_value < removed_net).
select throws_ok($$ select public.correct_stock_receipt('a7000000-0000-0000-0000-000000000324', 80, 'x') $$,
  '22023', null, 'value floor: total_value below removed_net blocks');

-- Happy VAT: correct 100 → 80 (remove 20). net 200, vat round(200*7%)=14, gross 214.
select lives_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 80, 'miscount') $$,
  'BO corrects the VAT receipt down to 80');
select is((select qty_on_hand from public.stock_on_hand
   where project_id='40000000-0000-0000-0000-000000000324' and catalog_item_id='11000000-0000-0000-0000-000000000324'),
  80::numeric, 'on-hand qty 100 → 80');
select is((select total_value from public.stock_on_hand
   where project_id='40000000-0000-0000-0000-000000000324' and catalog_item_id='11000000-0000-0000-0000-000000000324'),
  800::numeric, 'on-hand value 1000 → 800 (−200 net)');
select is((select removed_qty from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324'),
  20::numeric, 'removed_qty = 20');
select is((select removed_net from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324'),
  200::numeric, 'removed_net = 200');
select is((select removed_vat from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324'),
  14::numeric, 'removed_vat = round(200 * 7%) = 14');
select is((select removed_gross from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324'),
  214::numeric, 'removed_gross = 214 (residual)');
select is((select supplier_id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324'),
  '50000000-0000-0000-0000-000000000324'::uuid, 'supplier copied from the receipt');

-- Cumulative: a second correction to 70 removes 10 MORE (relative to current effective 80).
select lives_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 70, 'again') $$,
  'second correction to 70 removes 10 more');
select is((select qty_on_hand from public.stock_on_hand
   where project_id='40000000-0000-0000-0000-000000000324' and catalog_item_id='11000000-0000-0000-0000-000000000324'),
  70::numeric, 'on-hand qty 80 → 70');
select is((select sum(removed_qty) from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324'),
  30::numeric, 'cumulative removed_qty = 30 (20 + 10)');
select throws_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 80, 'x') $$,
  'P0001', null, 'cannot true-up above the current effective qty (70)');

-- Cross-guard A: reverse then correct → refused.
select isnt((select public.reverse_stock_receipt('a6000000-0000-0000-0000-000000000324', 'rev')), null,
  'reverse the zero-VAT receipt first');
select throws_ok($$ select public.correct_stock_receipt('a6000000-0000-0000-0000-000000000324', 40, 'x') $$,
  'P0001', null, 'cannot correct an already-reversed receipt');

-- Cross-guard B: correct then reverse → refused.
select lives_ok($$ select public.correct_stock_receipt('a8000000-0000-0000-0000-000000000324', 40, 'x') $$,
  'correct the xguard receipt (zero-VAT)');
select is((select removed_vat from public.stock_receipt_corrections where receipt_id='a8000000-0000-0000-0000-000000000324'),
  0::numeric, 'a zero-VAT receipt correction books removed_vat = 0 (no 1300 leg)');
select throws_ok($$ select public.reverse_stock_receipt('a8000000-0000-0000-0000-000000000324', 'rev') $$,
  'P0001', null, 'cannot reverse an already-corrected receipt');

-- Dangling-flag auto-resolver: reversing a receipt marks its pending flag obsolete.
select isnt((select public.reverse_stock_receipt('a9000000-0000-0000-0000-000000000324', 'rev')), null,
  'reverse the flagged receipt');
select is((select status from public.receipt_correction_requests where id='c9000000-0000-0000-0000-000000000324'),
  'obsolete', 'the pending flag is auto-resolved to obsolete on reverse');

reset role;
select * from finish();
rollback;
