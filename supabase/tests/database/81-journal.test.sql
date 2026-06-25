begin;
select plan(31);

-- ============================================================================
-- Spec 149 U3 / ADR 0057 decision 3 — double-entry journal (journal_entries +
-- journal_lines) + the posting RPCs. Pins: catalog/PK/RLS/zero-policy + the
-- status enum + the account FK; the one-sided line CHECK; append-only triggers
-- (UPDATE/DELETE blocked on both tables); zero authenticated grant; RPC gates
-- (post_journal_entry refuses site_admin + visitor); the balanced happy path with
-- a project dimension; the guards (unbalanced / unknown account / non-postable /
-- single line -> P0001); reversal (mirror entry exists; double-reverse refused);
-- audit; anon denied. gl_accounts seed (codes 1110/4100/1000) is in place from
-- migration 20260738000200.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110591', 'pm@journal.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220591', 'sa@journal.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330591', 'vi@journal.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110591';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220591';
-- third user stays visitor

insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000591', 'TAP-GL-JNL', 'Journal fixture');

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_type('public', 'journal_entry_status', 'journal_entry_status enum exists');
select enum_has_labels('public', 'journal_entry_status',
  array['draft', 'posted', 'reversed'], 'journal_entry_status labels');
select has_table('public', 'journal_entries', 'journal_entries exists');
select col_is_pk('public', 'journal_entries', 'id', 'journal_entries.id is the PK');
select has_table('public', 'journal_lines', 'journal_lines exists');
select col_is_pk('public', 'journal_lines', 'id', 'journal_lines.id is the PK');
select ok((select relrowsecurity from pg_class where oid = 'public.journal_entries'::regclass),
  'RLS enabled on journal_entries');
select ok((select relrowsecurity from pg_class where oid = 'public.journal_lines'::regclass),
  'RLS enabled on journal_lines');
select is((select count(*) from pg_policies where schemaname='public' and tablename='journal_entries'),
  0::bigint, 'journal_entries has no policies (zero grant)');
select is((select count(*) from pg_policies where schemaname='public' and tablename='journal_lines'),
  0::bigint, 'journal_lines has no policies (zero grant)');
select fk_ok('public', 'journal_lines', 'account_id', 'public', 'gl_accounts', 'id');

-- ============================================================================
-- B. One-sided line CHECK (run as owner — RLS bypassed, the CHECK fires).
-- A period + a header are needed to hang a line on.
-- ============================================================================
insert into public.accounting_periods (period_month) values (date '2026-07-01');
insert into public.journal_entries (entry_date, period_id, source_table, source_event, posted_by)
  values (date '2026-07-05',
          (select id from public.accounting_periods where period_month = date '2026-07-01'),
          'tap', 'tap', '11111111-1111-1111-1111-111111110591');

select throws_ok(
  $$ insert into public.journal_lines (entry_id, line_no, account_id, debit, credit)
     values ((select id from public.journal_entries where source_table = 'tap'),
             1, (select id from public.gl_accounts where code = '1110'), 50, 50) $$,
  '23514', null, 'a both-sided journal line is rejected');

-- ============================================================================
-- C. Append-only triggers (UPDATE + DELETE blocked, even for the owner).
-- ============================================================================
insert into public.journal_lines (entry_id, line_no, account_id, debit, credit)
  values ((select id from public.journal_entries where source_table = 'tap'),
          1, (select id from public.gl_accounts where code = '1110'), 100, 0);

select throws_ok(
  $$ update public.journal_entries set memo = 'x' where source_table = 'tap' $$,
  'P0001', null, 'journal_entries is append-only (UPDATE blocked)');
select throws_ok(
  $$ delete from public.journal_lines where entry_id =
       (select id from public.journal_entries where source_table = 'tap') $$,
  'P0001', null, 'journal_lines is append-only (DELETE blocked)');
select throws_ok(
  $$ delete from public.journal_entries where source_table = 'tap' $$,
  'P0001', null, 'journal_entries is append-only (DELETE blocked)');

-- ============================================================================
-- D. Zero grant + RPC gate (authenticated).
-- ============================================================================
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220591"}';

select throws_ok($$ select id from public.journal_entries limit 1 $$,
  '42501', null, 'authenticated cannot read journal_entries (zero grant)');
select throws_ok($$ select id from public.journal_lines limit 1 $$,
  '42501', null, 'authenticated cannot read journal_lines (zero grant)');
select throws_ok(
  $$ select public.post_journal_entry(date '2026-07-05', 'x',
       '[{"account_code":"1110","debit":100},{"account_code":"4100","credit":100}]'::jsonb) $$,
  '42501', null, 'post_journal_entry refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330591"}';
select throws_ok(
  $$ select public.post_journal_entry(date '2026-07-05', 'x',
       '[{"account_code":"1110","debit":100},{"account_code":"4100","credit":100}]'::jsonb) $$,
  '42501', null, 'post_journal_entry refuses visitor');

-- ============================================================================
-- E. Happy path (project_manager) — balanced, with a project dimension.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110591"}';
select lives_ok(
  $$ select public.post_journal_entry(date '2026-07-05', 'TAP-J-1',
       '[{"account_code":"1110","debit":100,"project_id":"cc000001-0000-4000-8000-000000000591"},
         {"account_code":"4100","credit":100}]'::jsonb) $$,
  'pm posts a balanced two-line entry');

-- ============================================================================
-- F. Guards (project_manager).
-- ============================================================================
select throws_ok(
  $$ select public.post_journal_entry(date '2026-07-05', 'x',
       '[{"account_code":"1110","debit":100},{"account_code":"4100","credit":90}]'::jsonb) $$,
  'P0001', null, 'rejects an unbalanced entry');
select throws_ok(
  $$ select public.post_journal_entry(date '2026-07-05', 'x',
       '[{"account_code":"9999","debit":100},{"account_code":"4100","credit":100}]'::jsonb) $$,
  'P0001', null, 'rejects an unknown account');
select throws_ok(
  $$ select public.post_journal_entry(date '2026-07-05', 'x',
       '[{"account_code":"1000","debit":100},{"account_code":"4100","credit":100}]'::jsonb) $$,
  'P0001', null, 'rejects a non-postable (heading) account');
select throws_ok(
  $$ select public.post_journal_entry(date '2026-07-05', 'x',
       '[{"account_code":"1110","debit":100}]'::jsonb) $$,
  'P0001', null, 'rejects a single-line entry');

-- ============================================================================
-- G. Reversal (project_manager). Capture the entry id as owner first — the test
-- cannot read the zero-grant journal_entries as authenticated (a real caller
-- passes an id obtained via the admin client).
-- ============================================================================
reset role;
create temp table _tap_jrev as
  select id from public.journal_entries where memo = 'TAP-J-1';
grant select on _tap_jrev to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110591"}';
select lives_ok(
  $$ select public.reverse_journal_entry((select id from _tap_jrev)) $$,
  'pm reverses the posted entry');
select throws_ok(
  $$ select public.reverse_journal_entry((select id from _tap_jrev)) $$,
  'P0001', null, 'an already-reversed entry cannot be reversed again');

-- ============================================================================
-- H. Effects + audit (reset to owner to read past the zero-grant posture).
-- ============================================================================
reset role;
select is(
  (select count(*) from public.journal_entries
    where reversal_of = (select id from public.journal_entries where memo = 'TAP-J-1')),
  1::bigint, 'a reversal entry exists linked via reversal_of');
-- Scope to THIS fixture's entries (audit_log.target_id = the journal entry id):
-- the table-wide journal_posted count grows with every real drained posting, so
-- a global `= 2` goes red the moment prod posts a journal entry.
select is(
  (select count(*) from public.audit_log
    where action = 'journal_posted'
      and target_id in (
        select id from public.journal_entries
         where memo = 'TAP-J-1'
            or reversal_of = (select id from public.journal_entries where memo = 'TAP-J-1'))),
  2::bigint, 'two journal_posted audit rows for this fixture (the entry + its reversal)');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries where memo = 'TAP-J-1')
      and project_id = 'cc000001-0000-4000-8000-000000000591' and debit = 100),
  1::bigint, 'the debit line carries its project dimension');
select is(
  (select sum(debit) from public.journal_lines
    where entry_id = (select id from public.journal_entries where memo = 'TAP-J-1')),
  (select sum(credit) from public.journal_lines
    where entry_id = (select id from public.journal_entries where memo = 'TAP-J-1')),
  'the posted entry balances (Σdebit = Σcredit)');

-- ============================================================================
-- I. Anon denied entirely.
-- ============================================================================
set local role anon;
select throws_ok($$ select id from public.journal_entries limit 1 $$,
  '42501', null, 'anon cannot read journal_entries');

reset role;
select * from finish();
rollback;
