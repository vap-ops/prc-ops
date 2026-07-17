begin;
select plan(3);

-- ============================================================================
-- Spec 178 B7 / ADR 0057 dec 11 — extend gl_reconciliation with the Inventory
-- (1500) ↔ stock_on_hand tie. 1500 is a SINGLE-feeder control (only store
-- movements touch it), so its GL balance must equal the perpetual subledger
-- (Σ stock_on_hand.total_value) once the posting backlog is clear — like the
-- 1210/2210 ties, unlike multi-feeder 2100/1400. Catches any store-posting bug.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('19191919-1919-1919-1919-000000000200', 'super@invrec.local', '{}'::jsonb);
update public.users set role='super_admin' where id='19191919-1919-1919-1919-000000000200';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000200', 'INVREC-1', 'กระทบยอดคลัง');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000200', 'electrical', 'วัสดุคลัง', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000200', 'electrical', 'วัสดุคลังสอง', 'ชิ้น', true);
insert into public.suppliers (id, name, created_by) values
  ('5a000000-0000-0000-0000-000000000200', 'ร้านคลัง', '19191919-1919-1919-1919-000000000200');

-- On-hand: item1 worth 500. A matching receipt (10 @ 50 = 500) posts Dr 1500 500.
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000200', 'ee000000-0000-0000-0000-000000000200', 10, 500);
insert into public.stock_receipts
  (id, project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, created_by) values
  ('a1000000-0000-0000-0000-000000000200', 'aa000000-0000-0000-0000-000000000200',
   'ee000000-0000-0000-0000-000000000200', 10, 'ชิ้น', 50,
   '5a000000-0000-0000-0000-000000000200', '19191919-1919-1919-1919-000000000200');

-- Post the receipt to the GL (owner/superuser bypasses the service_role grant).
select public.post_stock_receipt_to_gl('a1000000-0000-0000-0000-000000000200');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000200"}';

-- A. The new reconciliation row exists and ties (GL 1500 = on-hand value = 500).
select is(
  (select count(*)::int from public.gl_reconciliation() where check_name = 'inventory_1500'),
  1, 'gl_reconciliation has an inventory_1500 check');
-- gl_reconciliation() is TABLE-WIDE; assert the INVARIANT via the gated `ok`
-- rather than a raw gl_value = subledger_value compare. Spec 324 U7: the subledger
-- backing 1500 is the on-hand pool PLUS the PO-level charges capitalized to 1500
-- (transport/discount post to 1500 but never the moving-avg pool). `ok` is pending-
-- gated (green while 1500-affecting postings drain), so a transient in-flight posting
-- on the shared DB cannot flake this — unlike a raw value compare, which would red the
-- moment on-hand is committed ahead of its still-draining GL post. A standalone
-- subledger recompute is intentionally omitted (it would re-read journal_lines as the
-- RLS-filtered caller, never matching the function's SECURITY DEFINER full read).
select is(
  (select ok from public.gl_reconciliation() where check_name = 'inventory_1500'),
  true, 'inventory ties (GL 1500 = on-hand + capitalized PO charges) when quiescent/draining');

-- B. Introduce drift: more on-hand than the GL knows → the check must flag it.
-- Force the pending-gate OFF first (txn-local, rolled back) so the injected drift is
-- deterministically visible regardless of any concurrent in-flight 1500 posting on the
-- shared DB. The exact drift VALUE is intentionally not asserted — it is table-wide
-- (fixture + live + any concurrent state), so `ok = false` is the robust invariant.
reset role;
delete from public.gl_posting_outbox
 where status = 'pending'
   and source_table in ('stock_receipts', 'stock_issues', 'stock_returns',
                        'stock_counts', 'stock_reversals',
                        'stock_receipt_corrections', 'purchase_order_charges');
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000200', 'ef000000-0000-0000-0000-000000000200', 2, 100);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000200"}';
select is(
  (select ok from public.gl_reconciliation() where check_name = 'inventory_1500'),
  false, 'inventory does NOT tie once on-hand exceeds GL 1500 + capitalized PO charges');

reset role;

select * from finish();
rollback;
