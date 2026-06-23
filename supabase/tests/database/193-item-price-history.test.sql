begin;
select plan(10);

-- ============================================================================
-- Spec 182 U3 — item_price_history(catalog_item): the last-paid benchmark above
-- the quote-comparison table. Past PURCHASED purchase_requests for a catalog
-- item → the NET unit price paid (amount is the line GROSS, spec 119; net =
-- amount/(1+vat_rate/100)/qty), newest first, limit 5. Back-office READ ONLY
-- (unit price is money; site_admin + anon get nothing).
-- ============================================================================

-- A. Function shape.
select has_function('public', 'item_price_history', array['uuid'],
  'item_price_history(catalog_item) exists');
select is(
  (select prosecdef from pg_proc where proname = 'item_price_history'),
  true, 'item_price_history is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.item_price_history(uuid)', 'EXECUTE'),
  false, 'anon cannot execute item_price_history');

-- ============================================================================
-- Fixtures (postgres bypasses RLS + column grants).
-- ============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-1111-1111-111111111193', 'proc@h193.local', '{}'::jsonb),
  ('d3333333-3333-3333-3333-333333333193', 'sa@h193.local',   '{}'::jsonb),
  ('d9999999-9999-9999-9999-999999999193', 'super@h193.local','{}'::jsonb);
update public.users set role='procurement' where id='d1111111-1111-1111-1111-111111111193';
update public.users set role='site_admin'  where id='d3333333-3333-3333-3333-333333333193';
update public.users set role='super_admin' where id='d9999999-9999-9999-9999-999999999193';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000193', 'H193', 'price history 193');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000193', 'aa000000-0000-0000-0000-000000000193', 'WP193', 'งาน 193');
insert into public.suppliers (id, name, created_by) values
  ('51000000-0000-0000-0000-000000000193', 'ส.รุ่งเรือง', 'd9999999-9999-9999-9999-999999999193'),
  ('52000000-0000-0000-0000-000000000193', 'ไทยวัสดุ',   'd9999999-9999-9999-9999-999999999193');
-- Item A = the target; item B = a different item (must be excluded).
insert into public.catalog_items (id, category, base_item, unit) values
  ('da000000-0000-0000-0000-000000000193', 'steel_fixing', 'เหล็กข้ออ้อย 12 มิล', 'ท่อน'),
  ('db000000-0000-0000-0000-000000000193', 'steel_fixing', 'ปูนถุง',             'ถุง');

-- Item A purchased PRs (amount = GROSS):
--   newest 2026-06-10 s1 amount 4900 vat 0  qty 50 → net 98
--          2026-05-01 s2 amount 5350 vat 7  qty 50 → net 100  (5350/1.07/50)
--   oldest 2026-04-01 NO supplier_id, text 'ร้านลุงสมชาย' amount 2000 vat 0 qty 20 → net 100 (coalesce to text)
insert into public.purchase_requests
  (work_package_id, catalog_item_id, item_description, quantity, unit, status, source,
   requested_by, supplier_id, supplier, amount, vat_rate, purchased_at)
values
  ('cc000000-0000-0000-0000-000000000193', 'da000000-0000-0000-0000-000000000193',
   'เหล็กข้ออ้อย 12 มิล', 50, 'ท่อน', 'purchased', 'app',
   'd9999999-9999-9999-9999-999999999193', '51000000-0000-0000-0000-000000000193', null,
   4900, 0, '2026-06-10T00:00:00Z'),
  ('cc000000-0000-0000-0000-000000000193', 'da000000-0000-0000-0000-000000000193',
   'เหล็กข้ออ้อย 12 มิล', 50, 'ท่อน', 'purchased', 'app',
   'd9999999-9999-9999-9999-999999999193', '52000000-0000-0000-0000-000000000193', null,
   5350, 7, '2026-05-01T00:00:00Z'),
  ('cc000000-0000-0000-0000-000000000193', 'da000000-0000-0000-0000-000000000193',
   'เหล็กข้ออ้อย 12 มิล', 20, 'ท่อน', 'purchased', 'app',
   'd9999999-9999-9999-9999-999999999193', null, 'ร้านลุงสมชาย',
   2000, 0, '2026-04-01T00:00:00Z');

-- Item A but NOT purchased (amount null) → excluded.
insert into public.purchase_requests
  (work_package_id, catalog_item_id, item_description, quantity, unit, status, source, requested_by)
values
  ('cc000000-0000-0000-0000-000000000193', 'da000000-0000-0000-0000-000000000193',
   'เหล็กข้ออ้อย 12 มิล', 10, 'ท่อน', 'approved', 'app',
   'd9999999-9999-9999-9999-999999999193');

-- A purchased PR for a DIFFERENT item → excluded from item A's history.
insert into public.purchase_requests
  (work_package_id, catalog_item_id, item_description, quantity, unit, status, source,
   requested_by, supplier_id, amount, vat_rate, purchased_at)
values
  ('cc000000-0000-0000-0000-000000000193', 'db000000-0000-0000-0000-000000000193',
   'ปูนถุง', 100, 'ถุง', 'purchased', 'app',
   'd9999999-9999-9999-9999-999999999193', '51000000-0000-0000-0000-000000000193',
   9999, 0, '2026-06-20T00:00:00Z');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- B. site_admin is refused (unit price is money).
set local "request.jwt.claims" = '{"sub": "d3333333-3333-3333-3333-333333333193"}';
select throws_ok(
  $$ select * from public.item_price_history('da000000-0000-0000-0000-000000000193') $$,
  '42501', null, 'site_admin cannot read price history (back-office only)');

-- C. Behaviour (procurement).
set local "request.jwt.claims" = '{"sub": "d1111111-1111-1111-1111-111111111193"}';

select is(
  (select count(*)::int from public.item_price_history('da000000-0000-0000-0000-000000000193')),
  3, 'only the 3 purchased item-A rows (amount-null + other-item excluded)');
select is(
  (select net_unit_price from public.item_price_history('da000000-0000-0000-0000-000000000193')
     where supplier_name = 'ส.รุ่งเรือง'),
  98::numeric, 'net unit price strips no VAT (vat 0): 4900/50 = 98');
select is(
  (select net_unit_price from public.item_price_history('da000000-0000-0000-0000-000000000193')
     where supplier_name = 'ไทยวัสดุ'),
  100::numeric, 'net unit price strips VAT: 5350/1.07/50 = 100');
select is(
  (select net_unit_price from public.item_price_history('da000000-0000-0000-0000-000000000193')
     where supplier_name = 'ร้านลุงสมชาย'),
  100::numeric, 'a null supplier_id row coalesces to the text supplier snapshot');
select is(
  (select count(*)::int from public.item_price_history('da000000-0000-0000-0000-000000000193')
     where net_unit_price is null),
  0, 'no null net prices (the amount-null PR is excluded)');
select results_eq(
  $$ select purchased_at from public.item_price_history('da000000-0000-0000-0000-000000000193') $$,
  array['2026-06-10 00:00:00+00'::timestamptz,
        '2026-05-01 00:00:00+00'::timestamptz,
        '2026-04-01 00:00:00+00'::timestamptz],
  'newest purchase first');

reset role;

select * from finish();
rollback;
