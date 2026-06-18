begin;
select plan(53);

-- ============================================================================
-- A. Setup as postgres (the test transaction's outer role, which bypasses
--    RLS). Insert four auth.users; the on_auth_user_created trigger creates
--    four matching public.users rows with default role 'visitor' (ADR 0010).
--    Promote three to the privileged roles tested below; the fourth stays
--    'visitor'.
--
--    Insert two parent projects so the composite-unique test (E) can prove
--    that the same WP code is permitted under different projects but
--    rejected under the same project.
--
--    Insert one fixture WP with updated_at fixed to '2020-01-01' for the
--    UPDATE role tests + set_updated_at trigger assertion in section G —
--    transaction_timestamp() is frozen within a test transaction, so the
--    trigger's effect is otherwise unobservable.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@wp-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@wp-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@wp-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@wp-test.local', '{}'::jsonb),
  -- Spec 70: procurement reads WPs (worklist identity) but never writes them.
  ('55555555-5555-5555-5555-555555555555', 'proc@wp-test.local',    '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'
  where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager'
  where id = '33333333-3333-3333-3333-333333333333';
update public.users set role = 'procurement'
  where id = '55555555-5555-5555-5555-555555555555';
-- '4444…' keeps the default 'visitor' role from the trigger.

-- Two FK-parent projects.
insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PRC-TEST-WP-A', 'WP fixture project A'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'PRC-TEST-WP-B', 'WP fixture project B');

-- Spec 143 / ADR 0056: visibility is now membership-scoped — enrol this
-- fixture's PM/site_admin users so they can read the project.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-TEST-WP-A', 'PRC-TEST-WP-B')
     and u.id in (select au.id from auth.users au where au.email like '%@wp-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

-- Fixture WP for the UPDATE / no-DELETE / set_updated_at trigger checks.
insert into public.work_packages
  (id, project_id, code, name, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'WP-UPD-FIX',
   'fixture-initial',
   '2020-01-01 00:00:00+00');

-- Grant the runner's temp result buffer to authenticated, so the assertions
-- that run under `set local role authenticated` can still record their TAP
-- output via the runner's `insert into _tap_buf(line) select <pgtap>` rewrite.
-- Same pattern established in 06-users-rls.test.sql and 07-projects.test.sql.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog: enum, table shape, columns, defaults, uniqueness, FK, trigger.
-- ============================================================================

select has_type('public', 'work_package_status', 'work_package_status enum exists');
select enum_has_labels(
  'public', 'work_package_status',
  array['not_started', 'in_progress', 'on_hold', 'complete', 'pending_approval'],
  'work_package_status has the five expected values'
);

select has_table('public', 'work_packages', 'public.work_packages exists');

select col_is_pk('public', 'work_packages', 'id', 'id is primary key');
select col_type_is('public', 'work_packages', 'id', 'uuid', 'id is uuid');
select col_has_default('public', 'work_packages', 'id', 'id has a default (gen_random_uuid)');

select col_type_is('public', 'work_packages', 'project_id', 'uuid', 'project_id is uuid');
select col_not_null('public', 'work_packages', 'project_id', 'project_id is NOT NULL');

select col_type_is('public', 'work_packages', 'code', 'text', 'code is text');
select col_not_null('public', 'work_packages', 'code', 'code is NOT NULL');

select col_type_is('public', 'work_packages', 'name', 'text', 'name is text');
select col_not_null('public', 'work_packages', 'name', 'name is NOT NULL');

select col_type_is('public', 'work_packages', 'description', 'text', 'description is text');
select col_is_null('public', 'work_packages', 'description', 'description is NULLABLE');

-- Spec 71: the backup-capture note column.
select col_type_is('public', 'work_packages', 'notes', 'text', 'notes is text');
select col_is_null('public', 'work_packages', 'notes', 'notes is NULLABLE');
select has_function('public', 'set_work_package_notes', 'set_work_package_notes RPC exists');

select col_type_is(
  'public', 'work_packages', 'status', 'work_package_status',
  'status is work_package_status'
);
select col_not_null('public', 'work_packages', 'status', 'status is NOT NULL');
select col_default_is(
  'public', 'work_packages', 'status', 'not_started'::public.work_package_status,
  'status defaults to not_started'
);

select col_type_is(
  'public', 'work_packages', 'created_at',
  'timestamp with time zone',
  'created_at is timestamptz'
);
select col_type_is(
  'public', 'work_packages', 'updated_at',
  'timestamp with time zone',
  'updated_at is timestamptz'
);

select fk_ok(
  'public', 'work_packages', 'project_id',
  'public', 'projects', 'id',
  'project_id FK references projects.id'
);

select col_is_unique(
  'public', 'work_packages', array['project_id', 'code'],
  'composite unique constraint on (project_id, code)'
);

select has_trigger(
  'public', 'work_packages', 'work_packages_set_updated_at',
  'work_packages_set_updated_at trigger exists'
);

-- ============================================================================
-- C. RLS configuration.
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'public.work_packages'::regclass),
  true,
  'RLS enabled on public.work_packages'
);

-- Policy commands on work_packages are exactly SELECT, INSERT, UPDATE — NO
-- DELETE. Load-bearing per ADR 0013: archive via status, never hard-delete.
select results_eq(
  $$ select cmd::text from pg_policies
     where schemaname = 'public' and tablename = 'work_packages'
     order by cmd $$,
  array['INSERT'::text, 'SELECT'::text, 'UPDATE'::text],
  'work_packages has exactly SELECT/INSERT/UPDATE policies — no DELETE policy'
);

-- ============================================================================
-- D. Role-gated INSERT. Each assertion runs in an authenticated session
--    impersonating one of the seeded test users. From here on every
--    assertion's TAP-recording insert hits _tap_buf as the authenticated
--    role; hence the grants in section A.
--
--    Three-argument throws_ok treats arg 3 as the expected error message,
--    not as a test description — use the four-argument form with
--    errmsg=null and pass the description as arg 4.
-- ============================================================================

set local role authenticated;

-- D.1 super_admin can INSERT.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select lives_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             'WP-D1-SUPER', 'Insert-by-super_admin fixture') $$,
  'super_admin can INSERT into work_packages'
);

-- D.2 project_manager can INSERT.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             'WP-D2-PM', 'Insert-by-project_manager fixture') $$,
  'project_manager can INSERT into work_packages'
);

-- D.3 site_admin INSERT is denied (RLS WITH CHECK violation → SQLSTATE 42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             'WP-D3-SA-DENY', 'Should be denied') $$,
  '42501',
  null,
  'site_admin INSERT on work_packages is denied by RLS'
);

-- D.4 visitor INSERT is denied.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             'WP-D4-VIS-DENY', 'Should be denied') $$,
  '42501',
  null,
  'visitor INSERT on work_packages is denied by RLS'
);

-- D.5 procurement INSERT is denied (spec 70: read-only on WPs).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555"}';
select throws_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             'WP-D5-PROC-DENY', 'Should be denied') $$,
  '42501',
  null,
  'procurement INSERT on work_packages is denied by RLS'
);

-- ============================================================================
-- E. Composite-unique behavioral test. The (project_id, code) unique
--    constraint must reject duplicate codes under the same project but
--    accept the same code under a different project. Runs as super_admin
--    (already has INSERT permission from D.1). 23505 is unique_violation.
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';

-- E.1 First insert of WP-UNQ-001 under project A succeeds.
select lives_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             'WP-UNQ-001', 'Unique-constraint fixture A.1') $$,
  'super_admin INSERT WP-UNQ-001 under project A succeeds'
);

-- E.2 Second insert of WP-UNQ-001 under project A is rejected by the
--     composite unique constraint.
select throws_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             'WP-UNQ-001', 'Unique-constraint fixture A.2 duplicate') $$,
  '23505',
  null,
  'duplicate (project_id, code) under project A is rejected (unique_violation)'
);

-- E.3 Same code under a different project succeeds — uniqueness is scoped
--     to (project_id, code), not to code alone.
select lives_ok(
  $$ insert into public.work_packages (project_id, code, name)
     values ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
             'WP-UNQ-001', 'Unique-constraint fixture B') $$,
  'same code WP-UNQ-001 under a different project succeeds'
);

-- ============================================================================
-- F. Role-gated SELECT visibility.
-- ============================================================================

-- F.1 super_admin sees the table populated.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select isnt(
  (select count(*)::int from public.work_packages),
  0,
  'super_admin sees at least one work_package'
);

-- F.2 site_admin sees the table populated.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select isnt(
  (select count(*)::int from public.work_packages),
  0,
  'site_admin sees at least one work_package'
);

-- F.3 project_manager sees the table populated.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select isnt(
  (select count(*)::int from public.work_packages),
  0,
  'project_manager sees at least one work_package'
);

-- F.4 visitor sees NOTHING. Load-bearing for the ADR 0013 visibility contract.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is(
  (select count(*)::int from public.work_packages),
  0,
  'visitor sees no work_packages'
);

-- F.5 procurement sees the table populated (spec 70: WP identity on the
--     purchasing worklist).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555"}';
select isnt(
  (select count(*)::int from public.work_packages),
  0,
  'procurement sees at least one work_package'
);

-- ============================================================================
-- G. Role-gated UPDATE + set_updated_at trigger.
--
--    The UPDATE policy gates SELECT-FOR-UPDATE via the USING clause: when
--    USING returns false for all candidate rows, the UPDATE statement
--    affects 0 rows silently — no SQLSTATE is raised. So negative UPDATE
--    tests (site_admin / visitor) assert on row state, not on errors. The
--    same approach we used for "no DELETE policy" in 07-projects.
-- ============================================================================

-- G.1 project_manager can UPDATE.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
update public.work_packages
  set name = 'pm-changed'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
select is(
  (select name from public.work_packages
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'pm-changed',
  'project_manager UPDATE on work_packages succeeds'
);

-- G.2 super_admin can UPDATE.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
update public.work_packages
  set name = 'super-changed'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
select is(
  (select name from public.work_packages
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'super-changed',
  'super_admin UPDATE on work_packages succeeds'
);

-- G.3 site_admin UPDATE is silently filtered by the USING clause —
--     0 rows affected, no error, row value unchanged.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
update public.work_packages
  set name = 'sa-attempted'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
select is(
  (select name from public.work_packages
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'super-changed',
  'site_admin UPDATE has no effect — name unchanged from previous super_admin update'
);

-- G.4 set_updated_at trigger fired during G.1 / G.2, advancing updated_at
--     from the fixture's '2020-01-01' baseline.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select cmp_ok(
  (select updated_at from public.work_packages
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  '>',
  '2020-01-01 00:00:00+00'::timestamptz,
  'set_updated_at trigger moves updated_at forward on UPDATE'
);

-- ============================================================================
-- H. No DELETE — even as super_admin. With RLS enabled and no DELETE
--    policy, a DELETE through the application path affects zero rows.
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
delete from public.work_packages
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

select is(
  (select count(*)::int from public.work_packages
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'super_admin DELETE on work_packages has no effect — row remains (no DELETE policy)'
);

-- ============================================================================
-- I. set_work_package_notes RPC + the notes length CHECK (spec 71). Still
--    under `set local role authenticated` from section D; claims switch per
--    assertion. The fixture WP 'aaaa…' survived section H (no DELETE policy).
-- ============================================================================

-- I.1/I.2 site_admin — the on-site note author — writes via the RPC even
--          though SA has no work_packages UPDATE policy (the RPC writes the
--          notes column only).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select is(
  (select public.set_work_package_notes(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'ผนังร้าวฝั่งทิศเหนือ')),
  true,
  'site_admin writes a WP note via set_work_package_notes (returns true)');
select is(
  (select notes from public.work_packages
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'ผนังร้าวฝั่งทิศเหนือ',
  'the note landed on the work package');

-- I.3 visitor refused (role gate → 42501).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ select public.set_work_package_notes(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'nope') $$,
  '42501', null, 'visitor cannot set a WP note (role gate)');

-- I.4 procurement refused — it READS WPs (spec 70) but never writes them.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555"}';
select throws_ok(
  $$ select public.set_work_package_notes(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'nope') $$,
  '42501', null, 'procurement cannot set a WP note (role gate)');

-- I.5 unknown WP → false (0 rows updated).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select is(
  (select public.set_work_package_notes(
     '00000000-0000-0000-0000-000000000000'::uuid, 'x')),
  false,
  'set_work_package_notes returns false for an unknown work package');

-- I.6 a blank note clears the column to null (nullif(btrim(...),'')).
select is(
  (select public.set_work_package_notes(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '   ')),
  true,
  'a blank note is accepted (returns true)');
select is(
  (select notes from public.work_packages
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  null::text,
  'a blank note clears the column to null');

-- I.7 the length CHECK rejects an over-long note (super_admin direct UPDATE).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select throws_ok(
  $$ update public.work_packages
       set notes = repeat('x', 2001)
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '23514', null, 'notes longer than 2000 chars violate work_packages_notes_len');

-- ============================================================================
-- J. Tear down. Reset role to postgres before finish() / the runner's
--    appended dump from _tap_buf, so those run with full privileges.
-- ============================================================================

reset role;

select * from finish();
rollback;
