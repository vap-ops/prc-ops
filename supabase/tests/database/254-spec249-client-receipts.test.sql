begin;
select plan(25);

-- ============================================================================
-- Spec 249 U1 — client receipts (เงินรับจากลูกค้า): append-only supersede money
-- table, ADVANCE receipts (no billing link — money before paper), GL posting
-- (Dr 1110 bank / Cr 1200 AR when billing-linked, Cr 2300 customer-advance when
-- not), billing paid auto-flip on coverage, mark_client_billing_invoiced flip.
-- MONEY DOMAIN: zero authenticated grant; ids are stashed into _fix from the
-- superuser context between steps (the test itself may not read money tables
-- as authenticated — that IS the posture under test).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111249', 'pm@sp249.local', '{}'::jsonb),
  ('a2222222-2222-2222-2222-222222222249', 'sa@sp249.local', '{}'::jsonb);
update public.users set role='project_manager' where id='a1111111-1111-1111-1111-111111111249';
update public.users set role='site_admin'      where id='a2222222-2222-2222-2222-222222222249';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000249', 'SP249A', 'โครงการ 249A'),
  ('ab000000-0000-0000-0000-000000000249', 'SP249B', 'โครงการ 249B');

create temporary table _fix (k text primary key, v uuid) on commit drop;
grant select on _fix to authenticated;

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- 1. The customer-advance liability account exists.
select is(
  (select count(*)::int from public.gl_accounts
    where code = '2300' and account_type = 'liability'),
  1, 'gl account 2300 เงินรับล่วงหน้าจากลูกค้า exists as a liability');

-- 2. Zero authenticated grant.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111249"}';
select throws_ok($$ select count(*) from public.client_receipts $$, '42501', null,
  'authenticated has no direct grant on client_receipts');

-- 3. Fixture billing: gross 100000 @ ret 5 / vat 7 / wht 3 → net_receivable 99000.
select lives_ok(
  $$ select public.certify_client_billing(
       public.create_client_billing('aa000000-0000-0000-0000-000000000249', 100000)) $$,
  'fixture billing created + certified (net 99000)');
reset role;
insert into _fix values ('b1',
  (select id from public.client_billings where project_id = 'aa000000-0000-0000-0000-000000000249'));

-- 4–6. Partial receipt: records, enqueues GL, does NOT flip paid.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111249"}';
select lives_ok(
  $$ select public.record_client_receipt(
       'aa000000-0000-0000-0000-000000000249', 50000, '2026-07-03', 'bank_transfer',
       (select v from _fix where k = 'b1'), null) $$,
  'PM records a partial receipt against the billing');
reset role;
select is(
  (select status::text from public.client_billings where id = (select v from _fix where k = 'b1')),
  'certified', 'partial coverage does not flip the billing to paid');
select ok(
  exists (select 1 from public.gl_posting_outbox
    where source_table = 'client_receipts' and source_event = 'client_receipt'),
  'receipt enqueued a GL posting job');

-- 7. Advance receipt (no billing) records fine.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111249"}';
select lives_ok(
  $$ select public.record_client_receipt(
       'aa000000-0000-0000-0000-000000000249', 30000, '2026-07-03', 'cash', null, null) $$,
  'an ADVANCE receipt (no billing link) records fine');

-- 8. Cross-project billing link rejected.
select throws_ok(
  $$ select public.record_client_receipt(
       'ab000000-0000-0000-0000-000000000249', 1000, '2026-07-03', 'cash',
       (select v from _fix where k = 'b1'), null) $$,
  '22023', null, 'a receipt cannot link a billing from another project (22023)');

-- 9–10. Covering receipt flips the billing to paid.
select lives_ok(
  $$ select public.record_client_receipt(
       'aa000000-0000-0000-0000-000000000249', 49000, '2026-07-03', 'bank_transfer',
       (select v from _fix where k = 'b1'), null) $$,
  'second receipt tops coverage up to net_receivable');
reset role;
select is(
  (select status::text from public.client_billings where id = (select v from _fix where k = 'b1')),
  'paid', 'full coverage auto-flips the billing to paid');

insert into _fix values
  ('r49', (select id from public.client_receipts where amount = 49000)),
  ('r30', (select id from public.client_receipts where amount = 30000));

-- 11. Append-only: even a superuser UPDATE is blocked by the guard trigger.
select throws_ok(
  $$ update public.client_receipts set amount = 1
      where id = (select v from _fix where k = 'r49') $$,
  'P0001', null, 'client_receipts rows are append-only (update blocked)');

-- 12–13. VOID via supersede (all-null payload): coverage drops, paid downgrades
-- to invoiced (bill was placed; money is short again).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111249"}';
select lives_ok(
  $$ select public.supersede_client_receipt(
       (select v from _fix where k = 'r49'), null, null, null, null, null) $$,
  'voiding a receipt via supersede (null payload) works');
reset role;
select is(
  (select status::text from public.client_billings where id = (select v from _fix where k = 'b1')),
  'invoiced', 'losing coverage downgrades paid → invoiced');

-- 14–15. RE-ALLOCATE the advance onto the billing via supersede: covered again.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111249"}';
select lives_ok(
  $$ select public.supersede_client_receipt(
       (select v from _fix where k = 'r30'),
       49000, '2026-07-03', 'bank_transfer',
       (select v from _fix where k = 'b1'), null) $$,
  're-allocating an advance onto the billing via supersede works');
reset role;
select is(
  (select status::text from public.client_billings where id = (select v from _fix where k = 'b1')),
  'paid', 're-allocated coverage flips the billing back to paid');

-- 16. Current-state read: exactly 2 live receipt rows (anti-join) — the 50000
-- original + the re-allocated 49000; the voided and superseded rows excluded.
select is(
  (select count(*)::int from public.client_receipts r
    where r.amount is not null
      and not exists (select 1 from public.client_receipts n where n.superseded_by = r.id)),
  2, 'anti-join current-state sees 2 live receipts (50000 + reallocated 49000)');

-- 17–18. mark_client_billing_invoiced: certified → invoiced; draft refused.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111249"}';
select lives_ok(
  $$ select public.mark_client_billing_invoiced(
       public.certify_client_billing(
         public.create_client_billing('ab000000-0000-0000-0000-000000000249', 20000))) $$,
  'certified billing flips to invoiced (วางบิลแล้ว)');
select throws_ok(
  $$ select public.mark_client_billing_invoiced(
       public.create_client_billing('ab000000-0000-0000-0000-000000000249', 30000)) $$,
  'P0001', null, 'a draft billing cannot be marked invoiced');

-- 19–20. Gates: site_admin refused; unbound caller fails closed.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222249"}';
select throws_ok(
  $$ select public.record_client_receipt(
       'aa000000-0000-0000-0000-000000000249', 1000, '2026-07-03', 'cash', null, null) $$,
  '42501', null, 'site_admin cannot record a receipt (42501)');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.record_client_receipt(
       'aa000000-0000-0000-0000-000000000249', 1000, '2026-07-03', 'cash', null, null) $$,
  '42501', null, 'unbound caller fails closed (42501)');
reset role;

-- 21–24. Drain: posts the receipts — linked → Dr 1110 / Cr 1200; advance → Cr 2300;
-- a supersede reversed the entry of the row it replaced.
select ok((select public.drain_gl_posting(200) >= 1), 'drain processes the queued receipt jobs');
select ok(
  exists (
    select 1 from public.journal_entries e
      join public.journal_lines dr on dr.entry_id = e.id
      join public.gl_accounts da on da.id = dr.account_id and da.code = '1110' and dr.debit > 0
      join public.journal_lines cr on cr.entry_id = e.id
      join public.gl_accounts ca on ca.id = cr.account_id and ca.code = '1200' and cr.credit > 0
     where e.source_table = 'client_receipts' and e.status = 'posted'),
  'a billing-linked receipt posted Dr bank 1110 / Cr AR 1200');
select ok(
  exists (
    select 1 from public.journal_entries e
      join public.journal_lines cr on cr.entry_id = e.id
      join public.gl_accounts ca on ca.id = cr.account_id and ca.code = '2300' and cr.credit > 0
     where e.source_table = 'client_receipts' and e.status = 'posted'),
  'an advance receipt posted Cr customer-advance 2300');
select ok(
  exists (
    select 1 from public.journal_entries r
      join public.journal_entries e on r.reversal_of = e.id
     where e.source_table = 'client_receipts'),
  'superseding a posted receipt reversed its old journal entry');

-- 25. Audit trail for the receipt writes.
select ok(
  exists (select 1 from public.audit_log
    where action = 'client_receipt_record' and target_table = 'client_receipts'),
  'client_receipt_record audit row exists');

select * from finish();
rollback;
