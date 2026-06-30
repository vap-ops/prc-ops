begin;
select plan(8);

-- ============================================================================
-- ERD audit follow-up M7b (2026-06-29). stock_issues was excluded from the M7
-- append-only block triggers because it has a LEGITIMATE custody UPDATE
-- (confirm_stock_issue / confirm_on_behalf set received_at / received_by /
-- received_on_behalf). Its LEDGER fields (qty / cost / item / WP / project refs)
-- still need protection, so this adds a COLUMN-SCOPED freeze: a BEFORE UPDATE
-- trigger that allows only the three custody columns to change and raises P0001
-- on any other column edit, plus the standard DELETE/TRUNCATE block.
-- ============================================================================

-- Minimal fixture (mirrors 183-store-custody): one project / WP / catalog item /
-- on-hand row, then a directly-seeded stock_issue to mutate.
insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000105', 'M7B-PROJ', 'm7b freeze fixture');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000105', 'aa000000-0000-0000-0000-000000000105', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000105', 'electrical', 'วัสดุ m7b', 'ชิ้น', true);
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000105', 'ee000000-0000-0000-0000-000000000105', 100, 1000);
insert into public.stock_issues (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost)
values ('d0000000-0000-0000-0000-000000000105', 'aa000000-0000-0000-0000-000000000105',
  'ee000000-0000-0000-0000-000000000105', 'cc000000-0000-0000-0000-000000000105', 5, 'ชิ้น', 10);

-- A. Triggers exist.
select has_trigger('public', 'stock_issues', 'stock_issues_freeze_ledger',
  'M7b: stock_issues_freeze_ledger (column-scoped) exists');
select has_trigger('public', 'stock_issues', 'stock_issues_no_delete',
  'M7b: stock_issues_no_delete exists');
select has_trigger('public', 'stock_issues', 'stock_issues_no_truncate',
  'M7b: stock_issues_no_truncate exists');

-- B. Ledger fields are frozen.
select throws_ok(
  $$ update public.stock_issues set qty = 99
     where id = 'd0000000-0000-0000-0000-000000000105' $$,
  'P0001', null, 'M7b: editing qty (a ledger field) is rejected');
select throws_ok(
  $$ update public.stock_issues set unit_cost = 99
     where id = 'd0000000-0000-0000-0000-000000000105' $$,
  'P0001', null, 'M7b: editing unit_cost (a ledger field) is rejected');

-- C. Custody fields still mutable (confirm_stock_issue / confirm_on_behalf path).
select lives_ok(
  $$ update public.stock_issues set received_at = now()
     where id = 'd0000000-0000-0000-0000-000000000105' $$,
  'M7b: setting received_at (custody) is allowed');
select lives_ok(
  $$ update public.stock_issues set received_on_behalf = true
     where id = 'd0000000-0000-0000-0000-000000000105' $$,
  'M7b: setting received_on_behalf (custody) is allowed');

-- D. DELETE is blocked (append-only; correct via stock_reversals).
select throws_ok(
  $$ delete from public.stock_issues where id = 'd0000000-0000-0000-0000-000000000105' $$,
  'P0001', null, 'M7b: deleting a stock_issue is rejected');

select * from finish();
rollback;
