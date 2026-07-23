begin;
select plan(39);

-- ============================================================================
-- Spec 345 U3 — the review action RPCs: verify_money_event / flag_money_event /
-- resolve_money_flag / dismiss_money_flag (+ the single-row read path: the list
-- RPC regains signature with p_source_table/p_source_id + tab 'any').
-- Pins: gates (visitor 42501 message-pinned on every action fn); verify creates
-- the review on first action, refuses while an OPEN flag exists (P0001), and
-- dismisses outstanding SUGGESTED system flags (the D-1 loop-closer — proven
-- through the REAL U1 stale trigger, not a hand-seeded flag); flag creates an
-- open reviewer flag + flips the review, refuses the system-reserved
-- changed_after_verified type and a blank-detail 'other'; resolve/dismiss set
-- resolved_by/at and recompute (any open ⇒ flagged; else pending — NEVER
-- silently back to verified); every action writes audit action='other' with
-- its payload event. Fixture in 2001 months (prod-free window; U2 lesson);
-- every assert scoped to fixture ids.
-- ROLE DISCIPLINE: the RPCs run as authenticated (set role sandwiches); every
-- table-state assert runs as OWNER — the review tables are sealed (RLS, no
-- policies), so an authenticated read would return EMPTY silently and fake a
-- pass/fail. Never assert table state under the switched role.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000446', 'acct@ra446.local', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000446', 'vis@ra446.local', '{}'::jsonb);
update public.users set role = 'accounting' where id = '10000000-0000-4000-8000-000000000446';

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('a0000000-0000-4000-8000-000000000446', 'RA446 DC', 'daily', 'permanent', 300.00, true,
   '10000000-0000-4000-8000-000000000446');
-- W1: verify attribution · W2: the flag loop · W3: recompute with two flags ·
-- W4: untouched (gate probes). The stale cycle runs on a wp_labor_costs row.
insert into public.wage_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by) values
  ('d1000000-0000-4000-8000-000000000446', 'a0000000-0000-4000-8000-000000000446',
   date '2001-01-01', date '2001-01-05', 1000, 5, 1000, date '2001-01-06', 'cash',
   '10000000-0000-4000-8000-000000000446'),
  ('d2000000-0000-4000-8000-000000000446', 'a0000000-0000-4000-8000-000000000446',
   date '2001-01-08', date '2001-01-12', 1100, 5, 1100, date '2001-01-13', 'cash',
   '10000000-0000-4000-8000-000000000446'),
  ('d3000000-0000-4000-8000-000000000446', 'a0000000-0000-4000-8000-000000000446',
   date '2001-01-15', date '2001-01-19', 1200, 5, 1200, date '2001-01-20', 'cash',
   '10000000-0000-4000-8000-000000000446'),
  ('d4000000-0000-4000-8000-000000000446', 'a0000000-0000-4000-8000-000000000446',
   date '2001-01-22', date '2001-01-26', 1300, 5, 1300, date '2001-01-27', 'cash',
   '10000000-0000-4000-8000-000000000446');
insert into public.projects (id, code, name) values
  ('c0000000-0000-4000-8000-000000000446', 'TAP-RA-446', 'Review actions fixture');
insert into public.work_packages (id, project_id, code, name) values
  ('e0000000-0000-4000-8000-000000000446', 'c0000000-0000-4000-8000-000000000446', 'WP-RA-1', 'ra labor');
insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, frozen_by, computed_at) values
  ('e0000000-0000-4000-8000-000000000446', 500, 0, '10000000-0000-4000-8000-000000000446',
   '2001-01-10 09:00:00+00');

-- ============================================================================
-- A. Catalog + gates.
-- ============================================================================
select has_function('public', 'verify_money_event', 'verify_money_event exists');
select has_function('public', 'flag_money_event', 'flag_money_event exists');
select has_function('public', 'resolve_money_flag', 'resolve_money_flag exists');
select has_function('public', 'dismiss_money_flag', 'dismiss_money_flag exists');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and p.proname in ('verify_money_event', 'flag_money_event',
                               'resolve_money_flag', 'dismiss_money_flag')),
  4::bigint, 'all four action RPCs are SECURITY DEFINER');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "20000000-0000-4000-8000-000000000446"}';
select throws_ok($$
  select public.verify_money_event('wage_payments', 'd4000000-0000-4000-8000-000000000446')
$$, '42501', 'verify_money_event: role not permitted', 'a visitor cannot verify');
select throws_ok($$
  select public.flag_money_event('wage_payments', 'd4000000-0000-4000-8000-000000000446',
    'amount_mismatch', 'x')
$$, '42501', 'flag_money_event: role not permitted', 'a visitor cannot flag');
select throws_ok($$
  select public.resolve_money_flag('00000000-0000-4000-8000-000000000000', 'x')
$$, '42501', 'resolve_money_flag: role not permitted', 'a visitor cannot resolve');
select throws_ok($$
  select public.dismiss_money_flag('00000000-0000-4000-8000-000000000000')
$$, '42501', 'dismiss_money_flag: role not permitted', 'a visitor cannot dismiss');
reset role;

-- ============================================================================
-- B. Verify — create on first action, attribution, the stale cycle (D-1).
--    Actions run as the accountant; state asserts run as OWNER.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000446"}';
select lives_ok($$
  select public.verify_money_event('wage_payments', 'd1000000-0000-4000-8000-000000000446',
    'ตรวจครั้งแรก')
$$, 'verify creates the review on first admin action');
select throws_ok($$
  select public.verify_money_event('users', 'd1000000-0000-4000-8000-000000000446')
$$, '22023', null, 'an unknown source table is refused');
select lives_ok($$
  select public.verify_money_event('wp_labor_costs', 'e0000000-0000-4000-8000-000000000446')
$$, 'labor review verified (stale-cycle setup)');
reset role;

select is((select status from public.money_event_reviews
           where source_table = 'wage_payments'
             and source_id = 'd1000000-0000-4000-8000-000000000446'),
  'verified'::public.money_review_status, 'the review is verified');
select results_eq($$
  select verified_by, verified_via::text, (verified_at is not null), note
    from public.money_event_reviews
   where source_table = 'wage_payments' and source_id = 'd1000000-0000-4000-8000-000000000446'
$$, $$ values ('10000000-0000-4000-8000-000000000446'::uuid, 'reviewer'::text, true, 'ตรวจครั้งแรก'::text) $$,
  'verify stamps by/via/at/note');

-- The REAL U1 stale trigger flips the labor review (owner update).
update public.wp_labor_costs set own_cost = 600
 where work_package_id = 'e0000000-0000-4000-8000-000000000446';
select is((select status from public.money_event_reviews
           where source_table = 'wp_labor_costs'
             and source_id = 'e0000000-0000-4000-8000-000000000446'),
  'pending'::public.money_review_status, 'the U1 stale trigger flipped the verified review');
select is((select count(*) from public.money_review_flags f
            join public.money_event_reviews r on r.id = f.review_id
           where r.source_table = 'wp_labor_costs'
             and r.source_id = 'e0000000-0000-4000-8000-000000000446'
             and f.status = 'suggested' and f.raised_by_kind = 'system'),
  1::bigint, 'the stale flip left one suggested system flag');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000446"}';
select lives_ok($$
  select public.verify_money_event('wp_labor_costs', 'e0000000-0000-4000-8000-000000000446')
$$, 're-verify after the stale flip succeeds');
reset role;

select is((select count(*) from public.money_review_flags f
            join public.money_event_reviews r on r.id = f.review_id
           where r.source_table = 'wp_labor_costs'
             and r.source_id = 'e0000000-0000-4000-8000-000000000446'
             and f.status = 'suggested'),
  0::bigint, 're-verify dismissed the suggested system flag (D-1 loop closed)');
select is((select count(*) from public.money_review_flags f
            join public.money_event_reviews r on r.id = f.review_id
           where r.source_table = 'wp_labor_costs'
             and r.source_id = 'e0000000-0000-4000-8000-000000000446'
             and f.status = 'dismissed' and f.resolved_by is not null),
  1::bigint, 'the dismissal carries resolved_by (attribution, never silent)');

-- ============================================================================
-- C. Flag — open reviewer flag, reserved type, blank-other refusal, verify
--    refusal while open.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000446"}';
select lives_ok($$
  select public.flag_money_event('wage_payments', 'd2000000-0000-4000-8000-000000000446',
    'amount_mismatch', 'ยอดสลิปไม่ตรง')
$$, 'flag creates the review + an open reviewer flag');
select throws_ok($$
  select public.flag_money_event('wage_payments', 'd2000000-0000-4000-8000-000000000446',
    'changed_after_verified', 'x')
$$, '22023', null, 'changed_after_verified is system-reserved');
select throws_ok($$
  select public.flag_money_event('wage_payments', 'd2000000-0000-4000-8000-000000000446',
    'other', null)
$$, '22023', null, 'an OTHER flag without detail is refused');
select throws_ok($$
  select public.verify_money_event('wage_payments', 'd2000000-0000-4000-8000-000000000446')
$$, 'P0001', 'verify_money_event: resolve open flags first',
  'verify refuses while an open flag exists');
reset role;

select is((select status from public.money_event_reviews
           where source_table = 'wage_payments'
             and source_id = 'd2000000-0000-4000-8000-000000000446'),
  'flagged'::public.money_review_status, 'a flagged review reads flagged');
select results_eq($$
  select f.flag_type::text, f.raised_by_kind::text, f.status::text, (f.flagged_by is not null)
    from public.money_review_flags f
    join public.money_event_reviews r on r.id = f.review_id
   where r.source_table = 'wage_payments' and r.source_id = 'd2000000-0000-4000-8000-000000000446'
$$, $$ values ('amount_mismatch'::text, 'reviewer'::text, 'open'::text, true) $$,
  'the flag is open, reviewer-raised, attributed');

-- ============================================================================
-- D. Resolve / dismiss + recompute (two flags: flagged until the LAST closes).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000446"}';
select lives_ok($$
  select public.flag_money_event('wage_payments', 'd3000000-0000-4000-8000-000000000446',
    'missing_doc', null)
$$, 'first flag on W3');
select lives_ok($$
  select public.flag_money_event('wage_payments', 'd3000000-0000-4000-8000-000000000446',
    'wrong_vendor', 'ชื่อผู้ขายไม่ตรง')
$$, 'second flag on W3');
reset role;

-- Flag ids captured as OWNER (the sealed tables refuse an authenticated read),
-- granted like _tap_buf so the role-switched action bodies can address them.
create temp table _ra446_flags as
  select f.id, f.flag_type::text as ft
    from public.money_review_flags f
    join public.money_event_reviews r on r.id = f.review_id
   where r.source_id = 'd3000000-0000-4000-8000-000000000446';
grant select on _ra446_flags to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000446"}';
select lives_ok($$
  select public.resolve_money_flag(
    (select id from _ra446_flags where ft = 'missing_doc'), 'แนบสลิปแล้ว')
$$, 'resolve the first flag');
reset role;

select is((select status from public.money_event_reviews
           where source_table = 'wage_payments'
             and source_id = 'd3000000-0000-4000-8000-000000000446'),
  'flagged'::public.money_review_status, 'one open flag remains ⇒ still flagged');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000446"}';
select lives_ok($$
  select public.dismiss_money_flag(
    (select id from _ra446_flags where ft = 'wrong_vendor'), 'ตรวจแล้วถูกต้อง')
$$, 'dismiss the second flag');
select throws_ok($$
  select public.resolve_money_flag(
    (select id from _ra446_flags where ft = 'missing_doc'), 'ซ้ำ')
$$, 'P0001', null, 'a closed flag cannot be resolved again');
reset role;

select is((select status from public.money_event_reviews
           where source_table = 'wage_payments'
             and source_id = 'd3000000-0000-4000-8000-000000000446'),
  'pending'::public.money_review_status,
  'no open flags ⇒ pending (never silently back to verified)');
select is((select count(*) from public.money_review_flags f
            join public.money_event_reviews r on r.id = f.review_id
           where r.source_id = 'd3000000-0000-4000-8000-000000000446'
             and f.resolved_by is null and f.status in ('resolved', 'dismissed')),
  0::bigint, 'every closed flag carries resolved_by');

-- ============================================================================
-- E. The single-row read path: list RPC with source filters + tab 'any'.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000446"}';
select is((select count(*) from public.list_money_events_for_review(
             'any', null, null, 50, 0, 'wage_payments', 'd2000000-0000-4000-8000-000000000446')),
  1::bigint, 'source filters + tab any return exactly the addressed row');
select is((select review_status::text from public.list_money_events_for_review(
             'any', null, null, 50, 0, 'wage_payments', 'd2000000-0000-4000-8000-000000000446')),
  'flagged', 'the addressed row carries its review status regardless of tab');
reset role;

-- ============================================================================
-- F. Audit trail — one row per action, action='other' + payload event (owner
--    reads; scoped to fixture target ids).
-- ============================================================================
select is((select count(*) from public.audit_log
           where action = 'other' and payload->>'event' = 'money_review_verified'
             and target_id = 'd1000000-0000-4000-8000-000000000446'),
  1::bigint, 'verify audited');
select is((select count(*) from public.audit_log
           where action = 'other' and payload->>'event' = 'money_review_flag_raised'
             and target_id = 'd3000000-0000-4000-8000-000000000446'),
  2::bigint, 'both flags audited');
select is((select count(*) from public.audit_log
           where action = 'other' and payload->>'event' = 'money_review_flag_resolved'
             and target_id = 'd3000000-0000-4000-8000-000000000446'),
  1::bigint, 'resolve audited');
select is((select count(*) from public.audit_log
           where action = 'other' and payload->>'event' = 'money_review_flag_dismissed'
             and target_id = 'd3000000-0000-4000-8000-000000000446'),
  1::bigint, 'dismiss audited');

select * from finish();
rollback;
