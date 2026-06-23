begin;
select plan(14);

-- ============================================================================
-- Spec 178 U3 — Store P&L read (transfer-pricing margin observability).
--   store_pnl(project) returns per-item rows: qty_issued, cost_total (Σ
--   total_cost), sell_total (Σ coalesce(total_sell, total_cost) — unpriced/legacy
--   sells at cost), margin (sell−cost), shrinkage_value (Σ stock_counts.
--   variance_value). REVERSED issues are excluded (anti-join stock_reversals on
--   issue_id). Money gate: super_admin / project_director (mirrors wp_profit) —
--   NOT procurement, NOT site_admin/PM. Read on the user session (definer + gate).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('19191919-1919-1919-1919-000000000195', 'super@pnl.local', '{}'::jsonb),
  ('17171717-1717-1717-1717-000000000195', 'dir@pnl.local',   '{}'::jsonb),
  ('11111111-1111-1111-1111-000000000195', 'pm@pnl.local',    '{}'::jsonb),
  ('13131313-1313-1313-1313-000000000195', 'proc@pnl.local',  '{}'::jsonb);
update public.users set role='super_admin'      where id='19191919-1919-1919-1919-000000000195';
update public.users set role='project_director' where id='17171717-1717-1717-1717-000000000195';
update public.users set role='project_manager'  where id='11111111-1111-1111-1111-000000000195';
update public.users set role='procurement'      where id='13131313-1313-1313-1313-000000000195';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000195', 'PNL-1', 'พีแอนด์แอล ทดสอบ');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000195', 'aa000000-0000-0000-0000-000000000195', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000195', 'electrical', 'มีกำไร', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000195', 'electrical', 'ไม่มีราคาขาย', 'ชิ้น', true);

-- Issues (insert directly; total_cost/total_sell generated). item1 priced @50,
-- cost 30; item2 unpriced (sell_price null → sells at cost 5).
insert into public.stock_issues
  (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price) values
  ('a1000000-0000-0000-0000-000000000195', 'aa000000-0000-0000-0000-000000000195',
   'ee000000-0000-0000-0000-000000000195', 'cc000000-0000-0000-0000-000000000195', 10, 'ชิ้น', 30, 50),
  ('a2000000-0000-0000-0000-000000000195', 'aa000000-0000-0000-0000-000000000195',
   'ee000000-0000-0000-0000-000000000195', 'cc000000-0000-0000-0000-000000000195', 5,  'ชิ้น', 30, 50),
  ('a3000000-0000-0000-0000-000000000195', 'aa000000-0000-0000-0000-000000000195',
   'ef000000-0000-0000-0000-000000000195', 'cc000000-0000-0000-0000-000000000195', 4,  'ชิ้น', 5,  null),
  -- D: a big item1 issue that is REVERSED → must be excluded from the P&L.
  ('dd000000-0000-0000-0000-000000000195', 'aa000000-0000-0000-0000-000000000195',
   'ee000000-0000-0000-0000-000000000195', 'cc000000-0000-0000-0000-000000000195', 100,'ชิ้น', 30, 50);
insert into public.stock_reversals (project_id, catalog_item_id, issue_id, qty, value_delta) values
  ('aa000000-0000-0000-0000-000000000195', 'ee000000-0000-0000-0000-000000000195',
   'dd000000-0000-0000-0000-000000000195', 100, 3000);
-- A count for item1: system 10, counted 8 @ cost 30 → variance_value -60 (shrinkage).
insert into public.stock_counts (project_id, catalog_item_id, system_qty, counted_qty, unit, unit_cost) values
  ('aa000000-0000-0000-0000-000000000195', 'ee000000-0000-0000-0000-000000000195', 10, 8, 'ชิ้น', 30);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select ok(to_regprocedure('public.store_pnl(uuid)') is not null, 'store_pnl exists');
select is(has_function_privilege('anon', 'public.store_pnl(uuid)', 'EXECUTE'),
  false, 'anon cannot execute store_pnl');

set local role authenticated;

-- B. super_admin reads the P&L. item1: 10+5 issued (D reversed, excluded).
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000195"}';
select is((select qty_issued from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ee000000-0000-0000-0000-000000000195'),
  15::numeric, 'item1 qty_issued = 15 (reversed issue D excluded)');
select is((select cost_total from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ee000000-0000-0000-0000-000000000195'),
  450::numeric, 'item1 cost_total = 450 (15 * 30)');
select is((select sell_total from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ee000000-0000-0000-0000-000000000195'),
  750::numeric, 'item1 sell_total = 750 (15 * 50)');
select is((select margin from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ee000000-0000-0000-0000-000000000195'),
  300::numeric, 'item1 margin = 300 (sell 750 − cost 450)');
select is((select shrinkage_value from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ee000000-0000-0000-0000-000000000195'),
  -60::numeric, 'item1 shrinkage_value = −60 (count short 2 @ 30)');

-- C. item2 unpriced → sells AT COST (margin 0); no count → shrinkage 0.
select is((select sell_total from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ef000000-0000-0000-0000-000000000195'),
  20::numeric, 'item2 (unpriced) sell_total = cost 20 (4 * 5)');
select is((select margin from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ef000000-0000-0000-0000-000000000195'),
  0::numeric, 'item2 margin = 0 (unpriced sells at cost)');
select is((select shrinkage_value from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ef000000-0000-0000-0000-000000000195'),
  0::numeric, 'item2 shrinkage_value = 0 (no count → coalesced)');

-- D. project_director may also read (executive money tier).
set local "request.jwt.claims" = '{"sub": "17171717-1717-1717-1717-000000000195"}';
select is((select qty_issued from public.store_pnl('aa000000-0000-0000-0000-000000000195')
     where catalog_item_id='ee000000-0000-0000-0000-000000000195'),
  15::numeric, 'project_director reads store_pnl');

-- E. Deny: PM + procurement cannot read the store P&L (margin-sensitive).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000195"}';
select throws_ok(
  $$ select * from public.store_pnl('aa000000-0000-0000-0000-000000000195') $$,
  '42501', null, 'project_manager cannot read store_pnl (42501)');
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000195"}';
select throws_ok(
  $$ select * from public.store_pnl('aa000000-0000-0000-0000-000000000195') $$,
  '42501', null, 'procurement cannot read store_pnl (42501)');

-- F. Unknown project → 22023.
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000195"}';
select throws_ok(
  $$ select * from public.store_pnl('ffffffff-0000-0000-0000-000000000195') $$,
  '22023', null, 'unknown project rejected (22023)');

reset role;

select * from finish();
rollback;
