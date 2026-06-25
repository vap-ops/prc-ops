begin;
select plan(14);

-- ============================================================================
-- Spec 203 U2 / ADR 0057 — widen post_purchase_to_gl's status gate so a committed
-- purchase still posts after it progresses past 'purchased' (the drain-outage bug:
-- 9 WP-bound PRs reached 'delivered' before any drain ran, and the old gate
-- ('purchased','site_purchased' only) refused them → ~฿102k unposted). The widened
-- gate admits committed-and-not-voided: purchased / site_purchased / on_route /
-- delivered. Refused: requested / approved / rejected / cancelled. WP-less stays
-- suppressed (cost via the receipt poster) — no double-book. Poster called directly
-- (owner/definer), like pgTAP 83. UUIDs HEX-ONLY. amount 1070 @ 7% → net 1000/vat 70.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110203', 'pm@gate.local', '{}'::jsonb);
insert into public.projects (id, code, name) values
  ('cc000203-0000-4000-8000-000000000203', 'TAP-GATE', 'Purchase gate fixture');
insert into public.work_packages (id, project_id, code, name) values
  ('ee000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   'WP-GATE', 'Gate WP');
insert into public.suppliers (id, name, created_by) values
  ('5a000203-0000-4000-8000-000000000203', 'Gate Supplier', '11111111-1111-1111-1111-111111110203');

-- PRs across the lifecycle. project_id explicit (spec 195 P1 made it NOT NULL).
-- cancelled_at / decision_comment satisfy pr_cancel_shape / pr_reject_has_comment
-- for the voided rows (null elsewhere).
insert into public.purchase_requests
  (id, project_id, work_package_id, item_description, quantity, unit, requested_by,
   status, amount, vat_rate, supplier_id, purchased_at, cancelled_at, decision_comment)
values
  -- WP-bound, progressed past 'purchased' — the U2 fix targets:
  ('a1000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   'ee000203-0000-4000-8000-000000000203', 'rebar', 10, 'ton',
   '11111111-1111-1111-1111-111111110203', 'delivered', 1070, 7,
   '5a000203-0000-4000-8000-000000000203', timestamptz '2026-07-05 09:00+07', null, null),
  ('a2000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   'ee000203-0000-4000-8000-000000000203', 'pipe', 5, 'ea',
   '11111111-1111-1111-1111-111111110203', 'on_route', 535, 0,
   '5a000203-0000-4000-8000-000000000203', timestamptz '2026-07-05 09:00+07', null, null),
  -- WP-bound 'purchased' — the original postable case (regression):
  ('a3000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   'ee000203-0000-4000-8000-000000000203', 'wire', 2, 'roll',
   '11111111-1111-1111-1111-111111110203', 'purchased', 200, 0,
   '5a000203-0000-4000-8000-000000000203', timestamptz '2026-07-05 09:00+07', null, null),
  -- WP-LESS 'purchased' — must stay suppressed (return null), no double-book:
  ('a4000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   null, 'store sand', 1, 'lot',
   '11111111-1111-1111-1111-111111110203', 'purchased', 300, 0,
   '5a000203-0000-4000-8000-000000000203', timestamptz '2026-07-05 09:00+07', null, null),
  -- Pre-purchase / voided — must stay refused:
  ('a5000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   'ee000203-0000-4000-8000-000000000203', 'x', 1, 'ea',
   '11111111-1111-1111-1111-111111110203', 'requested', 100, 0,
   '5a000203-0000-4000-8000-000000000203', timestamptz '2026-07-05 09:00+07', null, null),
  ('a6000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   'ee000203-0000-4000-8000-000000000203', 'y', 1, 'ea',
   '11111111-1111-1111-1111-111111110203', 'cancelled', 100, 0,
   '5a000203-0000-4000-8000-000000000203', timestamptz '2026-07-05 09:00+07',
   timestamptz '2026-07-05 10:00+07', null),
  ('a7000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   'ee000203-0000-4000-8000-000000000203', 'z', 1, 'ea',
   '11111111-1111-1111-1111-111111110203', 'rejected', 100, 0,
   '5a000203-0000-4000-8000-000000000203', timestamptz '2026-07-05 09:00+07', null, 'ทดสอบปฏิเสธ'),
  -- WP-bound delivered but amount null — refused (regression, the amount guard):
  ('a8000203-0000-4000-8000-000000000203', 'cc000203-0000-4000-8000-000000000203',
   'ee000203-0000-4000-8000-000000000203', 'w', 1, 'ea',
   '11111111-1111-1111-1111-111111110203', 'delivered', null, 0,
   '5a000203-0000-4000-8000-000000000203', timestamptz '2026-07-05 09:00+07', null, null);

select has_function('public', 'post_purchase_to_gl', ARRAY['uuid'], 'post_purchase_to_gl(uuid) exists');

-- ============================================================================
-- A. The U2 widening — a committed purchase posts after it has progressed.
-- ============================================================================
select lives_ok(
  $$ select public.post_purchase_to_gl('a1000203-0000-4000-8000-000000000203') $$,
  'U2: a DELIVERED WP-bound purchase posts');
select is(
  (select credit from public.journal_lines
     where account_id = (select id from public.gl_accounts where code='2100')
       and entry_id = (select id from public.journal_entries
         where source_table='purchase_requests' and source_id='a1000203-0000-4000-8000-000000000203'
           and source_event='purchase')),
  1070::numeric, 'delivered purchase: AP (2100) credit = gross 1070');
select is(
  (select debit from public.journal_lines
     where account_id = (select id from public.gl_accounts where code='1400')
       and entry_id = (select id from public.journal_entries
         where source_table='purchase_requests' and source_id='a1000203-0000-4000-8000-000000000203'
           and source_event='purchase')),
  1000::numeric, 'delivered purchase: WIP (1400) debit = net 1000');
-- Reverse-and-repost under the widened gate: re-posting the delivered PR reverses
-- the prior entry and leaves exactly ONE current purchase entry (the dedup that
-- guarantees no double-book on the path that actually moves the ฿102k).
update public.purchase_requests set amount = 2140
 where id = 'a1000203-0000-4000-8000-000000000203';
select lives_ok(
  $$ select public.post_purchase_to_gl('a1000203-0000-4000-8000-000000000203') $$,
  'U2: re-posting a delivered purchase reverses-and-reposts');
select is(
  (select count(*) from public.journal_entries e
     where e.source_table='purchase_requests' and e.source_id='a1000203-0000-4000-8000-000000000203'
       and e.source_event='purchase'
       and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  1::bigint, 'exactly one CURRENT purchase entry after the re-post (no double-book)');
select lives_ok(
  $$ select public.post_purchase_to_gl('a2000203-0000-4000-8000-000000000203') $$,
  'U2: an ON_ROUTE WP-bound purchase posts');

-- ============================================================================
-- B. Regression — 'purchased' still posts; WP-less stays suppressed (no double-book).
-- ============================================================================
select lives_ok(
  $$ select public.post_purchase_to_gl('a3000203-0000-4000-8000-000000000203') $$,
  'regression: a PURCHASED WP-bound purchase still posts');
select lives_ok(
  $$ select public.post_purchase_to_gl('a4000203-0000-4000-8000-000000000203') $$,
  'regression: a WP-less purchase does not raise (suppressed)');
select is(
  (select count(*) from public.journal_entries
     where source_table='purchase_requests' and source_id='a4000203-0000-4000-8000-000000000203'
       and source_event='purchase'),
  0::bigint, 'regression: the WP-less purchase posts NO purchase entry (cost via receipt)');

-- ============================================================================
-- C. Refused states — pre-purchase + voided stay rejected.
-- ============================================================================
select throws_ok(
  $$ select public.post_purchase_to_gl('a5000203-0000-4000-8000-000000000203') $$,
  'P0001', null, 'a REQUESTED purchase is refused');
select throws_ok(
  $$ select public.post_purchase_to_gl('a6000203-0000-4000-8000-000000000203') $$,
  'P0001', null, 'a CANCELLED purchase is refused');
select throws_ok(
  $$ select public.post_purchase_to_gl('a7000203-0000-4000-8000-000000000203') $$,
  'P0001', null, 'a REJECTED purchase is refused');
select throws_ok(
  $$ select public.post_purchase_to_gl('a8000203-0000-4000-8000-000000000203') $$,
  'P0001', null, 'regression: a null-amount purchase is refused');

select * from finish();
rollback;
