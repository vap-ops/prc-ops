begin;
select plan(11);

-- ============================================================================
-- Fix 2026-06-28 / ADR 0057 — drain_gl_posting must route EVERY store movement,
-- not just receipts. Regression guard for the "re-sourced a stale drain body"
-- trap (spec 209 U1 dropped the spec-178-B6b stock_counts + stock_reversals arms
-- → a −16,400 ตรวจนับ silently went 'skipped', GL 1500 drifted from the physical
-- ledger). The B6b test (199) drove the POSTERS directly, so it never exercised
-- the drainer's CASE — this drives the full enqueue → drain → journal_entry path.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000235', 'pm@gldrain.local', '{}'::jsonb);
insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000235', 'GLDRAIN-1', 'สโตร์ทดสอบ drain');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000235', 'aa000000-0000-0000-0000-000000000235', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000235', 'electrical', 'วัสดุ drain', 'ชิ้น', true);
insert into public.suppliers (id, name, created_by) values
  ('5a000000-0000-0000-0000-000000000235', 'ร้าน drain', '11111111-1111-1111-1111-000000000235');

-- Isolate from prod outbox rows (the queue is pruned but the every-minute cron may
-- hold pending jobs in another snapshot). Owner context; rolled back with the test.
delete from public.gl_posting_outbox;

-- Five store movements, one of every kind that books to GL 1500. Each INSERT fires
-- its AFTER-INSERT enqueue trigger → one pending outbox job.
insert into public.stock_receipts
  (id, project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, created_by) values
  ('a1000000-0000-0000-0000-000000000235', 'aa000000-0000-0000-0000-000000000235',
   'ee000000-0000-0000-0000-000000000235', 10, 'ชิ้น', 30,
   '5a000000-0000-0000-0000-000000000235', '11111111-1111-1111-1111-000000000235');
insert into public.stock_issues
  (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, issued_by) values
  ('a2000000-0000-0000-0000-000000000235', 'aa000000-0000-0000-0000-000000000235',
   'ee000000-0000-0000-0000-000000000235', 'cc000000-0000-0000-0000-000000000235', 4, 'ชิ้น', 30,
   '11111111-1111-1111-1111-000000000235');
insert into public.stock_returns
  (id, project_id, catalog_item_id, issue_id, work_package_id, qty, unit, unit_cost, returned_by) values
  ('b1000000-0000-0000-0000-000000000235', 'aa000000-0000-0000-0000-000000000235',
   'ee000000-0000-0000-0000-000000000235', 'a2000000-0000-0000-0000-000000000235',
   'cc000000-0000-0000-0000-000000000235', 2, 'ชิ้น', 30, '11111111-1111-1111-1111-000000000235');
insert into public.stock_reversals
  (id, project_id, catalog_item_id, receipt_id, issue_id, qty, value_delta, reversed_by) values
  ('d1000000-0000-0000-0000-000000000235', 'aa000000-0000-0000-0000-000000000235',
   'ee000000-0000-0000-0000-000000000235', 'a1000000-0000-0000-0000-000000000235', null, 10, -300,
   '11111111-1111-1111-1111-000000000235');
-- Non-zero variance (−60) → a real GL effect that MUST land an entry.
insert into public.stock_counts
  (id, project_id, catalog_item_id, system_qty, counted_qty, unit, unit_cost) values
  ('c1000000-0000-0000-0000-000000000235', 'aa000000-0000-0000-0000-000000000235',
   'ee000000-0000-0000-0000-000000000235', 10, 8, 'ชิ้น', 30);

-- A. Structural pin — the drainer's CASE must name every store source. Cheap, no
--    fixtures: catches a future re-source trap before money silently drifts.
select has_function('public', 'drain_gl_posting', 'drain_gl_posting exists');
select ok(position('stock_counts' in
    pg_get_functiondef('public.drain_gl_posting(integer)'::regprocedure)) > 0,
  'drain_gl_posting routes stock_counts');
select ok(position('stock_reversals' in
    pg_get_functiondef('public.drain_gl_posting(integer)'::regprocedure)) > 0,
  'drain_gl_posting routes stock_reversals');

-- B. End-to-end: drain posts all five store jobs (none fall to the skipped arm).
select is((select public.drain_gl_posting(100)), 5, 'drain posts all five store jobs');

-- C. Each non-zero movement lands a posted journal entry, keyed by its source.
select is((select count(*)::int from public.journal_entries
  where source_table='stock_counts' and source_id='c1000000-0000-0000-0000-000000000235' and status='posted'),
  1, 'the stock_count (variance −60) posted a journal entry');
select is((select count(*)::int from public.journal_entries
  where source_table='stock_issues' and source_id='a2000000-0000-0000-0000-000000000235' and status='posted'),
  1, 'the stock_issue posted a journal entry');
select is((select count(*)::int from public.journal_entries
  where source_table='stock_returns' and source_id='b1000000-0000-0000-0000-000000000235' and status='posted'),
  1, 'the stock_return posted a journal entry');
select is((select count(*)::int from public.journal_entries
  where source_table='stock_reversals' and source_id='d1000000-0000-0000-0000-000000000235' and status='posted'),
  1, 'the stock_reversal posted a journal entry');
select is((select count(*)::int from public.journal_entries
  where source_table='stock_receipts' and source_id='a1000000-0000-0000-0000-000000000235' and status='posted'),
  1, 'the stock_receipt posted a journal entry');

-- D. The regression itself: NOTHING was marked 'skipped'. Pre-fix the count +
--    reversal jobs landed here (unknown source_table) and GL 1500 drifted.
select is((select count(*)::int from public.gl_posting_outbox where status='skipped'),
  0, 'no store job was skipped (the drift bug)');
select is((select count(*)::int from public.gl_posting_outbox where status='posted'),
  5, 'all five outbox jobs are marked posted');

select * from finish();
rollback;
