begin;
select plan(15);

-- ============================================================================
-- Spec 357 U-F — workers.gender: enum + nullable column + a one-column widen
-- of the workers PII column wall (authenticated may SELECT gender; anon may
-- not) + p_gender on create_worker / update_worker (null = keep on update).
-- ============================================================================

-- Grants for role-switched asserts (pgTAP _tap_buf lesson, #400).
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- 1-2. Enum exists with exactly (male, female).
select has_type('public', 'worker_gender', 'worker_gender enum exists');
select is(
  (select array_agg(enumlabel order by enumsortorder)::text[]
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'worker_gender'),
  array['male', 'female']::text[],
  'worker_gender labels are exactly male, female');

-- 3-4. Column exists and is nullable (null = ยังไม่ระบุ; no backfill guess).
select has_column('public', 'workers', 'gender', 'workers.gender exists');
select col_is_null('public', 'workers', 'gender', 'workers.gender is nullable');

-- 5-6. The PII column wall widens by exactly this column: authenticated may
-- SELECT gender, anon may not (the workers table has NO table-level
-- authenticated grant — column grants are the wall).
select ok(
  has_column_privilege('authenticated', 'public.workers', 'gender', 'SELECT'),
  'authenticated may SELECT workers.gender');
select ok(
  not has_column_privilege('anon', 'public.workers', 'gender', 'SELECT'),
  'anon may NOT SELECT workers.gender');

-- 7-8. The 13-arg RPCs are anon-revoked (the 36-lockdown posture carried over).
select ok(
  not has_function_privilege('anon',
    'public.create_worker(text, public.pay_type, public.employment_type, numeric, uuid, uuid, text, text, text, text, text, text, public.worker_gender)',
    'EXECUTE'),
  'anon cannot execute create_worker (13-arg)');
select ok(
  not has_function_privilege('anon',
    'public.update_worker(uuid, text, boolean, public.pay_type, public.employment_type, uuid, text, text, text, text, text, text, public.worker_gender)',
    'EXECUTE'),
  'anon cannot execute update_worker (13-arg)');

-- Fixture PM actor for the write-through asserts.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111357000', 'pm@gender-test.local', '{}'::jsonb);
update public.users set role = 'project_manager'
 where id = '11111111-1111-1111-1111-111111357000';

-- Writes run as the authenticated PM; every verification read runs afterwards
-- as postgres in its OWN statement — a read in the same statement as the
-- volatile RPC scans the statement-start snapshot and sees nothing (the first
-- cut of this test passed its null-default assert vacuously that way).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111357000"}';

-- 9-10. create_worker accepts p_gender / lives without it.
select lives_ok(
  $$ select public.create_worker('Gender Test A', 'daily', 'permanent', 300,
                                 p_gender => 'female') $$,
  'create_worker accepts p_gender');
select lives_ok(
  $$ select public.create_worker('Gender Test B', 'daily', 'permanent', 300) $$,
  'create_worker lives without p_gender');

reset role;
-- 11-12. Persisted values (postgres read, fresh statements).
select is(
  (select gender::text from public.workers where name = 'Gender Test A'),
  'female', 'create_worker writes gender');
select ok(
  (select gender from public.workers where name = 'Gender Test B') is null,
  'create_worker defaults gender to null');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111357000"}';

-- 13-14. update_worker: set, then an update omitting p_gender.
select lives_ok(
  $$ select public.update_worker(
       (select id from public.workers where name = 'Gender Test B'),
       p_gender => 'male') $$,
  'update_worker sets gender');
select lives_ok(
  $$ select public.update_worker(
       (select id from public.workers where name = 'Gender Test B'),
       p_name => 'Gender Test B2') $$,
  'update_worker lives with p_gender omitted');

reset role;
-- 15. Omitted p_gender kept the stored value (321-U3a blank=keep family).
select is(
  (select gender::text from public.workers where name = 'Gender Test B2'),
  'male', 'update_worker with p_gender omitted keeps the stored value');

select * from finish();
rollback;
