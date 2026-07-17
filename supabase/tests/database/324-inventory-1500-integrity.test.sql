begin;
select plan(3);

-- ============================================================================
-- Spec 324 U7 — the inventory_1500 tie in the SCHEDULED integrity registry
-- (_integrity_check_results, spec 283). Today the 1500 tie lives only in the
-- role-gated on-demand gl_reconciliation() (/accounting); the cron scan omits it,
-- so a correction-induced drift would go unseen for weeks.
--
-- THE TIE IS PO-CHARGE-AWARE: GL account 1500 (Inventory) = Σ stock_on_hand.
-- total_value + Σ(purchase_order_charges capitalized to 1500). PO-level freight/
-- discount post to 1500 in the GL but never flow into the moving-average store
-- pool, so they are an explicit reconciling term — otherwise the check reds on
-- the pre-existing, fully-explained drift (the old 200-store known-red).
-- ============================================================================

-- A. The scheduled registry now carries an implemented inventory_1500 money check.
select is(
  (select count(*)::int from public._integrity_check_results()
     where key in ('inventory_1500') and domain = 'money' and implemented),
  1, 'scheduled registry has an implemented inventory_1500 money check');

-- B. Inject drift: on-hand gains value with NO matching GL 1500 posting (and no
-- PO charge) → the tie breaks → the check reds. Proves the scan CATCHES a real
-- pool/GL divergence (a store-posting bug or an un-posted correction). Rolled
-- back at end, so the injected drift never persists.
-- Ensure the pending-gate is OFF (txn-local; rolled back) so the injected drift is
-- deterministically visible regardless of any concurrent in-flight 1500 posting on
-- the shared DB — the gate greens the row while 1500-affecting postings drain.
delete from public.gl_posting_outbox
 where status = 'pending'
   and source_table in ('stock_receipts', 'stock_issues', 'stock_returns',
                        'stock_counts', 'stock_reversals',
                        'stock_receipt_corrections', 'purchase_order_charges');
insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000324', 'U7DRIFT', 'ทดสอบดริฟท์');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000324', 'electrical', 'วัสดุดริฟท์', 'ชิ้น', true);
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000324', 'ee000000-0000-0000-0000-000000000324', 5, 9999);

select is(
  (select status from public._integrity_check_results() where key in ('inventory_1500')),
  'red', 'inventory_1500 reds when on-hand gains value with no GL 1500 posting');
select ok(
  (select drift from public._integrity_check_results() where key in ('inventory_1500')) <> 0,
  'drift is non-zero under the injected divergence');

select * from finish();
rollback;
