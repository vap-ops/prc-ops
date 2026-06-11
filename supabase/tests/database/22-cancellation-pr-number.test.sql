begin;
select plan(15);

-- ============================================================================
-- Spec 27 / ADR 0031 — cancellation (approved-stage, decider-only) +
-- PR running number (sequence-fed, backfilled chronologically).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-11111111bbbb', 'super@cpn-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-22222222bbbb', 'sa@cpn-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-33333333bbbb', 'pm@cpn-test.local',    '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-11111111bbbb';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-22222222bbbb';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-33333333bbbb';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-ccccccccbbbb', 'PRC-TEST-CPN', 'CPN fixture project');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeebbbb',
   'cccccccc-cccc-cccc-cccc-ccccccccbbbb', 'WP-CPN-1', 'CPN fixture WP');

-- q1: approved (the cancel fixture). q2: requested (two-layer guard).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at)
values
  ('b1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeebbbb',
   'Cement', 10, 'bag', '22222222-2222-2222-2222-22222222bbbb', 'approved',
   '33333333-3333-3333-3333-33333333bbbb', now()),
  ('b2000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeebbbb',
   'Sand', 2, 'truck', '22222222-2222-2222-2222-22222222bbbb', 'requested',
   null, null);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog.
-- ============================================================================

select has_column('public', 'purchase_requests', 'cancelled_at', 'cancelled_at exists');
select has_column('public', 'purchase_requests', 'cancelled_by', 'cancelled_by exists');
select has_column('public', 'purchase_requests', 'cancellation_reason', 'cancellation_reason exists');
select has_column('public', 'purchase_requests', 'pr_number', 'pr_number exists');
select col_not_null('public', 'purchase_requests', 'pr_number', 'pr_number is NOT NULL');

-- CHECK: a cancelled row must carry cancelled_at.
select throws_ok(
  $$ update public.purchase_requests
       set status = 'cancelled'
     where id = 'b1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '23514', null, 'cancelled without cancelled_at violates pr_cancel_shape');

-- pr_number backfill: every row numbered, unique, chronological order.
select is(
  (select count(*)::int from public.purchase_requests where pr_number is null),
  0, 'every row carries a pr_number (backfill complete)');
select ok(
  (select not exists (
     select 1
     from public.purchase_requests a
     join public.purchase_requests b
       on a.requested_at < b.requested_at and a.pr_number > b.pr_number)),
  'pr_number ordering is monotonic over requested_at (chronological backfill)');

-- New INSERTs draw from the sequence above the backfill.
select ok(
  (select pr_number > 0 from public.purchase_requests
     where id = 'b1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'fixture rows drew sequence-fed pr_numbers');

-- ============================================================================
-- C. Cancel paths (role-sim).
-- ============================================================================

set local role authenticated;

-- C.1 PM cancels the approved row — the decide-pattern two-layer guard.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333bbbb"}';
select lives_ok(
  $$ update public.purchase_requests
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = '33333333-3333-3333-3333-33333333bbbb'
     where id = 'b1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
       and status = 'approved' $$,
  'PM cancel of an approved row lives');

-- C.2 SA has no UPDATE policy — the same statement affects 0 rows on the
--     requested fixture (RLS filters silently; status must be unchanged).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222bbbb"}';
select lives_ok(
  $$ update public.purchase_requests
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = '22222222-2222-2222-2222-22222222bbbb'
     where id = 'b2000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'SA cancel statement runs (RLS silently filters to 0 rows)');

reset role;

select is(
  (select status::text from public.purchase_requests
     where id = 'b1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'cancelled', 'PM cancel flipped approved→cancelled');
select is(
  (select status::text from public.purchase_requests
     where id = 'b2000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'requested', 'SA cancel affected 0 rows — requested fixture unchanged (no SA write path)');

-- ============================================================================
-- D. Audit.
-- ============================================================================

select is(
  (select count(*)::int from public.audit_log
     where action = 'update'
       and target_table = 'purchase_requests'
       and target_id = 'b1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
       and payload->'transition' = '["approved", "cancelled"]'::jsonb),
  1, 'exactly one cancellation audit row with the transition payload');

select is(
  (select payload->>'cancelled_by' from public.audit_log
     where target_id = 'b1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
       and payload->'transition' = '["approved", "cancelled"]'::jsonb),
  '33333333-3333-3333-3333-33333333bbbb',
  'cancellation audit payload carries cancelled_by');

select * from finish();
rollback;
