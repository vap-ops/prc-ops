begin;
select plan(35);

-- ============================================================================
-- Spec 347 U1 — store-first purchase PRICE correction: ledger + GL plumbing.
--   A new append-only ledger `stock_receipt_price_corrections` (sealed, zero-grant,
--   freeze-triggered) whose AFTER-INSERT enqueues a GL job; drain_gl_posting routes
--   source_table='stock_receipt_price_corrections' to
--   post_stock_receipt_price_correction_to_gl, which posts a SIGNED contra of the
--   receipt's original รับเข้า against the price delta:
--     delta_net>0  -> Dr 1500 ; <0 -> Cr 1500   (asset, project dim)
--     delta_vat>0  -> Dr 1300 ; <0 -> Cr 1300   (input VAT, project dim)
--     delta_gross>0-> Cr 2100 ; <0 -> Dr 2100   (AP, supplier dim, mirrored)
--   Zero-delta legs are skipped. delta_gross = delta_net + delta_vat by construction
--   so the entry always balances. U1 is INERT (no RPC — U2 activates it); this test
--   inserts correction rows directly as the (superuser) test session to fire the
--   triggers, and proves authenticated/anon cannot.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000347', 'bo@pc347.local', '{}'::jsonb);
update public.users set role='procurement' where id='b0000000-0000-0000-0000-000000000347';

insert into public.projects (id, code, name) values
  ('40000000-0000-0000-0000-000000000347', 'PC347-PROJ', 'GL แก้ราคา');
insert into public.suppliers (id, name, created_by) values
  ('50000000-0000-0000-0000-000000000347', 'ผู้ขาย ราคา', 'b0000000-0000-0000-0000-000000000347');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('11000000-0000-0000-0000-000000000347', 'electrical', 'pc347', 'ชิ้น', true);

-- Four purchase receipts: R1 down-correction, R2 up-correction, R3 rate-only,
-- R4 for the stale-trigger fixture. total_cost is GENERATED (qty*unit_cost).
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, purchase_request_id, created_by) values
  ('a1000000-0000-0000-0000-000000000347', '40000000-0000-0000-0000-000000000347', '11000000-0000-0000-0000-000000000347', 100, 'ชิ้น', 100, 7, '50000000-0000-0000-0000-000000000347', null, 'b0000000-0000-0000-0000-000000000347'),
  ('a2000000-0000-0000-0000-000000000347', '40000000-0000-0000-0000-000000000347', '11000000-0000-0000-0000-000000000347', 100, 'ชิ้น', 100, 7, '50000000-0000-0000-0000-000000000347', null, 'b0000000-0000-0000-0000-000000000347'),
  ('a3000000-0000-0000-0000-000000000347', '40000000-0000-0000-0000-000000000347', '11000000-0000-0000-0000-000000000347', 100, 'ชิ้น', 100, 7, '50000000-0000-0000-0000-000000000347', null, 'b0000000-0000-0000-0000-000000000347'),
  ('a4000000-0000-0000-0000-000000000347', '40000000-0000-0000-0000-000000000347', '11000000-0000-0000-0000-000000000347', 100, 'ชิ้น', 100, 7, '50000000-0000-0000-0000-000000000347', null, 'b0000000-0000-0000-0000-000000000347');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select has_table('stock_receipt_price_corrections',
  'the price-correction ledger table exists');
select has_column('stock_receipt_price_corrections', 'receipt_id',       'has receipt_id');
select has_column('stock_receipt_price_corrections', 'corrected_amount', 'has corrected_amount (new gross)');
select has_column('stock_receipt_price_corrections', 'delta_net',        'has delta_net');
select has_column('stock_receipt_price_corrections', 'delta_gross',      'has delta_gross');
select has_column('stock_receipt_price_corrections', 'flag_id',          'has flag_id (money_review_flags fk)');

-- CHECK constraints (behavioural):
select throws_ok(
  $$ insert into public.stock_receipt_price_corrections
       (receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, corrected_by)
     values ('a1000000-0000-0000-0000-000000000347', 9630, 7, -1000, -70, -999, 'x', 'b0000000-0000-0000-0000-000000000347') $$,
  '23514', null, 'CHECK: delta_gross must equal delta_net + delta_vat');
select throws_ok(
  $$ insert into public.stock_receipt_price_corrections
       (receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, corrected_by)
     values ('a1000000-0000-0000-0000-000000000347', 0, 7, -1000, -70, -1070, 'x', 'b0000000-0000-0000-0000-000000000347') $$,
  '23514', null, 'CHECK: corrected_amount must be > 0');
select throws_ok(
  $$ insert into public.stock_receipt_price_corrections
       (receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, corrected_by)
     values ('a1000000-0000-0000-0000-000000000347', 100, 7, 0, 0, 0, 'x', 'b0000000-0000-0000-0000-000000000347') $$,
  '23514', null, 'CHECK: a no-op (0/0) correction row may not exist');

-- The poster is service-role only (like every other store GL poster).
select is(has_function_privilege('authenticated', 'public.post_stock_receipt_price_correction_to_gl(uuid)', 'EXECUTE'),
  false, 'authenticated cannot execute post_stock_receipt_price_correction_to_gl');

-- Integrity registry: the new table is in the inv_pending 1500-poster list in BOTH
-- integrity functions (else an in-flight correction flashes the tie red).
select ok(pg_get_functiondef('public.gl_reconciliation'::regproc) like '%stock_receipt_price_corrections%',
  'gl_reconciliation inv_pending list includes the price-correction table');
select ok(pg_get_functiondef('public._integrity_check_results'::regproc) like '%stock_receipt_price_corrections%',
  '_integrity_check_results inv_pending list includes the price-correction table');

-- ---------------------------------------------------------------------------
-- Enqueue + poster + drain (insert correction rows as the test session -> triggers fire)
-- ---------------------------------------------------------------------------
-- C1 on R1: DOWN (invoice ฿9,630 not ฿10,700) — deltas net -1000, vat -70, gross -1070.
insert into public.stock_receipt_price_corrections
  (id, receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, supplier_id, corrected_by)
values
  ('c1000000-0000-0000-0000-000000000347', 'a1000000-0000-0000-0000-000000000347', 9630, 7, -1000, -70, -1070, 'พิมพ์ราคาผิด', '50000000-0000-0000-0000-000000000347', 'b0000000-0000-0000-0000-000000000347');
-- C2 on R2: UP — deltas net +500, vat +35, gross +535.
insert into public.stock_receipt_price_corrections
  (id, receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, supplier_id, corrected_by)
values
  ('c2000000-0000-0000-0000-000000000347', 'a2000000-0000-0000-0000-000000000347', 11235, 7, 500, 35, 535, 'ราคาต่ำไป', '50000000-0000-0000-0000-000000000347', 'b0000000-0000-0000-0000-000000000347');
-- C3 on R3: RATE-ONLY (VAT flag was 0, invoice is 7% on the same ฿10,700) —
-- deltas net -700, vat +700, gross 0.
insert into public.stock_receipt_price_corrections
  (id, receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, supplier_id, corrected_by)
values
  ('c3000000-0000-0000-0000-000000000347', 'a3000000-0000-0000-0000-000000000347', 10700, 7, -700, 700, 0, 'ลืมติ๊ก VAT', '50000000-0000-0000-0000-000000000347', 'b0000000-0000-0000-0000-000000000347');

-- Enqueue: the C1 insert landed a job keyed on the TABLE NAME (drain dispatches on it).
select is(
  (select source_table from public.gl_posting_outbox where source_id='c1000000-0000-0000-0000-000000000347'),
  'stock_receipt_price_corrections',
  'enqueue trigger lands source_table = the table name (drain CASE key)');

select lives_ok($$ select public.drain_gl_posting(200) $$, 'drain_gl_posting runs');

-- Routing: the C1 job posted (NOT skipped/failed) -> the new drain CASE arm matches.
select is(
  (select status from public.gl_posting_outbox where source_id='c1000000-0000-0000-0000-000000000347'),
  'posted', 'the correction job routed + posted (drain CASE matches source_table)');

-- C1 DOWN contra: Cr 1500 1000 / Cr 1300 70 / Dr 2100 1070, balanced.
select is(
  (select sum(debit) from public.journal_lines where entry_id=(select id from public.journal_entries
     where source_table='stock_receipt_price_corrections' and source_id='c1000000-0000-0000-0000-000000000347')),
  (select sum(credit) from public.journal_lines where entry_id=(select id from public.journal_entries
     where source_table='stock_receipt_price_corrections' and source_id='c1000000-0000-0000-0000-000000000347')),
  'C1 down-correction contra balances (Sigma debit = Sigma credit)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c1000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='1500') and credit=1000 and project_id='40000000-0000-0000-0000-000000000347'),
  1::bigint, 'C1: Cr 1500 = 1000 (net down, project dim)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c1000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='1300') and credit=70),
  1::bigint, 'C1: Cr 1300 = 70 (input VAT down)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c1000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='2100') and debit=1070 and supplier_id='50000000-0000-0000-0000-000000000347'),
  1::bigint, 'C1: Dr 2100 = 1070 (AP down, supplier dim, mirrored)');

-- C2 UP contra: Dr 1500 500 / Dr 1300 35 / Cr 2100 535, balanced.
select is(
  (select sum(debit) from public.journal_lines where entry_id=(select id from public.journal_entries
     where source_id='c2000000-0000-0000-0000-000000000347')),
  (select sum(credit) from public.journal_lines where entry_id=(select id from public.journal_entries
     where source_id='c2000000-0000-0000-0000-000000000347')),
  'C2 up-correction contra balances');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c2000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='1500') and debit=500 and project_id='40000000-0000-0000-0000-000000000347'),
  1::bigint, 'C2: Dr 1500 = 500 (net up)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c2000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='2100') and credit=535 and supplier_id='50000000-0000-0000-0000-000000000347'),
  1::bigint, 'C2: Cr 2100 = 535 (AP up, mirrored)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c2000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='1300') and debit=35),
  1::bigint, 'C2: Dr 1300 = 35 (input VAT up)');

-- C3 RATE-ONLY contra: Cr 1500 700 / Dr 1300 700, NO 2100 leg, balanced.
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c3000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='2100')),
  0::bigint, 'C3 rate-only posts NO 2100 leg (gross delta = 0)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c3000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='1500') and credit=700 and project_id='40000000-0000-0000-0000-000000000347'),
  1::bigint, 'C3: Cr 1500 = 700 (net moves out of asset into VAT)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_id='c3000000-0000-0000-0000-000000000347')
       and account_id=(select id from public.gl_accounts where code='1300') and debit=700),
  1::bigint, 'C3: Dr 1300 = 700 (input VAT now claimable)');
select is(
  (select sum(debit) from public.journal_lines where entry_id=(select id from public.journal_entries
     where source_id='c3000000-0000-0000-0000-000000000347')),
  (select sum(credit) from public.journal_lines where entry_id=(select id from public.journal_entries
     where source_id='c3000000-0000-0000-0000-000000000347')),
  'C3 rate-only contra balances (2-line 1500<->1300)');

-- ---------------------------------------------------------------------------
-- Redrain self-guard: re-posting the SAME correction (an overlapping drain) reverses
-- the prior entry and re-posts an identical one, so the NET 1500 effect is unchanged,
-- not doubled (the 324 idempotency invariant, spec I-2/I-3).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.post_stock_receipt_price_correction_to_gl('c1000000-0000-0000-0000-000000000347') $$,
  're-posting the same correction is safe (reverse-and-repost)');
select is(
  (select coalesce(sum(credit),0) - coalesce(sum(debit),0)
     from public.journal_lines jl
     join public.journal_entries je on je.id = jl.entry_id
    where je.source_table='stock_receipt_price_corrections' and je.source_event='purchase_price_correction'
      and je.source_id='c1000000-0000-0000-0000-000000000347'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = je.id)
      and jl.account_id=(select id from public.gl_accounts where code='1500')),
  1000::numeric, 'the LIVE (non-reversed) correction books Cr 1500 = 1000 exactly once (redrain safe)');

-- ---------------------------------------------------------------------------
-- Stale trigger: a verified receipt review flips to pending on a new correction.
-- ---------------------------------------------------------------------------
insert into public.money_event_reviews (source_table, source_id, status, verified_via, verified_at) values
  ('stock_receipts', 'a4000000-0000-0000-0000-000000000347', 'verified', 'agent', now());
insert into public.stock_receipt_price_corrections
  (receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, supplier_id, corrected_by)
values
  ('a4000000-0000-0000-0000-000000000347', 9630, 7, -1000, -70, -1070, 'พิมพ์ราคาผิด', '50000000-0000-0000-0000-000000000347', 'b0000000-0000-0000-0000-000000000347');
select is(
  (select status::text from public.money_event_reviews where source_table='stock_receipts' and source_id='a4000000-0000-0000-0000-000000000347'),
  'pending', 'stale trigger flips the verified receipt review back to pending');

-- ---------------------------------------------------------------------------
-- Append-only freeze (mirror stock_receipt_corrections_block_mutation).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.stock_receipt_price_corrections set reason='changed' where id='c1000000-0000-0000-0000-000000000347' $$,
  'P0001', null, 'UPDATE on a correction row is blocked (append-only)');
select throws_ok(
  $$ delete from public.stock_receipt_price_corrections where id='c1000000-0000-0000-0000-000000000347' $$,
  'P0001', null, 'DELETE on a correction row is blocked (append-only)');

-- ---------------------------------------------------------------------------
-- Zero-grant posture: DEFINER-only, no direct table access for app roles.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000347"}';
select throws_ok(
  $$ insert into public.stock_receipt_price_corrections
       (receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, corrected_by)
     values ('a1000000-0000-0000-0000-000000000347', 9630, 7, -1000, -70, -1070, 'x', 'b0000000-0000-0000-0000-000000000347') $$,
  '42501', null, 'authenticated cannot INSERT directly (zero-grant; use the U2 RPC)');
select throws_ok(
  $$ select 1 from public.stock_receipt_price_corrections $$,
  '42501', null, 'authenticated cannot SELECT the ledger (zero-grant; read via DEFINER)');
reset role;

set local role anon;
select throws_ok(
  $$ insert into public.stock_receipt_price_corrections
       (receipt_id, corrected_amount, corrected_vat_rate, delta_net, delta_vat, delta_gross, reason, corrected_by)
     values ('a1000000-0000-0000-0000-000000000347', 9630, 7, -1000, -70, -1070, 'x', 'b0000000-0000-0000-0000-000000000347') $$,
  '42501', null, 'anon cannot INSERT directly (zero-grant)');
reset role;

select * from finish();
rollback;
