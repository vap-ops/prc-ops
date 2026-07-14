begin;
select plan(5);

-- ============================================================================
-- Spec 317 U7 — bank_name_usage(): the aggregate feeding the ชื่อธนาคาร picker's
-- usage-frequency order. Returns (bank_name, uses) counted across the three
-- bank homes (workers.bank_name + contact_bank.bank_name +
-- staff_registration_bank.bank_name). Aggregate NAMES + COUNTS only — no
-- account numbers, no holders, no row linkage — so an authenticated grant is
-- safe (the underlying columns stay zero-grant).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000717-0000-4000-8000-000000000317', 'caller@t317u7.local', '{}'::jsonb),
  ('b1000717-0000-4000-8000-000000000317', 'pm@t317u7.local', '{}'::jsonb);

insert into public.workers (id, name, pay_type, employment_type, day_rate, bank_name, created_by) values
  ('aa000717-0000-4000-8000-000000000317', 'ช่าง ก', 'daily', 'temporary', 500, 'กสิกรไทย',
   'b1000717-0000-4000-8000-000000000317'),
  ('ab000717-0000-4000-8000-000000000317', 'ช่าง ข', 'daily', 'temporary', 500, 'กสิกรไทย',
   'b1000717-0000-4000-8000-000000000317'),
  ('ac000717-0000-4000-8000-000000000317', 'ช่าง ค', 'daily', 'temporary', 500, 'ออมสิน',
   'b1000717-0000-4000-8000-000000000317');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select has_function('public', 'bank_name_usage', 'bank_name_usage() exists');

-- Counts visible to a plain authenticated caller (names+counts only).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000717-0000-4000-8000-000000000317"}';
-- Floor asserts: the two fixture rows guarantee ≥2 / ≥1; live rows may add more
-- (expected-side reads of the zero-grant columns are impossible as authenticated —
-- which is itself the wall this aggregate must not breach).
select ok(
  (select uses >= 2 from public.bank_name_usage() where bank_name = 'กสิกรไทย'),
  'กสิกรไทย counted across bank homes (both fixture workers included)');
select ok(
  (select uses >= 1 from public.bank_name_usage() where bank_name = 'ออมสิน'),
  'ออมสิน counted');
reset role;

-- The zero-grant walls stay: the aggregate must NOT open the underlying table.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000717-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select 1 from public.staff_registration_bank $$,
  '42501', null, 'staff_registration_bank stays zero-grant despite the aggregate');
reset role;

select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'bank_name_usage'
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on bank_name_usage');

select * from finish();
rollback;
