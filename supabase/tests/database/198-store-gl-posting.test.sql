begin;
select plan(13);

-- ============================================================================
-- Spec 178 B6a / ADR 0057 — post store movements to the GL (at COST). A new
-- Inventory asset account (1500); a รับเข้า posts Dr Inventory / Cr AP, a เบิก
-- posts Dr WIP (the WP) / Cr Inventory. Mirrors post_purchase_to_gl (reverse-and-
-- repost, service_role-only, balanced via post_journal_internal) + the async
-- enqueue trigger. The SELL/margin stays in the management P&L — the GL is COST.
-- Issues post under source_table='stock_issues' so wp_profit's 1400-purchase
-- filter excludes them (no double-count). Count + reversal legs = B6b.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000198', 'pm@stgl.local', '{}'::jsonb);

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000198', 'STGL-1', 'สโตร์ GL ทดสอบ');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000198', 'aa000000-0000-0000-0000-000000000198', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000198', 'electrical', 'วัสดุ GL', 'ชิ้น', true);
insert into public.suppliers (id, name, created_by) values
  ('5a000000-0000-0000-0000-000000000198', 'ร้าน GL', '11111111-1111-1111-1111-000000000198');

-- A receipt (10 @ 30 → total_cost 300) + an issue (4 @ 30 → total_cost 120). The
-- AFTER-INSERT enqueue trigger fires on each insert (assertion 4 checks it).
insert into public.stock_receipts
  (id, project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, created_by) values
  ('a1000000-0000-0000-0000-000000000198', 'aa000000-0000-0000-0000-000000000198',
   'ee000000-0000-0000-0000-000000000198', 10, 'ชิ้น', 30,
   '5a000000-0000-0000-0000-000000000198', '11111111-1111-1111-1111-000000000198');
insert into public.stock_issues
  (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, issued_by) values
  ('a2000000-0000-0000-0000-000000000198', 'aa000000-0000-0000-0000-000000000198',
   'ee000000-0000-0000-0000-000000000198', 'cc000000-0000-0000-0000-000000000198', 4, 'ชิ้น', 30,
   '11111111-1111-1111-1111-000000000198');

-- A. Structure.
select is(
  (select is_postable from public.gl_accounts where code='1500'),
  true, 'Inventory account 1500 exists and is postable');
select is(has_function_privilege('authenticated',
  'public.post_stock_receipt_to_gl(uuid)', 'EXECUTE'),
  false, 'authenticated cannot execute post_stock_receipt_to_gl (service_role only)');
select is(has_function_privilege('authenticated',
  'public.post_stock_issue_to_gl(uuid)', 'EXECUTE'),
  false, 'authenticated cannot execute post_stock_issue_to_gl (service_role only)');

-- B. The enqueue trigger fired on the receipt insert.
select is(
  (select count(*)::int from public.gl_posting_outbox
     where source_table='stock_receipts' and source_id='a1000000-0000-0000-0000-000000000198'),
  1, 'inserting a stock_receipt enqueued a GL posting job');

-- C. Receive posting: Dr Inventory 1500 / Cr AP 2100, at cost (300), balanced.
select lives_ok(
  $$ select public.post_stock_receipt_to_gl('a1000000-0000-0000-0000-000000000198') $$,
  'post_stock_receipt_to_gl posts the รับเข้า');
select is(
  (select sum(debit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_receipts' and source_id='a1000000-0000-0000-0000-000000000198'
         and source_event='stock_receive')),
  (select sum(credit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_receipts' and source_id='a1000000-0000-0000-0000-000000000198'
         and source_event='stock_receive')),
  'the receive entry balances (Σdebit = Σcredit)');
select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_receipts' and source_id='a1000000-0000-0000-0000-000000000198'
         and source_event='stock_receive')
       and account_id = (select id from public.gl_accounts where code='1500')
       and debit = 300 and project_id = 'aa000000-0000-0000-0000-000000000198'),
  1::bigint, 'Inventory (1500) debit = cost 300 with project dim');
select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_receipts' and source_id='a1000000-0000-0000-0000-000000000198'
         and source_event='stock_receive')
       and account_id = (select id from public.gl_accounts where code='2100')
       and credit = 300 and supplier_id = '5a000000-0000-0000-0000-000000000198'),
  1::bigint, 'AP (2100) credit = cost 300 with supplier party');

-- D. Issue posting: Dr WIP 1400 (the WP) / Cr Inventory 1500, at cost (120).
select lives_ok(
  $$ select public.post_stock_issue_to_gl('a2000000-0000-0000-0000-000000000198') $$,
  'post_stock_issue_to_gl posts the เบิก');
select is(
  (select sum(debit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_issues' and source_id='a2000000-0000-0000-0000-000000000198'
         and source_event='stock_issue')),
  (select sum(credit) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_issues' and source_id='a2000000-0000-0000-0000-000000000198'
         and source_event='stock_issue')),
  'the issue entry balances (Σdebit = Σcredit)');
select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_issues' and source_id='a2000000-0000-0000-0000-000000000198'
         and source_event='stock_issue')
       and account_id = (select id from public.gl_accounts where code='1400')
       and debit = 120 and project_id = 'aa000000-0000-0000-0000-000000000198'
       and work_package_id = 'cc000000-0000-0000-0000-000000000198'),
  1::bigint, 'WIP (1400) debit = cost 120 with project + WP dims');
select is(
  (select count(*) from public.journal_lines
     where entry_id = (select id from public.journal_entries
       where source_table='stock_issues' and source_id='a2000000-0000-0000-0000-000000000198'
         and source_event='stock_issue')
       and account_id = (select id from public.gl_accounts where code='1500')
       and credit = 120),
  1::bigint, 'Inventory (1500) credit = cost 120 (relieved into WIP)');
-- The issue posts under source_table='stock_issues' (NOT purchase_requests), so
-- wp_profit's 1400-purchase filter excludes it — the store-sell term covers it.
select is(
  (select source_table from public.journal_entries
     where source_id='a2000000-0000-0000-0000-000000000198' and source_event='stock_issue'),
  'stock_issues', 'the issue entry is tagged stock_issues (wp_profit excludes it from the GL term)');

select * from finish();
rollback;
