begin;
select plan(13);

-- ============================================================================
-- Spec 317 U1 — universal profile self-service, instant tier.
--
--  * NEW update_own_staff_contact(p_phone, p_emergency_contact_name,
--    p_emergency_contact_relation, p_emergency_contact_phone): an APPROVED (or
--    still-pending) staff member edits their own CONTACT fields — the office-staff
--    hole (update_own_staff_registration froze at approval). Name / DOB /
--    role-hint stay out of reach (identity tier -> spec 317 U3 approval flow).
--    Coalesce-keep semantics (blank = keep), mirroring its sibling RPC on the
--    same table.
--  * update_own_worker_profile re-signatured 6 -> 5 args: p_dob DROPPED — DOB
--    moves to the approved tier (operator decision 2026-07-14).
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000317-0000-4000-8000-000000000317', 's-approved@t317.local', '{}'::jsonb),
  ('a2000317-0000-4000-8000-000000000317', 's-rejected@t317.local', '{}'::jsonb),
  ('a3000317-0000-4000-8000-000000000317', 'no-reg@t317.local',     '{}'::jsonb),
  ('a4000317-0000-4000-8000-000000000317', 'worker@t317.local',     '{}'::jsonb),
  ('b1000317-0000-4000-8000-000000000317', 'pm@t317.local',         '{}'::jsonb);
update public.users set role = 'accounting'      where id = 'a1000317-0000-4000-8000-000000000317';
update public.users set role = 'technician'      where id = 'a4000317-0000-4000-8000-000000000317';
update public.users set role = 'project_manager' where id = 'b1000317-0000-4000-8000-000000000317';

insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('e1000317-0000-4000-8000-000000000317', 'a1000317-0000-4000-8000-000000000317',
   'PRC-17-0001', 'บัญชี อนุมัติแล้ว', '0817000001', 'approved'),
  ('e2000317-0000-4000-8000-000000000317', 'a2000317-0000-4000-8000-000000000317',
   'PRC-17-0002', 'ปฏิเสธ ทดสอบ', '0817000002', 'rejected');

insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, date_of_birth, created_by) values
  ('aa000317-0000-4000-8000-000000000317', 'ช่าง ทดสอบ', 'daily', 'temporary', 500,
   'a4000317-0000-4000-8000-000000000317', '1990-01-15',
   'b1000317-0000-4000-8000-000000000317');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Structure.
-- ============================================================================
select has_function('public', 'update_own_staff_contact', array['text','text','text','text'],
  'update_own_staff_contact(text,text,text,text) exists');

-- ============================================================================
-- Approved staff edit own contact fields.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000317-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.update_own_staff_contact('0899999917', 'พี่ ฉุกเฉิน', 'พี่สาว', '0888888817') $$,
  'approved staff updates own contact fields');
reset role;

select is(
  (select phone from public.staff_registrations
    where id = 'e1000317-0000-4000-8000-000000000317'),
  '0899999917', 'phone applied');
select is(
  (select emergency_contact_name || '|' || emergency_contact_relation || '|' || emergency_contact_phone
     from public.staff_registrations
    where id = 'e1000317-0000-4000-8000-000000000317'),
  'พี่ ฉุกเฉิน|พี่สาว|0888888817', 'emergency contact applied');
select is(
  (select full_name from public.staff_registrations
    where id = 'e1000317-0000-4000-8000-000000000317'),
  'บัญชี อนุมัติแล้ว', 'legal name untouched (identity tier, not reachable here)');

-- ============================================================================
-- Refusals.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000317-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.update_own_staff_contact('0800000000', null, null, null) $$,
  'P0001', null, 'rejected registration cannot edit contact');
set local "request.jwt.claims" = '{"sub": "a3000317-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.update_own_staff_contact('0800000000', null, null, null) $$,
  'P0001', null, 'caller without a registration is refused');
reset role;

select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'update_own_staff_contact'
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on update_own_staff_contact');

-- ============================================================================
-- Worker instant tier loses DOB (6-arg signature retired).
-- ============================================================================
select throws_ok(
  $$ select public.update_own_worker_profile('0811111111', 'a@b.c', 'x', 'y', 'z', '1991-02-02'::date) $$,
  '42883', null, 'the 6-arg (with-DOB) worker profile signature is dropped');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a4000317-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.update_own_worker_profile('0811111111', 'a@b.c', 'ฉุกเฉิน', 'พ่อ', '0822222222') $$,
  'bound worker updates contact via the 5-arg signature');
reset role;

select is(
  (select phone from public.workers where id = 'aa000317-0000-4000-8000-000000000317'),
  '0811111111', 'worker phone applied');
select is(
  (select date_of_birth from public.workers where id = 'aa000317-0000-4000-8000-000000000317'),
  '1990-01-15'::date, 'worker DOB untouched — no longer self-editable');
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'update_own_worker_profile'
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on the re-signatured worker profile RPC');

select * from finish();
rollback;
