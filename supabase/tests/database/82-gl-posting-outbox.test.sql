begin;
select plan(22);

-- ============================================================================
-- Spec 149 U4a / ADR 0057 decision 12 — gl_posting_outbox + enqueue triggers.
-- Pins: catalog (table/PK/status enum/FK) + RLS + zero grant + no policy; the
-- four AFTER-triggers exist and FIRE on the money event (dc_payment / rental_batch
-- / labor_freeze / purchase) and do NOT fire on a non-money purchase; enqueue
-- idempotency (re-fire does not duplicate; a failed job re-queues); anon/auth
-- denied. Fixtures inserted as owner (RLS bypassed; the subledgers are zero-grant).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110602', 'pm@glpost.local', '{}'::jsonb);

insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000602', 'TAP-GL-POST', 'Posting outbox fixture');
insert into public.work_packages (id, project_id, code, name) values
  ('ee000001-0000-4000-8000-000000000602', 'cc000001-0000-4000-8000-000000000602',
   'WP-GLP-1', 'Posting fixture WP');
insert into public.contractors (id, name, created_by) values
  ('dd000001-0000-4000-8000-000000000602', 'GLPost Crew', '11111111-1111-1111-1111-111111110602');
insert into public.equipment_owners (id, name, created_by) values
  ('b0000001-0000-4000-8000-000000000602', 'GLPost Sister Co', '11111111-1111-1111-1111-111111110602');

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_type('public', 'gl_posting_status', 'gl_posting_status enum exists');
select enum_has_labels('public', 'gl_posting_status',
  array['pending', 'posting', 'posted', 'failed', 'skipped'], 'gl_posting_status labels');
select has_table('public', 'gl_posting_outbox', 'gl_posting_outbox exists');
select col_is_pk('public', 'gl_posting_outbox', 'id', 'gl_posting_outbox.id is the PK');
select fk_ok('public', 'gl_posting_outbox', 'journal_entry_id', 'public', 'journal_entries', 'id');
select ok((select relrowsecurity from pg_class where oid = 'public.gl_posting_outbox'::regclass),
  'RLS enabled on gl_posting_outbox');
select is((select count(*) from pg_policies where schemaname='public' and tablename='gl_posting_outbox'),
  0::bigint, 'gl_posting_outbox has no policies (zero access)');
select has_trigger('public', 'purchase_requests', 'purchase_requests_enqueue_gl_posting',
  'purchase_requests enqueue trigger exists');
select has_trigger('public', 'dc_payments', 'dc_payments_enqueue_gl_posting',
  'dc_payments enqueue trigger exists');
select has_trigger('public', 'wp_labor_costs', 'wp_labor_costs_enqueue_gl_posting',
  'wp_labor_costs enqueue trigger exists');
select has_trigger('public', 'equipment_rental_batches', 'equipment_rental_batches_enqueue_gl_posting',
  'equipment_rental_batches enqueue trigger exists');

-- ============================================================================
-- B. Zero grant (authenticated).
-- ============================================================================
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110602"}';
select throws_ok($$ select id from public.gl_posting_outbox limit 1 $$,
  '42501', null, 'authenticated cannot read gl_posting_outbox (zero access)');
reset role;

-- ============================================================================
-- C. Triggers fire on the money event (inserts as owner).
-- ============================================================================
insert into public.equipment_rental_batches (id, owner_id, monthly_rate, starts_on, created_by) values
  ('e0000001-0000-4000-8000-000000000602', 'b0000001-0000-4000-8000-000000000602',
   50000, date '2026-07-01', '11111111-1111-1111-1111-111111110602');
select is((select count(*) from public.gl_posting_outbox where source_event = 'rental_batch'),
  1::bigint, 'a rental batch enqueues one rental_batch job');

insert into public.dc_payments
  (contractor_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method, paid_by)
values
  ('dd000001-0000-4000-8000-000000000602', date '2026-06-01', date '2026-06-15',
   1000, 5, 1000, date '2026-06-16', 'cash', '11111111-1111-1111-1111-111111110602');
select is((select count(*) from public.gl_posting_outbox where source_event = 'dc_payment'),
  1::bigint, 'a dc payment enqueues one dc_payment job');

insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, frozen_by) values
  ('ee000001-0000-4000-8000-000000000602', 700, 300, '11111111-1111-1111-1111-111111110602');
select is((select count(*) from public.gl_posting_outbox where source_event = 'labor_freeze'),
  1::bigint, 'a labor freeze enqueues one labor_freeze job');

-- A purchase that is NOT a money event (approved, no amount) → no enqueue.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status)
values
  ('a1000001-0000-4000-8000-000000000602', 'ee000001-0000-4000-8000-000000000602',
   'cement', 10, 'bag', '11111111-1111-1111-1111-111111110602', 'approved');
select is((select count(*) from public.gl_posting_outbox where source_event = 'purchase'),
  0::bigint, 'an approved purchase with no amount does NOT enqueue');

-- Promote it to a purchased ticket with an amount → the money event fires.
update public.purchase_requests
   set status = 'purchased', amount = 1000
 where id = 'a1000001-0000-4000-8000-000000000602';
select is((select count(*) from public.gl_posting_outbox where source_event = 'purchase'),
  1::bigint, 'a purchased ticket with an amount enqueues one purchase job');

-- ============================================================================
-- D. Idempotency (in-flight-only dedup + money-change WHEN).
-- ============================================================================
-- A money-changing re-fire while a job is still pending → dedup (one live job).
update public.wp_labor_costs set own_cost = 750
 where work_package_id = 'ee000001-0000-4000-8000-000000000602';
select is((select count(*) from public.gl_posting_outbox where source_event = 'labor_freeze'),
  1::bigint, 'a money-change re-fire does not duplicate a live job');

-- A NON-money update (costs unchanged) → the trigger WHEN is false → no enqueue.
update public.wp_labor_costs set computed_at = timestamptz '2026-01-01'
 where work_package_id = 'ee000001-0000-4000-8000-000000000602';
select is((select count(*) from public.gl_posting_outbox where source_event = 'labor_freeze'),
  1::bigint, 'a non-money update does not enqueue (money-change WHEN)');

-- A POSTED job + a money change → re-enqueues (the auto-correct enabler: the
-- correction re-drains and the poster reverse-and-reposts).
update public.gl_posting_outbox set status = 'posted' where source_event = 'labor_freeze';
update public.wp_labor_costs set own_cost = 800
 where work_package_id = 'ee000001-0000-4000-8000-000000000602';
select is((select count(*) from public.gl_posting_outbox where source_event = 'labor_freeze'),
  2::bigint, 'a posted job + money change re-enqueues (auto-correct)');

-- A FAILED job + a money change → re-enqueues (the drainer can retry).
update public.gl_posting_outbox set status = 'failed'
 where source_event = 'labor_freeze' and status = 'pending';
update public.wp_labor_costs set own_cost = 850
 where work_package_id = 'ee000001-0000-4000-8000-000000000602';
select is((select count(*) from public.gl_posting_outbox where source_event = 'labor_freeze'),
  3::bigint, 'a failed job does not block a fresh enqueue');

-- ============================================================================
-- E. Anon denied entirely.
-- ============================================================================
set local role anon;
select throws_ok($$ select id from public.gl_posting_outbox limit 1 $$,
  '42501', null, 'anon cannot read gl_posting_outbox');

reset role;
select * from finish();
rollback;
