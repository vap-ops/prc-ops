begin;
select plan(57);

-- ============================================================================
-- Spec 275 U3 — rental settlement (rental_settlements): the vendor's actual
-- invoice against a rental agreement. THIN GL (operator decision 2026-07-07):
-- the rent is already posted at batch creation and each fee at charge time, so
-- the settlement poster books ONLY the not-yet-booked legs — overtime (Dr 1400 /
-- Cr 2100 supplier) + the deposit RELEASE (refund Dr 1110 / Cr 1320; forfeit
-- Dr 1400 / Cr 1320). It NEVER re-posts base/fees (double-count) and does NOT
-- post WHT (the issued wht_certificate does, Dr 2100 / Cr 2210). A separate
-- poster books the deposit PAID leg (Dr 1320 / Cr 1110) off deposit_paid_date,
-- routed under the synthetic source_table 'rental_deposits'.
--
-- Pins: enum + table shape + ZERO-GRANT posture; append-only guard; the deposit
-- and settlement posters + drain arms; the gate (pm/super/procurement admitted;
-- site_admin/visitor/project_director refused); the deposit ceiling; the thin
-- journal (proves base/fees are NOT re-posted); WHT at 5% of base; supersede
-- reverse-and-repost; account 1320 seeded.
--
-- Data-independence (#243): every lookup is scoped to the fixture agreement
-- (aa…375) + distinct invoice numbers, never a bare amount a prod row could share.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110375', 'pm@rs.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220375', 'sa@rs.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330375', 'vi@rs.local',    '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440375', 'proc@rs.local',  '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550375', 'pd@rs.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660375', 'super@rs.local', '{}'::jsonb);
update public.users set role = 'project_manager'  where id = '11111111-1111-1111-1111-111111110375';
update public.users set role = 'site_admin'       where id = '22222222-2222-2222-2222-222222220375';
-- 33… stays visitor (the enum default)
update public.users set role = 'procurement'      where id = '44444444-4444-4444-4444-444444440375';
update public.users set role = 'project_director' where id = '55555555-5555-5555-5555-555555550375';
update public.users set role = 'super_admin'      where id = '66666666-6666-6666-6666-666666660375';

-- Supplier A: 13-digit tax id + VAT-registered (WHT + VAT apply).
insert into public.suppliers (id, name, tax_id, is_vat_registered, created_by) values
  ('bb000375-0000-4000-8000-000000000001', 'บ.เครนทดสอบ Settlement',
   '1234567890123', true, '11111111-1111-1111-1111-111111110375');
-- Supplier B: no tax id (WHT must be skipped).
insert into public.suppliers (id, name, created_by) values
  ('bb000375-0000-4000-8000-000000000002', 'ร้านเช่าไม่มีเลขภาษี',
   '11111111-1111-1111-1111-111111110375');

-- Agreement A: deposit 10000 PAID on 2026-07-01 (fires the deposit-paid leg),
-- rent 90000. Agreement B: no deposit, supplier B (WHT-skip case).
insert into public.equipment_rental_batches
    (id, supplier_id, monthly_rate, starts_on, deposit_amount, deposit_paid_date, created_by) values
  ('aa000375-0000-4000-8000-000000000001',
   'bb000375-0000-4000-8000-000000000001', 90000, date '2026-07-01', 10000, date '2026-07-01',
   '11111111-1111-1111-1111-111111110375'),
  ('aa000375-0000-4000-8000-000000000002',
   'bb000375-0000-4000-8000-000000000002', 50000, date '2026-07-01', 0, null,
   '11111111-1111-1111-1111-111111110375');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Structure: enum, table shape, ZERO-GRANT, RPCs/posters/triggers/drain, 1320.
-- ============================================================================
select ok((select string_agg(e.enumlabel, ',') from pg_type t
     join pg_enum e on e.enumtypid = t.oid where t.typname = 'audit_action')
     like '%rental_settlement_record%', 'audit_action gained rental_settlement_record');
select ok((select string_agg(e.enumlabel, ',') from pg_type t
     join pg_enum e on e.enumtypid = t.oid where t.typname = 'audit_action')
     like '%rental_settlement_supersede%', 'audit_action gained rental_settlement_supersede');
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_settlements'),
  'id,agreement_id,invoice_no,invoice_date,base_amount,overtime_amount,fees_amount,net_amount,'
  || 'vat_amount,wht_amount,deposit_refunded,deposit_forfeited,method,note,created_by,created_at,'
  || 'superseded_by,correction_reason',
  'rental_settlements has exactly the spec columns');
select ok((select relrowsecurity from pg_class where oid = 'public.rental_settlements'::regclass),
  'RLS enabled on rental_settlements');
select is((select count(*)::int from pg_policy where polrelid = 'public.rental_settlements'::regclass),
  0, 'zero-grant money table: NO policies at all');
select is(has_table_privilege('authenticated', 'public.rental_settlements', 'INSERT'),
  false, 'authenticated has no INSERT grant');
select is(has_table_privilege('authenticated', 'public.rental_settlements', 'SELECT'),
  false, 'authenticated has no SELECT grant (zero-grant)');
select is(has_table_privilege('authenticated', 'public.rental_settlements', 'UPDATE'),
  false, 'authenticated has no UPDATE grant');
select is(has_table_privilege('anon', 'public.rental_settlements', 'SELECT'),
  false, 'anon has no SELECT grant');
select ok(to_regprocedure('public.record_rental_settlement(uuid, text, date, numeric, numeric, '
  || 'numeric, numeric, numeric, numeric, receipt_method, text)') is not null,
  'record_rental_settlement exists with the spec signature');
select ok(to_regprocedure('public.supersede_rental_settlement(uuid, text, date, numeric, numeric, '
  || 'numeric, numeric, numeric, numeric, receipt_method, text, text)') is not null,
  'supersede_rental_settlement exists');
select ok(to_regprocedure('public.post_rental_settlement_to_gl(uuid)') is not null,
  'post_rental_settlement_to_gl exists');
select ok(to_regprocedure('public.post_rental_deposit_to_gl(uuid)') is not null,
  'post_rental_deposit_to_gl exists');
select ok(has_function_privilege('authenticated', 'public.record_rental_settlement(uuid, text, date, '
  || 'numeric, numeric, numeric, numeric, numeric, numeric, receipt_method, text)', 'EXECUTE'),
  'authenticated may execute record_rental_settlement');
select is(has_function_privilege('authenticated', 'public.post_rental_settlement_to_gl(uuid)', 'EXECUTE'),
  false, 'the settlement poster is internal — authenticated cannot execute it');
select is(has_function_privilege('authenticated', 'public.post_rental_deposit_to_gl(uuid)', 'EXECUTE'),
  false, 'the deposit poster is internal — authenticated cannot execute it');
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.rental_settlements'::regclass
     and not tgisinternal and tgname in ('rental_settlements_no_update_delete', 'rental_settlements_no_truncate')),
  2, 'append-only guard triggers installed on rental_settlements');
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.rental_settlements'::regclass
     and not tgisinternal and tgname = 'rental_settlements_enqueue_gl_posting'),
  1, 'AFTER INSERT enqueue trigger installed on rental_settlements');
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.equipment_rental_batches'::regclass
     and not tgisinternal and tgname in
       ('equipment_rental_batches_enqueue_deposit_gl_ins', 'equipment_rental_batches_enqueue_deposit_gl_upd')),
  2, 'deposit enqueue triggers (ins + upd) installed on equipment_rental_batches');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'drain_gl_posting')
    like all (array['%rental_settlements%', '%rental_deposits%']),
  'drain_gl_posting routes rental_settlements + rental_deposits');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'drain_gl_posting')
    like all (array['%purchase_requests%', '%wage_payments%', '%wp_labor_costs%',
      '%equipment_rental_batches%', '%client_billings%', '%retention_receivables%',
      '%wht_certificates%', '%client_receipts%', '%stock_receipts%', '%stock_issues%',
      '%stock_returns%', '%stock_counts%', '%stock_reversals%', '%subcontract_payments%',
      '%purchase_order_charges%', '%rental_charges%']),
  'no pre-existing drain arm was dropped by the re-source');
select ok((select is_postable from public.gl_accounts where code = '1320'),
  'account 1320 (rental deposit prepaid) seeded as a postable leaf');
select is((select account_type::text from public.gl_accounts where code = '1320'),
  'asset', '1320 is an asset account');

-- ============================================================================
-- B. Deposit PAID leg. Agreement A carries deposit 10000 paid 2026-07-01 → the
--    insert trigger enqueued 'rental_deposits'; drain posts Dr 1320 / Cr 1110.
-- ============================================================================
reset role;
select ok((select public.drain_gl_posting() >= 1), 'drain processed the deposit-paid job');
select is(
  (select l.debit from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
    where a.code = '1320'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_deposits' and e.source_event = 'rental_deposit'
                           and e.source_id = 'aa000375-0000-4000-8000-000000000001' and e.status = 'posted')),
  10000::numeric, 'deposit paid: Dr 1320 = 10000');
select is(
  (select l.credit from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
    where a.code = '1110'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_deposits' and e.source_event = 'rental_deposit'
                           and e.source_id = 'aa000375-0000-4000-8000-000000000001' and e.status = 'posted')),
  10000::numeric, 'deposit paid: Cr 1110 = 10000');

-- ============================================================================
-- C. Record gate: pm/super/procurement admitted; site_admin/visitor/PD refused.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220375"}';  -- site_admin
select throws_ok($$ select public.record_rental_settlement(
  'aa000375-0000-4000-8000-000000000001'::uuid, 'INV-SA', date '2026-08-01', 0,0,0,0,0,0, 'bank_transfer', null) $$,
  '42501', null, 'record refuses site_admin');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330375"}';  -- visitor
select throws_ok($$ select public.record_rental_settlement(
  'aa000375-0000-4000-8000-000000000001'::uuid, 'INV-VI', date '2026-08-01', 0,0,0,0,0,0, 'bank_transfer', null) $$,
  '42501', null, 'record refuses visitor');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550375"}';  -- project_director
select throws_ok($$ select public.record_rental_settlement(
  'aa000375-0000-4000-8000-000000000001'::uuid, 'INV-PD', date '2026-08-01', 0,0,0,0,0,0, 'bank_transfer', null) $$,
  '42501', null, 'record refuses project_director (settlement gate is pm/super/procurement)');
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660375"}';  -- super_admin
select lives_ok($$ select public.record_rental_settlement(
  'aa000375-0000-4000-8000-000000000001'::uuid, 'INV-SUPER', date '2026-08-01', 100,0,0,0,0,0, 'bank_transfer', null) $$,
  'super_admin may record a settlement');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440375"}';  -- procurement
select lives_ok($$ select public.record_rental_settlement(
  'aa000375-0000-4000-8000-000000000001'::uuid, 'INV-PROC', date '2026-08-01', 100,0,0,0,0,0, 'bank_transfer', null) $$,
  'procurement may record a settlement');

-- D. Validation: unknown agreement + deposit ceiling.
select throws_ok($$ select public.record_rental_settlement(
  '00000000-0000-0000-0000-000000000000'::uuid, 'INV-X', date '2026-08-01', 100,0,0,0,0,0, 'bank_transfer', null) $$,
  'P0001', null, 'record refuses an unknown agreement id');
select throws_ok($$ select public.record_rental_settlement(
  'aa000375-0000-4000-8000-000000000001'::uuid, 'INV-CAP', date '2026-08-01', 0,0,0,0, 9000, 2000, 'bank_transfer', null) $$,
  'P0001', null, 'record refuses deposit refunded+forfeited (11000) over the agreement deposit (10000)');
reset role;

-- ============================================================================
-- E. Thin settlement journal. PM records the real settlement on agreement A:
--    base 90000, overtime 5000, fees 1000 (net 96000), VAT 6720, deposit
--    refunded 4000 + forfeited 1000. Poster books ONLY overtime + deposit
--    release — NOT base/fees. Expect: Dr 1400 = 6000 (overtime 5000 + forfeit
--    1000), Cr 2100 = 5000 (overtime, supplier), Dr 1110 = 4000 (refund),
--    Cr 1320 = 5000 (refund 4000 + forfeit 1000). Entry balances.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110375"}';  -- PM
select lives_ok($$ select public.record_rental_settlement(
  'aa000375-0000-4000-8000-000000000001'::uuid, 'INV-MAIN', date '2026-08-05',
  90000, 5000, 1000, 6720, 4000, 1000, 'bank_transfer', 'main invoice') $$,
  'PM records the main settlement');
reset role;
-- Resolve the settlement id as owner (zero-grant table).
do $$ begin
  perform set_config('t375.main',
    (select id::text from public.rental_settlements
      where agreement_id = 'aa000375-0000-4000-8000-000000000001' and invoice_no = 'INV-MAIN'
        and superseded_by is null), false);
end $$;
select is(
  (select net_amount from public.rental_settlements where id = current_setting('t375.main')::uuid),
  96000::numeric, 'net_amount = base+overtime+fees = 96000 (deposit NOT netted in)');
select ok((select public.drain_gl_posting() >= 1), 'drain processed the settlement job');
-- The whole 1400 debit on the settlement entry = overtime 5000 + forfeit 1000 = 6000.
-- If base (90000) had been re-posted this would be 96000 — this is the anti-double-count pin.
select is(
  (select coalesce(sum(l.debit), 0) from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_settlements' and e.source_event = 'rental_settlement'
                           and e.source_id = current_setting('t375.main')::uuid and e.status = 'posted')),
  6000::numeric, 'settlement Dr 1400 = 6000 (overtime+forfeit only — base/fees NOT re-posted)');
select is(
  (select l.credit from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
    where a.code = '2100'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_settlements' and e.source_event = 'rental_settlement'
                           and e.source_id = current_setting('t375.main')::uuid and e.status = 'posted')),
  5000::numeric, 'settlement Cr 2100 = 5000 (overtime only, supplier AP)');
select is(
  (select l.debit from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
    where a.code = '1110'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_settlements' and e.source_event = 'rental_settlement'
                           and e.source_id = current_setting('t375.main')::uuid and e.status = 'posted')),
  4000::numeric, 'settlement Dr 1110 = 4000 (deposit refund)');
select is(
  (select coalesce(sum(l.credit), 0) from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
    where a.code = '1320'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_settlements' and e.source_event = 'rental_settlement'
                           and e.source_id = current_setting('t375.main')::uuid and e.status = 'posted')),
  5000::numeric, 'settlement Cr 1320 = 5000 (deposit refund 4000 + forfeit 1000 release the asset)');
select is(
  (select sum(l.debit) - sum(l.credit) from public.journal_lines l
    where l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_settlements' and e.source_event = 'rental_settlement'
                           and e.source_id = current_setting('t375.main')::uuid and e.status = 'posted')),
  0::numeric, 'settlement entry balances (ΣDr = ΣCr)');

-- WHT cert issued at 5% of base (90000 → 4500), tagged to this settlement, and
-- its own GL reclassifies Dr 2100 / Cr 2210.
select is(
  (select wht_amount from public.wht_certificates
    where pay_source_table = 'rental_settlements' and pay_source_id = current_setting('t375.main')::uuid),
  4500::numeric, 'a wht_certificate is issued at 5% of base_amount (90000 → 4500)');
select is(
  (select income_type from public.wht_certificates
    where pay_source_table = 'rental_settlements' and pay_source_id = current_setting('t375.main')::uuid),
  'rent', 'the WHT certificate income_type is rent');
select is(
  (select l.credit from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
    where a.code = '2210'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'wht_certificates' and e.source_event = 'wht_certificate'
                           and e.source_id = (select id from public.wht_certificates
                                               where pay_source_table = 'rental_settlements'
                                                 and pay_source_id = current_setting('t375.main')::uuid)
                           and e.status = 'posted')),
  4500::numeric, 'the WHT cert reclassifies Cr 2210 = 4500 (Dr 2100)');

-- ============================================================================
-- F. WHT skipped when the supplier has no valid 13-digit tax id (agreement B).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110375"}';
select lives_ok($$ select public.record_rental_settlement(
  'aa000375-0000-4000-8000-000000000002'::uuid, 'INV-NOTAX', date '2026-08-06', 50000, 0, 0, 0, 0, 0, 'cash', null) $$,
  'PM records a settlement on the no-tax-id agreement');
reset role;
do $$ begin
  perform set_config('t375.notax',
    (select id::text from public.rental_settlements
      where agreement_id = 'aa000375-0000-4000-8000-000000000002' and invoice_no = 'INV-NOTAX'), false);
end $$;
select is(
  (select wht_amount from public.rental_settlements where id = current_setting('t375.notax')::uuid),
  0::numeric, 'no WHT recorded when the supplier lacks a 13-digit tax id');
select is(
  (select count(*)::int from public.wht_certificates
    where pay_source_table = 'rental_settlements' and pay_source_id = current_setting('t375.notax')::uuid),
  0, 'no WHT certificate issued for the no-tax-id supplier');

-- ============================================================================
-- G. Supersede: correction_reason required; reverse-and-repost; a superseded row
--    cannot be superseded again; site_admin refused.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220375"}';  -- site_admin
select throws_ok($$ select public.supersede_rental_settlement(
  current_setting('t375.main')::uuid, 'INV-MAIN-R', date '2026-08-05', 90000, 2000, 1000, 6510, 4000, 1000,
  'bank_transfer', 'fix overtime', null) $$,
  '42501', null, 'supersede refuses site_admin');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110375"}';  -- PM
select throws_ok($$ select public.supersede_rental_settlement(
  current_setting('t375.main')::uuid, 'INV-MAIN-R', date '2026-08-05', 90000, 2000, 1000, 6510, 4000, 1000,
  'bank_transfer', null, null) $$,
  'P0001', null, 'supersede requires a correction_reason');
select lives_ok($$ select public.supersede_rental_settlement(
  current_setting('t375.main')::uuid, 'INV-MAIN-R', date '2026-08-05', 90000, 2000, 1000, 6510, 4000, 1000,
  'bank_transfer', 'overtime was 2000 not 5000', null) $$,
  'PM supersedes the settlement with a corrected overtime');
select throws_ok($$ select public.supersede_rental_settlement(
  current_setting('t375.main')::uuid, 'INV-MAIN-R2', date '2026-08-05', 90000, 0, 0, 0, 0, 0,
  'bank_transfer', 'again', null) $$,
  'P0001', null, 'a settlement already superseded cannot be superseded again');
reset role;
select ok((select public.drain_gl_posting() >= 1), 'drain processed the supersede job');
-- The original settlement entry is now reversed (has a reversal_of pointing at it).
select is(
  (select count(*)::int from public.journal_entries r
    where r.reversal_of = (select e.id from public.journal_entries e
                            where e.source_table = 'rental_settlements' and e.source_event = 'rental_settlement'
                              and e.source_id = current_setting('t375.main')::uuid and e.reversal_of is null)),
  1, 'supersede: the original settlement entry got exactly one reversal');
-- The superseding row's own entry: Dr 1400 = overtime 2000 + forfeit 1000 = 3000.
do $$ begin
  -- The superseding row's OWN superseded_by points BACK at INV-MAIN (subcontract
  -- supersede convention), so it is NOT null — identify it by its unique invoice_no.
  perform set_config('t375.mainR',
    (select id::text from public.rental_settlements
      where agreement_id = 'aa000375-0000-4000-8000-000000000001' and invoice_no = 'INV-MAIN-R'), false);
end $$;
select is(
  (select coalesce(sum(l.debit), 0) from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_settlements' and e.source_event = 'rental_settlement'
                           and e.source_id = current_setting('t375.mainR')::uuid and e.status = 'posted')),
  3000::numeric, 'supersede: the new entry Dr 1400 = 3000 (corrected overtime 2000 + forfeit 1000)');
select is(
  (select sum(l.debit) - sum(l.credit) from public.journal_lines l
    where l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_settlements' and e.source_event = 'rental_settlement'
                           and e.source_id = current_setting('t375.mainR')::uuid and e.status = 'posted')),
  0::numeric, 'supersede: the new entry balances');

-- ============================================================================
-- H. Append-only guard blocks direct mutation (even as owner).
-- ============================================================================
select throws_ok(
  $$ update public.rental_settlements set note = 'x' where id = current_setting('t375.mainR')::uuid $$,
  'P0001', null, 'append-only: direct UPDATE is blocked');
select throws_ok(
  $$ delete from public.rental_settlements where id = current_setting('t375.mainR')::uuid $$,
  'P0001', null, 'append-only: direct DELETE is blocked');

select * from finish();
rollback;
