begin;
select plan(39);

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
select is(public.dob_today(), (now() at time zone 'Asia/Bangkok')::date,
  'the gate reasons in the BANGKOK civil date — the server is UTC, so current_date would refuse someone on their real 15th birthday for seven hours a day');
select is(public.dob_rejection_reason(null), null,
  'a null DOB is acceptable — every DOB column is nullable and forcing a value is how wrong ones arrive');
select is(public.dob_rejection_reason('infinity'::date), 'dob is not a real date',
  'a non-finite date is named for what it is, not mislabelled as a Buddhist-era year');
select is(public.dob_rejection_reason(date '2513-03-11'), 'dob looks like a buddhist era year',
  'a Buddhist-era year is named as such, NOT as a future date');
select is(public.dob_rejection_reason(date '2469-01-01'), 'dob looks like a buddhist era year',
  'a BE year that is NOT in the future is still caught by the year test');
select is(public.dob_rejection_reason(public.dob_today() + 1), 'dob in the future',
  'tomorrow is refused as a future date');
select is(public.dob_rejection_reason(public.dob_today()), 'dob under minimum age',
  'today — the date picker default that produced the live age-0 request — is refused as under-age');
select is(public.dob_rejection_reason((public.dob_today() - interval '15 years')::date), null,
  'exactly 15 years old is ACCEPTED — the floor is under-15, not under-or-equal');
select is(public.dob_rejection_reason((public.dob_today() - interval '15 years')::date + 1),
  'dob under minimum age',
  'one day short of 15 is refused');
select is(public.dob_rejection_reason((public.dob_today() - interval '30 years')::date), null,
  'an ordinary adult DOB is accepted');
select is(public.dob_rejection_reason((public.dob_today() - interval '120 years')::date), null,
  'exactly 120 years old is accepted — the ceiling is over-120');
select is(public.dob_rejection_reason((public.dob_today() - interval '120 years')::date - 1),
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

-- The guarded columns are all `date`. The trigger reads them through
-- to_jsonb(new)->>col, which is only safe while that stays true — a widening to
-- text or timestamptz would truncate in UTC or raise a raw 22007 with no honest
-- copy, so pin the types rather than leave the assumption unstated.
select col_type_is('public', 'workers', 'date_of_birth', 'date', 'workers.date_of_birth is a date');
select col_type_is('public', 'staff_registrations', 'date_of_birth', 'date',
  'staff_registrations.date_of_birth is a date');
select col_type_is('public', 'crew_registrations', 'date_of_birth', 'date',
  'crew_registrations.date_of_birth is a date');
select col_type_is('public', 'contractors', 'date_of_birth', 'date',
  'contractors.date_of_birth is a date');
select col_type_is('public', 'identity_change_requests', 'proposed_dob', 'date',
  'identity_change_requests.proposed_dob is a date');

-- A mistyped TG_ARGV[0] would otherwise make the trigger a silent no-op: `->>`
-- returns NULL for an absent key and a NULL DOB is acceptable. Without this the
-- three tables below that carry only a has_trigger pin could have their column
-- argument corrupted and nothing would fail.
create temp table dob_argv_probe (id int, date_of_birth date);
create trigger dob_argv_probe_typo before insert on dob_argv_probe
  for each row execute function public.assert_valid_dob_trigger('date_of_brith');
select throws_ok($$ insert into dob_argv_probe values (1, '2513-03-11') $$,
  'P0001', 'dob_argv_probe: assert_valid_dob_trigger is guarding column date_of_brith, which does not exist',
  'a trigger pointed at a column that does not exist FAILS LOUDLY instead of silently guarding nothing');

-- ---------------------------------------------------------------------------
-- D. Behaviour on workers — the table decide_identity_change writes into.
-- ---------------------------------------------------------------------------
-- contractors is the seventh-path table: authenticated holds column-level
-- INSERT+UPDATE on its date_of_birth with permissive RLS and NO rpc guards it,
-- so this trigger is the only thing standing there. It gets a behavioural probe,
-- not just a has_trigger pin.
select throws_ok($$
  insert into public.contractors (name, date_of_birth)
  values ('บริษัททดสอบ 403', public.dob_today())
$$, 'P0001', 'contractors.date_of_birth: dob under minimum age',
  'the contractors trigger refuses a bad DOB on the one table no RPC protects');

select throws_ok($$
  insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, date_of_birth)
  values ('d0030403-0403-0403-0403-d0d0d0d00403', 'เด็ก', 'daily', 'permanent', 0, true,
          '11111111-1111-1111-1111-111111110403', public.dob_today())
$$, 'P0001', 'workers.date_of_birth: dob under minimum age',
  'an under-15 worker cannot be inserted');

select throws_ok($$
  insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, date_of_birth)
  values ('d0040403-0403-0403-0403-d0d0d0d00403', 'พ.ศ.', 'daily', 'permanent', 0, true,
          '11111111-1111-1111-1111-111111110403', date '2513-03-11')
$$, 'P0001', 'workers.date_of_birth: dob looks like a buddhist era year',
  'a Buddhist-era year cannot be inserted — and is named as พ.ศ., not as the future arm it would fall through to');

select lives_ok($$
  insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, date_of_birth)
  values ('d0010403-0403-0403-0403-d0d0d0d00403', 'ผู้ใหญ่', 'daily', 'permanent', 0, true,
          '11111111-1111-1111-1111-111111110403', (public.dob_today() - interval '30 years')::date)
$$, 'a valid DOB inserts');

select lives_ok($$
  insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by)
  values ('d0020403-0403-0403-0403-d0d0d0d00403', 'ไม่ทราบวันเกิด', 'daily', 'permanent', 0, true,
          '11111111-1111-1111-1111-111111110403')
$$, 'a worker with no DOB at all still inserts');

select throws_ok($$
  update public.workers set date_of_birth = public.dob_today()
   where id = 'd0010403-0403-0403-0403-d0d0d0d00403'
$$, 'P0001', 'workers.date_of_birth: dob under minimum age',
  'an existing worker cannot be UPDATED to an under-age DOB');

-- The legacy row: a bad DOB that predates the gate must not freeze the record.
-- Planted via session_replication_role, NOT `alter table … disable trigger`:
-- the ALTER takes a ShareRowExclusiveLock on public.workers, and the runner wraps
-- twenty files in ONE transaction, so that lock would block every live INSERT and
-- UPDATE on a hot table for the rest of the chunk. This suite runs against the
-- shared production database.
set local session_replication_role = 'replica';
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, date_of_birth)
values ('d0e50403-0403-0403-0403-d0d0d0d00403', 'แถวเก่า', 'daily', 'permanent', 0, true,
        '11111111-1111-1111-1111-111111110403', date '2513-03-11');
set local session_replication_role = 'origin';

select lives_ok($$
  update public.workers set name = 'แถวเก่า แก้ชื่อ'
   where id = 'd0e50403-0403-0403-0403-d0d0d0d00403'
$$, 'a legacy row carrying a bad DOB is still editable for OTHER reasons — the gate is not retroactive');

select throws_ok($$
  update public.workers set date_of_birth = date '2469-01-01'
   where id = 'd0e50403-0403-0403-0403-d0d0d0d00403'
$$, 'P0001', 'workers.date_of_birth: dob looks like a buddhist era year',
  'but CHANGING a legacy row''s DOB to another bad value is refused');

-- ---------------------------------------------------------------------------
-- E. Behaviour on identity_change_requests — the pre-approval store. Blocking
--    here is what stops the age-0 request class at the source; blocking on
--    workers is what stops an ALREADY-pending one at approve time.
-- ---------------------------------------------------------------------------
select throws_ok($$
  insert into public.identity_change_requests (user_id, proposed_dob)
  values ('11111111-1111-1111-1111-111111110403', public.dob_today())
$$, 'P0001', 'identity_change_requests.proposed_dob: dob under minimum age',
  'a proposed DOB of today cannot even be requested');

select lives_ok($$
  insert into public.identity_change_requests (user_id, proposed_dob)
  values ('11111111-1111-1111-1111-111111110403', (public.dob_today() - interval '30 years')::date)
$$, 'a valid proposed DOB is requested normally');

-- ---------------------------------------------------------------------------
-- F. APPROVING a stored proposal. Gate 4 found this the hard way: the
--    trigger on workers/staff_registrations/contractors only fires if the
--    approve actually UPDATES a row, and decide_identity_change's three writes
--    are all conditional on the requester having such a row. Live, THREE of the
--    four pending requests have no worker row, no approved registration and no
--    contractor link — so approving a bad proposal touched nothing, raised
--    nothing, and marked the request approved.
--
--    The proposal must therefore be validated at the moment it is APPLIED, not
--    only where it lands. Rejecting must stay open, or an approver is left with
--    a row they can neither approve nor clear.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a4030403-0403-4403-8403-a4a4a4a40403', 'orphan@dob.local',   '{}'::jsonb),
  ('b4030403-0403-4403-8403-b4b4b4b40403', 'orphan2@dob.local',  '{}'::jsonb),
  ('c4030403-0403-4403-8403-c4c4c4c40403', 'approver@dob.local', '{}'::jsonb);
update public.users set role = 'procurement_manager'
  where id = 'c4030403-0403-4403-8403-c4c4c4c40403';

-- Two proposals from users with NO linked records at all, planted with the
-- trigger off so the gate is exercised at approve time rather than at insert.
set local session_replication_role = 'replica';
insert into public.identity_change_requests (id, user_id, proposed_dob) values
  ('e4030403-0403-4403-8403-e4e4e4e40403', 'a4030403-0403-4403-8403-a4a4a4a40403', public.dob_today()),
  ('f4030403-0403-4403-8403-f4f4f4f40403', 'b4030403-0403-4403-8403-b4b4b4b40403',
   (public.dob_today() - interval '30 years')::date);
set local session_replication_role = 'origin';

-- The runner rewrites assertions into a temp collector table, so a role switch
-- needs these grants or every assertion below dies on _tap_buf, not on the code.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c4030403-0403-4403-8403-c4c4c4c40403"}';

select throws_ok(
  $$ select public.decide_identity_change('e4030403-0403-4403-8403-e4e4e4e40403', true) $$,
  'P0001', null,
  'APPROVING an age-0 proposal is refused even when the requester has no linked record to write it to');

select lives_ok(
  $$ select public.decide_identity_change('e4030403-0403-4403-8403-e4e4e4e40403', false) $$,
  'REJECTING it is still open — the approver is never left with a row they can neither approve nor clear');

select lives_ok(
  $$ select public.decide_identity_change('f4030403-0403-4403-8403-f4f4f4f40403', true) $$,
  'CONTROL — a good proposal still approves, so the refusal above is the gate and not a broken approve');

reset role;

select * from finish();
rollback;
