begin;
select plan(12);

-- ============================================================================
-- Spec 178 U2 — issue snapshots the SELL price (transfer pricing at issue).
--   stock_issues gains sell_price (snapshot at issue) + total_sell (generated
--   qty*sell_price). issue_stock (same 6-arg sig, CREATE OR REPLACE) computes
--   sell_price = coalesce(item_sell_rate, moving-avg cost) — an unpriced item
--   sells AT COST (zero store margin), never null. The snapshot is immutable:
--   changing a rate only affects FUTURE issues.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('19191919-1919-1919-1919-000000000187', 'super@isell.local', '{}'::jsonb);
update public.users set role='super_admin' where id='19191919-1919-1919-1919-000000000187';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000187', 'ISELL-1', 'ขายเบิก ทดสอบ');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000187', 'aa000000-0000-0000-0000-000000000187', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000187', 'electrical', 'มีราคาขาย', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000187', 'electrical', 'ไม่มีราคาขาย', 'ชิ้น', true);
-- item1 (ee) has a sell rate of 50; item2 (ef) has NO rate → sells at cost.
insert into public.item_sell_rates (catalog_item_id, sell_rate) values
  ('ee000000-0000-0000-0000-000000000187', 50);
-- Pre-seed on-hand (owner bypasses RLS). item1: 20 @ avg 30; item2: 10 @ avg 5.
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000187', 'ee000000-0000-0000-0000-000000000187', 20, 600),
  ('aa000000-0000-0000-0000-000000000187', 'ef000000-0000-0000-0000-000000000187', 10, 50);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_column('public', 'stock_issues', 'sell_price', 'stock_issues has sell_price');
select has_column('public', 'stock_issues', 'total_sell', 'stock_issues has total_sell');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000187"}';

-- B. Issue item1 (qty 5) — has a sell rate of 50; cost (moving-avg) is 30.
select isnt(
  (select public.issue_stock('aa000000-0000-0000-0000-000000000187',
     'ee000000-0000-0000-0000-000000000187', 'cc000000-0000-0000-0000-000000000187', 5, 'เบิกมีราคา')),
  null, 'issue item1 (qty 5) — returns id');
select is(
  (select sell_price from public.stock_issues
     where catalog_item_id='ee000000-0000-0000-0000-000000000187' and qty=5),
  50::numeric, 'item1 sell_price snapshot = the rate 50');
select is(
  (select total_sell from public.stock_issues
     where catalog_item_id='ee000000-0000-0000-0000-000000000187' and qty=5),
  250::numeric, 'item1 total_sell generated = 250 (5 * 50)');
select is(
  (select unit_cost from public.stock_issues
     where catalog_item_id='ee000000-0000-0000-0000-000000000187' and qty=5),
  30::numeric, 'item1 unit_cost = moving-avg 30 (cost unchanged)');

-- C. Issue item2 (qty 4) — NO rate → sells AT COST (moving-avg 5).
select isnt(
  (select public.issue_stock('aa000000-0000-0000-0000-000000000187',
     'ef000000-0000-0000-0000-000000000187', 'cc000000-0000-0000-0000-000000000187', 4, null)),
  null, 'issue item2 (qty 4, no rate) — returns id');
select is(
  (select sell_price from public.stock_issues
     where catalog_item_id='ef000000-0000-0000-0000-000000000187' and qty=4),
  5::numeric, 'item2 (no rate) sell_price falls back to moving-avg cost 5');
select is(
  (select total_sell from public.stock_issues
     where catalog_item_id='ef000000-0000-0000-0000-000000000187' and qty=4),
  20::numeric, 'item2 total_sell = 20 (4 * 5)');

-- D. Snapshot immutability: bump item1 rate to 80, issue again (qty 7).
select public.set_item_sell_rate('ee000000-0000-0000-0000-000000000187', 80);
select isnt(
  (select public.issue_stock('aa000000-0000-0000-0000-000000000187',
     'ee000000-0000-0000-0000-000000000187', 'cc000000-0000-0000-0000-000000000187', 7, null)),
  null, 'issue item1 again (qty 7) at the new rate — returns id');
select is(
  (select sell_price from public.stock_issues
     where catalog_item_id='ee000000-0000-0000-0000-000000000187' and qty=7),
  80::numeric, 'the new item1 issue (qty 7) snapshots the new rate 80');
select is(
  (select sell_price from public.stock_issues
     where catalog_item_id='ee000000-0000-0000-0000-000000000187' and qty=5),
  50::numeric, 'the first item1 issue (qty 5) keeps sell_price 50 (immutable snapshot)');

reset role;

select * from finish();
rollback;
