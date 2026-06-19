begin;
select plan(20);

-- ============================================================================
-- Spec 149 U6 / ADR 0057 decision 9 — WHT certificates + deducted posting.
-- Pins: wht_rates seed + zero-grant; wht_certificates catalog + zero-grant;
-- record_wht_certificate (pm gate; rate default from income_type; 13-digit guard;
-- deducted needs a party); the deducted posting via drain (Dr DC-clearing 2110 /
-- Cr WHT-payable 2210, contractor party); a suffered cert posts nothing; anon denied.
-- base 100000 @ service(3%) → wht 3000.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110647', 'pm@wht.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220647', 'sa@wht.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110647';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220647';

insert into public.contractors (id, name, created_by) values
  ('dd000001-0000-4000-8000-000000000647', 'WHT Subcon', '11111111-1111-1111-1111-111111110647');

-- ============================================================================
-- A. Catalog + seed.
-- ============================================================================
select has_type('public', 'wht_direction', 'wht_direction enum exists');
select has_type('public', 'wht_form', 'wht_form enum exists');
select has_table('public', 'wht_rates', 'wht_rates exists');
select has_table('public', 'wht_certificates', 'wht_certificates exists');
select is((select default_rate from public.wht_rates where income_type = 'service'),
  3::numeric, 'service WHT rate seeded at 3%');
select is((select default_rate from public.wht_rates where income_type = 'rent'),
  5::numeric, 'rent WHT rate seeded at 5%');
select is((select count(*) from pg_policies where schemaname='public' and tablename='wht_certificates'),
  0::bigint, 'wht_certificates zero policies (zero grant)');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- B. record (pm gate; defaults rate from income_type; deducted needs a party).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220647"}';
select throws_ok(
  $$ select public.record_wht_certificate('deducted', 'pnd53', 'service', '0105556000123', 100000,
       null, null, 'dd000001-0000-4000-8000-000000000647') $$,
  '42501', null, 'record_wht_certificate refuses site_admin');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110647"}';
select throws_ok(
  $$ select public.record_wht_certificate('deducted', 'pnd53', 'service', '123', 100000,
       null, null, 'dd000001-0000-4000-8000-000000000647') $$,
  'P0001', null, 'rejects a bad tax id');
select throws_ok(
  $$ select public.record_wht_certificate('deducted', 'pnd53', 'service', '0105556000123', 100000) $$,
  'P0001', null, 'a deducted cert with no party is rejected');
select lives_ok(
  $$ select public.record_wht_certificate('deducted', 'pnd53', 'service', '0105556000123', 100000,
       null, null, 'dd000001-0000-4000-8000-000000000647') $$,
  'pm records a deducted WHT certificate (rate defaults to 3%)');

reset role;
create temp table _tap_wht as
  select id from public.wht_certificates where contractor_id = 'dd000001-0000-4000-8000-000000000647'
    and direction = 'deducted';
select is((select wht_amount from public.wht_certificates where id = (select id from _tap_wht)),
  3000::numeric, 'wht_amount = 3% of 100000 (rate defaulted from income_type)');
select is((select wht_rate from public.wht_certificates where id = (select id from _tap_wht)),
  3::numeric, 'wht_rate defaulted to the service rate');

-- ============================================================================
-- C. Drain → the deducted posting.
-- ============================================================================
select is((select public.drain_gl_posting(100)), 1, 'drain posts the deducted WHT cert');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='wht_certificates' and source_id=(select id from _tap_wht) and source_event='wht_certificate')
      and account_id = (select id from public.gl_accounts where code='2110')
      and debit = 3000 and contractor_id = 'dd000001-0000-4000-8000-000000000647'),
  1::bigint, 'Dr DC-clearing (2110) = 3000 with contractor party');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='wht_certificates' and source_id=(select id from _tap_wht) and source_event='wht_certificate')
      and account_id = (select id from public.gl_accounts where code='2210') and credit = 3000),
  1::bigint, 'Cr WHT-payable (2210) = 3000');
select is(
  (select sum(debit) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='wht_certificates' and source_id=(select id from _tap_wht) and source_event='wht_certificate')),
  (select sum(credit) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='wht_certificates' and source_id=(select id from _tap_wht) and source_event='wht_certificate')),
  'the WHT entry balances');

-- ============================================================================
-- D. A suffered cert is a document only (no GL post, no enqueue).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110647"}';
select lives_ok(
  $$ select public.record_wht_certificate('suffered', 'pnd53', 'service', '0105556000999', 50000) $$,
  'pm records a suffered WHT certificate');
reset role;
select is(
  (select count(*) from public.gl_posting_outbox where source_table = 'wht_certificates'
     and source_id = (select id from public.wht_certificates where direction='suffered')),
  0::bigint, 'a suffered cert does NOT enqueue a GL post');

-- ============================================================================
-- E. Anon denied.
-- ============================================================================
set local role anon;
select throws_ok($$ select id from public.wht_certificates limit 1 $$,
  '42501', null, 'anon cannot read wht_certificates');

reset role;
select * from finish();
rollback;
