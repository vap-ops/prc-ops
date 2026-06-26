begin;
select plan(14);

-- ============================================================================
-- Spec 149 U4b / ADR 0057 — post_purchase_to_gl + the engine amendments.
-- Pins: journal_lines party column + FK; journal_entries.posted_by nullable; the
-- purchase posting (Dr WIP 1400 net + Dr Input VAT 1300 + Cr AP 2100 gross,
-- balanced, supplier party, project/WP dims); reverse-and-repost (an amount
-- correction reverses the old entry and posts the new). amount 1070 @ 7% VAT ->
-- net 1000 / vat 70. Poster called directly (owner/definer); the drainer is U4c.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110613', 'pm@purchgl.local', '{}'::jsonb);

insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000613', 'TAP-GL-PUR', 'Purchase poster fixture');
insert into public.work_packages (id, project_id, code, name) values
  ('ee000001-0000-4000-8000-000000000613', 'cc000001-0000-4000-8000-000000000613',
   'WP-PUR-1', 'Purchase poster WP');
insert into public.suppliers (id, name, created_by) values
  ('5a000001-0000-4000-8000-000000000613', 'GLPost Supplier', '11111111-1111-1111-1111-111111110613');
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   amount, vat_rate, supplier_id, purchased_at)
values
  ('a1000001-0000-4000-8000-000000000613', 'ee000001-0000-4000-8000-000000000613',
   'rebar', 10, 'ton', '11111111-1111-1111-1111-111111110613', 'purchased',
   1070, 7, '5a000001-0000-4000-8000-000000000613', timestamptz '2026-07-05 09:00+07');

-- ============================================================================
-- A. Engine shape.
-- ============================================================================
select has_column('public', 'journal_lines', 'supplier_id', 'journal_lines has the supplier party column');
select fk_ok('public', 'journal_lines', 'supplier_id', 'public', 'suppliers', 'id');
select ok(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='journal_entries' and column_name='posted_by') = 'YES',
  'journal_entries.posted_by is nullable (system posts)');

-- ============================================================================
-- B. First post (owner/definer context).
-- ============================================================================
select lives_ok(
  $$ select public.post_purchase_to_gl('a1000001-0000-4000-8000-000000000613') $$,
  'post_purchase_to_gl posts a purchase');

select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
      where source_table='purchase_requests' and source_id='a1000001-0000-4000-8000-000000000613'
        and source_event='purchase')),
  3::bigint, 'three lines: WIP net + Input VAT + AP gross');
select is(
  (select sum(debit) from public.journal_lines
    where entry_id = (select id from public.journal_entries
      where source_table='purchase_requests' and source_id='a1000001-0000-4000-8000-000000000613'
        and source_event='purchase')),
  1070::numeric, 'debits total the gross (1070)');
select is(
  (select sum(debit) from public.journal_lines je
    where entry_id = (select id from public.journal_entries
      where source_table='purchase_requests' and source_id='a1000001-0000-4000-8000-000000000613'
        and source_event='purchase')),
  (select sum(credit) from public.journal_lines
    where entry_id = (select id from public.journal_entries
      where source_table='purchase_requests' and source_id='a1000001-0000-4000-8000-000000000613'
        and source_event='purchase')),
  'the entry balances (Σdebit = Σcredit)');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
      where source_table='purchase_requests' and source_id='a1000001-0000-4000-8000-000000000613'
        and source_event='purchase')
      and account_id = (select id from public.gl_accounts where code='1400')
      and debit = 1000
      and project_id = 'cc000001-0000-4000-8000-000000000613'
      and work_package_id = 'ee000001-0000-4000-8000-000000000613'),
  1::bigint, 'WIP (1400) line = net 1000 with project + WP dims');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
      where source_table='purchase_requests' and source_id='a1000001-0000-4000-8000-000000000613'
        and source_event='purchase')
      and account_id = (select id from public.gl_accounts where code='1300')
      and debit = 70),
  1::bigint, 'Input VAT (1300) line = 70');
select is(
  (select count(*) from public.journal_lines
    where entry_id = (select id from public.journal_entries
      where source_table='purchase_requests' and source_id='a1000001-0000-4000-8000-000000000613'
        and source_event='purchase')
      and account_id = (select id from public.gl_accounts where code='2100')
      and credit = 1070
      and supplier_id = '5a000001-0000-4000-8000-000000000613'),
  1::bigint, 'AP (2100) line = gross 1070 with supplier party');

-- ============================================================================
-- C. Reverse-and-repost: an amount correction reverses the old entry, posts new.
-- ============================================================================
update public.purchase_requests set amount = 2140
 where id = 'a1000001-0000-4000-8000-000000000613';
select lives_ok(
  $$ select public.post_purchase_to_gl('a1000001-0000-4000-8000-000000000613') $$,
  'a corrected purchase re-posts');
select is(
  (select count(*) from public.journal_entries e
    where e.source_table='purchase_requests' and e.source_id='a1000001-0000-4000-8000-000000000613'
      and e.source_event='purchase'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  1::bigint, 'exactly one CURRENT (non-reversed) purchase entry after re-post');
select is(
  (select count(*) from public.journal_entries r
    where r.source_event='reversal'
      and r.reversal_of in (select e.id from public.journal_entries e
        where e.source_table='purchase_requests'
          and e.source_id='a1000001-0000-4000-8000-000000000613')),
  1::bigint, 'one reversal entry was created for the superseded purchase entry');
select is(
  (select credit from public.journal_lines l
    where l.account_id = (select id from public.gl_accounts where code='2100')
      and l.entry_id = (select e.id from public.journal_entries e
        where e.source_table='purchase_requests' and e.source_id='a1000001-0000-4000-8000-000000000613'
          and e.source_event='purchase'
          and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id))),
  2140::numeric, 'the current entry carries the corrected gross (2140)');

select * from finish();
rollback;
