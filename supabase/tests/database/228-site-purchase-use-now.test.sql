begin;
select plan(28);

-- ============================================================================
-- Spec 208 U3b — on-site "ใช้ที่งานนี้เลย" (buy & use on this WP now).
-- site_purchase_use_now(project, wp, catalog_item, qty, unit_cost, note?)
-- atomically RECEIVES a catalogued item into the store AND ISSUES it to the WP.
-- Net qty-on-hand is unchanged (received then issued the same qty); the WP is
-- charged at moving-average cost. Gate = issue_stock's (SITE_STAFF + membership;
-- procurement excluded). Sections: A structure, B happy, C validations, D gate.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000228', 'pmmember@un.local',   '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000228', 'pmoutsider@un.local', '{}'::jsonb),
  ('13131313-1313-1313-1313-000000000228', 'procurement@un.local','{}'::jsonb),
  ('14141414-1414-1414-1414-000000000228', 'visitor@un.local',    '{}'::jsonb),
  ('15151515-1515-1515-1515-000000000228', 'sitemember@un.local', '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000228', 'super@un.local',      '{}'::jsonb);
update public.users set role='project_manager' where id='11111111-1111-1111-1111-000000000228';
update public.users set role='project_manager' where id='12121212-1212-1212-1212-000000000228';
update public.users set role='procurement'     where id='13131313-1313-1313-1313-000000000228';
update public.users set role='site_admin'      where id='15151515-1515-1515-1515-000000000228';
update public.users set role='super_admin'     where id='19191919-1919-1919-1919-000000000228';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000228', 'UN-PROJ-1', 'ซื้อใช้เลย 1'),
  ('bb000000-0000-0000-0000-000000000228', 'UN-PROJ-2', 'ซื้อใช้เลย 2');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000000-0000-0000-0000-000000000228', 'aa000000-0000-0000-0000-000000000228',
   'WP-UN-1', 'งานซื้อใช้เลย', 'in_progress'),
  ('ff000000-0000-0000-0000-000000000228', 'bb000000-0000-0000-0000-000000000228',
   'WP-UN-2', 'งานคนละโครงการ', 'in_progress');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('dd000000-0000-0000-0000-000000000228', 'electrical', 'วัสดุซื้อใช้ A', 'ชิ้น', true),
  ('de000000-0000-0000-0000-000000000228', 'electrical', 'วัสดุซื้อใช้ B', 'ชิ้น', true),
  ('df000000-0000-0000-0000-000000000228', 'electrical', 'วัสดุปิดใช้งาน', 'ชิ้น', false),
  -- spec 211 U11c-A: a VAT buy-&-use item.
  ('d1000000-0000-0000-0000-000000000228', 'electrical', 'วัสดุมีใบกำกับ', 'ชิ้น', true);

insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000228', '15151515-1515-1515-1515-000000000228',
   '19191919-1919-1919-1919-000000000228'),
  ('aa000000-0000-0000-0000-000000000228', '11111111-1111-1111-1111-000000000228',
   '19191919-1919-1919-1919-000000000228');

-- itemB has PRIOR store stock (10 @ avg 35); itemA starts empty.
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000228', 'de000000-0000-0000-0000-000000000228', 10, 350);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Structure.
-- ============================================================================
select ok(to_regprocedure('public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text, numeric)')
  is not null, 'site_purchase_use_now exists (7-arg, +p_vat_rate)');
select is(has_function_privilege('anon',
  'public.site_purchase_use_now(uuid, uuid, uuid, numeric, numeric, text, numeric)', 'EXECUTE'),
  false, 'anon cannot execute site_purchase_use_now');

set local role authenticated;

-- ============================================================================
-- B. Happy: site_admin member buys-&-uses itemA (no prior stock) qty 5 @ 20 → WP1.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000228"}';
select ok(
  (select public.site_purchase_use_now(
     'aa000000-0000-0000-0000-000000000228',
     'ee000000-0000-0000-0000-000000000228',
     'dd000000-0000-0000-0000-000000000228', 5, 20)) is not null,
  'buy-&-use returns the issue id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000228'
       and catalog_item_id='dd000000-0000-0000-0000-000000000228'),
  0::numeric, 'itemA on-hand nets to 0 (received 5, issued 5)');
select is(
  (select count(*)::int from public.stock_receipts
     where project_id='aa000000-0000-0000-0000-000000000228'
       and catalog_item_id='dd000000-0000-0000-0000-000000000228'),
  1, 'a stock_receipt records the on-site buy');
select is(
  (select count(*)::int from public.stock_issues
     where work_package_id='ee000000-0000-0000-0000-000000000228'
       and catalog_item_id='dd000000-0000-0000-0000-000000000228'),
  1, 'a stock_issue charges the WP');
select is(
  (select unit_cost from public.stock_issues
     where work_package_id='ee000000-0000-0000-0000-000000000228'
       and catalog_item_id='dd000000-0000-0000-0000-000000000228'),
  20::numeric, 'no prior stock → the WP is charged the buy cost (20)');

-- itemB has prior stock 10 → buy-&-use qty 4 leaves net qty unchanged at 10.
select ok(
  (select public.site_purchase_use_now(
     'aa000000-0000-0000-0000-000000000228',
     'ee000000-0000-0000-0000-000000000228',
     'de000000-0000-0000-0000-000000000228', 4, 50)) is not null,
  'buy-&-use itemB returns the issue id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000228'
       and catalog_item_id='de000000-0000-0000-0000-000000000228'),
  10::numeric, 'itemB net qty unchanged at 10 (received 4, issued 4)');

-- ============================================================================
-- C. Validations (site_admin member actor).
-- ============================================================================
select throws_ok(
  $$ select public.site_purchase_use_now('aa000000-0000-0000-0000-000000000228',
       'ee000000-0000-0000-0000-000000000228', 'dd000000-0000-0000-0000-000000000228', 0, 20) $$,
  '22023', null, 'qty <= 0 rejected (22023)');
select throws_ok(
  $$ select public.site_purchase_use_now('aa000000-0000-0000-0000-000000000228',
       'ee000000-0000-0000-0000-000000000228', 'dd000000-0000-0000-0000-000000000228', 5, -1) $$,
  '22023', null, 'negative unit_cost rejected (22023)');
select throws_ok(
  $$ select public.site_purchase_use_now('aa000000-0000-0000-0000-000000000228',
       'ee000000-0000-0000-0000-000000000228', 'df000000-0000-0000-0000-000000000228', 5, 20) $$,
  '22023', null, 'inactive catalog item rejected (22023)');
select is(
  (select count(*)::int from public.stock_receipts
     where catalog_item_id='df000000-0000-0000-0000-000000000228'),
  0, 'the failed inactive-item call left no stray receipt (atomic)');
select throws_ok(
  $$ select public.site_purchase_use_now('aa000000-0000-0000-0000-000000000228',
       'ff000000-0000-0000-0000-000000000228', 'dd000000-0000-0000-0000-000000000228', 5, 20) $$,
  '22023', null, 'a WP from another project rejected (22023)');

-- ============================================================================
-- D. Gate.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-000000000228"}';
select throws_ok(
  $$ select public.site_purchase_use_now('aa000000-0000-0000-0000-000000000228',
       'ee000000-0000-0000-0000-000000000228', 'dd000000-0000-0000-0000-000000000228', 1, 20) $$,
  '42501', null, 'visitor denied (42501)');
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000228"}';
select throws_ok(
  $$ select public.site_purchase_use_now('aa000000-0000-0000-0000-000000000228',
       'ee000000-0000-0000-0000-000000000228', 'dd000000-0000-0000-0000-000000000228', 1, 20) $$,
  '42501', null, 'procurement denied — buy-&-use is a site action (42501)');
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000228"}';
select throws_ok(
  $$ select public.site_purchase_use_now('aa000000-0000-0000-0000-000000000228',
       'ee000000-0000-0000-0000-000000000228', 'dd000000-0000-0000-0000-000000000228', 1, 20) $$,
  '42501', null, 'non-member PM denied (42501)');

reset role;

-- ============================================================================
-- E. GL (option B): post the itemA buy-&-use legs and assert the accounting —
--    net Dr 1400 / Cr 2100 at cost, Inventory 1500 nets to 0, and NO Input-VAT
--    (1300) split (the cash-buy shortcut is VAT-inclusive). Post synchronously
--    in a DO block (the posters are VOLATILE — never inside an assertion WHERE),
--    mirroring pgTAP 213.
-- ============================================================================
do $$
begin
  perform public.post_stock_receipt_to_gl(
    (select id from public.stock_receipts
       where project_id='aa000000-0000-0000-0000-000000000228'
         and catalog_item_id='dd000000-0000-0000-0000-000000000228'));
  perform public.post_stock_issue_to_gl(
    (select id from public.stock_issues
       where work_package_id='ee000000-0000-0000-0000-000000000228'
         and catalog_item_id='dd000000-0000-0000-0000-000000000228'));
end $$;

select is(
  (select coalesce(sum(jl.credit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '2100' and e.status = 'posted' and e.source_table = 'stock_receipts'
      and e.source_id = (select id from public.stock_receipts
        where project_id='aa000000-0000-0000-0000-000000000228'
          and catalog_item_id='dd000000-0000-0000-0000-000000000228')),
  100.00::numeric, 'the buy credits AP exactly once at cost (Cr 2100 = 5*20)');
select is(
  (select coalesce(sum(jl.debit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '1500' and e.status = 'posted' and e.source_table = 'stock_receipts'
      and e.source_id = (select id from public.stock_receipts
        where project_id='aa000000-0000-0000-0000-000000000228'
          and catalog_item_id='dd000000-0000-0000-0000-000000000228')),
  100.00::numeric, 'the buy debits Inventory 1500 at cost (receipt leg)');
select is(
  (select coalesce(sum(jl.credit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '1500' and e.status = 'posted' and e.source_table = 'stock_issues'
      and e.source_id = (select id from public.stock_issues
        where work_package_id='ee000000-0000-0000-0000-000000000228'
          and catalog_item_id='dd000000-0000-0000-0000-000000000228')),
  100.00::numeric, 'the use credits Inventory 1500 back out (issue leg) — 1500 nets to 0');
select is(
  (select coalesce(sum(jl.debit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '1400' and e.status = 'posted' and e.source_table = 'stock_issues'
      and e.source_id = (select id from public.stock_issues
        where work_package_id='ee000000-0000-0000-0000-000000000228'
          and catalog_item_id='dd000000-0000-0000-0000-000000000228')),
  100.00::numeric, 'the WP carries the cost once via WP-WIP 1400 (at moving-average)');
select is(
  (select coalesce(sum(jl.debit + jl.credit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
    where a.code = '1300'
      and jl.entry_id in (
        select e.id from public.journal_entries e
         where e.status = 'posted'
           and ((e.source_table='stock_receipts' and e.source_id=(select id from public.stock_receipts
                   where project_id='aa000000-0000-0000-0000-000000000228'
                     and catalog_item_id='dd000000-0000-0000-0000-000000000228'))
             or (e.source_table='stock_issues' and e.source_id=(select id from public.stock_issues
                   where work_package_id='ee000000-0000-0000-0000-000000000228'
                     and catalog_item_id='dd000000-0000-0000-0000-000000000228'))))),
  0::numeric, 'no Input VAT (1300) line — the cash-buy shortcut is VAT-inclusive (option B)');

-- ============================================================================
-- F. VAT buy-&-use (spec 211 U11c-A): a catalogued buy WITH a tax invoice now
--    reclaims Input VAT (1300). itemD1 qty 1 @ GROSS 107, vat_rate 7 → net 100,
--    vat 7. Inventory carries NET (100); the WP is charged NET (100); AP = GROSS
--    (107). Mirrors the receipt poster's no-PR VAT fallback (spec 208 U4b).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000228"}';
select ok(
  (select public.site_purchase_use_now(
     'aa000000-0000-0000-0000-000000000228',
     'ee000000-0000-0000-0000-000000000228',
     'd1000000-0000-0000-0000-000000000228', 1, 107, null, 7)) is not null,
  'VAT buy-&-use returns the issue id');
select is(
  (select unit_cost from public.stock_receipts
     where catalog_item_id='d1000000-0000-0000-0000-000000000228'),
  100.00::numeric, 'the receipt carries the NET unit cost (107 gross / 1.07 = 100)');
select is(
  (select vat_rate from public.stock_receipts
     where catalog_item_id='d1000000-0000-0000-0000-000000000228'),
  7::numeric, 'the receipt snapshots vat_rate 7');
reset role;

do $$
begin
  perform public.post_stock_receipt_to_gl(
    (select id from public.stock_receipts where catalog_item_id='d1000000-0000-0000-0000-000000000228'));
  perform public.post_stock_issue_to_gl(
    (select id from public.stock_issues
       where work_package_id='ee000000-0000-0000-0000-000000000228'
         and catalog_item_id='d1000000-0000-0000-0000-000000000228'));
end $$;

select is(
  (select coalesce(sum(jl.debit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '1500' and e.status = 'posted' and e.source_table = 'stock_receipts'
      and e.source_id = (select id from public.stock_receipts
        where catalog_item_id='d1000000-0000-0000-0000-000000000228')),
  100.00::numeric, 'VAT receipt debits Inventory 1500 at NET (100)');
select is(
  (select coalesce(sum(jl.debit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '1300' and e.status = 'posted' and e.source_table = 'stock_receipts'
      and e.source_id = (select id from public.stock_receipts
        where catalog_item_id='d1000000-0000-0000-0000-000000000228')),
  7.00::numeric, 'VAT receipt splits Input VAT 1300 (7)');
select is(
  (select coalesce(sum(jl.credit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '2100' and e.status = 'posted' and e.source_table = 'stock_receipts'
      and e.source_id = (select id from public.stock_receipts
        where catalog_item_id='d1000000-0000-0000-0000-000000000228')),
  107.00::numeric, 'VAT receipt credits AP 2100 at GROSS (107)');
select is(
  (select coalesce(sum(jl.debit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '1400' and e.status = 'posted' and e.source_table = 'stock_issues'
      and e.source_id = (select id from public.stock_issues
        where work_package_id='ee000000-0000-0000-0000-000000000228'
          and catalog_item_id='d1000000-0000-0000-0000-000000000228')),
  100.00::numeric, 'VAT use charges the WP at NET (Dr 1400 = 100) — Input VAT is not a WP cost');

select * from finish();
rollback;
