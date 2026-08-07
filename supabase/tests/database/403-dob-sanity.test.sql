begin;
select plan(27);

-- ============================================================================
-- Spec 403 U1 — the DOB sanity gate. Operator ruling 2026-08-07: hard block
--   under 15. Two live wrong-year classes motivated it — a Buddhist-era year
--   typed into a CE field (a real row carried 2513-03-11, i.e. 487 years in the
--   future) and the date picker's own submit date (a pending identity request
--   carried its own created_at as a DOB, age 0).
--
-- Enforced by a TRIGGER per table rather than inside the six DOB-writing RPCs:
--   a trigger cannot be bypassed by a seventh writer, and the diff does not
--   reproduce six function bodies. dob_rejection_reason is the pure SSOT — it
--   returns the REASON, so each caller can name the actual cause instead of a
--   generic refusal (the honest-copy rule).
--
-- The BE arm is checked BEFORE the future arm on purpose: 2513-03-11 satisfies
--   both, and "the future" would be true, useless, and would never teach the
--   user to subtract 543.
--
-- An UPDATE that does not CHANGE the DOB is not validated, so the legacy bad
--   row stays editable for every other reason (the gate is not retroactive).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110403', 'super@dob.local', '{}'::jsonb);
update public.users set role = 'super_admin'
  where id = '11111111-1111-1111-1111-111111110403';

-- ---------------------------------------------------------------------------
-- A. Catalogue + posture
-- ---------------------------------------------------------------------------
select has_function('public', 'dob_rejection_reason', array['date'],
  'dob_rejection_reason(date) exists');
select has_function('public', 'assert_valid_dob_trigger', array[]::text[],
  'assert_valid_dob_trigger() exists');
select is(has_function_privilege('anon', 'public.dob_rejection_reason(date)', 'EXECUTE'),
  false, 'dob_rejection_reason is not executable by anon');

-- ---------------------------------------------------------------------------
-- B. The pure arms. Each returns the REASON, null meaning acceptable.
-- ---------------------------------------------------------------------------
select is(public.dob_rejection_reason(null), null,
  'a null DOB is acceptable — every DOB column is nullable and forcing a value is how wrong ones arrive');
select is(public.dob_rejection_reason(date '2513-03-11'), 'dob looks like a buddhist era year',
  'a Buddhist-era year is named as such, NOT as a future date');
select is(public.dob_rejection_reason(date '2469-01-01'), 'dob looks like a buddhist era year',
  'a BE year that is NOT in the future is still caught by the year test');
select is(public.dob_rejection_reason(current_date + 1), 'dob in the future',
  'tomorrow is refused as a future date');
select is(public.dob_rejection_reason(current_date), 'dob under minimum age',
  'today — the date picker default that produced the live age-0 request — is refused as under-age');
select is(public.dob_rejection_reason((current_date - interval '15 years')::date), null,
  'exactly 15 years old is ACCEPTED — the floor is under-15, not under-or-equal');
select is(public.dob_rejection_reason((current_date - interval '15 years')::date + 1),
  'dob under minimum age',
  'one day short of 15 is refused');
select is(public.dob_rejection_reason((current_date - interval '30 years')::date), null,
  'an ordinary adult DOB is accepted');
select is(public.dob_rejection_reason((current_date - interval '120 years')::date), null,
  'exactly 120 years old is accepted — the ceiling is over-120');
select is(public.dob_rejection_reason((current_date - interval '120 years')::date - 1),
  'dob implausibly old',
  'a year-typo in the other direction is refused');

-- ---------------------------------------------------------------------------
-- C. The trigger is installed on every table holding a DOB.
-- ---------------------------------------------------------------------------
select has_trigger('public', 'workers', 'workers_dob_valid',
  'workers carries the DOB trigger');
select has_trigger('public', 'staff_registrations', 'staff_registrations_dob_valid',
  'staff_registrations carries the DOB trigger');
select has_trigger('public', 'crew_registrations', 'crew_registrations_dob_valid',
  'crew_registrations carries the DOB trigger');
select has_trigger('public', 'contractors', 'contractors_dob_valid',
  'contractors carries the DOB trigger');
select has_trigger('public', 'identity_change_requests', 'identity_change_requests_dob_valid',
  'identity_change_requests carries the DOB trigger (proposed_dob, the pre-approval store)');

-- ---------------------------------------------------------------------------
-- D. Behaviour on workers — the table decide_identity_change writes into.
-- ---------------------------------------------------------------------------
select throws_ok($$
  insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, date_of_birth)
  values ('d0030403-0403-0403-0403-d0d0d0d00403', 'เด็ก', 'daily', 'permanent', 0, true,
          '11111111-1111-1111-1111-111111110403', current_date)
$$, 'P0001', null, 'an under-15 worker cannot be inserted');

select throws_ok($$
  insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, date_of_birth)
  values ('d0040403-0403-0403-0403-d0d0d0d00403', 'พ.ศ.', 'daily', 'permanent', 0, true,
          '11111111-1111-1111-1111-111111110403', date '2513-03-11')
$$, 'P0001', null, 'a Buddhist-era year cannot be inserted');

select lives_ok($$
  insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, date_of_birth)
  values ('d0010403-0403-0403-0403-d0d0d0d00403', 'ผู้ใหญ่', 'daily', 'permanent', 0, true,
          '11111111-1111-1111-1111-111111110403', (current_date - interval '30 years')::date)
$$, 'a valid DOB inserts');

select lives_ok($$
  insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by)
  values ('d0020403-0403-0403-0403-d0d0d0d00403', 'ไม่ทราบวันเกิด', 'daily', 'permanent', 0, true,
          '11111111-1111-1111-1111-111111110403')
$$, 'a worker with no DOB at all still inserts');

select throws_ok($$
  update public.workers set date_of_birth = current_date
   where id = 'd0010403-0403-0403-0403-d0d0d0d00403'
$$, 'P0001', null, 'an existing worker cannot be UPDATED to an under-age DOB');

-- The legacy row: a bad DOB that predates the gate must not freeze the record.
alter table public.workers disable trigger workers_dob_valid;
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, date_of_birth)
values ('d0e50403-0403-0403-0403-d0d0d0d00403', 'แถวเก่า', 'daily', 'permanent', 0, true,
        '11111111-1111-1111-1111-111111110403', date '2513-03-11');
alter table public.workers enable trigger workers_dob_valid;

select lives_ok($$
  update public.workers set name = 'แถวเก่า แก้ชื่อ'
   where id = 'd0e50403-0403-0403-0403-d0d0d0d00403'
$$, 'a legacy row carrying a bad DOB is still editable for OTHER reasons — the gate is not retroactive');

select throws_ok($$
  update public.workers set date_of_birth = date '2469-01-01'
   where id = 'd0e50403-0403-0403-0403-d0d0d0d00403'
$$, 'P0001', null, 'but CHANGING a legacy row''s DOB to another bad value is refused');

-- ---------------------------------------------------------------------------
-- E. Behaviour on identity_change_requests — the pre-approval store. Blocking
--    here is what stops the age-0 request class at the source; blocking on
--    workers is what stops an ALREADY-pending one at approve time.
-- ---------------------------------------------------------------------------
select throws_ok($$
  insert into public.identity_change_requests (user_id, proposed_dob)
  values ('11111111-1111-1111-1111-111111110403', current_date)
$$, 'P0001', null, 'a proposed DOB of today cannot even be requested');

select lives_ok($$
  insert into public.identity_change_requests (user_id, proposed_dob)
  values ('11111111-1111-1111-1111-111111110403', (current_date - interval '30 years')::date)
$$, 'a valid proposed DOB is requested normally');

select * from finish();
rollback;
