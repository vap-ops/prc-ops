begin;
select plan(16);

-- ============================================================================
-- Spec 178 B6b / ADR 0057 — the store GL adjustment legs (count + reversal), at
-- COST. Completes B6a (receive + issue).
--   count shrinkage (short): Dr COGS-materials 5100 / Cr Inventory 1500
--   count overage:           Dr Inventory 1500 / Cr COGS-materials 5100
--   count zero-variance:     no journal entry (poster returns null)
--   reverse receipt:         Dr AP 2100 / Cr Inventory 1500   (flip the รับเข้า)
--   reverse issue:           Dr Inventory 1500 / Cr WIP 1400   (flip the เบิก)
-- Posters mirror B6a (service_role-only, balanced); AFTER-INSERT triggers enqueue.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000199', 'pm@stadj.local', '{}'::jsonb);
insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000199', 'STADJ-1', 'สโตร์ปรับปรุง');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000199', 'aa000000-0000-0000-0000-000000000199', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000199', 'electrical', 'วัสดุปรับปรุง', 'ชิ้น', true);
insert into public.suppliers (id, name, created_by) values
  ('5a000000-0000-0000-0000-000000000199', 'ร้านปรับปรุง', '11111111-1111-1111-1111-000000000199');

-- Counts: short (variance_value -60), over (+60), zero (0). variance_value generated.
insert into public.stock_counts
  (id, project_id, catalog_item_id, system_qty, counted_qty, unit, unit_cost) values
  ('c1000000-0000-0000-0000-000000000199', 'aa000000-0000-0000-0000-000000000199',
   'ee000000-0000-0000-0000-000000000199', 10, 8,  'ชิ้น', 30),
  ('c2000000-0000-0000-0000-000000000199', 'aa000000-0000-0000-0000-000000000199',
   'ee000000-0000-0000-0000-000000000199', 10, 12, 'ชิ้น', 30),
  ('c3000000-0000-0000-0000-000000000199', 'aa000000-0000-0000-0000-000000000199',
   'ee000000-0000-0000-0000-000000000199', 10, 10, 'ชิ้น', 30);

-- A receipt + its reversal; an issue + its reversal (total_cost generated).
insert into public.stock_receipts
  (id, project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, created_by) values
  ('a1000000-0000-0000-0000-000000000199', 'aa000000-0000-0000-0000-000000000199',
   'ee000000-0000-0000-0000-000000000199', 10, 'ชิ้น', 30,
   '5a000000-0000-0000-0000-000000000199', '11111111-1111-1111-1111-000000000199');
insert into public.stock_issues
  (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, issued_by) values
  ('a2000000-0000-0000-0000-000000000199', 'aa000000-0000-0000-0000-000000000199',
   'ee000000-0000-0000-0000-000000000199', 'cc000000-0000-0000-0000-000000000199', 4, 'ชิ้น', 30,
   '11111111-1111-1111-1111-000000000199');
insert into public.stock_reversals
  (id, project_id, catalog_item_id, receipt_id, issue_id, qty, value_delta, reversed_by) values
  ('d1000000-0000-0000-0000-000000000199', 'aa000000-0000-0000-0000-000000000199',
   'ee000000-0000-0000-0000-000000000199', 'a1000000-0000-0000-0000-000000000199', null, 10, -300,
   '11111111-1111-1111-1111-000000000199'),
  ('d2000000-0000-0000-0000-000000000199', 'aa000000-0000-0000-0000-000000000199',
   'ee000000-0000-0000-0000-000000000199', null, 'a2000000-0000-0000-0000-000000000199', 4, 120,
   '11111111-1111-1111-1111-000000000199');

-- A. Structure.
select is(has_function_privilege('authenticated', 'public.post_stock_count_to_gl(uuid)', 'EXECUTE'),
  false, 'authenticated cannot execute post_stock_count_to_gl');
select is(has_function_privilege('authenticated', 'public.post_stock_reversal_to_gl(uuid)', 'EXECUTE'),
  false, 'authenticated cannot execute post_stock_reversal_to_gl');
select is(
  (select count(*)::int from public.gl_posting_outbox
     where source_table='stock_counts' and source_id='c1000000-0000-0000-0000-000000000199'),
  1, 'inserting a stock_count enqueued a GL posting job');

-- B. Count shrinkage (short): Dr 5100 / Cr 1500 = 60.
select lives_ok(
  $$ select public.post_stock_count_to_gl('c1000000-0000-0000-0000-000000000199') $$,
  'post_stock_count_to_gl posts a shrinkage');
select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_counts' and source_id='c1000000-0000-0000-0000-000000000199')
       and account_id = (select id from public.gl_accounts where code='5100') and debit = 60),
  1::bigint, 'shrinkage Dr COGS-materials (5100) = 60');
select is(
  (select sum(debit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_counts' and source_id='c1000000-0000-0000-0000-000000000199')),
  (select sum(credit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_counts' and source_id='c1000000-0000-0000-0000-000000000199')),
  'the shrinkage entry balances');

-- C. Count overage: Dr 1500 / Cr 5100 = 60.
select lives_ok(
  $$ select public.post_stock_count_to_gl('c2000000-0000-0000-0000-000000000199') $$,
  'post_stock_count_to_gl posts an overage');
select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_counts' and source_id='c2000000-0000-0000-0000-000000000199')
       and account_id = (select id from public.gl_accounts where code='1500') and debit = 60),
  1::bigint, 'overage Dr Inventory (1500) = 60');

-- D. Count zero-variance: no journal entry.
select lives_ok(
  $$ select public.post_stock_count_to_gl('c3000000-0000-0000-0000-000000000199') $$,
  'post_stock_count_to_gl on a zero-variance count is a no-op');
select is(
  (select count(*)::int from public.journal_entries
     where source_table='stock_counts' and source_id='c3000000-0000-0000-0000-000000000199'),
  0, 'a zero-variance count posts no journal entry');

-- E. Reverse a receipt: Dr AP 2100 / Cr Inventory 1500 = 300.
select lives_ok(
  $$ select public.post_stock_reversal_to_gl('d1000000-0000-0000-0000-000000000199') $$,
  'post_stock_reversal_to_gl flips a รับเข้า');
select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_reversals' and source_id='d1000000-0000-0000-0000-000000000199')
       and account_id = (select id from public.gl_accounts where code='2100') and debit = 300),
  1::bigint, 'receipt reversal Dr AP (2100) = 300');
select is(
  (select sum(debit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_reversals' and source_id='d1000000-0000-0000-0000-000000000199')),
  (select sum(credit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_reversals' and source_id='d1000000-0000-0000-0000-000000000199')),
  'the receipt-reversal entry balances');

-- F. Reverse an issue: Dr Inventory 1500 / Cr WIP 1400 (the WP) = 120.
select lives_ok(
  $$ select public.post_stock_reversal_to_gl('d2000000-0000-0000-0000-000000000199') $$,
  'post_stock_reversal_to_gl flips a เบิก');
select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_reversals' and source_id='d2000000-0000-0000-0000-000000000199')
       and account_id = (select id from public.gl_accounts where code='1400') and credit = 120
       and work_package_id = 'cc000000-0000-0000-0000-000000000199'),
  1::bigint, 'issue reversal Cr WIP (1400) = 120 with WP dim');
select is(
  (select sum(debit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_reversals' and source_id='d2000000-0000-0000-0000-000000000199')),
  (select sum(credit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_reversals' and source_id='d2000000-0000-0000-0000-000000000199')),
  'the issue-reversal entry balances');

select * from finish();
rollback;
