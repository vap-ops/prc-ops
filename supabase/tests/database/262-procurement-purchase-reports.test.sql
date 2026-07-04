begin;
select plan(45);

-- ============================================================================
-- Spec 262 U1 — purchase_report(): bucketed procurement-spend aggregate.
--
-- Pins: existence + SECURITY DEFINER / pinned search_path + exec grants; the
-- role gate (procurement, procurement_manager, project_manager, project_director,
-- super_admin, accounting admitted; site_admin / visitor refused) and the
-- by-purchaser slice narrowing (manager tier ∪ procurement_manager only — plain
-- procurement / accounting refused); param validation; committed-status
-- population (requested / approved / rejected / cancelled excluded); the spec-260
-- charge fold (largest-remainder over the PO's committed member lines by line NET,
-- discount subtracts, exact sum) on a mixed WP+store, mixed-project PO and a
-- VAT-bearing charge; VAT split (gross→net/vat, ADR 0045); day / month / year
-- buckets on Asia/Bangkok business days (the DB session tz is UTC), month + year
-- boundaries, p_to inclusive; null supplier / category / purchaser "ไม่ระบุ"
-- buckets (shown, never dropped).
--
-- Data-independence (#243 lesson): every assertion is scoped to fixture ids /
-- projects, never to a bare amount a real prod row could also carry.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000262-0000-4000-8000-000000000001', 'proc@262.local',  '{}'::jsonb),
  ('a0000262-0000-4000-8000-000000000002', 'procm@262.local', '{}'::jsonb),
  ('a0000262-0000-4000-8000-000000000003', 'pm@262.local',    '{}'::jsonb),
  ('a0000262-0000-4000-8000-000000000004', 'pd@262.local',    '{}'::jsonb),
  ('a0000262-0000-4000-8000-000000000005', 'super@262.local', '{}'::jsonb),
  ('a0000262-0000-4000-8000-000000000006', 'acct@262.local',  '{}'::jsonb),
  ('a0000262-0000-4000-8000-000000000007', 'sa@262.local',    '{}'::jsonb),
  ('a0000262-0000-4000-8000-000000000008', 'vis@262.local',   '{}'::jsonb);
update public.users set role='procurement',         full_name='คุณจัดซื้อ'    where id='a0000262-0000-4000-8000-000000000001';
update public.users set role='procurement_manager', full_name='หัวหน้าจัดซื้อ' where id='a0000262-0000-4000-8000-000000000002';
update public.users set role='project_manager',     full_name='คุณพีเอ็ม'      where id='a0000262-0000-4000-8000-000000000003';
update public.users set role='project_director'     where id='a0000262-0000-4000-8000-000000000004';
update public.users set role='super_admin'          where id='a0000262-0000-4000-8000-000000000005';
update public.users set role='accounting'           where id='a0000262-0000-4000-8000-000000000006';
update public.users set role='site_admin'           where id='a0000262-0000-4000-8000-000000000007';
-- ...08 stays visitor (auto-created by the auth.users insert trigger)

insert into public.projects (id, code, name) values
  ('c0000262-0000-4000-8000-000000000001','TAP262-P1','โครงการ 262-1'),
  ('c0000262-0000-4000-8000-000000000002','TAP262-P2','โครงการ 262-2'),
  ('c0000262-0000-4000-8000-000000000003','TAP262-P3','โครงการ 262-3'),
  ('c0000262-0000-4000-8000-000000000004','TAP262-P4','โครงการ 262-4'),
  ('c0000262-0000-4000-8000-000000000005','TAP262-P5','โครงการ 262-5'),
  ('c0000262-0000-4000-8000-000000000006','TAP262-P6','โครงการ 262-6'),
  ('c0000262-0000-4000-8000-000000000007','TAP262-P7','โครงการ 262-7');
insert into public.work_packages (id, project_id, code, name, status) values
  ('e0000262-0000-4000-8000-000000000001','c0000262-0000-4000-8000-000000000001','WP262-1','งาน 262-1','in_progress');
insert into public.suppliers (id, name, created_by) values
  ('b0000262-0000-4000-8000-000000000001','ผู้ขายทดสอบ 262','a0000262-0000-4000-8000-000000000003');
insert into public.catalog_categories (id, code, name) values
  ('d0000262-0000-4000-8000-000000000001', '99', 'หมวดทดสอบ 262');
insert into public.catalog_items (id, base_item, unit, category_id) values
  ('f0000262-0000-4000-8000-000000000001','สินค้า 262','ชิ้น','d0000262-0000-4000-8000-000000000001');

insert into public.purchase_orders (id, supplier_id, supplier, created_by) values
  ('90000262-0000-4000-8000-000000000001','b0000262-0000-4000-8000-000000000001','ผู้ขายทดสอบ 262','a0000262-0000-4000-8000-000000000003'),
  ('90000262-0000-4000-8000-000000000002','b0000262-0000-4000-8000-000000000001','ผู้ขายทดสอบ 262','a0000262-0000-4000-8000-000000000003');

-- Committed member lines. amount is GROSS (ADR 0045). purchased_at carries an
-- explicit offset so the Asia/Bangkok business day is unambiguous. A WP-bound
-- line's project_id is derived by the BEFORE INSERT trigger (ADR 0063).
insert into public.purchase_requests
  (id, work_package_id, project_id, item_description, quantity, unit, status, source,
   requested_by, amount, vat_rate, purchased_at, supplier_id, catalog_item_id, purchase_order_id)
values
  -- Mixed PO1: L1 P1 WP-bound 300, L2 P2 store-bound 100 (net weights 3:1). MAY.
  ('fa000262-0000-4000-8000-000000000001','e0000262-0000-4000-8000-000000000001', null,
     'ปูน',10,'ถุง','purchased','app','a0000262-0000-4000-8000-000000000003',
     300, 0, '2026-05-15 12:00:00+07', null,
     'f0000262-0000-4000-8000-000000000001','90000262-0000-4000-8000-000000000001'),
  ('fa000262-0000-4000-8000-000000000002', null,'c0000262-0000-4000-8000-000000000002',
     'เหล็ก',5,'เส้น','purchased','app','a0000262-0000-4000-8000-000000000003',
     100, 0, '2026-05-15 12:00:00+07', null, null,'90000262-0000-4000-8000-000000000001'),
  -- PO2: single line + a VAT-bearing charge (214 @7 → net 200 / vat 14). APRIL, P7.
  ('fa000262-0000-4000-8000-000000000013', null,'c0000262-0000-4000-8000-000000000007',
     'ของ VAT',1,'ชิ้น','purchased','app','a0000262-0000-4000-8000-000000000003',
     100, 0, '2026-04-16 12:00:00+07', null, null,'90000262-0000-4000-8000-000000000002'),
  -- VAT line, no charge (P3): 107 @7 → net 100 / vat 7. JUNE.
  ('fa000262-0000-4000-8000-000000000003', null,'c0000262-0000-4000-8000-000000000003',
     'สินค้า VAT',1,'ชิ้น','delivered','app','a0000262-0000-4000-8000-000000000001',
     107, 7, '2026-06-10 12:00:00+07', 'b0000262-0000-4000-8000-000000000001', null, null),
  -- Bucket lines (P4), no PO.
  ('fa000262-0000-4000-8000-000000000004', null,'c0000262-0000-4000-8000-000000000004',
     'บัคเก็ต Dec25',1,'ชิ้น','purchased','app','a0000262-0000-4000-8000-000000000003',
     100, 0, '2025-12-20 12:00:00+07', null, null, null),
  ('fa000262-0000-4000-8000-000000000005', null,'c0000262-0000-4000-8000-000000000004',
     'บัคเก็ต Jan10',1,'ชิ้น','on_route','app','a0000262-0000-4000-8000-000000000003',
     200, 0, '2026-01-10 12:00:00+07', null, null, null),
  ('fa000262-0000-4000-8000-000000000006', null,'c0000262-0000-4000-8000-000000000004',
     'บัคเก็ต Jan31',1,'ชิ้น','purchased','app','a0000262-0000-4000-8000-000000000003',
     50, 0, '2026-01-31 12:00:00+07', null, null, null),
  ('fa000262-0000-4000-8000-000000000007', null,'c0000262-0000-4000-8000-000000000004',
     'บัคเก็ต tz',1,'ชิ้น','delivered','app','a0000262-0000-4000-8000-000000000003',
     999, 0, '2026-01-31 18:00:00+00', null, null, null),  -- 18:00Z Jan-31 = 01:00 BKK Feb-01
  -- Null-bucket line (P6): site_purchased, no supplier, no requester, no catalog.
  -- source='site_purchase' (≠ 'app') lets requested_by be null (pr_native_has_requester). JULY.
  ('fa000262-0000-4000-8000-000000000012', null,'c0000262-0000-4000-8000-000000000006',
     'ซื้อหน้างาน',1,'ชิ้น','site_purchased','site_purchase', null,
     80, 0, '2026-07-10 12:00:00+07', null, null, null);

-- Excluded statuses (P5): purchased_at in-window so ONLY the status excludes them.
-- rejected needs a decision_comment, cancelled needs cancelled_at (shape CHECKs).
insert into public.purchase_requests
  (id, project_id, item_description, quantity, unit, status, source, requested_by,
   amount, vat_rate, purchased_at, decision_comment, cancelled_at)
values
  ('fa000262-0000-4000-8000-000000000008','c0000262-0000-4000-8000-000000000005',
     'req',1,'ชิ้น','requested','app','a0000262-0000-4000-8000-000000000003',
     111, 0, '2026-05-15 12:00:00+07', null, null),
  ('fa000262-0000-4000-8000-000000000009','c0000262-0000-4000-8000-000000000005',
     'appr',1,'ชิ้น','approved','app','a0000262-0000-4000-8000-000000000003',
     222, 0, '2026-05-15 12:00:00+07', null, null),
  ('fa000262-0000-4000-8000-000000000010','c0000262-0000-4000-8000-000000000005',
     'rej',1,'ชิ้น','rejected','app','a0000262-0000-4000-8000-000000000003',
     333, 0, '2026-05-15 12:00:00+07', 'ทดสอบปฏิเสธ', null),
  ('fa000262-0000-4000-8000-000000000011','c0000262-0000-4000-8000-000000000005',
     'can',1,'ชิ้น','cancelled','app','a0000262-0000-4000-8000-000000000003',
     444, 0, '2026-05-15 12:00:00+07', null, '2026-05-16 12:00:00+07');

-- PO1: transport 100 @0 + discount 40 @0 (net split 3:1). PO2: transport 214 @7.
insert into public.purchase_order_charges (id, purchase_order_id, charge_type, amount, vat_rate, note, created_by) values
  ('ca000262-0000-4000-8000-000000000001','90000262-0000-4000-8000-000000000001','transport',100, 0, null,'a0000262-0000-4000-8000-000000000003'),
  ('ca000262-0000-4000-8000-000000000002','90000262-0000-4000-8000-000000000001','discount',  40, 0, null,'a0000262-0000-4000-8000-000000000003'),
  ('ca000262-0000-4000-8000-000000000003','90000262-0000-4000-8000-000000000002','transport',214, 7, null,'a0000262-0000-4000-8000-000000000003');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- === A. Structure ==========================================================
select ok(
  to_regprocedure('public.purchase_report(date, date, text, text, uuid)') is not null,
  'purchase_report exists with the (date,date,text,text,uuid) signature');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'purchase_report'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  1, 'purchase_report is SECURITY DEFINER with a pinned search_path');
select is(has_function_privilege('anon',
  'public.purchase_report(date, date, text, text, uuid)', 'EXECUTE'),
  false, 'anon cannot execute purchase_report');
select ok(has_function_privilege('authenticated',
  'public.purchase_report(date, date, text, text, uuid)', 'EXECUTE'),
  'authenticated may execute purchase_report');

-- === B. Role gate ==========================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000001"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none') $$, 'procurement may run the report');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000002"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none') $$, 'procurement_manager may run the report');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000003"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none') $$, 'project_manager may run the report');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000004"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none') $$, 'project_director may run the report (ADR 0058)');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000005"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none') $$, 'super_admin may run the report');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000006"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none') $$, 'accounting may run the report (read parity)');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000007"}';
select throws_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none') $$, '42501', null, 'site_admin refused');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000008"}';
select throws_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none') $$, '42501', null, 'visitor refused');

-- === C. By-purchaser slice narrowing (manager tier ∪ procurement_manager) ===
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000001"}';
select throws_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'purchaser') $$, '42501', null, 'plain procurement refused the purchaser slice');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000006"}';
select throws_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'purchaser') $$, '42501', null, 'accounting refused the purchaser slice');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000002"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'purchaser') $$, 'procurement_manager may see the purchaser slice');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000003"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'purchaser') $$, 'project_manager may see the purchaser slice');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000004"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'purchaser') $$, 'project_director may see the purchaser slice');
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000005"}';
select lives_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'purchaser') $$, 'super_admin may see the purchaser slice');

-- === D. Param validation ===================================================
select throws_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'week', 'none') $$, '22023', null, 'invalid bucket rejected');
select throws_ok($$ select * from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'widget') $$, '22023', null, 'invalid group_by rejected');

-- Value assertions run as super_admin (admitted + manager tier for the purchaser slice).
set local "request.jwt.claims" = '{"sub":"a0000262-0000-4000-8000-000000000005"}';

-- === E. Charge fold — mixed WP+store, mixed-project PO1 (MAY) ================
-- lines 300:100 net; transport 100 → 75:25; discount 40 → 30:10; net charge 60.
-- P1 = 300 + (75-30) = 345 ; P2 = 100 + (25-10) = 115 ; total gross 460, charge 60.
select is((select gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'project') where group_key = 'c0000262-0000-4000-8000-000000000001'),
  345::numeric, 'project P1 gross = line 300 + allocated charge 45');
select is((select gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'project') where group_key = 'c0000262-0000-4000-8000-000000000002'),
  115::numeric, 'project P2 gross = line 100 + allocated charge 15');
select is((select gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'none')),
  460::numeric, 'none: total gross folds charges (460) and excludes the same-month excluded-status rows');
select is((select charge_gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'none')),
  60::numeric, 'none: charge_gross = transport 100 − discount 40 = 60');
select is((select line_gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'none')),
  400::numeric, 'none: line_gross = 300 + 100 (charges kept out of line_gross)');
select is((select sum(charge_gross) from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'project')),
  60::numeric, 'invariant: Σ charge over project slices = the none total (exact, largest-remainder)');
select is((select gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'supplier') where group_key = 'b0000262-0000-4000-8000-000000000001'),
  460::numeric, 'supplier S1 gross = 460 (both lines via the PO1 supplier)');

-- === F. Category dimension (MAY) ===========================================
select is((select gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'category') where group_label = 'หมวดทดสอบ 262'),
  345::numeric, 'category หมวดทดสอบ 262 = L1 (300 + charge 45)');
select is((select gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'category') where group_label = 'ไม่ระบุหมวด'),
  115::numeric, 'null catalog_item → ไม่ระบุหมวด bucket (L2 100 + charge 15), shown not dropped');

-- === G. VAT-bearing charge single-line PO2 (APRIL, P7) =====================
-- transport 214 @7 → net 200 / vat 14 ; line 100 @0. gross 314, net 300, vat 14.
select is((select charge_gross from public.purchase_report(date '2026-04-01', date '2026-04-30', 'month', 'none', 'c0000262-0000-4000-8000-000000000007')),
  214::numeric, 'VAT charge: charge_gross = 214');
select is((select net from public.purchase_report(date '2026-04-01', date '2026-04-30', 'month', 'none', 'c0000262-0000-4000-8000-000000000007')),
  300::numeric, 'VAT charge: net = line 100 + charge net 200');
select is((select vat from public.purchase_report(date '2026-04-01', date '2026-04-30', 'month', 'none', 'c0000262-0000-4000-8000-000000000007')),
  14::numeric, 'VAT charge: vat = charge vat 14');

-- === H. VAT split on a line (JUNE, P3): 107 @7 → net 100 / vat 7 ===========
select is((select net from public.purchase_report(date '2026-06-01', date '2026-06-30', 'month', 'none', 'c0000262-0000-4000-8000-000000000003')),
  100::numeric, 'line VAT: net = round2(107 / 1.07) = 100 (item_price_history arithmetic)');
select is((select vat from public.purchase_report(date '2026-06-01', date '2026-06-30', 'month', 'none', 'c0000262-0000-4000-8000-000000000003')),
  7::numeric, 'line VAT: vat = 7');

-- === I. Buckets (P4), Asia/Bangkok business days ===========================
-- Year [2025-12,2026-02]: 2025 = L4 100 ; 2026 = L5 200 + L6 50 + L7 999 = 1249.
select is((select gross from public.purchase_report(date '2025-12-01', date '2026-02-28', 'year', 'none', 'c0000262-0000-4000-8000-000000000004') where bucket = date '2025-01-01'),
  100::numeric, 'year bucket 2025 = 100');
select is((select gross from public.purchase_report(date '2025-12-01', date '2026-02-28', 'year', 'none', 'c0000262-0000-4000-8000-000000000004') where bucket = date '2026-01-01'),
  1249::numeric, 'year bucket 2026 = 1249 (Jan 200 + Jan-31 50 + tz Feb-01 999)');
-- Month [Jan]: L5 200 + L6 50 (Jan-31 inclusive); L4 Dec + L7 (BKK Feb-01) excluded.
select is((select gross from public.purchase_report(date '2026-01-01', date '2026-01-31', 'month', 'none', 'c0000262-0000-4000-8000-000000000004') where bucket = date '2026-01-01'),
  250::numeric, 'month Jan = 250 (Jan-31 p_to inclusive; Dec + tz-Feb excluded)');
select is((select pr_count from public.purchase_report(date '2026-01-01', date '2026-01-31', 'month', 'none', 'c0000262-0000-4000-8000-000000000004') where bucket = date '2026-01-01'),
  2, 'month Jan pr_count = 2');
-- Day: 2026-01-10 = 200.
select is((select gross from public.purchase_report(date '2026-01-01', date '2026-01-31', 'day', 'none', 'c0000262-0000-4000-8000-000000000004') where bucket = date '2026-01-10'),
  200::numeric, 'day 2026-01-10 = 200');
-- tz: L7 (18:00Z Jan-31) buckets as Bangkok Feb-01.
select is((select gross from public.purchase_report(date '2026-02-01', date '2026-02-28', 'month', 'none', 'c0000262-0000-4000-8000-000000000004') where bucket = date '2026-02-01'),
  999::numeric, 'tz: a UTC-evening Jan-31 purchase falls on Bangkok Feb-01');

-- === J. Excluded statuses (P5) =============================================
select is((select count(*)::int from public.purchase_report(date '2026-01-01', date '2026-12-31', 'month', 'none', 'c0000262-0000-4000-8000-000000000005')),
  0, 'requested / approved / rejected / cancelled all excluded (0 rows for P5)');

-- === K. Null supplier / purchaser buckets (P6, JULY) =======================
select is((select group_label from public.purchase_report(date '2026-07-01', date '2026-07-31', 'month', 'supplier', 'c0000262-0000-4000-8000-000000000006')),
  'ไม่ระบุผู้ขาย', 'null supplier → ไม่ระบุผู้ขาย, shown not dropped');
select is((select group_label from public.purchase_report(date '2026-07-01', date '2026-07-31', 'month', 'purchaser', 'c0000262-0000-4000-8000-000000000006')),
  'ไม่ระบุผู้สั่งซื้อ', 'null requested_by → ไม่ระบุผู้สั่งซื้อ, shown not dropped');

-- === L. Named purchaser (MAY) ==============================================
select is((select group_label from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'purchaser') where group_key = 'a0000262-0000-4000-8000-000000000003'),
  'คุณพีเอ็ม', 'purchaser label from users.full_name');
select is((select gross from public.purchase_report(date '2026-05-01', date '2026-05-31', 'month', 'purchaser') where group_key = 'a0000262-0000-4000-8000-000000000003'),
  460::numeric, 'purchaser คุณพีเอ็ม gross = 460');

reset role;

select * from finish();
rollback;
