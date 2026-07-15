begin;
select plan(34);

-- ============================================================================
-- Spec 320 U1 — worker_payout_nominee: a PM-managed, TEMPORARY payout override
-- routing a bankless worker's wage to a friend/family account, with a signed-
-- consent photo as discharge evidence. Manual, procurement_manager-only, no
-- approval flow. Append-history (new active row per nominee; clearing flips the
-- active row to cleared). Zero-grant bank PII; reads via DEFINER RPCs only.
-- Consent photo lands in a new PM-scoped nominee-consent/<worker_id>/ path.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('b2220000-0000-4000-8000-000000000320', 'pmgr@t320.local', '{}'::jsonb),
  ('55550000-0000-4000-8000-000000000320', 'sa@t320.local',   '{}'::jsonb);
update public.users set role = 'procurement_manager' where id = 'b2220000-0000-4000-8000-000000000320';
update public.users set role = 'site_admin'          where id = '55550000-0000-4000-8000-000000000320';

-- Two bankless workers (W is the subject; W2 supplies a foreign worker-id for the
-- wrong-folder path test). user_id null (no login needed); created_by = PM.
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, created_by) values
  ('a1110000-0000-4000-8000-000000000320', 'ช่าง ไร้บัญชี', 'daily', 'temporary', 500,
   null, 'b2220000-0000-4000-8000-000000000320'),
  ('a2220000-0000-4000-8000-000000000320', 'ช่าง อีกคน', 'daily', 'temporary', 500,
   null, 'b2220000-0000-4000-8000-000000000320');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Objects exist.
-- ============================================================================
select has_table('public', 'worker_payout_nominee', 'worker_payout_nominee exists');
select has_function('public', 'set_worker_payout_nominee', 'set_worker_payout_nominee exists');
select has_function('public', 'clear_worker_payout_nominee', 'clear_worker_payout_nominee exists');
select has_function('public', 'get_worker_payout_nominee', 'get_worker_payout_nominee exists');
select has_function('public', 'list_active_payout_nominees', 'list_active_payout_nominees exists');
select ok((select relrowsecurity from pg_class where oid = 'public.worker_payout_nominee'::regclass),
  'RLS enabled on worker_payout_nominee');

-- ============================================================================
-- Zero-grant wall + PM-only gate (a non-PM site_admin is refused everywhere).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55550000-0000-4000-8000-000000000320"}';
select throws_ok(
  $$ select 1 from public.worker_payout_nominee $$,
  '42501', null, 'worker_payout_nominee is unreadable by authenticated (zero-grant, DEFINER-only)');
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', 'กสิกรไทย',
       '9998887776', 'สมชาย ใจดี', 'nominee-consent/a1110000-0000-4000-8000-000000000320/c1.jpg') $$,
  '42501', null, 'a non-PM (site_admin) cannot set a nominee');
select throws_ok(
  $$ select public.clear_worker_payout_nominee('a1110000-0000-4000-8000-000000000320') $$,
  '42501', null, 'a non-PM cannot clear a nominee');
select throws_ok(
  $$ select * from public.get_worker_payout_nominee('a1110000-0000-4000-8000-000000000320') $$,
  '42501', null, 'a non-PM cannot get a nominee');
select throws_ok(
  $$ select * from public.list_active_payout_nominees() $$,
  '42501', null, 'a non-PM cannot list nominees');
reset role;

-- ============================================================================
-- Set floors (as procurement_manager).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000320"}';
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', '', 'พี่ชาย', 'กสิกรไทย',
       '9998887776', 'สมชาย ใจดี', 'nominee-consent/a1110000-0000-4000-8000-000000000320/c1.jpg') $$,
  'P0001', null, 'an empty payee name is refused');
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', '',
       '9998887776', 'สมชาย ใจดี', 'nominee-consent/a1110000-0000-4000-8000-000000000320/c1.jpg') $$,
  'P0001', null, 'an empty payee bank name is refused');
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', 'กสิกรไทย',
       '9998887776', '', 'nominee-consent/a1110000-0000-4000-8000-000000000320/c1.jpg') $$,
  'P0001', null, 'an empty payee account name is refused');
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', 'กสิกรไทย',
       '12ab', 'สมชาย ใจดี', 'nominee-consent/a1110000-0000-4000-8000-000000000320/c1.jpg') $$,
  'P0001', null, 'a malformed account number is refused');
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', 'กสิกรไทย',
       '9998887776', 'สมชาย ใจดี', null) $$,
  'P0001', null, 'a missing consent photo is refused (REQUIRED)');
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', 'กสิกรไทย',
       '9998887776', 'สมชาย ใจดี', 'nominee-consent/a2220000-0000-4000-8000-000000000320/x.jpg') $$,
  '42501', null, 'a consent path in another worker''s folder is refused');
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', 'กสิกรไทย',
       '9998887776', 'สมชาย ใจดี', 'nominee-consent/a1110000-0000-4000-8000-000000000320/ghost.jpg') $$,
  'P0001', null, 'a never-uploaded consent path is refused');
select throws_ok(
  $$ select public.set_worker_payout_nominee(
       '99990000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', 'กสิกรไทย',
       '9998887776', 'สมชาย ใจดี', 'nominee-consent/99990000-0000-4000-8000-000000000320/c1.jpg') $$,
  'P0001', null, 'an unknown worker is refused');

-- Real consent object, then the happy path (dashes/spaces normalized to digits).
reset role;
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs', 'nominee-consent/a1110000-0000-4000-8000-000000000320/c1.jpg');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000320"}';
select isnt(
  (select public.set_worker_payout_nominee(
     'a1110000-0000-4000-8000-000000000320', 'พี่ชาย สมชาย', 'พี่ชาย', 'กสิกรไทย',
     '999-888 7776', 'สมชาย ใจดี', 'nominee-consent/a1110000-0000-4000-8000-000000000320/c1.jpg')),
  null, 'the PM sets a nominee for a bankless worker (dashes/spaces ok)');
reset role;

-- One active row, fields correct, account normalized.
select is(
  (select count(*)::int from public.worker_payout_nominee
    where worker_id = 'a1110000-0000-4000-8000-000000000320' and active),
  1, 'exactly one active nominee for the worker');
select is(
  (select payee_account_number from public.worker_payout_nominee
    where worker_id = 'a1110000-0000-4000-8000-000000000320' and active),
  '9998887776', 'the account number is stored normalized');

-- ============================================================================
-- Re-set → one-active invariant (prior row retained + cleared).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000320"}';
select lives_ok(
  $$ select public.set_worker_payout_nominee(
       'a1110000-0000-4000-8000-000000000320', 'ภรรยา สมหญิง', 'คู่สมรส', 'ออมสิน',
       '5556667778', 'สมหญิง ใจงาม', 'nominee-consent/a1110000-0000-4000-8000-000000000320/c1.jpg') $$,
  'the PM replaces the nominee with a new one');
reset role;
select is(
  (select count(*)::int from public.worker_payout_nominee
    where worker_id = 'a1110000-0000-4000-8000-000000000320' and active),
  1, 'still exactly one active nominee after re-set');
select is(
  (select count(*)::int from public.worker_payout_nominee
    where worker_id = 'a1110000-0000-4000-8000-000000000320'),
  2, 'the prior nominee is retained as history (2 rows total)');
select is(
  (select count(*)::int from public.worker_payout_nominee
    where worker_id = 'a1110000-0000-4000-8000-000000000320' and not active and cleared_at is not null),
  1, 'the superseded nominee is stamped cleared_at');

-- ============================================================================
-- Read RPCs (as PM): get = the active nominee; list = the worklist with age.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000320"}';
select is(
  (select payee_name from public.get_worker_payout_nominee('a1110000-0000-4000-8000-000000000320')),
  'ภรรยา สมหญิง', 'get returns the active (latest) nominee');
select is(
  (select count(*)::int from public.list_active_payout_nominees()
    where worker_id = 'a1110000-0000-4000-8000-000000000320'),
  1, 'the worklist lists the worker with an active nominee');
select is(
  (select days_active from public.list_active_payout_nominees()
    where worker_id = 'a1110000-0000-4000-8000-000000000320'),
  0, 'days_active is 0 for a same-day nominee');
reset role;

-- ============================================================================
-- Clear (reclaim) — idempotent; no active row remains; get returns nothing.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000320"}';
select lives_ok(
  $$ select public.clear_worker_payout_nominee('a1110000-0000-4000-8000-000000000320') $$,
  'the PM clears the nominee (worker registered their own account)');
select lives_ok(
  $$ select public.clear_worker_payout_nominee('a1110000-0000-4000-8000-000000000320') $$,
  'clearing again is idempotent (no active row → no error)');
select is(
  (select count(*)::int from public.get_worker_payout_nominee('a1110000-0000-4000-8000-000000000320')),
  0, 'get returns nothing after clear');
reset role;
select is(
  (select count(*)::int from public.worker_payout_nominee
    where worker_id = 'a1110000-0000-4000-8000-000000000320' and active),
  0, 'no active nominee remains after clear');

-- ============================================================================
-- Grants — no PUBLIC/anon EXECUTE on any nominee RPC.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('set_worker_payout_nominee', 'clear_worker_payout_nominee',
                            'get_worker_payout_nominee', 'list_active_payout_nominees')
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on any payout-nominee RPC');

select * from finish();
rollback;
