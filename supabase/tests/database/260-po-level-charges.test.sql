begin;
select plan(63);

-- ============================================================================
-- Spec 260 — PO-level charges (ค่าขนส่ง / ส่วนลด / ค่าใช้จ่ายอื่น). Pins:
-- enum + table shape + RLS (no write policies, read follows purchase_orders);
-- add gate (site_admin refused, the 4 create-roles allowed) + validation
-- CHECKs (amount > 0, 'other' requires note); the outbox job enqueued with
-- source_event 'po_charge'; the GL entry legs for a mixed WP+store PO
-- (proportional allocation sums exactly, Dr/Cr balance, discount contra
-- shape); drain_gl_posting routes 'purchase_order_charges' to the new poster
-- without dropping any existing arm; void charge (gate: plain procurement
-- refused, each of PM/super/PD admitted; posted → reversed, pending → job
-- skipped, row deleted, audit rows for both actions).
--
-- Data-independence (#243 lesson): every charge/audit lookup is scoped to the
-- fixture POs (via the fa… member ids), never to a bare amount that a real
-- prod row could also carry.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110260', 'pm@chg.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220260', 'sa@chg.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330260', 'vi@chg.local',    '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440260', 'proc@chg.local',  '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550260', 'pd@chg.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660260', 'super@chg.local', '{}'::jsonb);
update public.users set role = 'project_manager'  where id = '11111111-1111-1111-1111-111111110260';
update public.users set role = 'site_admin'       where id = '22222222-2222-2222-2222-222222220260';
-- 33… stays visitor
update public.users set role = 'procurement'      where id = '44444444-4444-4444-4444-444444440260';
update public.users set role = 'project_director' where id = '55555555-5555-5555-5555-555555550260';
update public.users set role = 'super_admin'      where id = '66666666-6666-6666-6666-666666660260';

insert into public.projects (id, code, name) values
  ('cc000260-0000-4000-8000-000000000001', 'TAP-CHG', 'PO-charge fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000260-0000-4000-8000-000000000001',
   'cc000260-0000-4000-8000-000000000001', 'WP-CHG-1', 'charge WP 1', 'in_progress'),
  ('ee000260-0000-4000-8000-000000000003',
   'cc000260-0000-4000-8000-000000000001', 'WP-CHG-2', 'charge WP 2', 'in_progress'),
  ('ee000260-0000-4000-8000-000000000004',
   'cc000260-0000-4000-8000-000000000001', 'WP-CHG-3', 'charge WP 3', 'in_progress');
insert into public.suppliers (id, name, created_by) values
  ('bb000260-0000-4000-8000-000000000001', 'ร้านทดสอบ ค่าใช้จ่าย',
   '11111111-1111-1111-1111-111111110260');

-- Member-line pool. fa…01 = WP-bound (project via the WP), fa…02 = store-bound
-- (project_id direct, WP null — the ADR 0065 shape) → the mixed PO. fa…03–05 =
-- three WP-bound lines for the rounding-remainder PO. fa…07 = the gates PO.
insert into public.purchase_requests
    (id, work_package_id, project_id, item_description, quantity, unit, status,
     source, requested_by) values
  ('fa000260-0000-4000-8000-000000000001',
   'ee000260-0000-4000-8000-000000000001', null, 'ปูนถุง', 10, 'ถุง', 'approved',
   'app', '11111111-1111-1111-1111-111111110260'),
  ('fa000260-0000-4000-8000-000000000002',
   null, 'cc000260-0000-4000-8000-000000000001', 'เหล็กเข้าคลัง', 5, 'เส้น', 'approved',
   'app', '11111111-1111-1111-1111-111111110260'),
  ('fa000260-0000-4000-8000-000000000003',
   'ee000260-0000-4000-8000-000000000001', null, 'ทราย A', 1, 'คิว', 'approved',
   'app', '11111111-1111-1111-1111-111111110260'),
  ('fa000260-0000-4000-8000-000000000004',
   'ee000260-0000-4000-8000-000000000003', null, 'ทราย B', 1, 'คิว', 'approved',
   'app', '11111111-1111-1111-1111-111111110260'),
  ('fa000260-0000-4000-8000-000000000005',
   'ee000260-0000-4000-8000-000000000004', null, 'ทราย C', 1, 'คิว', 'approved',
   'app', '11111111-1111-1111-1111-111111110260'),
  ('fa000260-0000-4000-8000-000000000007',
   null, 'cc000260-0000-4000-8000-000000000001', 'ของทดสอบเกต', 1, 'ชิ้น', 'approved',
   'app', '11111111-1111-1111-1111-111111110260');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Structure: enum, table shape, RLS posture, RPC/poster/trigger/drain.
-- ============================================================================
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
     from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'po_charge_type'),
  'transport,discount,other', 'po_charge_type enum = transport,discount,other');
select ok(
  (select string_agg(e.enumlabel, ',') from pg_type t
     join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'audit_action') like '%po_charge_add%',
  'audit_action gained po_charge_add');
select ok(
  (select string_agg(e.enumlabel, ',') from pg_type t
     join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'audit_action') like '%po_charge_void%',
  'audit_action gained po_charge_void');
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_order_charges'),
  'id,purchase_order_id,charge_type,amount,vat_rate,note,created_by,created_at',
  'purchase_order_charges has exactly the spec columns');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.purchase_order_charges'::regclass),
  'RLS enabled on purchase_order_charges');
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.purchase_order_charges'::regclass and polcmd <> 'r'),
  0, 'no INSERT/UPDATE/DELETE policies (RPC is the only writer)');
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.purchase_order_charges'::regclass and polcmd = 'r'),
  1, 'exactly one SELECT policy');
select ok(
  (select pg_get_expr(polqual, polrelid) from pg_policy
    where polrelid = 'public.purchase_order_charges'::regclass and polcmd = 'r')
    like all (array['%site_admin%', '%project_manager%', '%procurement%',
                    '%super_admin%', '%project_director%']),
  'read policy admits the same 5 roles as purchase_orders');
select is(has_table_privilege('authenticated', 'public.purchase_order_charges', 'INSERT'),
  false, 'authenticated has no INSERT grant');
select is(has_table_privilege('authenticated', 'public.purchase_order_charges', 'UPDATE'),
  false, 'authenticated has no UPDATE grant');
select is(has_table_privilege('authenticated', 'public.purchase_order_charges', 'DELETE'),
  false, 'authenticated has no DELETE grant');
select ok(has_table_privilege('authenticated', 'public.purchase_order_charges', 'SELECT'),
  'authenticated may SELECT (RLS gates the rows)');

select ok(to_regprocedure(
  'public.add_purchase_order_charge(uuid, po_charge_type, numeric, numeric, text)') is not null,
  'add_purchase_order_charge exists with the spec signature');
select ok(to_regprocedure('public.void_purchase_order_charge(uuid)') is not null,
  'void_purchase_order_charge exists');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('add_purchase_order_charge', 'void_purchase_order_charge',
                        'post_purchase_order_charge_to_gl')
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  3, 'all three charge functions are SECURITY DEFINER with pinned search_path');
select is(has_function_privilege('anon',
  'public.add_purchase_order_charge(uuid, po_charge_type, numeric, numeric, text)', 'EXECUTE'),
  false, 'anon cannot execute add_purchase_order_charge');
select ok(has_function_privilege('authenticated',
  'public.add_purchase_order_charge(uuid, po_charge_type, numeric, numeric, text)', 'EXECUTE'),
  'authenticated may execute add_purchase_order_charge');
select is(has_function_privilege('anon',
  'public.void_purchase_order_charge(uuid)', 'EXECUTE'),
  false, 'anon cannot execute void_purchase_order_charge');
select ok(has_function_privilege('authenticated',
  'public.void_purchase_order_charge(uuid)', 'EXECUTE'),
  'authenticated may execute void_purchase_order_charge');
select is(has_function_privilege('authenticated',
  'public.post_purchase_order_charge_to_gl(uuid)', 'EXECUTE'),
  false, 'the poster is internal — authenticated cannot execute it');
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.purchase_order_charges'::regclass
      and not tgisinternal
      and tgname = 'purchase_order_charges_enqueue_gl_posting'),
  1, 'AFTER INSERT enqueue trigger installed on purchase_order_charges');

-- Drain: the new arm exists AND every pre-existing arm survived the re-source
-- (the GL-drain re-source lesson — a replace must never drop an arm).
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'drain_gl_posting')
    like '%purchase_order_charges%',
  'drain_gl_posting routes purchase_order_charges');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'drain_gl_posting')
    like all (array[
      '%purchase_requests%', '%wage_payments%', '%wp_labor_costs%',
      '%equipment_rental_batches%', '%client_billings%', '%retention_receivables%',
      '%wht_certificates%', '%client_receipts%', '%stock_receipts%',
      '%stock_issues%', '%stock_returns%', '%stock_counts%', '%stock_reversals%',
      '%subcontract_payments%']),
  'no pre-existing drain arm was dropped by the re-source');

-- ============================================================================
-- B. Build the gates PO (fa…07 alone), then pin the add gate + validation.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110260"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000260-0000-4000-8000-000000000001'::uuid, date '2026-07-20',
       '[{"request_id":"fa000260-0000-4000-8000-000000000007","amount":100}]'::jsonb) $$,
  'PM creates the gates PO');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220260"}';
select throws_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000007'),
       'transport', 10, 0, null) $$,
  '42501', null, 'add refuses site_admin');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330260"}';
select throws_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000007'),
       'transport', 10, 0, null) $$,
  '42501', null, 'add refuses visitor');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110260"}';
select lives_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000007'),
       'transport', 10, 0, null) $$,
  'project_manager may add a charge');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440260"}';
select lives_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000007'),
       'other', 20, 0, 'ค่าธรรมเนียมเอกสาร') $$,
  'procurement may add a charge');
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660260"}';
select lives_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000007'),
       'discount', 5, 0, null) $$,
  'super_admin may add a charge');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550260"}';
select lives_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000007'),
       'transport', 15, 0, null) $$,
  'project_director may add a charge (ADR 0058 completeness)');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110260"}';
select throws_ok(
  $$ select public.add_purchase_order_charge(
       '00000000-0000-0000-0000-000000000000'::uuid, 'transport', 10, 0, null) $$,
  'P0001', null, 'add refuses an unknown PO id');
select throws_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000007'),
       'transport', 0, 0, null) $$,
  '23514', null, 'CHECK refuses amount = 0 (always positive; discount subtracts by type)');
select throws_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000007'),
       'other', 10, 0, '  ') $$,
  '23514', null, 'CHECK refuses an ''other'' charge without a note');
reset role;

-- C. The AFTER-INSERT trigger enqueued an outbox job + the add audit row.
select is(
  (select status::text from public.gl_posting_outbox
    where source_table = 'purchase_order_charges'
      and source_id = (select id from public.purchase_order_charges
                        where amount = 10 and charge_type = 'transport'
                          and purchase_order_id = (select purchase_order_id
                                from public.purchase_requests
                               where id = 'fa000260-0000-4000-8000-000000000007'))
      and source_event = 'po_charge'),
  'pending', 'add enqueued a pending outbox job with source_event po_charge');
select is(
  (select count(*)::int from public.audit_log
    where action = 'po_charge_add'
      and payload->>'charge_type' = 'transport'
      and (payload->>'amount')::numeric = 10
      and payload->>'po_number' = (select po.po_number::text
             from public.purchase_orders po
            where po.id = (select purchase_order_id from public.purchase_requests
                            where id = 'fa000260-0000-4000-8000-000000000007'))),
  1, 'one po_charge_add audit row with {po_number, charge_type, amount}');

-- ============================================================================
-- D. GL legs — the mixed WP+store PO. Lines: 300 (WP-bound) + 100 (store-
--    bound), VAT-free, so line net weights are 300:100. transport 107 @7% →
--    net 100 / VAT 7: Dr 1400 75 (project+WP) + Dr 1500 25 (project only) +
--    Dr 1300 7 / Cr 2100 107. Routed through drain_gl_posting (proves the arm).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110260"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000260-0000-4000-8000-000000000001'::uuid, date '2026-07-21',
       '[{"request_id":"fa000260-0000-4000-8000-000000000001","amount":300},
         {"request_id":"fa000260-0000-4000-8000-000000000002","amount":100}]'::jsonb) $$,
  'PM creates the mixed WP+store PO');
select lives_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000001'),
       'transport', 107, 7, null) $$,
  'PM adds transport 107 @7% to the mixed PO');
reset role;

select ok((select public.drain_gl_posting() >= 1), 'drain_gl_posting processed jobs');

select is(
  (select o.status::text from public.gl_posting_outbox o
    where o.source_table = 'purchase_order_charges'
      and o.source_id = (select id from public.purchase_order_charges
                          where amount = 107 and charge_type = 'transport'
                            and purchase_order_id = (select purchase_order_id
                                  from public.purchase_requests
                                 where id = 'fa000260-0000-4000-8000-000000000001'))
      and o.source_event = 'po_charge'),
  'posted', 'the charge job drained to posted (the new CASE arm routed it)');

-- The posted transport entry, leg by leg.
select is(
  (select l.debit from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 107 and charge_type = 'transport'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  75::numeric, 'transport: Dr 1400 WIP = 75 (WP-bound share, by line net)');
select ok(
  (select l.project_id = 'cc000260-0000-4000-8000-000000000001'
      and l.work_package_id = 'ee000260-0000-4000-8000-000000000001'
     from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 107 and charge_type = 'transport'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  'transport: the WIP leg carries project + work-package dimensions');
select ok(
  (select l.debit = 25 and l.project_id = 'cc000260-0000-4000-8000-000000000001'
      and l.work_package_id is null
     from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1500'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 107 and charge_type = 'transport'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  'transport: Dr 1500 Inventory = 25 (store-bound share, project dimension only)');
-- VAT allocates per member (each member's project), so sum the 1300 legs.
select is(
  (select sum(l.debit) from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1300'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 107 and charge_type = 'transport'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  7::numeric, 'transport: Dr 1300 Input VAT = 7 (summed over per-member legs)');
select ok(
  (select l.credit = 107 and l.supplier_id = 'bb000260-0000-4000-8000-000000000001'
     from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '2100'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 107 and charge_type = 'transport'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  'transport: Cr 2100 AP = 107 gross, supplier-dimensioned');
select is(
  (select sum(l.debit) - sum(l.credit) from public.journal_lines l
    where l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 107 and charge_type = 'transport'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  0::numeric, 'transport entry balances (ΣDr = ΣCr)');

-- Discount contra: 53.50 @7% → net 50 / VAT 3.50: Dr 2100 53.50 / Cr 1400
-- 37.50 + Cr 1500 12.50 + Cr 1300 3.50. Posted via the poster directly.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110260"}';
select lives_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000001'),
       'discount', 53.50, 7, null) $$,
  'PM adds discount 53.50 @7% to the mixed PO');
reset role;
select public.post_purchase_order_charge_to_gl(
  (select id from public.purchase_order_charges
    where amount = 53.50 and charge_type = 'discount'
      and purchase_order_id = (select purchase_order_id from public.purchase_requests
                                where id = 'fa000260-0000-4000-8000-000000000001')));

select ok(
  (select l.debit = 53.50 from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '2100'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 53.50 and charge_type = 'discount'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  'discount contra: Dr 2100 AP = 53.50 (the gross comes OFF what we owe)');
select ok(
  (select
      sum(case when a.code = '1400' then l.credit else 0 end) = 37.50
      and sum(case when a.code = '1500' then l.credit else 0 end) = 12.50
      and sum(case when a.code = '1300' then l.credit else 0 end) = 3.50
     from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 53.50 and charge_type = 'discount'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  'discount contra: Cr 1400 37.50 + Cr 1500 12.50 + Cr 1300 3.50 (same allocation)');
select is(
  (select sum(l.debit) - sum(l.credit) from public.journal_lines l
    where l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 53.50 and charge_type = 'discount'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000001'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  0::numeric, 'discount entry balances (ΣDr = ΣCr)');

-- ============================================================================
-- E. Rounding remainder: 3 equal WP lines (100 each, 3 distinct WPs) +
--    transport 100 @0% → naive thirds are 33.33+33.33+33.33 = 99.99; the
--    remainder satang goes to the largest share, so the legs sum EXACTLY.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110260"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000260-0000-4000-8000-000000000001'::uuid, date '2026-07-22',
       '[{"request_id":"fa000260-0000-4000-8000-000000000003","amount":100},
         {"request_id":"fa000260-0000-4000-8000-000000000004","amount":100},
         {"request_id":"fa000260-0000-4000-8000-000000000005","amount":100}]'::jsonb) $$,
  'PM creates the 3-equal-line rounding PO');
select lives_ok(
  $$ select public.add_purchase_order_charge(
       (select purchase_order_id from public.purchase_requests
         where id = 'fa000260-0000-4000-8000-000000000003'),
       'transport', 100, 0, null) $$,
  'PM adds transport 100 @0% to the rounding PO');
reset role;
select public.post_purchase_order_charge_to_gl(
  (select id from public.purchase_order_charges
    where amount = 100 and charge_type = 'transport'
      and purchase_order_id = (select purchase_order_id from public.purchase_requests
                                where id = 'fa000260-0000-4000-8000-000000000003')));

select is(
  (select sum(l.debit) from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 100 and charge_type = 'transport'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000003'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  100::numeric, 'rounding: the three WIP shares sum EXACTLY to the net (no lost satang)');
select ok(
  (select count(*) filter (where l.debit = 33.34) = 1
      and count(*) filter (where l.debit = 33.33) = 2
     from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'purchase_order_charges'
                           and e.source_id = (select id from public.purchase_order_charges
                                               where amount = 100 and charge_type = 'transport'
                                                 and purchase_order_id = (select purchase_order_id
                                                       from public.purchase_requests
                                                      where id = 'fa000260-0000-4000-8000-000000000003'))
                           and e.source_event = 'po_charge' and e.status = 'posted')),
  'rounding: remainder satang lands on exactly one share (33.34 + 33.33 + 33.33)');

-- ============================================================================
-- F. Void charge: gate, posted → reversed, pending → skipped, rows + audit.
--    (The D-drain posted every then-pending charge job, so the pending-void
--    case uses a FRESH charge added after the drain.)
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440260"}';
select throws_ok(
  $$ select public.void_purchase_order_charge(
       (select id from public.purchase_order_charges
         where amount = 10 and charge_type = 'transport'
           and purchase_order_id = (select purchase_order_id from public.purchase_requests
                                     where id = 'fa000260-0000-4000-8000-000000000007'))) $$,
  '42501', null, 'void refuses plain procurement (manager-only: un-booking money)');

-- PM voids the POSTED mixed-PO transport charge (107 @7) — entry reversed.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110260"}';
select lives_ok(
  $$ select public.void_purchase_order_charge(
       (select id from public.purchase_order_charges
         where amount = 107 and charge_type = 'transport'
           and purchase_order_id = (select purchase_order_id from public.purchase_requests
                                     where id = 'fa000260-0000-4000-8000-000000000001'))) $$,
  'project_manager voids the posted transport charge');
reset role;
select is(
  (select count(*)::int from public.journal_entries r
    where r.reversal_of in
      (select e.id from public.journal_entries e
        where e.source_table = 'purchase_order_charges'
          and e.source_event = 'po_charge'
          and e.status = 'posted'
          and e.reversal_of is null
          and e.id in (select l.entry_id from public.journal_lines l
                        where l.work_package_id = 'ee000260-0000-4000-8000-000000000001'
                           or l.project_id = 'cc000260-0000-4000-8000-000000000001'))),
  1, 'void: the posted charge entry got exactly one reversal entry');
select ok(
  not exists (select 1 from public.purchase_order_charges
               where amount = 107 and charge_type = 'transport'
                 and purchase_order_id = (select purchase_order_id from public.purchase_requests
                                           where id = 'fa000260-0000-4000-8000-000000000001')),
  'void: the posted charge row is deleted');

-- super_admin voids a FRESH still-pending charge — job skipped, row gone.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660260"}';
select public.add_purchase_order_charge(
  (select purchase_order_id from public.purchase_requests
    where id = 'fa000260-0000-4000-8000-000000000007'),
  'other', 30, 0, 'ค่ามัดจำพาเลท');
select lives_ok(
  $$ select public.void_purchase_order_charge(
       (select id from public.purchase_order_charges
         where amount = 30 and charge_type = 'other'
           and purchase_order_id = (select purchase_order_id from public.purchase_requests
                                     where id = 'fa000260-0000-4000-8000-000000000007'))) $$,
  'super_admin voids a still-pending charge');
reset role;
select is(
  (select o.status::text from public.gl_posting_outbox o
    where o.source_table = 'purchase_order_charges'
      and o.source_event = 'po_charge'
      -- Scope the audit lookup to the fixture PO (po_number) — a bare
      -- charge_type+amount could collide with a real prod void (#243 lesson).
      and o.source_id = (select target_id from public.audit_log
                          where action = 'po_charge_void'
                            and payload->>'charge_type' = 'other'
                            and (payload->>'amount')::numeric = 30
                            and payload->>'po_number' = (select po.po_number::text
                                   from public.purchase_orders po
                                  where po.id = (select purchase_order_id
                                          from public.purchase_requests
                                         where id = 'fa000260-0000-4000-8000-000000000007')))),
  'skipped', 'void: the pending job is skipped, never postable');
select ok(
  not exists (select 1 from public.purchase_order_charges
               where amount = 30 and charge_type = 'other'
                 and purchase_order_id = (select purchase_order_id from public.purchase_requests
                                           where id = 'fa000260-0000-4000-8000-000000000007')),
  'void: the pending charge row is deleted too');

-- project_director voids too (the manager tier is PM/super/PD — is_manager()).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550260"}';
select lives_ok(
  $$ select public.void_purchase_order_charge(
       (select id from public.purchase_order_charges
         where amount = 15 and charge_type = 'transport'
           and purchase_order_id = (select purchase_order_id from public.purchase_requests
                                     where id = 'fa000260-0000-4000-8000-000000000007'))) $$,
  'project_director voids a charge');
reset role;

select is(
  (select count(*)::int from public.audit_log
    where action = 'po_charge_void'
      and payload->>'po_number' in
        (select po.po_number::text from public.purchase_orders po
          where po.id in (select purchase_order_id from public.purchase_requests
                           where id in ('fa000260-0000-4000-8000-000000000001',
                                        'fa000260-0000-4000-8000-000000000007')))
      and payload->>'charge_type' is not null
      and (payload->>'amount') is not null),
  3, 'three po_charge_void audit rows, each with {po_number, charge_type, amount}');
select throws_ok(
  $$ select public.void_purchase_order_charge('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0001', null, 'void refuses an unknown charge id');

select * from finish();
rollback;
