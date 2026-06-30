begin;
select plan(44);

-- ============================================================================
-- A. Setup as postgres (the test transaction's outer role, which bypasses
--    RLS). Insert four auth.users; the on_auth_user_created trigger creates
--    four matching public.users rows with default role 'visitor' (ADR 0010).
--    Promote three to the privileged roles tested below; the fourth stays
--    'visitor'.
--
--    Insert one parent project for the FK + visibility fixtures, and one
--    fixture report row with updated_at fixed to '2020-01-01' so the
--    set_updated_at trigger assertion in section G can prove updated_at
--    moved forward — transaction_timestamp() is frozen within the test
--    transaction.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@reports-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@reports-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@reports-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@reports-test.local', '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'
  where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager'
  where id = '33333333-3333-3333-3333-333333333333';
-- '4444…' keeps the default 'visitor' role from the trigger.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PRC-TEST-REP-A', 'Reports fixture project');

-- Spec 143 / ADR 0056: visibility is now membership-scoped — enrol this
-- fixture's PM/site_admin users so they can read the project.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-TEST-REP-A')
     and u.id in (select au.id from auth.users au where au.email like '%@reports-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

-- Fixture report for the no-app-UPDATE / no-app-DELETE / set_updated_at
-- trigger assertions in sections F, G, H. requested_by is the PM seeded
-- above. updated_at is fixed to '2020-01-01' so the trigger's effect on a
-- subsequent UPDATE is observable inside the frozen transaction clock.
insert into public.reports
  (id, project_id, requested_by, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '33333333-3333-3333-3333-333333333333',
   '2020-01-01 00:00:00+00');

-- Grant the runner's temp result buffer to authenticated, so the assertions
-- that run under `set local role authenticated` can still record their TAP
-- output via the runner's `insert into _tap_buf(line) select <pgtap>` rewrite.
-- Same pattern established in 06-users-rls.test.sql and forward.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog: enum, table shape, columns, defaults, FKs, trigger, indexes.
-- ============================================================================

select has_type('public', 'report_status', 'report_status enum exists');
select enum_has_labels(
  'public', 'report_status',
  array['requested', 'processing', 'complete', 'failed'],
  'report_status has the four expected values'
);

select has_table('public', 'reports', 'public.reports exists');

-- Spec 61: PM report-content params — jsonb, '{}' default (pre-61 rows
-- and the frozen worker's inserts both read as the legacy report).
select col_type_is('public', 'reports', 'params', 'jsonb', 'params is jsonb (spec 61)');
select col_has_default('public', 'reports', 'params', 'params has a default');

select col_is_pk('public', 'reports', 'id', 'id is primary key');
select col_type_is('public', 'reports', 'id', 'uuid', 'id is uuid');
select col_has_default('public', 'reports', 'id', 'id has a default (gen_random_uuid)');

select col_type_is('public', 'reports', 'project_id', 'uuid', 'project_id is uuid');
select col_not_null('public', 'reports', 'project_id', 'project_id is NOT NULL');

select col_type_is('public', 'reports', 'status', 'report_status', 'status is report_status');
select col_not_null('public', 'reports', 'status', 'status is NOT NULL');
select col_default_is(
  'public', 'reports', 'status', 'requested'::public.report_status,
  'status defaults to requested'
);

select col_type_is('public', 'reports', 'storage_path', 'text', 'storage_path is text');
select col_is_null('public', 'reports', 'storage_path', 'storage_path is NULLABLE');

select col_type_is('public', 'reports', 'error', 'text', 'error is text');
select col_is_null('public', 'reports', 'error', 'error is NULLABLE');

select col_type_is('public', 'reports', 'requested_by', 'uuid', 'requested_by is uuid');
select col_not_null('public', 'reports', 'requested_by', 'requested_by is NOT NULL');

select col_type_is(
  'public', 'reports', 'created_at',
  'timestamp with time zone',
  'created_at is timestamptz'
);
select col_type_is(
  'public', 'reports', 'updated_at',
  'timestamp with time zone',
  'updated_at is timestamptz'
);

select fk_ok(
  'public', 'reports', 'project_id',
  'public', 'projects', 'id',
  'project_id FK references projects.id'
);
select fk_ok(
  'public', 'reports', 'requested_by',
  'public', 'users', 'id',
  'requested_by FK references users.id'
);

select has_trigger(
  'public', 'reports', 'reports_set_updated_at',
  'reports_set_updated_at trigger exists'
);

select has_index(
  'public', 'reports', 'reports_project_id_idx',
  'reports_project_id_idx exists'
);
select has_index(
  'public', 'reports', 'reports_active_status_idx',
  'reports_active_status_idx exists (partial index for the worker queue)'
);

-- ============================================================================
-- C. RLS configuration.
--
--    Policy commands on reports are EXACTLY INSERT + SELECT — NO UPDATE, NO
--    DELETE. App users request + read; the Railway worker mutates rows via
--    the service role (which bypasses RLS), and projects/reports archive-
--    not-delete per ADR 0013.
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'public.reports'::regclass),
  true,
  'RLS enabled on public.reports'
);

-- The second SELECT is the spec-233 / ADR-0067 client read arm (additive,
-- read-only, completed reports scoped to client_has_live_access). The
-- append-only invariant (no UPDATE, no DELETE) is unchanged.
select results_eq(
  $$ select cmd::text from pg_policies
     where schemaname = 'public' and tablename = 'reports'
     order by cmd $$,
  array['INSERT'::text, 'SELECT'::text, 'SELECT'::text],
  'reports has exactly INSERT + SELECT×2 policies — no UPDATE, no DELETE'
);

-- ============================================================================
-- D. Role-gated INSERT. Each assertion runs in an authenticated session
--    impersonating one of the seeded test users. Three-arg throws_ok treats
--    arg 3 as the expected error message, not as a test description — use
--    the four-arg form with errmsg=null.
-- ============================================================================

set local role authenticated;

-- D.1 super_admin can INSERT.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select lives_ok(
  $$ insert into public.reports (project_id, requested_by)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'super_admin can INSERT into reports'
);

-- D.2 project_manager can INSERT.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ insert into public.reports (project_id, requested_by)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             '33333333-3333-3333-3333-333333333333'::uuid) $$,
  'project_manager can INSERT into reports'
);

-- D.3 site_admin INSERT is denied (RLS WITH CHECK violation → SQLSTATE 42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ insert into public.reports (project_id, requested_by)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  '42501',
  null,
  'site_admin INSERT on reports is denied by RLS'
);

-- D.4 visitor INSERT is denied.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ insert into public.reports (project_id, requested_by)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             '44444444-4444-4444-4444-444444444444'::uuid) $$,
  '42501',
  null,
  'visitor INSERT on reports is denied by RLS'
);

-- ============================================================================
-- E. Role-gated SELECT visibility.
--
--    Load-bearing difference from photo_logs / projects / work_packages:
--    site_admin is NOT in the SELECT policy. SAs do not consume reports in
--    v1; if a future surface needs them to, that's a policy + an ADR.
-- ============================================================================

-- E.1 super_admin sees the table populated.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select isnt(
  (select count(*)::int from public.reports),
  0,
  'super_admin sees at least one report'
);

-- E.2 project_manager sees the table populated.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select isnt(
  (select count(*)::int from public.reports),
  0,
  'project_manager sees at least one report'
);

-- E.3 site_admin sees NOTHING (intentional — not in the SELECT policy).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select is(
  (select count(*)::int from public.reports),
  0,
  'site_admin sees no reports'
);

-- E.4 visitor sees NOTHING. Load-bearing for the ADR 0013 visibility contract.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is(
  (select count(*)::int from public.reports),
  0,
  'visitor sees no reports'
);

-- ============================================================================
-- F. No app UPDATE — even as project_manager.
--
--    With RLS enabled and no UPDATE policy, the planner's USING evaluation
--    returns false for every candidate row, so UPDATE statements affect
--    zero rows silently. Same shape as 07-projects' no-DELETE assertion.
--    The Railway worker uses the service role and bypasses RLS — that path
--    is the only mutation route, and it isn't tested under app-role context.
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
update public.reports
  set status = 'processing'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select is(
  (select status::text from public.reports
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'requested',
  'project_manager UPDATE on reports has no effect — status unchanged'
);

-- ============================================================================
-- G. No app DELETE — even as super_admin. Same archive-not-delete posture
--    as projects / work_packages.
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
delete from public.reports
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

select is(
  (select count(*)::int from public.reports
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'super_admin DELETE on reports has no effect — row remains (no DELETE policy)'
);

-- ============================================================================
-- H. set_updated_at trigger fires on UPDATE.
--
--    App users cannot UPDATE (sections F + C prove that). The trigger's
--    behavior is therefore only observable in a context that bypasses RLS —
--    which is exactly the Railway worker's running context. We mirror that
--    here by `reset role`-ing back to postgres (the test transaction's
--    outer role, which is also the function owner and RLS-bypass) before
--    running the UPDATE.
-- ============================================================================

reset role;

update public.reports
  set status = 'processing'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

select cmp_ok(
  (select updated_at from public.reports
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  '>',
  '2020-01-01 00:00:00+00'::timestamptz,
  'set_updated_at trigger moves updated_at forward on UPDATE (service-role context)'
);

-- ============================================================================
-- I. Reports Storage bucket — catalog-only assertions, mirroring the photos
--    bucket test (11-photos-bucket). Behavioral RLS on storage.objects is
--    not exercised: the bucket has NO authenticated/anon policies by
--    design, so there is nothing client-visible to test behaviorally.
-- ============================================================================

select is(
  (select count(*)::int from storage.buckets where id = 'reports'),
  1,
  'storage.buckets has a row with id = ''reports'''
);

select is(
  (select public from storage.buckets where id = 'reports'),
  false,
  'reports bucket is private (public = false)'
);

select is(
  (select file_size_limit from storage.buckets where id = 'reports'),
  52428800::bigint,
  'reports bucket file_size_limit = 50 MiB'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'reports'),
  array['application/pdf']::text[],
  'reports bucket allowed_mime_types is [application/pdf]'
);

-- No authenticated/anon policies on storage.objects scoped to the reports
-- bucket. Worker writes via the service role (bypasses RLS); download URLs
-- in the future PM-report UI are minted server-side via the service role
-- too. The absence of policies here is load-bearing — adding one later
-- would be a privilege-broadening change that needs its own justification.
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and policyname ilike 'reports%'),
  0,
  'no authenticated/anon policies on storage.objects for the reports bucket'
);

-- ============================================================================
-- J. Tear down. Role was already reset to postgres in section H; pgTAP's
--    finish() and the runner's appended `select line from _tap_buf order
--    by ord;` run under postgres with full privileges. The rollback at
--    end-of-test is the belt-and-braces backstop.
-- ============================================================================

select * from finish();
rollback;
