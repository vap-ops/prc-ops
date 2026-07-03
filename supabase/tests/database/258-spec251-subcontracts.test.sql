begin;
select plan(31);

-- ============================================================================
-- Spec 251 U1 — subcontracts (agreed vs paid, ผู้รับเหมาช่วง): 3 tables
-- (subcontracts / subcontract_wps / subcontract_payments), 2 enums, RLS zero
-- grant (money domain, house convention), 5 RPCs, and the new
-- post_subcontract_payment_to_gl poster — direct one-step Dr WIP-construction
-- (1400, project_id + contractor_id, work_package_id NULL) / Cr Bank (1110),
-- no accrual step (operator decision 2026-07-03: subcontracts have no
-- progress-% certification signal to trigger an accrual like dc_payments'
-- 2110 clearing). Re-drain guard mirrors 256-dc-payment-redrain-guard.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111251', 'pm@sc251.local', '{}'::jsonb),
  ('a2222222-2222-2222-2222-222222222251', 'sa@sc251.local', '{}'::jsonb);
update public.users set role='project_manager' where id='a1111111-1111-1111-1111-111111111251';
update public.users set role='site_admin'      where id='a2222222-2222-2222-2222-222222222251';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000251', 'SC251A', 'โครงการ 251A'),
  ('ab000000-0000-0000-0000-000000000251', 'SC251B', 'โครงการ 251B');

insert into public.contractors (id, name, created_by) values
  ('c1000000-0000-0000-0000-000000000251', 'ผู้รับเหมาช่วง 251', 'a1111111-1111-1111-1111-111111111251');

insert into public.work_packages (id, project_id, code, name) values
  ('ba000000-0000-0000-0000-000000000251', 'aa000000-0000-0000-0000-000000000251', 'WP-SC251-1', 'WP1 251A'),
  ('bb000000-0000-0000-0000-000000000251', 'aa000000-0000-0000-0000-000000000251', 'WP-SC251-2', 'WP2 251A'),
  ('bc000000-0000-0000-0000-000000000251', 'ab000000-0000-0000-0000-000000000251', 'WP-SC251-3', 'WP1 251B (other project)');

create temporary table _fix (k text primary key, v uuid) on commit drop;
grant select on _fix to authenticated;
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- 1–3. Zero authenticated grant on all three tables (money domain posture).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select throws_ok($$ select count(*) from public.subcontracts $$, '42501', null,
  'authenticated has no direct grant on subcontracts');
select throws_ok($$ select count(*) from public.subcontract_wps $$, '42501', null,
  'authenticated has no direct grant on subcontract_wps');
select throws_ok($$ select count(*) from public.subcontract_payments $$, '42501', null,
  'authenticated has no direct grant on subcontract_payments');

-- 4. create_subcontract — PM creates a deal.
select lives_ok(
  $$ select public.create_subcontract(
       'c1000000-0000-0000-0000-000000000251', 'aa000000-0000-0000-0000-000000000251',
       'งานโครงสร้าง', 500000, date '2026-07-01', null, null) $$,
  'PM creates a subcontract deal');
reset role;
insert into _fix values ('sc1',
  (select id from public.subcontracts where title = 'งานโครงสร้าง'));

-- 5. site_admin refused (money write).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222251"}';
select throws_ok(
  $$ select public.create_subcontract(
       'c1000000-0000-0000-0000-000000000251', 'aa000000-0000-0000-0000-000000000251',
       'x', 1000, null, null, null) $$,
  '42501', null, 'site_admin cannot create a subcontract (42501)');
reset role;

-- 6. unbound caller fails closed.
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.create_subcontract(
       'c1000000-0000-0000-0000-000000000251', 'aa000000-0000-0000-0000-000000000251',
       'x', 1000, null, null, null) $$,
  '42501', null, 'unbound caller fails closed (42501)');
reset role;

-- 7. update_subcontract — status flip, coalesce semantics (title preserved).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select lives_ok(
  $$ select public.update_subcontract(
       (select v from _fix where k = 'sc1'), null, null, null, 'completed', null, null) $$,
  'PM updates subcontract status');
reset role;
select is(
  (select status::text from public.subcontracts where id = (select v from _fix where k = 'sc1')),
  'completed', 'status flipped to completed');
select is(
  (select title from public.subcontracts where id = (select v from _fix where k = 'sc1')),
  'งานโครงสร้าง', 'title preserved (coalesce semantics — omitted field untouched)');

-- 8–9. set_subcontract_wps — attach 2 WPs from the deal's own project.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select lives_ok(
  $$ select public.set_subcontract_wps(
       (select v from _fix where k = 'sc1'),
       array['ba000000-0000-0000-0000-000000000251', 'bb000000-0000-0000-0000-000000000251']::uuid[]) $$,
  'PM attaches 2 WPs to the deal');
reset role;
select is(
  (select count(*)::int from public.subcontract_wps where subcontract_id = (select v from _fix where k = 'sc1')),
  2, 'deal covers exactly 2 WPs');

-- 10. Cross-project WP rejected by the trigger.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select throws_ok(
  $$ select public.set_subcontract_wps(
       (select v from _fix where k = 'sc1'),
       array['ba000000-0000-0000-0000-000000000251', 'bc000000-0000-0000-0000-000000000251']::uuid[]) $$,
  null, null, 'a WP from another project is rejected');
reset role;

-- 11. Reconcile: calling set_subcontract_wps again with a DIFFERENT set drops
-- the old membership and adds the new one (add+remove, not additive).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select lives_ok(
  $$ select public.set_subcontract_wps(
       (select v from _fix where k = 'sc1'),
       array['bb000000-0000-0000-0000-000000000251']::uuid[]) $$,
  'PM reconciles the WP set down to 1');
reset role;
select is(
  (select array_agg(work_package_id order by work_package_id)
     from public.subcontract_wps where subcontract_id = (select v from _fix where k = 'sc1')),
  array['bb000000-0000-0000-0000-000000000251']::uuid[],
  'reconcile removed w1 and kept only w2 (no additive leftover)');

-- 12. A WP MAY appear in a second deal (no exclusivity).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select lives_ok(
  $$ select public.set_subcontract_wps(
       public.create_subcontract('c1000000-0000-0000-0000-000000000251',
         'aa000000-0000-0000-0000-000000000251', 'งานที่สอง', 100000, null, null, null),
       array['bb000000-0000-0000-0000-000000000251']::uuid[]) $$,
  'the same WP may appear in a second deal (split trades)');
reset role;

-- 13. RESTRICT: a WP referenced by a subcontract cannot be deleted.
select throws_ok(
  $$ delete from public.work_packages where id = 'bb000000-0000-0000-0000-000000000251' $$,
  '23503', null, 'a WP covered by an active deal cannot be deleted (RESTRICT)');

-- 14. record_subcontract_payment — an advance payment. Enqueues its GL job.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select lives_ok(
  $$ select public.record_subcontract_payment(
       (select v from _fix where k = 'sc1'), 'advance', 100000, date '2026-07-03',
       'bank_transfer', null) $$,
  'PM records an advance payment');
reset role;
insert into _fix values ('p1',
  (select id from public.subcontract_payments where subcontract_id = (select v from _fix where k = 'sc1')));
select ok(
  exists (select 1 from public.gl_posting_outbox
    where source_table = 'subcontract_payments' and source_event = 'subcontract_payment'
      and source_id = (select v from _fix where k = 'p1')),
  'the payment enqueued a GL posting job');

-- 15. Append-only: even a superuser UPDATE is blocked.
select throws_ok(
  $$ update public.subcontract_payments set amount = 1 where id = (select v from _fix where k = 'p1') $$,
  'P0001', null, 'subcontract_payments rows are append-only (update blocked)');

-- 16–18. FIRST DRAIN: direct one-step post — Dr 1400 (project_id + contractor_id
-- set, work_package_id NULL) / Cr 1110, no accrual/clearing account.
select ok((select public.drain_gl_posting(200) >= 1), 'first drain posts the payment');
select ok(
  exists (
    select 1 from public.journal_entries e
      join public.journal_lines dr on dr.entry_id = e.id
      join public.gl_accounts da on da.id = dr.account_id and da.code = '1400' and dr.debit = 100000
      join public.journal_lines cr on cr.entry_id = e.id
      join public.gl_accounts ca on ca.id = cr.account_id and ca.code = '1110' and cr.credit = 100000
     where e.source_table = 'subcontract_payments' and e.status = 'posted'
       and e.source_id = (select v from _fix where k = 'p1')
       and dr.project_id = 'aa000000-0000-0000-0000-000000000251'
       and dr.contractor_id = 'c1000000-0000-0000-0000-000000000251'),
  'posted Dr WIP-construction 1400 (project+contractor dimensioned) / Cr Bank 1110');
select is(
  (select work_package_id from public.journal_lines l
     join public.journal_entries e on e.id = l.entry_id
     join public.gl_accounts a on a.id = l.account_id and a.code = '1400'
    where e.source_table = 'subcontract_payments' and e.source_id = (select v from _fix where k = 'p1')),
  null, 'the WIP line carries NO work_package_id (multi-WP deal, no clean split)');

-- 19–20. supersede_subcontract_payment — a correction. SECOND DRAIN reverses the
-- old entry and posts the new one.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select lives_ok(
  $$ select public.supersede_subcontract_payment(
       (select v from _fix where k = 'p1'), 'advance', 120000, date '2026-07-03',
       'bank_transfer', 'wrong amount') $$,
  'PM supersedes the payment with a corrected amount');
reset role;
insert into _fix values ('p2',
  (select id from public.subcontract_payments where superseded_by = (select v from _fix where k = 'p1')));
select ok((select public.drain_gl_posting(200) >= 1), 'second drain processes the supersede');
select is(
  (select count(*)::int from public.journal_entries e
    where e.source_table = 'subcontract_payments'
      and e.source_id = (select v from _fix where k = 'p1')
      and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  0, 'the original payment''s entry is reversed once the correction posts');

-- 21–22. RE-DRAIN ATTACK: reset the superseded row's job to pending and drain
-- again — the guard must NOT re-post it; the successor stays untouched.
update public.gl_posting_outbox set status = 'pending'
 where source_table = 'subcontract_payments' and source_id = (select v from _fix where k = 'p1');
select ok((select public.drain_gl_posting(200) >= 0), 'third drain (re-drain attack) runs');
select is(
  (select count(*)::int from public.journal_entries e
    where e.source_table = 'subcontract_payments'
      and e.source_id = (select v from _fix where k = 'p1')
      and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  0, 're-drain guard: a superseded payment never re-posts');
select is(
  (select count(*)::int from public.journal_entries e
    where e.source_table = 'subcontract_payments'
      and e.source_id = (select v from _fix where k = 'p2')
      and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  1, 'the successor''s entry is unaffected by the re-drain attack');

-- 23. Cannot supersede an already-superseded row.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111251"}';
select throws_ok(
  $$ select public.supersede_subcontract_payment(
       (select v from _fix where k = 'p1'), 'advance', 1, date '2026-07-03', 'cash', null) $$,
  'P0001', null, 'an already-superseded payment cannot be superseded again');
reset role;

-- 24. Audit trail for the create + payment writes.
select ok(
  exists (select 1 from public.audit_log
    where action = 'subcontract_create' and target_table = 'subcontracts'),
  'subcontract_create audit row exists');
select ok(
  exists (select 1 from public.audit_log
    where action = 'subcontract_payment_record' and target_table = 'subcontract_payments'),
  'subcontract_payment_record audit row exists');

select * from finish();
rollback;
