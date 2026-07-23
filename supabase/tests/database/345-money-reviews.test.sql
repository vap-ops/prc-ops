begin;
select plan(49);

-- ============================================================================
-- Spec 345 U1 — money-event review layer: money_event_reviews + money_review_flags
-- + the generic stale-verify trigger (money_review_mark_stale_tg) on 15 sources.
-- Pins: 5 enums; both tables' keys/FKs; zero-grant + RLS-sealed posture (no
-- policies, authenticated denied); the CHECK constraints (source allowlist,
-- verified attribution, reviewer flag attribution, closed-flag shape); the
-- stale-verify behavior contract on all three wiring shapes — in-place UPDATE
-- (wp_labor_costs, the composite oddity: source_id = work_package_id), supersede
-- INSERT (wage_payments.superseded_by), and correction-ledger INSERT
-- (stock_receipt_corrections / stock_reversals keying 'stock_receipts').
-- D-1 (plan): staleness lands status='pending' + ONE system flag born 'suggested';
-- non-WHEN columns never fire; sources without a review are untouched.
-- Fixtures inserted as owner (subledgers are zero-grant); all counts scoped to
-- fixture ids — never table-wide (prod rows may exist).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000345', 'reviewer@mr345.local', '{}'::jsonb);

insert into public.projects (id, code, name) values
  ('c0000000-0000-4000-8000-000000000345', 'TAP-MR-345', 'Money review fixture');
insert into public.work_packages (id, project_id, code, name) values
  ('e1000000-0000-4000-8000-000000000345', 'c0000000-0000-4000-8000-000000000345', 'WP-MR-1', 'labor stale WP'),
  ('e2000000-0000-4000-8000-000000000345', 'c0000000-0000-4000-8000-000000000345', 'WP-MR-2', 'no-review WP');
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('a0000000-0000-4000-8000-000000000345', 'MR345 DC', 'daily', 'permanent', 300.00, true,
   '10000000-0000-4000-8000-000000000345');
insert into public.suppliers (id, name, created_by) values
  ('50000000-0000-4000-8000-000000000345', 'ผู้ขาย MR345', '10000000-0000-4000-8000-000000000345');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('11000000-0000-4000-8000-000000000345', 'electrical', 'MR345 stale item', 'ชิ้น', true);

-- ============================================================================
-- A. Enums.
-- ============================================================================
select has_type('public', 'money_review_status', 'money_review_status enum exists');
select enum_has_labels('public', 'money_review_status',
  array['pending', 'verified', 'flagged'], 'money_review_status labels');
select has_type('public', 'money_review_verified_via', 'money_review_verified_via enum exists');
select enum_has_labels('public', 'money_review_verified_via',
  array['reviewer', 'agent'], 'money_review_verified_via labels');
select has_type('public', 'money_flag_status', 'money_flag_status enum exists');
select enum_has_labels('public', 'money_flag_status',
  array['suggested', 'open', 'resolved', 'dismissed'], 'money_flag_status labels');
select has_type('public', 'money_flag_raised_by_kind', 'money_flag_raised_by_kind enum exists');
select enum_has_labels('public', 'money_flag_raised_by_kind',
  array['reviewer', 'agent', 'system'], 'money_flag_raised_by_kind labels');
select has_type('public', 'money_flag_type', 'money_flag_type enum exists');
select enum_has_labels('public', 'money_flag_type',
  array['missing_doc', 'wrong_doc_type', 'amount_mismatch', 'sum_mismatch', 'unreadable',
        'duplicate_doc', 'wrong_vendor', 'changed_after_verified', 'other'],
  'money_flag_type labels');

-- ============================================================================
-- B. Tables + keys.
-- ============================================================================
select has_table('public', 'money_event_reviews', 'money_event_reviews exists');
select has_table('public', 'money_review_flags', 'money_review_flags exists');
select col_is_pk('public', 'money_event_reviews', 'id', 'money_event_reviews.id is the PK');
select col_is_pk('public', 'money_review_flags', 'id', 'money_review_flags.id is the PK');
select fk_ok('public', 'money_event_reviews', 'project_id', 'public', 'projects', 'id');
select fk_ok('public', 'money_review_flags', 'review_id', 'public', 'money_event_reviews', 'id');

-- ============================================================================
-- C. Posture: RLS sealed, zero grant, definer trigger fn, 15 triggers.
-- ============================================================================
select ok((select relrowsecurity from pg_class where oid = 'public.money_event_reviews'::regclass),
  'RLS enabled on money_event_reviews');
select ok((select relrowsecurity from pg_class where oid = 'public.money_review_flags'::regclass),
  'RLS enabled on money_review_flags');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'money_event_reviews'),
  0::bigint, 'money_event_reviews has no policies (sealed; DEFINER-only access)');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'money_review_flags'),
  0::bigint, 'money_review_flags has no policies (sealed; DEFINER-only access)');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000345"}';
select throws_ok($$ select id from public.money_event_reviews limit 1 $$,
  '42501', null, 'authenticated cannot read money_event_reviews (zero grant)');
select throws_ok($$ select id from public.money_review_flags limit 1 $$,
  '42501', null, 'authenticated cannot read money_review_flags (zero grant)');
reset role;

select has_function('public', 'money_review_mark_stale_tg', 'stale-verify trigger fn exists');
select is((select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'money_review_mark_stale_tg'),
  true, 'money_review_mark_stale_tg is SECURITY DEFINER');
select is((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where not t.tgisinternal and t.tgname like '%\_money\_review\_stale'),
  16::bigint, 'exactly 16 stale-verify triggers are wired (+ spec 347 price-correction)');
-- The generic fn silently no-ops on a nonexistent id column (to_jsonb ->> null),
-- so pin every wired trigger's tg_argv[1] against the table's REAL columns —
-- a mis-wired future trigger must red here, not ship green and never fire.
select is(
  (select count(*) from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and t.tgname like '%\_money\_review\_stale'
      and exists (select 1 from information_schema.columns col
                   where col.table_schema = 'public'
                     and col.table_name = c.relname
                     and col.column_name = (string_to_array(encode(t.tgargs, 'escape'), '\000'))[2])),
  16::bigint, 'every stale trigger names an id column that exists on its table (no silent no-op wiring)');
select has_trigger('public', 'wp_labor_costs', 'wp_labor_costs_money_review_stale',
  'wp_labor_costs stale trigger exists (source_id = work_package_id)');

-- ============================================================================
-- D. CHECK constraints.
-- ============================================================================
select throws_ok($$
  insert into public.money_event_reviews (source_table, source_id)
  values ('users', '10000000-0000-4000-8000-000000000345')
$$, '23514', null, 'source_table outside the 15-source allowlist is refused');

select throws_ok($$
  insert into public.money_event_reviews (source_table, source_id, status)
  values ('wage_payments', 'd9000000-0000-4000-8000-000000000345', 'verified')
$$, '23514', null, 'a verified review without verified_at/verified_via is refused');

select throws_ok($$
  insert into public.money_event_reviews (source_table, source_id, status, verified_at, verified_via)
  values ('wage_payments', 'd8000000-0000-4000-8000-000000000345', 'verified', now(), 'reviewer')
$$, '23514', null, 'a reviewer-verified review without verified_by is refused');

insert into public.money_event_reviews
  (id, source_table, source_id, status, verified_at, verified_via) values
  ('b4000000-0000-4000-8000-000000000345', 'wage_payments',
   'd7000000-0000-4000-8000-000000000345', 'verified', now(), 'agent');
select is((select status from public.money_event_reviews where id = 'b4000000-0000-4000-8000-000000000345'),
  'verified'::public.money_review_status,
  'an agent-verified review carries no verified_by (the U8b auto-verify shape)');

-- Seed the three reviews the behavior tests drive (as owner; verified shape).
insert into public.money_event_reviews
  (id, source_table, source_id, project_id, status, verified_by, verified_at, verified_via) values
  ('b1000000-0000-4000-8000-000000000345', 'wp_labor_costs',
   'e1000000-0000-4000-8000-000000000345', 'c0000000-0000-4000-8000-000000000345',
   'verified', '10000000-0000-4000-8000-000000000345', now(), 'reviewer');

select throws_ok($$
  insert into public.money_event_reviews (source_table, source_id)
  values ('wp_labor_costs', 'e1000000-0000-4000-8000-000000000345')
$$, '23505', null, 'one review per (source_table, source_id) — duplicate refused');

select throws_ok($$
  insert into public.money_review_flags (review_id, flag_type, raised_by_kind, status)
  values ('b1000000-0000-4000-8000-000000000345', 'other', 'reviewer', 'open')
$$, '23514', null, 'a reviewer-raised flag without flagged_by is refused');

select throws_ok($$
  insert into public.money_review_flags (review_id, flag_type, raised_by_kind, status, flagged_by)
  values ('b1000000-0000-4000-8000-000000000345', 'other', 'reviewer', 'resolved',
          '10000000-0000-4000-8000-000000000345')
$$, '23514', null, 'a resolved/dismissed flag without resolved_at is refused');

-- ============================================================================
-- E. UPDATE stale path — wp_labor_costs (WHEN: own_cost/dc_cost; id col =
--    work_package_id). Non-WHEN column first, then the real change.
-- ============================================================================
insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, frozen_by) values
  ('e1000000-0000-4000-8000-000000000345', 900, 100, '10000000-0000-4000-8000-000000000345'),
  ('e2000000-0000-4000-8000-000000000345', 500, 500, '10000000-0000-4000-8000-000000000345');

update public.wp_labor_costs set frozen_by = '10000000-0000-4000-8000-000000000345'
 where work_package_id = 'e1000000-0000-4000-8000-000000000345';
select is((select status from public.money_event_reviews where id = 'b1000000-0000-4000-8000-000000000345'),
  'verified'::public.money_review_status, 'non-WHEN column update leaves the review verified');
select is((select count(*) from public.money_review_flags
           where review_id = 'b1000000-0000-4000-8000-000000000345'),
  0::bigint, 'non-WHEN column update raises no flag');

update public.wp_labor_costs set own_cost = 950
 where work_package_id = 'e1000000-0000-4000-8000-000000000345';
select is((select status from public.money_event_reviews where id = 'b1000000-0000-4000-8000-000000000345'),
  'pending'::public.money_review_status, 'own_cost change flips the verified review to pending');
select ok((select verified_at is not null from public.money_event_reviews
           where id = 'b1000000-0000-4000-8000-000000000345'),
  'the last-verify trail (verified_at) is retained on the stale flip (D-4)');
select is((select count(*) from public.money_review_flags
           where review_id = 'b1000000-0000-4000-8000-000000000345'
             and flag_type = 'changed_after_verified'
             and raised_by_kind = 'system' and status = 'suggested'),
  1::bigint, 'exactly one system flag born suggested (changed_after_verified)');

-- Idempotence: another money change while already pending adds nothing.
update public.wp_labor_costs set dc_cost = 200
 where work_package_id = 'e1000000-0000-4000-8000-000000000345';
select is((select count(*) from public.money_review_flags
           where review_id = 'b1000000-0000-4000-8000-000000000345'),
  1::bigint, 'a further change while pending raises no second flag (idempotent)');

-- ============================================================================
-- F. INSERT stale path — wage_payments supersede (NEW row carries superseded_by).
-- ============================================================================
insert into public.wage_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by) values
  ('d1000000-0000-4000-8000-000000000345', 'a0000000-0000-4000-8000-000000000345',
   date '2026-07-01', date '2026-07-15', 3000, 10, 3000, date '2026-07-16', 'cash',
   '10000000-0000-4000-8000-000000000345');
insert into public.money_event_reviews
  (id, source_table, source_id, status, verified_by, verified_at, verified_via) values
  ('b2000000-0000-4000-8000-000000000345', 'wage_payments',
   'd1000000-0000-4000-8000-000000000345', 'verified',
   '10000000-0000-4000-8000-000000000345', now(), 'reviewer');

-- A fresh, non-superseding payment must not touch payment A's review.
insert into public.wage_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by) values
  ('d3000000-0000-4000-8000-000000000345', 'a0000000-0000-4000-8000-000000000345',
   date '2026-06-01', date '2026-06-15', 1500, 5, 1500, date '2026-06-16', 'cash',
   '10000000-0000-4000-8000-000000000345');
select is((select status from public.money_event_reviews where id = 'b2000000-0000-4000-8000-000000000345'),
  'verified'::public.money_review_status, 'a non-superseding insert leaves the review verified');

-- dc_payments_reason_iff_supersede: a superseding row must carry correction_reason.
insert into public.wage_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by, superseded_by, correction_reason) values
  ('d2000000-0000-4000-8000-000000000345', 'a0000000-0000-4000-8000-000000000345',
   date '2026-07-01', date '2026-07-15', 3200, 10, 3200, date '2026-07-16', 'cash',
   '10000000-0000-4000-8000-000000000345', 'd1000000-0000-4000-8000-000000000345',
   'แก้ยอด (fixture)');
select is((select status from public.money_event_reviews where id = 'b2000000-0000-4000-8000-000000000345'),
  'pending'::public.money_review_status, 'a superseding insert flips the old payment''s review to pending');
select is((select count(*) from public.money_review_flags
           where review_id = 'b2000000-0000-4000-8000-000000000345'
             and flag_type = 'changed_after_verified' and raised_by_kind = 'system'),
  1::bigint, 'the supersede raises exactly one system flag');

-- ============================================================================
-- G. Correction-ledger path — stock_receipt_corrections + stock_reversals both
--    key the 'stock_receipts' review via their receipt_id.
-- ============================================================================
insert into public.stock_receipts
  (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, received_at) values
  ('a1000000-0000-4000-8000-000000000345', 'c0000000-0000-4000-8000-000000000345',
   '11000000-0000-4000-8000-000000000345', 100, 'ชิ้น', 10, 7,
   '50000000-0000-4000-8000-000000000345', '2026-07-20 10:00:00+00');
insert into public.money_event_reviews
  (id, source_table, source_id, project_id, status, verified_by, verified_at, verified_via) values
  ('b3000000-0000-4000-8000-000000000345', 'stock_receipts',
   'a1000000-0000-4000-8000-000000000345', 'c0000000-0000-4000-8000-000000000345',
   'verified', '10000000-0000-4000-8000-000000000345', now(), 'reviewer');

insert into public.stock_receipt_corrections
  (id, receipt_id, removed_qty, removed_net, removed_vat, removed_gross, true_qty, reason,
   supplier_id, corrected_by) values
  ('f1000000-0000-4000-8000-000000000345', 'a1000000-0000-4000-8000-000000000345',
   10, 100, 7, 107, 90, 'นับผิด (fixture)', '50000000-0000-4000-8000-000000000345',
   '10000000-0000-4000-8000-000000000345');
select is((select status from public.money_event_reviews where id = 'b3000000-0000-4000-8000-000000000345'),
  'pending'::public.money_review_status, 'a stock receipt correction flips the receipt''s review');
select is((select count(*) from public.money_review_flags
           where review_id = 'b3000000-0000-4000-8000-000000000345'),
  1::bigint, 'the correction raises exactly one system flag');

-- Re-verify (owner write), then a reversal must stale it AGAIN — the cycle repeats.
update public.money_event_reviews
   set status = 'verified', verified_by = '10000000-0000-4000-8000-000000000345',
       verified_at = now(), verified_via = 'reviewer'
 where id = 'b3000000-0000-4000-8000-000000000345';
insert into public.stock_reversals
  (id, project_id, catalog_item_id, receipt_id, qty, value_delta, note, reversed_by) values
  ('f2000000-0000-4000-8000-000000000345', 'c0000000-0000-4000-8000-000000000345',
   '11000000-0000-4000-8000-000000000345', 'a1000000-0000-4000-8000-000000000345',
   -90, -900, 'reverse (fixture)', '10000000-0000-4000-8000-000000000345');
select is((select status from public.money_event_reviews where id = 'b3000000-0000-4000-8000-000000000345'),
  'pending'::public.money_review_status, 'a stock reversal stales the re-verified review again');
select is((select count(*) from public.money_review_flags
           where review_id = 'b3000000-0000-4000-8000-000000000345'),
  2::bigint, 'the second staleness cycle appends a second flag');

-- ============================================================================
-- H. No-review no-op: a money change on a source row with no review row.
-- ============================================================================
update public.wp_labor_costs set own_cost = 555
 where work_package_id = 'e2000000-0000-4000-8000-000000000345';
select is((select count(*) from public.money_event_reviews
           where source_table = 'wp_labor_costs'
             and source_id = 'e2000000-0000-4000-8000-000000000345'),
  0::bigint, 'a change on an unreviewed source creates no review row');
select is((select count(*) from public.money_review_flags where review_id in
            ('b1000000-0000-4000-8000-000000000345',
             'b2000000-0000-4000-8000-000000000345',
             'b3000000-0000-4000-8000-000000000345')),
  4::bigint, 'fixture-wide flag total is exactly the four earned above');

select * from finish();
rollback;
