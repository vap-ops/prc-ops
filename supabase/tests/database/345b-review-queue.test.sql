begin;
select plan(30);

-- ============================================================================
-- Spec 345 U2 — list_money_events_for_review (union queue RPC) +
-- money_review_docs_expected (the docs-expected SSOT helper).
-- Pins: both fns exist; list RPC is SECURITY DEFINER; the 15-source
-- docs-expected map + unknown-source refusal; anon/visitor gates (42501,
-- message-pinned); tab membership (absent review ⇒ pending; verified;
-- flagged w/ open_flag_count; no_docs = expected-class AND zero docs);
-- supersede exclusion (old wage row leaves the queue); month + project
-- filters (null-project rows drop under a project filter); ordering
-- (older event first within a tab); doc_count; docs_expected per row;
-- pagination.
-- ⚠️ The RPC unions LIVE prod rows — every assert is scoped to fixture ids
-- or fixture projects; NEVER a global count (doctrine: no global counts on
-- operator-writable tables).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000445', 'acct@rq445.local', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000445', 'vis@rq445.local', '{}'::jsonb);
update public.users set role = 'accounting' where id = '10000000-0000-4000-8000-000000000445';
-- 20…445 stays visitor (default).

insert into public.projects (id, code, name) values
  ('c1000000-0000-4000-8000-000000000445', 'TAP-RQ-P1', 'Review queue P1'),
  ('c2000000-0000-4000-8000-000000000445', 'TAP-RQ-P2', 'Review queue P2');
insert into public.work_packages (id, project_id, code, name) values
  ('e1000000-0000-4000-8000-000000000445', 'c1000000-0000-4000-8000-000000000445', 'WP-RQ-1', 'queue labor WP');
insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, frozen_by, computed_at) values
  ('e1000000-0000-4000-8000-000000000445', 800, 200, '10000000-0000-4000-8000-000000000445',
   '2001-01-20 09:00:00+00');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('a0000000-0000-4000-8000-000000000445', 'RQ445 DC', 'daily', 'permanent', 320.00, true,
   '10000000-0000-4000-8000-000000000445');
-- Wage A (July) is superseded by B — only B may appear in the queue. C is June.
insert into public.wage_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by) values
  ('d1000000-0000-4000-8000-000000000445', 'a0000000-0000-4000-8000-000000000445',
   date '2001-01-01', date '2001-01-09', 3000, 9, 3000, date '2001-01-10', 'cash',
   '10000000-0000-4000-8000-000000000445'),
  ('d3000000-0000-4000-8000-000000000445', 'a0000000-0000-4000-8000-000000000445',
   date '2001-02-01', date '2001-02-09', 1500, 5, 1500, date '2001-02-10', 'cash',
   '10000000-0000-4000-8000-000000000445');
insert into public.wage_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by, superseded_by, correction_reason) values
  ('d2000000-0000-4000-8000-000000000445', 'a0000000-0000-4000-8000-000000000445',
   date '2001-01-01', date '2001-01-09', 3200, 9, 3200, date '2001-01-10', 'cash',
   '10000000-0000-4000-8000-000000000445', 'd1000000-0000-4000-8000-000000000445',
   'แก้ยอด (fixture)');

insert into public.office_expense_categories (id, label_th, label_en, sort, is_active) values
  ('0c000000-0000-4000-8000-000000000445', 'หมวด RQ445', 'RQ445 cat', 990, true);
insert into public.office_expenses
  (id, project_id, category_id, description, amount, expense_date, payment_source, submitted_by) values
  ('0e100000-0000-4000-8000-000000000445', 'c1000000-0000-4000-8000-000000000445',
   '0c000000-0000-4000-8000-000000000445', 'ค่ากาแฟ RQ445', 700, date '2001-01-05', 'own_money',
   '10000000-0000-4000-8000-000000000445'),
  ('0e200000-0000-4000-8000-000000000445', 'c1000000-0000-4000-8000-000000000445',
   '0c000000-0000-4000-8000-000000000445', 'ค่ากระดาษ RQ445', 900, date '2001-01-06', 'own_money',
   '10000000-0000-4000-8000-000000000445');
insert into public.office_expense_attachments (id, office_expense_id, storage_path, created_by, purpose) values
  ('0a100000-0000-4000-8000-000000000445', '0e200000-0000-4000-8000-000000000445', 'rq445/receipt.jpg',
   '10000000-0000-4000-8000-000000000445', 'tax_invoice');

insert into public.suppliers (id, name, created_by) values
  ('50000000-0000-4000-8000-000000000445', 'ผู้ขาย RQ445', '10000000-0000-4000-8000-000000000445');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('11000000-0000-4000-8000-000000000445', 'electrical', 'RQ445 item', 'ชิ้น', true);
insert into public.stock_receipts
  (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, received_at) values
  ('a1000000-0000-4000-8000-000000000445', 'c1000000-0000-4000-8000-000000000445',
   '11000000-0000-4000-8000-000000000445', 10, 'ชิ้น', 50, 0,
   '50000000-0000-4000-8000-000000000445', '2001-01-12 08:00:00+00');

-- Reviews (owner writes): E2 verified · SR1 flagged with one OPEN flag.
insert into public.money_event_reviews
  (id, source_table, source_id, project_id, status, verified_by, verified_at, verified_via) values
  ('b1000000-0000-4000-8000-000000000445', 'office_expenses',
   '0e200000-0000-4000-8000-000000000445', 'c1000000-0000-4000-8000-000000000445',
   'verified', '10000000-0000-4000-8000-000000000445', now(), 'reviewer');
insert into public.money_event_reviews
  (id, source_table, source_id, project_id, status) values
  ('b2000000-0000-4000-8000-000000000445', 'stock_receipts',
   'a1000000-0000-4000-8000-000000000445', 'c1000000-0000-4000-8000-000000000445', 'flagged');
insert into public.money_review_flags
  (review_id, flag_type, raised_by_kind, status, detail, flagged_by) values
  ('b2000000-0000-4000-8000-000000000445', 'amount_mismatch', 'reviewer', 'open',
   'ยอดไม่ตรง (fixture)', '10000000-0000-4000-8000-000000000445');

-- ============================================================================
-- A. Catalog + gates.
-- ============================================================================
select has_function('public', 'money_review_docs_expected', array['text'],
  'docs-expected SSOT helper exists');
select has_function('public', 'list_money_events_for_review',
  'list_money_events_for_review exists');
select is((select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'list_money_events_for_review'),
  true, 'list_money_events_for_review is SECURITY DEFINER');

select is(
  (select array_agg(public.money_review_docs_expected(s) order by s)
     from unnest(array['purchase_requests','purchase_order_charges','office_expenses',
       'stock_receipts','stock_returns','wage_payments','wp_labor_costs',
       'equipment_rental_batches','rental_charges','rental_settlements',
       'subcontract_payments','client_billings','client_receipts',
       'retention_receivables','wht_certificates']) s),
  (select array_agg(v order by s2) from (values
     ('purchase_requests','expected'), ('purchase_order_charges','no_path_yet'),
     ('office_expenses','expected'), ('stock_receipts','no_path_yet'),
     ('stock_returns','no_path_yet'), ('wage_payments','no_path_yet'),
     ('wp_labor_costs','not_expected'), ('equipment_rental_batches','no_path_yet'),
     ('rental_charges','no_path_yet'), ('rental_settlements','expected'),
     ('subcontract_payments','no_path_yet'), ('client_billings','no_path_yet'),
     ('client_receipts','no_path_yet'), ('retention_receivables','no_path_yet'),
     ('wht_certificates','no_path_yet')) t(s2, v)),
  'docs-expected map pins all 15 sources (expected: PR + office expense + rental settlement; not_expected: labor)');
select throws_ok($$ select public.money_review_docs_expected('users') $$,
  '22023', null, 'an unknown source is refused, never silently classified');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role anon;
select throws_ok($$ select * from public.list_money_events_for_review('pending') $$,
  '42501', null, 'anon cannot execute the queue RPC');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "20000000-0000-4000-8000-000000000445"}';
select throws_ok($$ select * from public.list_money_events_for_review('pending') $$,
  '42501', 'list_money_events_for_review: role not permitted',
  'a visitor is refused with the pinned message');
reset role;

-- ============================================================================
-- B. Behavior — as the accounting user. Fixture-scoped asserts ONLY.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000445"}';

select is((select count(*) from public.list_money_events_for_review('pending', null, date '2001-01-01')
           where source_id = 'd2000000-0000-4000-8000-000000000445'),
  1::bigint, 'the current (superseding) wage payment appears in the pending tab');
select is((select count(*) from public.list_money_events_for_review('pending', null, date '2001-01-01')
           where source_id = 'd1000000-0000-4000-8000-000000000445'),
  0::bigint, 'the superseded wage payment has left the queue');

select is(
  (select array_agg(t.source_table order by t.ord)
     from public.list_money_events_for_review(
       'pending', 'c1000000-0000-4000-8000-000000000445', date '2001-01-01')
       with ordinality as t(source_table, source_id, project_id, project_name, amount,
         event_date, counterparty, doc_count, review_status, open_flag_count,
         docs_expected, ord)),
  array['office_expenses', 'wp_labor_costs'],
  'within a tab the older event ranks first (01-05 expense before 01-20 labor freeze)');

select is((select count(*) from public.list_money_events_for_review('pending', null, date '2001-02-01')
           where source_id = 'd3000000-0000-4000-8000-000000000445'),
  1::bigint, 'the second-month filter admits that month payment');
select is((select count(*) from public.list_money_events_for_review('pending', null, date '2001-01-01')
           where source_id = 'd3000000-0000-4000-8000-000000000445'),
  0::bigint, 'the first-month filter excludes the other month payment');

select is((select count(*) from public.list_money_events_for_review('verified', null, date '2001-01-01')
           where source_id = '0e200000-0000-4000-8000-000000000445'),
  1::bigint, 'a verified review lands in the verified tab');
select is((select count(*) from public.list_money_events_for_review('pending', null, date '2001-01-01')
           where source_id = '0e200000-0000-4000-8000-000000000445'),
  0::bigint, 'a verified review is out of the pending tab');

select is((select count(*) from public.list_money_events_for_review('no_docs', null, date '2001-01-01')
           where source_id = '0e100000-0000-4000-8000-000000000445'),
  1::bigint, 'a doc-less expected-class expense sits in ไม่มีเอกสาร');
select is((select count(*) from public.list_money_events_for_review('no_docs', null, date '2001-01-01')
           where source_id = '0e200000-0000-4000-8000-000000000445'),
  0::bigint, 'an expense with an attachment is out of ไม่มีเอกสาร');

select is((select count(*) from public.list_money_events_for_review('flagged', null, date '2001-01-01')
           where source_id = 'a1000000-0000-4000-8000-000000000445'),
  1::bigint, 'a flagged review lands in the flagged tab');
select is((select open_flag_count from public.list_money_events_for_review('flagged', null, date '2001-01-01')
           where source_id = 'a1000000-0000-4000-8000-000000000445'),
  1, 'the flagged row carries its open flag count');

select is((select count(*) from public.list_money_events_for_review(
             'pending', 'c1000000-0000-4000-8000-000000000445', date '2001-01-01')),
  2::bigint, 'project filter: P1 holds exactly the expense + the labor freeze');
select is((select count(*) from public.list_money_events_for_review(
             'pending', 'c2000000-0000-4000-8000-000000000445', date '2001-01-01')),
  0::bigint, 'project filter: the empty fixture project has no rows');
select is((select count(*) from public.list_money_events_for_review(
             'pending', 'c1000000-0000-4000-8000-000000000445', date '2001-01-01')
           where source_table = 'wage_payments'),
  0::bigint, 'a project filter drops project-less rows (wage payments)');

select results_eq($$
  select amount, counterparty from public.list_money_events_for_review('pending', null, date '2001-01-01')
   where source_id = 'd2000000-0000-4000-8000-000000000445'
$$, $$ values (3200::numeric, 'RQ445 DC'::text) $$,
  'the wage row carries paid_amount and the worker name');
select is((select counterparty from public.list_money_events_for_review('pending', null, date '2001-01-01')
           where source_id = '0e100000-0000-4000-8000-000000000445'),
  'ค่ากาแฟ RQ445', 'the expense row carries its description');
select is((select counterparty from public.list_money_events_for_review('flagged', null, date '2001-01-01')
           where source_id = 'a1000000-0000-4000-8000-000000000445'),
  'ผู้ขาย RQ445', 'the receipt row carries the supplier name');

select is((select doc_count from public.list_money_events_for_review('verified', null, date '2001-01-01')
           where source_id = '0e200000-0000-4000-8000-000000000445'),
  1, 'doc_count counts the attachment');
select is((select doc_count from public.list_money_events_for_review('no_docs', null, date '2001-01-01')
           where source_id = '0e100000-0000-4000-8000-000000000445'),
  0, 'doc_count is zero without attachments');

select is((select count(*) from public.list_money_events_for_review(
             'pending', null, date '2001-01-01', 1, 0)),
  1::bigint, 'p_limit=1 returns exactly one row');

select is((select docs_expected from public.list_money_events_for_review('pending', null, date '2001-01-01')
           where source_id = 'd2000000-0000-4000-8000-000000000445'),
  'no_path_yet', 'wage rows are classed no_path_yet (until U6)');
select is((select docs_expected from public.list_money_events_for_review(
             'pending', 'c1000000-0000-4000-8000-000000000445', date '2001-01-01')
           where source_table = 'wp_labor_costs'),
  'not_expected', 'labor rows are classed not_expected (muster is the evidence)');
select is((select docs_expected from public.list_money_events_for_review('no_docs', null, date '2001-01-01')
           where source_id = '0e100000-0000-4000-8000-000000000445'),
  'expected', 'office expenses are classed expected');

reset role;

select * from finish();
rollback;
