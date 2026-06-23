begin;
select plan(4);

-- ============================================================================
-- Spec 178 U4 — flip wp_profit: fold the store-issue SELL into materials.
--   wp_profit's materials_cost = GL acct-1400 purchase cost (unchanged) PLUS the
--   per-WP Σ coalesce(total_sell, total_cost) of NON-reversed stock_issues (the
--   store transfer price). Disjoint sources (store issues aren't in the GL) → no
--   double-count. Same return signature (CREATE OR REPLACE). Reversed issues are
--   excluded. A WP with no store draws is unchanged (materials from GL only).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('19191919-1919-1919-1919-000000000196', 'super@wpsell.local', '{}'::jsonb);
update public.users set role='super_admin' where id='19191919-1919-1919-1919-000000000196';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000196', 'WPSELL-1', 'กำไร WP ทดสอบ');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000196', 'aa000000-0000-0000-0000-000000000196', 'WP-1', 'งานมีเบิก'),
  ('cd000000-0000-0000-0000-000000000196', 'aa000000-0000-0000-0000-000000000196', 'WP-2', 'งานไม่มีเบิก');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000196', 'electrical', 'มีราคาขาย', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000196', 'electrical', 'ไม่มีราคาขาย', 'ชิ้น', true);
-- WP-1 has a budget (so profit is not null); WP-2 has none.
insert into public.wp_economics (work_package_id, budget) values
  ('cc000000-0000-0000-0000-000000000196', 1000);

-- Store issues drawn TO WP-1: priced (sell 500) + unpriced (at cost 20) + a big
-- REVERSED one (sell 5000 — must be excluded). No labor/equipment → those terms 0.
insert into public.stock_issues
  (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price) values
  ('b1000000-0000-0000-0000-000000000196', 'aa000000-0000-0000-0000-000000000196',
   'ee000000-0000-0000-0000-000000000196', 'cc000000-0000-0000-0000-000000000196', 10, 'ชิ้น', 30, 50),
  ('b2000000-0000-0000-0000-000000000196', 'aa000000-0000-0000-0000-000000000196',
   'ef000000-0000-0000-0000-000000000196', 'cc000000-0000-0000-0000-000000000196', 4,  'ชิ้น', 5,  null),
  ('bd000000-0000-0000-0000-000000000196', 'aa000000-0000-0000-0000-000000000196',
   'ee000000-0000-0000-0000-000000000196', 'cc000000-0000-0000-0000-000000000196', 100,'ชิ้น', 30, 50);
insert into public.stock_reversals (project_id, catalog_item_id, issue_id, qty, value_delta) values
  ('aa000000-0000-0000-0000-000000000196', 'ee000000-0000-0000-0000-000000000196',
   'bd000000-0000-0000-0000-000000000196', 100, 3000);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000196"}';

-- WP-1: materials = store-sell 500 + 20 = 520 (no GL; reversed 5000 excluded).
select is((select materials_cost from public.wp_profit('cc000000-0000-0000-0000-000000000196')),
  520::numeric, 'WP-1 materials_cost = store-sell 520 (priced 500 + unpriced-at-cost 20; reversed excluded)');
select is((select profit from public.wp_profit('cc000000-0000-0000-0000-000000000196')),
  480::numeric, 'WP-1 profit = budget 1000 − labor 0 − materials 520 − equip 0');
-- WP-2 has no store draws → materials unchanged (GL only = 0 here).
select is((select materials_cost from public.wp_profit('cd000000-0000-0000-0000-000000000196')),
  0::numeric, 'WP-2 (no store issues) materials_cost = 0 — the fold is per-WP, no leak');
-- Only the materials line changed; labor stays 0 (no labor logs).
select is((select labor_sell from public.wp_profit('cc000000-0000-0000-0000-000000000196')),
  0::numeric, 'WP-1 labor_sell = 0 (only the materials line folds in store-sell)');

reset role;

select * from finish();
rollback;
