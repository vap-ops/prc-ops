begin;
select plan(5);

-- ============================================================================
-- Spec 195 Phase 4 / ADR 0063 — cost integrity for the store-bound flow. The
-- invariant: a store-bound (WP-less) purchase's cost lands ONCE — as Inventory at
-- RECEIPT, then as WP cost at เบิก — never double. This file pins the cross-phase
-- claim that ties P2/P3 together: a WP-less purchase books NOTHING (so AP is NOT
-- credited at purchase), and the RECEIPT is the single AP event for that material.
--
-- (The downstream legs are pinned elsewhere: เบิก → WP cost at sell in wp_profit
-- by pgTAP 195/196; store receipt/issue GL by 198/199; 1500 ↔ on-hand by 200;
-- the suppression mechanics by 212.)
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-1111-1111-111111111213', 'pm@i213.local', '{}'::jsonb);
update public.users set role='project_manager' where id='d1111111-1111-1111-1111-111111111213';

insert into public.projects (id, code, name) values
  ('a2130000-0000-0000-0000-000000000213', 'PRC-213', 'cost integrity 213');
insert into public.catalog_items (id, category, base_item, spec_attrs, unit, is_active) values
  ('e2130000-0000-0000-0000-000000000213', 'electrical', 'สายไฟ', null, 'ม้วน', true);
insert into public.suppliers (id, name, created_by) values
  ('5e130000-0000-0000-0000-000000000213', 'ร้าน 213', 'd1111111-1111-1111-1111-111111111213');

-- A store-bound (WP-less) PR, purchased, all-in 214 for qty 2 (unit_cost 107 → total 214).
insert into public.purchase_requests
  (id, project_id, work_package_id, catalog_item_id, item_description, quantity, unit,
   status, source, requested_by, supplier_id, amount, purchased_at)
values
  ('b2130000-0000-0000-0000-000000000213',
   'a2130000-0000-0000-0000-000000000213', null,
   'e2130000-0000-0000-0000-000000000213', 'สายไฟ', 2, 'ม้วน',
   'purchased', 'app', 'd1111111-1111-1111-1111-111111111213',
   '5e130000-0000-0000-0000-000000000213', 214, now());

-- 1. While still 'purchased', the WP-less purchase books NOTHING (store-bound →
--    booked as Inventory at receipt, not expensed at purchase). The poster no-ops.
select is(
  (select public.post_purchase_to_gl('b2130000-0000-0000-0000-000000000213')),
  null, 'a WP-less purchase books no journal (AP not credited at purchase)');

-- 2. ...and no purchase journal entry exists for it.
select is(
  (select count(*)::int from public.journal_entries
     where source_table='purchase_requests'
       and source_id='b2130000-0000-0000-0000-000000000213'),
  0, 'no purchase-sourced journal entry for the WP-less PR');

-- Receive it → the P3 trigger records the stock_receipt (the inventory event).
update public.purchase_requests
   set delivered_at = now(), status = 'delivered'
 where id = 'b2130000-0000-0000-0000-000000000213';

-- Post the receipt's GL ONCE (a DO block, not a wrapped assertion select — the
-- poster is VOLATILE; never call it inside an assertion's WHERE).
do $$
begin
  perform public.post_stock_receipt_to_gl(
    (select id from public.stock_receipts
       where purchase_request_id = 'b2130000-0000-0000-0000-000000000213'));
end $$;

-- 3. Receiving created exactly one stock_receipt (the inventory event).
select is(
  (select count(*)::int from public.stock_receipts
     where purchase_request_id='b2130000-0000-0000-0000-000000000213'),
  1, 'receiving the WP-less PR creates exactly one stock_receipt');

-- 4. The receipt is the SINGLE AP event: it credits AP (2100) by the all-in cost (214).
select is(
  (select coalesce(sum(jl.credit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '2100'
      and e.source_table = 'stock_receipts' and e.status = 'posted'
      and e.source_id = (select id from public.stock_receipts
                           where purchase_request_id='b2130000-0000-0000-0000-000000000213')),
  214.00::numeric, 'the receipt credits AP exactly once, at the all-in cost (Cr 2100)');

-- 5. ...and that same posting debits Inventory 1500 by 214 (the asset lands at receipt).
select is(
  (select coalesce(sum(jl.debit), 0)
     from public.journal_lines jl
     join public.gl_accounts a on a.id = jl.account_id
     join public.journal_entries e on e.id = jl.entry_id
    where a.code = '1500'
      and e.source_table = 'stock_receipts' and e.status = 'posted'
      and e.source_id = (select id from public.stock_receipts
                           where purchase_request_id='b2130000-0000-0000-0000-000000000213')),
  214.00::numeric, 'the material lands as Inventory 1500 at receipt (cost booked once)');

select * from finish();
rollback;
