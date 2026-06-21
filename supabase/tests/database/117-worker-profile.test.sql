begin;
select plan(17);

-- ============================================================================
-- Spec 170 / ADR 0062 U4b — DC worker portal profile (person-relevant fields).
-- A DC is a worker, so their portal profile lives on the worker: contact
-- (phone/email), emergency contact (name/relation/phone), date of birth — added
-- here; tax_id stays PM-entered (read-only to the owner). Pins: the new columns;
-- get_my_worker_profile() (owner reads their own PII past the zero-grant columns);
-- update_own_worker_profile() (self-scoped + column-scoped — writes only the six
-- editable fields, never name/day_rate/tax_id; refuses an unbound caller).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111114171', 'pm@wprof.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333334171', 'dc@wprof.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444171', 'un@wprof.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111114171';
update public.users set role = 'contractor'      where id = '33333333-3333-3333-3333-333333334171';
-- 44.. stays visitor (unbound).

-- A DC worker bound to the portal user 33.. (workers.user_id), seeded with a
-- name, rate and tax_id so the column-scope assertions can prove they're untouched.
insert into public.workers (id, name, worker_type, day_rate, active, created_by, dc_arrangement,
                            tax_id, bank_name, bank_account_number, bank_account_name, user_id) values
  ('aa000001-0000-4000-8000-000000004171', 'DC A', 'dc', 400.00, true,
   '11111111-1111-1111-1111-111111114171', 'regular', 'TAX-A',
   'KBank', '123-4-56789-0', 'DC A', '33333333-3333-3333-3333-333333334171');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_function('public', 'get_my_worker_profile', 'get_my_worker_profile exists');
select has_function('public', 'update_own_worker_profile', 'update_own_worker_profile exists');
select has_column('public', 'workers', 'email', 'workers.email added');
select has_column('public', 'workers', 'emergency_contact_name', 'workers.emergency_contact_name added');
select has_column('public', 'workers', 'date_of_birth', 'workers.date_of_birth added');

-- ============================================================================
-- B. get_my_worker_profile — owner reads their own profile.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333334171"}';
select is((select count(*) from public.get_my_worker_profile()),
  1::bigint, 'bound DC reads exactly their own profile row');
select is((select name from public.get_my_worker_profile()),
  'DC A', 'the profile is the caller''s worker (DC A)');
-- U4c-1: the owner reads their own bank (display) past the zero-grant columns.
select is((select bank_name from public.get_my_worker_profile()),
  'KBank', 'get_my_worker_profile returns the worker''s bank name');
select is((select bank_account_number from public.get_my_worker_profile()),
  '123-4-56789-0', 'get_my_worker_profile returns the worker''s bank account number');

-- ============================================================================
-- C. update_own_worker_profile — self + column scoped.
-- ============================================================================
select lives_ok(
  $$ select public.update_own_worker_profile('0812345678', 'dca@line.local',
       'Mère', 'แม่', '0899999999', date '1990-05-01') $$,
  'bound DC updates their own profile');

reset role;
select is((select phone from public.workers where id = 'aa000001-0000-4000-8000-000000004171'),
  '0812345678', 'phone updated');
select is((select email from public.workers where id = 'aa000001-0000-4000-8000-000000004171'),
  'dca@line.local', 'email updated');
select is((select emergency_contact_name from public.workers where id = 'aa000001-0000-4000-8000-000000004171'),
  'Mère', 'emergency contact name updated');
select is((select date_of_birth from public.workers where id = 'aa000001-0000-4000-8000-000000004171'),
  date '1990-05-01', 'date of birth updated');
-- Column scope: name / day_rate / tax_id are NOT writable through this RPC.
select is((select name from public.workers where id = 'aa000001-0000-4000-8000-000000004171'),
  'DC A', 'name is untouched (column scope)');
select is((select day_rate from public.workers where id = 'aa000001-0000-4000-8000-000000004171'),
  400.00, 'day_rate is untouched (column scope)');
select is((select tax_id from public.workers where id = 'aa000001-0000-4000-8000-000000004171'),
  'TAX-A', 'tax_id is untouched (PM-entered, column scope)');

-- ============================================================================
-- D. An unbound caller is refused / sees nothing.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444171"}';
select throws_ok(
  $$ select public.update_own_worker_profile('x', null, null, null, null, null) $$,
  '42501', null, 'an unbound caller cannot update a worker profile');
select is((select count(*) from public.get_my_worker_profile()),
  0::bigint, 'an unbound caller reads zero profile rows');

reset role;
select * from finish();
rollback;
