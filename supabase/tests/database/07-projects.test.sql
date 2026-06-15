begin;
select plan(32);

-- ============================================================================
-- A. Setup as postgres (the test transaction's outer role, which bypasses
--    RLS). Insert four auth.users; the on_auth_user_created trigger creates
--    four matching public.users rows with default role 'visitor' (ADR 0010).
--    Promote three to the privileged roles tested below; the fourth stays
--    'visitor'.
--
--    A test project is also inserted with updated_at fixed to '2020-01-01'
--    so the set_updated_at trigger assertion (G below) can prove that
--    updated_at moved forward — `now()` is frozen at transaction_timestamp,
--    so an insert + update in the same transaction would otherwise share a
--    timestamp.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@projects-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@projects-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@projects-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@projects-test.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555555555', 'proc@projects-test.local',    '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'
  where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager'
  where id = '33333333-3333-3333-3333-333333333333';
-- '4444…' keeps the default 'visitor' role from the trigger.
update public.users set role = 'procurement'
  where id = '55555555-5555-5555-5555-555555555555';

insert into public.projects (id, code, name, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'PRC-TEST-TRIG-001',
   'Trigger fixture',
   '2020-01-01 00:00:00+00');

-- Grant the runner's temp result buffer to authenticated, so the assertions
-- that run under `set local role authenticated` can still record their TAP
-- output via the runner's `insert into _tap_buf(line) select <pgtap>` rewrite.
-- Same pattern established in 06-users-rls.test.sql.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog: enum, table shape, columns, defaults, uniqueness.
-- ============================================================================

select has_type('public', 'project_status', 'project_status enum exists');
select enum_has_labels(
  'public', 'project_status',
  array['active', 'on_hold', 'completed', 'archived'],
  'project_status has the four expected values'
);

select has_table('public', 'projects', 'public.projects exists');

select col_is_pk('public', 'projects', 'id', 'id is primary key');
select col_type_is('public', 'projects', 'id', 'uuid', 'id is uuid');
select col_has_default('public', 'projects', 'id', 'id has a default (gen_random_uuid)');

select col_type_is('public', 'projects', 'code', 'text', 'code is text');
select col_not_null('public', 'projects', 'code', 'code is NOT NULL');
select col_is_unique('public', 'projects', 'code', 'code is UNIQUE');

select col_type_is('public', 'projects', 'name', 'text', 'name is text');
select col_not_null('public', 'projects', 'name', 'name is NOT NULL');

select col_type_is('public', 'projects', 'status', 'project_status', 'status is project_status');
select col_not_null('public', 'projects', 'status', 'status is NOT NULL');
select col_default_is(
  'public', 'projects', 'status', 'active'::public.project_status,
  'status defaults to active'
);

select col_type_is(
  'public', 'projects', 'created_at',
  'timestamp with time zone',
  'created_at is timestamptz'
);
select col_type_is(
  'public', 'projects', 'updated_at',
  'timestamp with time zone',
  'updated_at is timestamptz'
);

-- Spec 72: the backup-capture note column.
select col_type_is('public', 'projects', 'notes', 'text', 'notes is text');
select col_is_null('public', 'projects', 'notes', 'notes is NULLABLE');

select has_trigger(
  'public', 'projects', 'projects_set_updated_at',
  'projects_set_updated_at trigger exists'
);

-- ============================================================================
-- C. RLS configuration.
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'public.projects'::regclass),
  true,
  'RLS enabled on public.projects'
);

-- Policy commands on projects are exactly SELECT, INSERT, UPDATE — NO DELETE.
-- This is load-bearing per ADR 0013: hard deletes are not allowed through the
-- app. Sorted alphabetically (INSERT, SELECT, UPDATE).
select results_eq(
  $$ select cmd::text from pg_policies
     where schemaname = 'public' and tablename = 'projects'
     order by cmd $$,
  array['INSERT'::text, 'SELECT'::text, 'UPDATE'::text],
  'projects has exactly SELECT/INSERT/UPDATE policies — no DELETE policy'
);

-- ============================================================================
-- D. Role-gated INSERT. Each assertion runs in an authenticated session
--    impersonating one of the seeded test users. From here on every
--    assertion's TAP-recording insert hits _tap_buf as the authenticated
--    role; hence the grants in section A.
-- ============================================================================

set local role authenticated;

-- D.1 super_admin can INSERT.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select lives_ok(
  $$ insert into public.projects (code, name)
     values ('PRC-TEST-INS-001', 'Insert-by-super_admin fixture') $$,
  'super_admin can INSERT into projects'
);

-- D.2 site_admin INSERT is denied (RLS WITH CHECK violation → SQLSTATE 42501).
-- Use the 4-arg throws_ok form with errmsg=NULL: the 3-arg form treats its
-- 3rd argument as the expected error message, not a test description.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ insert into public.projects (code, name)
     values ('PRC-TEST-INS-SA-DENY', 'Should be denied') $$,
  '42501',
  null,
  'site_admin INSERT on projects is denied by RLS'
);

-- D.3 project_manager INSERT is denied.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select throws_ok(
  $$ insert into public.projects (code, name)
     values ('PRC-TEST-INS-PM-DENY', 'Should be denied') $$,
  '42501',
  null,
  'project_manager INSERT on projects is denied by RLS'
);

-- ============================================================================
-- E. Role-gated SELECT visibility.
-- ============================================================================

-- E.1 super_admin sees the table populated.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select isnt(
  (select count(*)::int from public.projects),
  0,
  'super_admin sees at least one project'
);

-- E.2 site_admin sees the table populated.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select isnt(
  (select count(*)::int from public.projects),
  0,
  'site_admin sees at least one project'
);

-- E.3 project_manager sees the table populated.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select isnt(
  (select count(*)::int from public.projects),
  0,
  'project_manager sees at least one project'
);

-- E.4 visitor sees NOTHING. Load-bearing for the ADR 0013 visibility contract.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is(
  (select count(*)::int from public.projects),
  0,
  'visitor sees no projects'
);

-- E.5 procurement sees the table populated (spec 102 — read-only project
-- visibility; the app gives procurement a read-only WP list, never capture).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555"}';
select isnt(
  (select count(*)::int from public.projects),
  0,
  'procurement sees at least one project (spec 102)'
);

-- ============================================================================
-- F. No DELETE — even as super_admin. With RLS enabled and no DELETE policy,
--    a DELETE through the application path affects zero rows. Run the DELETE
--    as a plain statement first (the pgTAP runner only rewrites `select …`
--    statements; the DELETE passes through unchanged), then assert that the
--    target row still exists.
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
delete from public.projects
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

select is(
  (select count(*)::int from public.projects
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'super_admin DELETE on projects has no effect — row remains (no DELETE policy)'
);

-- ============================================================================
-- G. set_updated_at trigger fires on UPDATE. The fixture row was inserted in
--    section A with updated_at = '2020-01-01'; an UPDATE under super_admin
--    must move it forward. Comparing against a fixed past value sidesteps
--    transaction_timestamp() being frozen within the test transaction.
-- ============================================================================

update public.projects
  set name = 'Trigger fixture (updated)'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

select cmp_ok(
  (select updated_at from public.projects
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  '>',
  '2020-01-01 00:00:00+00'::timestamptz,
  'set_updated_at trigger moves updated_at forward on UPDATE'
);

-- Spec 72: the notes length CHECK rejects an over-long note (super_admin
-- direct UPDATE; still under the super claims set in section F).
select throws_ok(
  $$ update public.projects
       set notes = repeat('x', 2001)
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '23514', null, 'notes longer than 2000 chars violate projects_notes_len');

-- ============================================================================
-- H. Tear down. Reset role to postgres before finish() / the runner's
--    appended `select line from _tap_buf order by ord;` so the dump runs
--    with full privileges. pgTAP assertions absorb per-test failures into
--    TAP output rather than raising, so this reset is always reached, and
--    the rollback at the end is the belt-and-braces backstop.
-- ============================================================================

reset role;

select * from finish();
rollback;
