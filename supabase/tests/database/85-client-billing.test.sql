begin;
select plan(24);

-- ============================================================================
-- Spec 149 U5 / ADR 0057 decision 8 — client billing (งวด) + retention (5%).
-- Pins: catalog + zero-grant; create (draft, pm gate); certify (computes
-- retention/VAT/WHT/net, accrues retention 'held'); the GL posting via drain
-- (Dr AR net + Dr Retention + Dr WHT / Cr Revenue + Cr Output VAT, balanced,
-- client party); anon denied. gross 100000 @ 5/7/3 → ret 5000, vat 7000, wht 3000,
-- net 99000. Entry id captured as owner (zero-grant tables unreadable to authed).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110635', 'pm@billing.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220635', 'sa@billing.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110635';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220635';

insert into public.clients (id, name, created_by) values
  ('c1000001-0000-4000-8000-000000000635', 'Billing Client', '11111111-1111-1111-1111-111111110635');
insert into public.projects (id, code, name, client_id) values
  ('cc000001-0000-4000-8000-000000000635', 'TAP-GL-BILL', 'Billing fixture',
   'c1000001-0000-4000-8000-000000000635');

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_type('public', 'client_billing_status', 'client_billing_status enum exists');
select has_type('public', 'retention_status', 'retention_status enum exists');
select has_table('public', 'client_billings', 'client_billings exists');
select has_table('public', 'retention_receivables', 'retention_receivables exists');
select is((select count(*) from pg_policies where schemaname='public' and tablename='client_billings'),
  0::bigint, 'client_billings zero policies (zero grant)');
select is((select count(*) from pg_policies where schemaname='public' and tablename='retention_receivables'),
  0::bigint, 'retention_receivables zero policies (zero grant)');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- B. create + certify (pm gate; site_admin refused).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220635"}';
select throws_ok(
  $$ select public.create_client_billing('cc000001-0000-4000-8000-000000000635', 100000) $$,
  '42501', null, 'create_client_billing refuses site_admin');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110635"}';
select lives_ok(
  $$ select public.create_client_billing('cc000001-0000-4000-8000-000000000635', 100000) $$,
  'pm creates a draft billing');

reset role;
create temp table _tap_cb as
  select id from public.client_billings where project_id = 'cc000001-0000-4000-8000-000000000635';
grant select on _tap_cb to authenticated;
select is(
  (select status from public.client_billings where project_id = 'cc000001-0000-4000-8000-000000000635'),
  'draft'::public.client_billing_status, 'new billing is draft');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220635"}';
select throws_ok(
  $$ select public.certify_client_billing((select id from _tap_cb)) $$,
  '42501', null, 'certify_client_billing refuses site_admin');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110635"}';
select lives_ok(
  $$ select public.certify_client_billing((select id from _tap_cb)) $$,
  'pm certifies the billing');

-- ============================================================================
-- C. Certified amounts + retention accrual (owner reads past zero-grant).
-- ============================================================================
reset role;
select is((select status from public.client_billings where id = (select id from _tap_cb)),
  'certified'::public.client_billing_status, 'billing is certified');
select is((select retention_amount from public.client_billings where id = (select id from _tap_cb)),
  5000::numeric, 'retention amount = 5% of 100000');
select is((select vat_amount from public.client_billings where id = (select id from _tap_cb)),
  7000::numeric, 'VAT amount = 7%');
select is((select wht_suffered from public.client_billings where id = (select id from _tap_cb)),
  3000::numeric, 'WHT suffered = 3%');
select is((select net_receivable from public.client_billings where id = (select id from _tap_cb)),
  99000::numeric, 'net receivable = 100000 + 7000 − 5000 − 3000');
select is(
  (select count(*) from public.retention_receivables
    where client_billing_id = (select id from _tap_cb) and amount_withheld = 5000 and status = 'held'),
  1::bigint, 'a held retention receivable of 5000 was accrued');

-- ============================================================================
-- D. Drain → the GL posting (Dr AR net + Dr Retention + Dr WHT / Cr Revenue + Cr VAT).
-- ============================================================================
select is((select public.drain_gl_posting(100)), 1, 'drain posts the certified billing');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='client_billings' and source_id=(select id from _tap_cb) and source_event='client_billing')
      and account_id = (select id from public.gl_accounts where code='1200')
      and debit = 99000 and client_id = 'c1000001-0000-4000-8000-000000000635'),
  1::bigint, 'Dr AR (1200) = net 99000 with client party');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='client_billings' and source_id=(select id from _tap_cb) and source_event='client_billing')
      and account_id = (select id from public.gl_accounts where code='1210') and debit = 5000),
  1::bigint, 'Dr Retention receivable (1210) = 5000');
select is(
  (select credit from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='client_billings' and source_id=(select id from _tap_cb) and source_event='client_billing')
      and account_id = (select id from public.gl_accounts where code='4100')),
  100000::numeric, 'Cr Revenue (4100) = gross 100000');
select is(
  (select credit from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='client_billings' and source_id=(select id from _tap_cb) and source_event='client_billing')
      and account_id = (select id from public.gl_accounts where code='2200')),
  7000::numeric, 'Cr Output VAT (2200) = 7000');
select is(
  (select sum(debit) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='client_billings' and source_id=(select id from _tap_cb) and source_event='client_billing')),
  (select sum(credit) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='client_billings' and source_id=(select id from _tap_cb) and source_event='client_billing')),
  'the billing entry balances (Σdebit = Σcredit)');

-- ============================================================================
-- E. Anon denied.
-- ============================================================================
set local role anon;
select throws_ok($$ select id from public.client_billings limit 1 $$,
  '42501', null, 'anon cannot read client_billings');

reset role;
select * from finish();
rollback;
