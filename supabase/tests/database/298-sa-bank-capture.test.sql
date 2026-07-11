begin;
select plan(22);

-- ============================================================================
-- Spec 298 U1 — SA-assisted onboarding: capture-blind bank for phoneless workers.
--   * worker_bank_capture: zero-grant (service_role only), RLS on, no auth policy.
--   * sa_add_project_worker_with_bank: SA (site_admin|super + can_see_project) adds a
--     phoneless worker (day_rate 0, user_id null) AND a pending_pm capture, atomically;
--     photo path must be under 'sa-bank-capture/'.
--   * sa_worker_bank_status: DEFINER status-only projection (no photo_path leak).
--   * complete_worker_bank: money set (procurement_manager|project_director|super_admin)
--     transcribes -> workers.bank_*, flips status on_file, NEVER touches pay/level.
-- Valid Thai IDs: 3201200000008 · 1101700000001 · 3400000000001.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0298-0298-0298-700000000298', 'sa-mem@s298.local',  '{}'::jsonb),
  ('71000000-0298-0298-0298-710000000298', 'sa-none@s298.local', '{}'::jsonb),
  ('75000000-0298-0298-0298-750000000298', 'super@s298.local',   '{}'::jsonb),
  ('72000000-0298-0298-0298-720000000298', 'visitor@s298.local', '{}'::jsonb),
  ('76000000-0298-0298-0298-760000000298', 'pm@s298.local',      '{}'::jsonb);
update public.users set role = 'site_admin'          where id = '70000000-0298-0298-0298-700000000298';
update public.users set role = 'site_admin'          where id = '71000000-0298-0298-0298-710000000298';
update public.users set role = 'super_admin'         where id = '75000000-0298-0298-0298-750000000298';
update public.users set role = 'procurement_manager' where id = '76000000-0298-0298-0298-760000000298';

insert into public.projects (id, code, name) values
  ('73000000-0298-0298-0298-730000000298', 'TAP-298', 'Spec 298 fixture project');
insert into public.project_members (project_id, user_id, added_by) values
  ('73000000-0298-0298-0298-730000000298', '70000000-0298-0298-0298-700000000298',
   '75000000-0298-0298-0298-750000000298');

-- an existing worker so the national-ID dedup has something to collide with,
-- AND a worker that has NO capture row (for the "complete with no pending capture" case).
insert into public.workers (name, pay_type, employment_type, day_rate, active, created_by, tax_id) values
  ('มีอยู่แล้ว', 'daily', 'temporary', 400, true,
   '75000000-0298-0298-0298-750000000298', '1101700000001');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- worker-id lookups run inside throws_ok/lives_ok bodies while role=authenticated, which
-- has no table grant on the money-scoped public.workers — stash ids in a granted temp table.
create temp table _wid (tax_id text primary key, id uuid);
grant select, insert on _wid to authenticated, anon;
insert into _wid values
  ('1101700000001', (select id from public.workers where tax_id = '1101700000001'));

-- ============================================================================
-- A. Zero-grant wall — an authenticated user cannot read worker_bank_capture.
-- ============================================================================
select throws_ok(
  $$ set local role authenticated; select * from public.worker_bank_capture $$,
  '42501', null, 'worker_bank_capture is zero-grant to authenticated (no direct read)');
reset role;

-- ============================================================================
-- B. sa_add_project_worker_with_bank — gate + atomic worker + pending capture.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0298-0298-0298-700000000298"}';
select ok(
  (select public.sa_add_project_worker_with_bank(
     '73000000-0298-0298-0298-730000000298', 'สมชาย ช่างดี', '3201200000008', '1990-05-01',
     'sa-bank-capture/2026/11111111-1111-1111-1111-111111111111.jpg')) is not null,
  'an SA-member adds a phoneless worker with a walled passbook path');

reset role;
insert into _wid values
  ('3201200000008', (select id from public.workers where tax_id = '3201200000008'));
select ok(
  (select day_rate = 0 and user_id is null and active
     from public.workers where tax_id = '3201200000008'),
  'the added worker is phoneless + active + NO money (day_rate 0)');
select is(
  (select c.status from public.worker_bank_capture c
     join public.workers w on w.id = c.worker_id where w.tax_id = '3201200000008'),
  'pending_pm'::public.worker_bank_capture_status,
  'a pending_pm worker_bank_capture row was written atomically');

-- bad path (not under sa-bank-capture/) is refused, no worker created.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0298-0298-0298-700000000298"}';
select throws_ok(
  $$ select public.sa_add_project_worker_with_bank(
       '73000000-0298-0298-0298-730000000298', 'พาธผิด', '3400000000001', '1990-01-01',
       'technician/70000000-0298-0298-0298-700000000298/book_bank/x.jpg') $$,
  'P0001', null, 'a photo path not under sa-bank-capture/ is refused');
reset role;
select is(
  (select count(*)::int from public.workers where tax_id = '3400000000001'),
  0, 'the refused bad-path add left no orphan worker');

-- non-SA (visitor) is refused at the role gate.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0298-0298-0298-720000000298"}';
select throws_ok(
  $$ select public.sa_add_project_worker_with_bank(
       '73000000-0298-0298-0298-730000000298', 'ผู้เยี่ยม', '3400000000001', '1990-01-01',
       'sa-bank-capture/2026/22222222-2222-2222-2222-222222222222.jpg') $$,
  '42501', null, 'a non-SA is refused (role gate)');

-- duplicate national-ID (already on a worker) is refused.
set local "request.jwt.claims" = '{"sub": "70000000-0298-0298-0298-700000000298"}';
select throws_ok(
  $$ select public.sa_add_project_worker_with_bank(
       '73000000-0298-0298-0298-730000000298', 'ซ้ำ', '1101700000001', '1990-01-01',
       'sa-bank-capture/2026/33333333-3333-3333-3333-333333333333.jpg') $$,
  'P0001', null, 'a national-ID already on a worker is refused (dedup)');
reset role;

-- ============================================================================
-- C. sa_worker_bank_status — status-only projection, no photo_path leak.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0298-0298-0298-700000000298"}';
select is(
  (select count(*)::int from public.sa_worker_bank_status('73000000-0298-0298-0298-730000000298')
     where status = 'pending_pm'),
  1, 'sa_worker_bank_status shows the pending worker for the SA''s project');
reset role;
select ok(
  pg_get_function_result('public.sa_worker_bank_status(uuid)'::regprocedure) not like '%photo_path%',
  'sa_worker_bank_status never exposes photo_path (status-only)');

-- a non-member SA cannot read another project's statuses.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0298-0298-0298-710000000298"}';
select throws_ok(
  $$ select * from public.sa_worker_bank_status('73000000-0298-0298-0298-730000000298') $$,
  '42501', null, 'a non-member SA cannot read the project''s bank statuses');
reset role;

-- ============================================================================
-- D. complete_worker_bank — money-set gate + validation + normalization + pay untouched.
-- ============================================================================
-- a site_admin (not money-authorized) cannot complete.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0298-0298-0298-700000000298"}';
select throws_ok(
  format($$ select public.complete_worker_bank(%L, 'ธ.กรุงเทพ', '1234567', 'สมชาย ช่างดี') $$,
    (select id from _wid where tax_id = '3201200000008')),
  '42501', null, 'a site_admin cannot complete bank (not money-authorized)');
reset role;

-- add a second worker (W2) that stays pending, for the validation/normalization cases.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0298-0298-0298-700000000298"}';
select ok(
  (select public.sa_add_project_worker_with_bank(
     '73000000-0298-0298-0298-730000000298', 'สมหญิง ช่างเก่ง', '3400000000001', '1988-03-03',
     'sa-bank-capture/2026/44444444-4444-4444-4444-444444444444.jpg')) is not null,
  'a second phoneless worker is added (stays pending for the completion cases)');
reset role;
insert into _wid values
  ('3400000000001', (select id from public.workers where tax_id = '3400000000001'));

-- procurement_manager completion: bad account numbers rejected.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "76000000-0298-0298-0298-760000000298"}';
select throws_ok(
  format($$ select public.complete_worker_bank(%L, 'ธ.กรุงเทพ', '12ab', 'สมหญิง ช่างเก่ง') $$,
    (select id from _wid where tax_id = '3400000000001')),
  'P0001', null, 'a non-digit account number is rejected');
select throws_ok(
  format($$ select public.complete_worker_bank(%L, 'ธ.กรุงเทพ', '12345', 'สมหญิง ช่างเก่ง') $$,
    (select id from _wid where tax_id = '3400000000001')),
  'P0001', null, 'a too-short (5-digit) account number is rejected');

-- valid completion with a dashed/spaced number normalizes to digits.
select lives_ok(
  format($$ select public.complete_worker_bank(%L, 'ธนาคารกรุงเทพ', '123-456 789', 'สมหญิง ช่างเก่ง') $$,
    (select id from _wid where tax_id = '3400000000001')),
  'a money-authorized PM completes the bank');
reset role;
select is(
  (select bank_account_number from public.workers where tax_id = '3400000000001'),
  '123456789', 'the account number is stored normalized (spaces/dashes stripped)');
select is(
  (select bank_name from public.workers where tax_id = '3400000000001'),
  'ธนาคารกรุงเทพ', 'the bank name is stored');
select is(
  (select c.status from public.worker_bank_capture c
     join public.workers w on w.id = c.worker_id where w.tax_id = '3400000000001'),
  'on_file'::public.worker_bank_capture_status, 'the capture flips to on_file on completion');
select ok(
  (select day_rate = 0 from public.workers where tax_id = '3400000000001'),
  'completion NEVER touches pay — day_rate stays 0 (ADR 0079)');

-- completing an already-on_file worker is refused (non-pending).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "76000000-0298-0298-0298-760000000298"}';
select throws_ok(
  format($$ select public.complete_worker_bank(%L, 'ธ.ไทยพาณิชย์', '999999', 'x') $$,
    (select id from _wid where tax_id = '3400000000001')),
  'P0001', null, 'completing an already-on_file worker is refused');

-- completing a worker that has NO capture row is refused.
select throws_ok(
  format($$ select public.complete_worker_bank(%L, 'ธ.ไทยพาณิชย์', '999999', 'x') $$,
    (select id from _wid where tax_id = '1101700000001')),
  'P0001', null, 'completing a worker with no pending capture is refused');
reset role;

select * from finish();
rollback;
