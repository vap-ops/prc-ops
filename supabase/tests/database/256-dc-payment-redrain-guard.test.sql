begin;
select plan(9);

-- ============================================================================
-- Re-drain guard on post_dc_payment_to_gl — twin of the spec 249 U1c receipt
-- guard (20260813064200). Flaw: after R2 supersedes R1 and R2's drain reverses
-- R1's entry, re-running R1's outbox job found no un-reversed entry to reverse
-- (the not-exists filter skips reversed ones) and re-posted R1 UNPAIRED. The
-- guard: a row any newer row supersedes is non-current — post nothing for it.
-- Fixtures as owner, mirroring 84-drain-gl-posting.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110656', 'pm@dcredrain.local', '{}'::jsonb);
-- ADR 0062: a DC payment keys on the worker (the payee).
insert into public.workers (id, name, worker_type, day_rate, active, created_by) values
  ('aa000001-0000-4000-8000-000000000656', 'Re-drain DC', 'dc', 200.00, true,
   '11111111-1111-1111-1111-111111110656');

-- R1: a paid DC payment -> the outbox trigger enqueues its posting job.
insert into public.dc_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by)
values
  ('d1000001-0000-4000-8000-000000000656', 'aa000001-0000-4000-8000-000000000656',
   date '2026-06-01', date '2026-06-15', 1000, 5, 1000, date '2026-06-16', 'cash',
   '11111111-1111-1111-1111-111111110656');

-- 1. The insert enqueued a pending GL job.
select ok(
  exists (select 1 from public.gl_posting_outbox
    where source_table = 'dc_payments'
      and source_id = 'd1000001-0000-4000-8000-000000000656' and status = 'pending'),
  'R1 insert enqueued a pending GL posting job');

-- 2-3. FIRST DRAIN: R1 posts (Dr 2110 / Cr 1110).
select ok((select public.drain_gl_posting(200) >= 1), 'first drain posts R1');
select is(
  (select count(*)::int from public.journal_entries e
    where e.source_table = 'dc_payments'
      and e.source_id = 'd1000001-0000-4000-8000-000000000656'
      and e.source_event = 'dc_payment' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  1, 'R1 has exactly one posted-unreversed entry after the first drain');

-- R2 supersedes R1 (amount correction) -> its own job enqueues.
insert into public.dc_payments
  (id, worker_id, period_from, period_to, computed_amount, computed_days,
   paid_amount, paid_at, method, paid_by, superseded_by, correction_reason)
values
  ('d2000002-0000-4000-8000-000000000656', 'aa000001-0000-4000-8000-000000000656',
   date '2026-06-01', date '2026-06-15', 1000, 5, 1200, date '2026-06-16', 'cash',
   '11111111-1111-1111-1111-111111110656', 'd1000001-0000-4000-8000-000000000656',
   'wrong amount');

-- 4-6. SECOND DRAIN: R2's posting reverses R1's entry and posts R2.
select ok((select public.drain_gl_posting(200) >= 1), 'second drain processes the supersede');
select is(
  (select count(*)::int from public.journal_entries e
    where e.source_table = 'dc_payments'
      and e.source_id = 'd1000001-0000-4000-8000-000000000656'
      and e.source_event = 'dc_payment' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  0, 'R1''s entry is reversed once R2 posts');
select is(
  (select count(*)::int from public.journal_entries e
    where e.source_table = 'dc_payments'
      and e.source_id = 'd2000002-0000-4000-8000-000000000656'
      and e.source_event = 'dc_payment' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  1, 'R2 has exactly one posted-unreversed entry');

-- 7-9. RE-DRAIN ATTACK: reset R1's job to pending and drain again — the guard
-- must NOT re-post the superseded row, and R2's entry stays untouched.
update public.gl_posting_outbox set status = 'pending'
 where source_table = 'dc_payments'
   and source_id = 'd1000001-0000-4000-8000-000000000656';
select ok((select public.drain_gl_posting(200) >= 0), 'third drain (re-drain attack) runs');
select is(
  (select count(*)::int from public.journal_entries e
    where e.source_table = 'dc_payments'
      and e.source_id = 'd1000001-0000-4000-8000-000000000656'
      and e.source_event = 'dc_payment' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  0, 're-drain guard: a superseded DC payment never re-posts (no unpaired entry)');
select is(
  (select count(*)::int from public.journal_entries e
    where e.source_table = 'dc_payments'
      and e.source_id = 'd2000002-0000-4000-8000-000000000656'
      and e.source_event = 'dc_payment' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  1, 'the successor''s entry is unaffected by the re-drain attack');

select * from finish();
rollback;
