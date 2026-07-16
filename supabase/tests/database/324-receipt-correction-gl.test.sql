begin;
select plan(17);

-- ============================================================================
-- Spec 324 U3 — the GL contra for a receipt correction.
--   An AFTER-INSERT trigger on stock_receipt_corrections enqueues a GL job;
--   drain_gl_posting routes source_table='stock_receipt_corrections' to
--   post_stock_receipt_correction_to_gl, which posts the VAT-RESIDUAL CONTRA of
--   the original รับเข้า: Cr 1500 (net) / Cr 1300 (vat, if any) / Dr 2100 (gross
--   residual). Zero-net → no entry (skip). Posted into the CURRENT open period.
--   A reverse-and-repost self-guard makes an overlapping drain idempotent.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000324', 'bo@gl324.local', '{}'::jsonb);
update public.users set role='procurement' where id='b0000000-0000-0000-0000-000000000324';

insert into public.projects (id, code, name) values
  ('40000000-0000-0000-0000-000000000324', 'GL324-PROJ', 'GL แก้จำนวน');
insert into public.suppliers (id, name, created_by) values
  ('50000000-0000-0000-0000-000000000324', 'ผู้ขาย GL', 'b0000000-0000-0000-0000-000000000324');

insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('11000000-0000-0000-0000-000000000324', 'electrical', 'vat',    'ชิ้น', true),
  ('12000000-0000-0000-0000-000000000324', 'electrical', 'novat',  'ชิ้น', true),
  ('13000000-0000-0000-0000-000000000324', 'electrical', 'free',   'ชิ้น', true),
  ('14000000-0000-0000-0000-000000000324', 'electrical', 'odd',    'ชิ้น', true);

-- I1 VAT (100 @ 10, 7%), I2 zero-VAT (50 @ 10), I3 free (50 @ 0), I4 awkward (8 @ 3.33, 7%).
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, created_by) values
  ('a1000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '11000000-0000-0000-0000-000000000324', 100, 'ชิ้น', 10,   7, '50000000-0000-0000-0000-000000000324', 'b0000000-0000-0000-0000-000000000324'),
  ('a2000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '12000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 10,   0, '50000000-0000-0000-0000-000000000324', 'b0000000-0000-0000-0000-000000000324'),
  ('a3000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '13000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 0,    0, '50000000-0000-0000-0000-000000000324', 'b0000000-0000-0000-0000-000000000324'),
  ('a4000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '14000000-0000-0000-0000-000000000324', 8,   'ชิ้น', 3.33, 7, '50000000-0000-0000-0000-000000000324', 'b0000000-0000-0000-0000-000000000324');
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('40000000-0000-0000-0000-000000000324', '11000000-0000-0000-0000-000000000324', 100, 1000),
  ('40000000-0000-0000-0000-000000000324', '12000000-0000-0000-0000-000000000324', 50,  500),
  ('40000000-0000-0000-0000-000000000324', '13000000-0000-0000-0000-000000000324', 50,  0),
  ('40000000-0000-0000-0000-000000000324', '14000000-0000-0000-0000-000000000324', 8,   26.64);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- Structure: the poster is service-role only (like the other store posters).
select is(has_function_privilege('authenticated', 'public.post_stock_receipt_correction_to_gl(uuid)', 'EXECUTE'),
  false, 'authenticated cannot execute post_stock_receipt_correction_to_gl (service-role only)');

-- Apply the corrections as back-office (fires the enqueue trigger).
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000324"}';
select lives_ok($$ select public.correct_stock_receipt('a1000000-0000-0000-0000-000000000324', 80, 'vat')  $$, 'correct VAT receipt (remove 20)');
select lives_ok($$ select public.correct_stock_receipt('a2000000-0000-0000-0000-000000000324', 40, 'nov')  $$, 'correct zero-VAT receipt (remove 10)');
select lives_ok($$ select public.correct_stock_receipt('a3000000-0000-0000-0000-000000000324', 40, 'free') $$, 'correct free receipt (remove 10, net 0)');
select lives_ok($$ select public.correct_stock_receipt('a4000000-0000-0000-0000-000000000324', 1,  'odd')  $$, 'correct awkward receipt (remove 7)');
reset role;

-- Drain the enqueued GL jobs.
select lives_ok($$ select public.drain_gl_posting(200) $$, 'drain_gl_posting runs');

-- Routing: the I1 correction job posted (NOT skipped/failed) → the CASE label matches.
select is(
  (select status from public.gl_posting_outbox
     where source_table='stock_receipt_corrections'
       and source_id=(select id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324')),
  'posted', 'the correction job routed + posted (drain CASE matches the enqueue source_table)');

-- I1 (VAT): one balanced entry in the current period; Cr1500=200, Cr1300=14, Dr2100=214.
select is(
  (select entry_date from public.journal_entries
     where source_table='stock_receipt_corrections' and source_event='stock_receipt_correction'
       and source_id=(select id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324')),
  current_date, 'the contra posts into the current open period (current_date)');
select is(
  (select sum(debit) from public.journal_lines where entry_id=(select id from public.journal_entries
     where source_id=(select id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324')
       and source_event='stock_receipt_correction')),
  (select sum(credit) from public.journal_lines where entry_id=(select id from public.journal_entries
     where source_id=(select id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324')
       and source_event='stock_receipt_correction')),
  'the VAT contra balances (Σdebit = Σcredit)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_event='stock_receipt_correction'
       and source_id=(select id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324'))
     and account_id=(select id from public.gl_accounts where code='1500') and credit=200 and project_id='40000000-0000-0000-0000-000000000324'),
  1::bigint, 'Cr 1500 = removed_net 200 (project dim)');
select is(
  (select count(*) from public.journal_lines
     where entry_id=(select id from public.journal_entries where source_event='stock_receipt_correction'
       and source_id=(select id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324'))
     and account_id=(select id from public.gl_accounts where code='2100') and debit=214 and supplier_id='50000000-0000-0000-0000-000000000324'),
  1::bigint, 'Dr 2100 = removed_gross 214 (supplier party, residual)');

-- I2 (zero-VAT): exactly 2 lines, no 1300.
select is(
  (select count(*) from public.journal_lines where entry_id=(select id from public.journal_entries where source_event='stock_receipt_correction'
     and source_id=(select id from public.stock_receipt_corrections where receipt_id='a2000000-0000-0000-0000-000000000324'))
     and account_id=(select id from public.gl_accounts where code='1300')),
  0::bigint, 'a zero-VAT correction posts NO 1300 (Input VAT) leg');

-- I3 (free): zero-net → no journal entry, but the outbox job is still posted.
select is(
  (select count(*) from public.journal_entries where source_event='stock_receipt_correction'
     and source_id=(select id from public.stock_receipt_corrections where receipt_id='a3000000-0000-0000-0000-000000000324')),
  0::bigint, 'a zero-value (unit_cost 0) correction posts NO journal entry (skip)');
select is(
  (select status from public.gl_posting_outbox where source_table='stock_receipt_corrections'
     and source_id=(select id from public.stock_receipt_corrections where receipt_id='a3000000-0000-0000-0000-000000000324')),
  'posted', 'the zero-value job is still marked posted (not failed/skipped)');

-- I4 (awkward rounding 3.33 @ 7%): the residual keeps it balanced to the satang.
select is(
  (select sum(debit) from public.journal_lines where entry_id=(select id from public.journal_entries where source_event='stock_receipt_correction'
     and source_id=(select id from public.stock_receipt_corrections where receipt_id='a4000000-0000-0000-0000-000000000324'))),
  (select sum(credit) from public.journal_lines where entry_id=(select id from public.journal_entries where source_event='stock_receipt_correction'
     and source_id=(select id from public.stock_receipt_corrections where receipt_id='a4000000-0000-0000-0000-000000000324'))),
  'awkward-rounding contra still balances (Dr 2100 = residual)');

-- Redrain self-guard: posting the SAME correction twice (overlapping drain) leaves
-- the NET 1500 effect unchanged (reverse-and-repost), not doubled.
select lives_ok(
  $$ select public.post_stock_receipt_correction_to_gl(
       (select id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324')) $$,
  're-posting the same correction is safe (reverse-and-repost)');
-- Exactly ONE live (non-reversed) correction entry survives → Cr 1500 = 200, not
-- doubled (the prior entry was reversed-and-reposted, not stacked).
select is(
  (select coalesce(sum(credit),0) - coalesce(sum(debit),0)
     from public.journal_lines jl
     join public.journal_entries je on je.id = jl.entry_id
    where je.source_table='stock_receipt_corrections' and je.source_event='stock_receipt_correction'
      and je.source_id=(select id from public.stock_receipt_corrections where receipt_id='a1000000-0000-0000-0000-000000000324')
      and not exists (select 1 from public.journal_entries r where r.reversal_of = je.id)
      and jl.account_id=(select id from public.gl_accounts where code='1500')),
  200::numeric, 'the LIVE (non-reversed) correction entry books Cr 1500 = 200 exactly once (redrain safe)');

select * from finish();
rollback;
