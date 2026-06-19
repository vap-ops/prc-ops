begin;
select plan(14);

-- ============================================================================
-- Spec 149 U5b / ADR 0057 decision 8 — retention release (held→due→released).
-- Pins: released_by column; mark_retention_due (held→due, pm gate); release_retention
-- (due→released, pm gate, site_admin refused); the release posting via drain
-- (Dr Bank 1110 / Cr Retention 1210, client party, balanced) + release_entry_id
-- link; re-release refused; anon denied. Fixtures inserted as owner; a draft
-- billing parents the held retention (the certify→accrue path is covered by 85).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110646', 'pm@retrel.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220646', 'sa@retrel.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110646';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220646';

insert into public.clients (id, name, created_by) values
  ('c1000001-0000-4000-8000-000000000646', 'Retention Client', '11111111-1111-1111-1111-111111110646');
insert into public.projects (id, code, name, client_id) values
  ('cc000001-0000-4000-8000-000000000646', 'TAP-GL-RET', 'Retention fixture',
   'c1000001-0000-4000-8000-000000000646');
insert into public.client_billings (id, project_id, gross_amount, status, created_by) values
  ('cb000001-0000-4000-8000-000000000646', 'cc000001-0000-4000-8000-000000000646', 100000, 'draft',
   '11111111-1111-1111-1111-111111110646');
insert into public.retention_receivables (id, project_id, client_billing_id, amount_withheld) values
  ('44000001-0000-4000-8000-000000000646', 'cc000001-0000-4000-8000-000000000646',
   'cb000001-0000-4000-8000-000000000646', 5000);

-- ============================================================================
-- A. Shape.
-- ============================================================================
select has_column('public', 'retention_receivables', 'released_by', 'retention_receivables has released_by');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- B. mark due (held → due).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110646"}';
select lives_ok(
  $$ select public.mark_retention_due('44000001-0000-4000-8000-000000000646', date '2027-06-01') $$,
  'pm marks the retention due');
reset role;
select is((select status from public.retention_receivables where id = '44000001-0000-4000-8000-000000000646'),
  'due'::public.retention_status, 'retention is due');
select is((select due_date from public.retention_receivables where id = '44000001-0000-4000-8000-000000000646'),
  date '2027-06-01', 'due_date recorded');

-- ============================================================================
-- C. release (due → released; site_admin refused).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220646"}';
select throws_ok(
  $$ select public.release_retention('44000001-0000-4000-8000-000000000646') $$,
  '42501', null, 'release_retention refuses site_admin');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110646"}';
select lives_ok(
  $$ select public.release_retention('44000001-0000-4000-8000-000000000646') $$,
  'pm releases the retention');

reset role;
select is((select status from public.retention_receivables where id = '44000001-0000-4000-8000-000000000646'),
  'released'::public.retention_status, 'retention is released');
select is((select released_by from public.retention_receivables where id = '44000001-0000-4000-8000-000000000646'),
  '11111111-1111-1111-1111-111111110646'::uuid, 'released_by pinned to the pm');

-- ============================================================================
-- D. Drain → the release posting.
-- ============================================================================
select is((select public.drain_gl_posting(100)), 1, 'drain posts the release');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='retention_receivables' and source_id='44000001-0000-4000-8000-000000000646'
          and source_event='retention_release')
      and account_id = (select id from public.gl_accounts where code='1110') and debit = 5000),
  1::bigint, 'Dr Bank (1110) = 5000');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
        where source_table='retention_receivables' and source_id='44000001-0000-4000-8000-000000000646'
          and source_event='retention_release')
      and account_id = (select id from public.gl_accounts where code='1210')
      and credit = 5000 and client_id = 'c1000001-0000-4000-8000-000000000646'),
  1::bigint, 'Cr Retention receivable (1210) = 5000 with client party');
select is(
  (select release_entry_id from public.retention_receivables where id = '44000001-0000-4000-8000-000000000646'),
  (select id from public.journal_entries
     where source_table='retention_receivables' and source_id='44000001-0000-4000-8000-000000000646'
       and source_event='retention_release'),
  'release_entry_id is linked to the posted entry');

-- ============================================================================
-- E. Re-release refused + anon denied.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110646"}';
select throws_ok(
  $$ select public.release_retention('44000001-0000-4000-8000-000000000646') $$,
  'P0001', null, 'an already-released retention cannot be released again');

set local role anon;
select throws_ok($$ select id from public.retention_receivables limit 1 $$,
  '42501', null, 'anon cannot read retention_receivables');

reset role;
select * from finish();
rollback;
