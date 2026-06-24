begin;
select plan(16);

-- ============================================================================
-- Spec 198 U2 / ADR 0064 — divert a delivered WP-bound purchase into the store.
--   divert_purchase_to_store(pr) (SITE_STAFF gate, can_see_project): inserts a
--   stock_receipt (cost transfers WP-WIP -> Inventory), reclassifies the PR
--   WP-less, rolls stock_on_hand. The GL net (after drain/post): reverse the WP
--   purchase (Dr 2100 / Cr 1400) + the receipt (Dr 1500 / Cr 2100) =>
--   WP-WIP 0 · Inventory +cost · AP unchanged. post_purchase_to_gl now reverses
--   BEFORE the WP-less suppression, so the re-post undoes the old WP-WIP entry.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000216', 'pmmember@dv.local',  '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000216', 'pmoutsider@dv.local','{}'::jsonb),
  ('14141414-1414-1414-1414-000000000216', 'visitor@dv.local',   '{}'::jsonb),
  ('15151515-1515-1515-1515-000000000216', 'sitemember@dv.local','{}'::jsonb),
  ('19191919-1919-1919-1919-000000000216', 'super@dv.local',     '{}'::jsonb);
update public.users set role='project_manager' where id='11111111-1111-1111-1111-000000000216';
update public.users set role='project_manager' where id='12121212-1212-1212-1212-000000000216';
update public.users set role='site_admin'      where id='15151515-1515-1515-1515-000000000216';
update public.users set role='super_admin'     where id='19191919-1919-1919-1919-000000000216';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000216', 'DV-PROJ', 'ย้ายเข้าคลัง ทดสอบ');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000216', 'aa000000-0000-0000-0000-000000000216', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000216', 'electrical', 'วัสดุย้ายคลัง', 'ชิ้น', true);
insert into public.suppliers (id, name, created_by) values
  ('5a000000-0000-0000-0000-000000000216', 'ร้านย้ายคลัง', '19191919-1919-1919-1919-000000000216');
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000216', '11111111-1111-1111-1111-000000000216',
   '19191919-1919-1919-1919-000000000216'),
  ('aa000000-0000-0000-0000-000000000216', '15151515-1515-1515-1515-000000000216',
   '19191919-1919-1919-1919-000000000216');

-- The main PR: WP-bound, catalogued, purchased (amount 300 / qty 10), then post
-- its purchase GL (Dr 1400 / Cr 2100), then mark delivered.
insert into public.purchase_requests
  (id, project_id, work_package_id, catalog_item_id, item_description, quantity, unit,
   amount, supplier_id, status, requested_by, purchased_at)
values
  ('d1000000-0000-0000-0000-000000000216', 'aa000000-0000-0000-0000-000000000216',
   'cc000000-0000-0000-0000-000000000216', 'ee000000-0000-0000-0000-000000000216',
   'วัสดุย้ายคลัง', 10, 'ชิ้น', 300, '5a000000-0000-0000-0000-000000000216',
   'purchased', '11111111-1111-1111-1111-000000000216', now());
select public.post_purchase_to_gl('d1000000-0000-0000-0000-000000000216');
update public.purchase_requests set status='delivered'
  where id='d1000000-0000-0000-0000-000000000216';

-- A second PR still 'purchased' (not delivered) — for the not-delivered guard.
insert into public.purchase_requests
  (id, project_id, work_package_id, catalog_item_id, item_description, quantity, unit,
   amount, supplier_id, status, requested_by)
values
  ('d2000000-0000-0000-0000-000000000216', 'aa000000-0000-0000-0000-000000000216',
   'cc000000-0000-0000-0000-000000000216', 'ee000000-0000-0000-0000-000000000216',
   'ยังไม่ส่ง', 5, 'ชิ้น', 150, '5a000000-0000-0000-0000-000000000216',
   'purchased', '11111111-1111-1111-1111-000000000216');

-- A third PR: delivered but WP-less (store-bound) — not divertible.
insert into public.purchase_requests
  (id, project_id, work_package_id, catalog_item_id, item_description, quantity, unit,
   amount, supplier_id, status, requested_by)
values
  ('d3000000-0000-0000-0000-000000000216', 'aa000000-0000-0000-0000-000000000216',
   null, 'ee000000-0000-0000-0000-000000000216',
   'เข้าสโตร์', 5, 'ชิ้น', 150, '5a000000-0000-0000-0000-000000000216',
   'delivered', '11111111-1111-1111-1111-000000000216');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select ok(to_regprocedure('public.divert_purchase_to_store(uuid)') is not null,
  'divert_purchase_to_store exists');
select is(has_function_privilege('anon',
  'public.divert_purchase_to_store(uuid)', 'EXECUTE'),
  false, 'anon cannot execute divert_purchase_to_store');

-- B. Pre-divert: the WP-bound purchase posted Dr 1400 (WP-WIP) = 300.
select is(
  (select coalesce(sum(l.debit - l.credit), 0)
     from public.journal_lines l
    where l.account_id = (select id from public.gl_accounts where code='1400')
      and l.work_package_id = 'cc000000-0000-0000-0000-000000000216'),
  300::numeric, 'pre-divert: WP-WIP (1400) for the WP = 300 (purchase posted)');

set local role authenticated;

-- C. Guards.
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-000000000216"}';
select throws_ok(
  $$ select public.divert_purchase_to_store('d1000000-0000-0000-0000-000000000216') $$,
  '42501', null, 'visitor denied (42501)');
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000216"}';
select throws_ok(
  $$ select public.divert_purchase_to_store('d1000000-0000-0000-0000-000000000216') $$,
  '42501', null, 'non-member PM denied (42501)');
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000216"}';
select throws_ok(
  $$ select public.divert_purchase_to_store('d2000000-0000-0000-0000-000000000216') $$,
  '22023', null, 'a not-delivered purchase cannot be diverted (22023)');
select throws_ok(
  $$ select public.divert_purchase_to_store('d3000000-0000-0000-0000-000000000216') $$,
  '22023', null, 'a WP-less (store-bound) line cannot be diverted (22023)');

-- D. Happy path: site_admin member diverts the main PR.
select isnt(
  (select public.divert_purchase_to_store('d1000000-0000-0000-0000-000000000216')),
  null, 'site_admin member diverts the WP-bound line — returns a receipt id');

reset role;

-- E. State after divert: receipt stamped, on-hand rolled, PR reclassified WP-less.
select is(
  (select count(*)::int from public.stock_receipts
     where purchase_request_id='d1000000-0000-0000-0000-000000000216'),
  1, 'a stock_receipt was created, stamped with the source PR');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000216'
       and catalog_item_id='ee000000-0000-0000-0000-000000000216'),
  10::numeric, 'on-hand qty rolled to 10');
select is(
  (select work_package_id from public.purchase_requests
     where id='d1000000-0000-0000-0000-000000000216'),
  null, 'the PR is now WP-less (store-bound)');

-- F. The divert reversed the WP-WIP entry SYNCHRONOUSLY (Dr 2100 / Cr 1400), so
--    the WP's WIP nets to 0 already — the cost left the WP.
select is(
  (select coalesce(sum(l.debit - l.credit), 0)
     from public.journal_lines l
    where l.account_id = (select id from public.gl_accounts where code='1400')
      and l.work_package_id = 'cc000000-0000-0000-0000-000000000216'),
  0::numeric, 'WP-WIP (1400) for the WP nets to 0 after divert (reversed in the RPC)');

-- G. Post the receipt's enqueued GL job: Dr 1500 Inventory / Cr 2100 AP.
select lives_ok(
  $$ select public.post_stock_receipt_to_gl(
       (select id from public.stock_receipts
          where purchase_request_id='d1000000-0000-0000-0000-000000000216')) $$,
  'the receipt posts Dr 1500 / Cr 2100');
select is(
  (select coalesce(sum(l.debit - l.credit), 0)
     from public.journal_lines l
    where l.account_id = (select id from public.gl_accounts where code='1500')
      and l.project_id = 'aa000000-0000-0000-0000-000000000216'),
  300::numeric, 'Inventory (1500) = 300 (the material is now store stock)');
select is(
  (select coalesce(sum(l.credit - l.debit), 0)
     from public.journal_lines l
    where l.account_id = (select id from public.gl_accounts where code='2100')
      and l.supplier_id = '5a000000-0000-0000-0000-000000000216'),
  300::numeric, 'AP (2100) net credit = 300 (one liability — unchanged by the transfer)');

-- H. Idempotency: a second divert is blocked (the receipt already exists).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000216"}';
select throws_ok(
  $$ select public.divert_purchase_to_store('d1000000-0000-0000-0000-000000000216') $$,
  '22023', null, 'a line already diverted cannot be diverted again (22023)');
reset role;

select * from finish();
rollback;
