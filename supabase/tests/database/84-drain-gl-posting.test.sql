begin;
select plan(21);

-- ============================================================================
-- Spec 149 U4c / ADR 0057 — drain_gl_posting + dc/labor/rental posters,
-- end-to-end: insert subledger rows (triggers enqueue) -> drain -> balanced
-- journal entries per the posting map; auto-correct via re-drain (re-freeze);
-- void a DC payment (supersede -> reverse, no new entry). Fixtures as owner.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110624', 'pm@drain.local', '{}'::jsonb);
insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000624', 'TAP-GL-DRAIN', 'Drain fixture');
insert into public.work_packages (id, project_id, code, name) values
  ('ee000001-0000-4000-8000-000000000624', 'cc000001-0000-4000-8000-000000000624', 'WP-DR-1', 'Drain WP');
-- ADR 0062: a DC payment keys on the worker (the payee), not a contractor.
insert into public.workers (id, name, worker_type, day_rate, active, created_by) values
  ('aa000001-0000-4000-8000-000000000624', 'Drain DC', 'dc', 200.00, true,
   '11111111-1111-1111-1111-111111110624');
insert into public.equipment_owners (id, name, created_by) values
  ('b0000001-0000-4000-8000-000000000624', 'Drain Sister Co', '11111111-1111-1111-1111-111111110624');
insert into public.suppliers (id, name, created_by) values
  ('5a000001-0000-4000-8000-000000000624', 'Drain Supplier', '11111111-1111-1111-1111-111111110624');

-- Isolate from any pre-existing prod gl_posting_outbox rows: the queue is not
-- pruned, so real posted jobs persist and would inflate the table-wide posted
-- count below. Owner context here; rolled back with the test.
delete from public.gl_posting_outbox;

-- Subledger rows -> the U4a triggers enqueue four pending jobs.
insert into public.dc_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by)
values
  ('d1000001-0000-4000-8000-000000000624', 'aa000001-0000-4000-8000-000000000624',
   date '2026-06-01', date '2026-06-15', 1000, 5, 1000, date '2026-06-16', 'cash',
   '11111111-1111-1111-1111-111111110624');
insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, frozen_by) values
  ('ee000001-0000-4000-8000-000000000624', 700, 300, '11111111-1111-1111-1111-111111110624');
insert into public.equipment_rental_batches (id, owner_id, monthly_rate, starts_on, created_by) values
  ('e0000001-0000-4000-8000-000000000624', 'b0000001-0000-4000-8000-000000000624',
   50000, date '2026-07-01', '11111111-1111-1111-1111-111111110624');
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status, amount, vat_rate, supplier_id, purchased_at)
values
  ('a1000001-0000-4000-8000-000000000624', 'ee000001-0000-4000-8000-000000000624',
   'rebar', 10, 'ton', '11111111-1111-1111-1111-111111110624', 'purchased', 1070, 7,
   '5a000001-0000-4000-8000-000000000624', timestamptz '2026-07-05 09:00+07');

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_function('public', 'drain_gl_posting', 'drain_gl_posting exists');
select has_function('public', 'post_dc_payment_to_gl', 'post_dc_payment_to_gl exists');
select has_function('public', 'post_labor_freeze_to_gl', 'post_labor_freeze_to_gl exists');
select has_function('public', 'post_rental_batch_to_gl', 'post_rental_batch_to_gl exists');
select is((select is_postable from public.gl_accounts where code = '2130'),
  true, 'payroll-clearing account 2130 exists and is postable');

-- ============================================================================
-- B. Drain the four jobs.
-- ============================================================================
select is((select public.drain_gl_posting(100)), 4, 'drain posts all four pending jobs');
select is((select count(*) from public.gl_posting_outbox where status = 'posted'),
  4::bigint, 'all four outbox jobs are marked posted');
select is((select count(*) from public.gl_posting_outbox
  where status = 'posted' and journal_entry_id is not null), 4::bigint,
  'each posted job links its journal entry');

-- DC payment: Dr DC-clearing 2110 1000 / Cr Bank 1110 1000. ADR 0062: the payee
-- is a worker, journal_lines has no worker dimension → the line carries no party.
select is((select count(*) from public.journal_lines
  where entry_id = (select id from public.journal_entries
      where source_table='dc_payments' and source_id='d1000001-0000-4000-8000-000000000624' and source_event='dc_payment')
    and account_id = (select id from public.gl_accounts where code='2110')
    and debit = 1000 and contractor_id is null),
  1::bigint, 'DC payment debits DC-clearing 1000 (no party — worker payee)');
select is((select count(*) from public.journal_lines
  where entry_id = (select id from public.journal_entries
      where source_table='dc_payments' and source_id='d1000001-0000-4000-8000-000000000624' and source_event='dc_payment')
    and account_id = (select id from public.gl_accounts where code='1110') and credit = 1000),
  1::bigint, 'DC payment credits Bank 1000');

-- Labor freeze: Dr WIP 1400 (700+300) / Cr Payroll 2130 700 + Cr DC-clearing 2110 300.
select is((select sum(debit) from public.journal_lines
  where entry_id = (select id from public.journal_entries
      where source_table='wp_labor_costs' and source_id='ee000001-0000-4000-8000-000000000624' and source_event='labor_freeze')
    and account_id = (select id from public.gl_accounts where code='1400')),
  1000::numeric, 'labor freeze debits WIP 1000 (own 700 + dc 300)');
select is((select credit from public.journal_lines
  where entry_id = (select id from public.journal_entries
      where source_table='wp_labor_costs' and source_id='ee000001-0000-4000-8000-000000000624' and source_event='labor_freeze')
    and account_id = (select id from public.gl_accounts where code='2130')),
  700::numeric, 'labor freeze credits Payroll-clearing 700 (own)');
select is((select credit from public.journal_lines
  where entry_id = (select id from public.journal_entries
      where source_table='wp_labor_costs' and source_id='ee000001-0000-4000-8000-000000000624' and source_event='labor_freeze')
    and account_id = (select id from public.gl_accounts where code='2110')),
  300::numeric, 'labor freeze credits DC-clearing 300 (dc)');

-- Rental: Dr WIP 1400 50000 / Cr Intercompany AP 2120 50000 (owner party).
select is((select count(*) from public.journal_lines
  where entry_id = (select id from public.journal_entries
      where source_table='equipment_rental_batches' and source_id='e0000001-0000-4000-8000-000000000624')
    and account_id = (select id from public.gl_accounts where code='2120')
    and credit = 50000 and equipment_owner_id = 'b0000001-0000-4000-8000-000000000624'),
  1::bigint, 'rental credits Intercompany AP 50000 (owner party)');

-- Purchase (poster proven in 83; one sanity line here): Cr AP 2100 1070 (supplier).
select is((select count(*) from public.journal_lines
  where entry_id = (select id from public.journal_entries
      where source_table='purchase_requests' and source_id='a1000001-0000-4000-8000-000000000624' and source_event='purchase')
    and account_id = (select id from public.gl_accounts where code='2100')
    and credit = 1070 and supplier_id = '5a000001-0000-4000-8000-000000000624'),
  1::bigint, 'purchase credits AP 1070 (supplier party)');

-- ============================================================================
-- C. Auto-correct: re-freeze labor (money change) -> re-enqueue -> re-drain.
-- ============================================================================
update public.wp_labor_costs set own_cost = 800
 where work_package_id = 'ee000001-0000-4000-8000-000000000624';
select is((select public.drain_gl_posting(100)), 1, 're-drain posts the re-frozen labor');
select is((select count(*) from public.journal_entries e
  where e.source_table='wp_labor_costs' and e.source_id='ee000001-0000-4000-8000-000000000624'
    and e.source_event='labor_freeze'
    and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  1::bigint, 'exactly one CURRENT labor entry after re-freeze');
select is((select sum(debit) from public.journal_lines
  where entry_id = (select e.id from public.journal_entries e
      where e.source_table='wp_labor_costs' and e.source_id='ee000001-0000-4000-8000-000000000624'
        and e.source_event='labor_freeze'
        and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id))
    and account_id = (select id from public.gl_accounts where code='1400')),
  1100::numeric, 'the current labor entry debits WIP 1100 (own 800 + dc 300)');

-- ============================================================================
-- D. Void a DC payment (supersede -> reverse old, post nothing new).
-- ============================================================================
insert into public.dc_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days,
   paid_amount, paid_at, method, paid_by, superseded_by, correction_reason)
values
  ('d2000002-0000-4000-8000-000000000624', 'aa000001-0000-4000-8000-000000000624',
   date '2026-06-01', date '2026-06-15', 1000, 5, null, date '2026-06-16', 'cash',
   '11111111-1111-1111-1111-111111110624', 'd1000001-0000-4000-8000-000000000624', 'wrong amount');
select is((select public.drain_gl_posting(100)), 1, 'drain processes the void');
select is((select count(*) from public.journal_entries e
  where e.source_table='dc_payments' and e.source_id='d1000001-0000-4000-8000-000000000624'
    and e.source_event='dc_payment'
    and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  0::bigint, 'the original DC payment entry is now reversed (no current entry)');
select is((select count(*) from public.gl_posting_outbox
  where source_id = 'd2000002-0000-4000-8000-000000000624'
    and status = 'posted' and journal_entry_id is null),
  1::bigint, 'the void job is posted with no new journal entry');

select * from finish();
rollback;
