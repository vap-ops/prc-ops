begin;
select plan(45);

-- ============================================================================
-- A. Setup as postgres (the test transaction's outer role, which bypasses
--    RLS). Insert four auth.users; the on_auth_user_created trigger creates
--    four matching public.users rows with default role 'visitor' (ADR 0010).
--    Promote three to the privileged roles tested below; the fourth stays
--    'visitor'.
--
--    Insert one parent project + two work_packages: one for the catalog /
--    CHECK / trigger / RLS fixtures, one isolated for the history test
--    (section I) so its row count is unaffected by earlier sections.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@appr-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@appr-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@appr-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@appr-test.local', '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'
  where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager'
  where id = '33333333-3333-3333-3333-333333333333';
-- '4444…' keeps the default 'visitor' role from the trigger.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PRC-TEST-AP-A', 'Approvals fixture project A');

-- Spec 143 / ADR 0056: visibility is now membership-scoped — enrol this
-- fixture's PM/site_admin users so they can read the project.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-TEST-AP-A')
     and u.id in (select au.id from auth.users au where au.email like '%@appr-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'WP-AP-A1', 'Approvals fixture WP — primary'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'WP-AP-A2', 'Approvals fixture WP — history isolation');

-- Grant the runner's temp result buffer to authenticated, so the assertions
-- that run under `set local role authenticated` can still record their TAP
-- output via the runner's `insert into _tap_buf(line) select <pgtap>` rewrite.
-- Same pattern established in 06/07/08/09.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog: enum, table shape, columns, FKs, CHECK, index.
-- ============================================================================

select has_type('public', 'approval_decision', 'approval_decision enum exists');
select enum_has_labels(
  'public', 'approval_decision',
  array['approved', 'rejected', 'needs_revision'],
  'approval_decision has the three expected values'
);

select has_table('public', 'approvals', 'public.approvals exists');

select col_is_pk('public', 'approvals', 'id', 'id is primary key');
select col_type_is('public', 'approvals', 'id', 'uuid', 'id is uuid');
select col_has_default('public', 'approvals', 'id', 'id has a default (gen_random_uuid)');

select col_type_is('public', 'approvals', 'work_package_id', 'uuid', 'work_package_id is uuid');
select col_not_null('public', 'approvals', 'work_package_id', 'work_package_id is NOT NULL');

select col_type_is('public', 'approvals', 'decision', 'approval_decision', 'decision is approval_decision');
select col_not_null('public', 'approvals', 'decision', 'decision is NOT NULL');

select col_type_is('public', 'approvals', 'comment', 'text', 'comment is text');
select col_is_null('public', 'approvals', 'comment', 'comment is NULLABLE (constrained by CHECK)');

select col_type_is('public', 'approvals', 'decided_by', 'uuid', 'decided_by is uuid');
select col_not_null('public', 'approvals', 'decided_by', 'decided_by is NOT NULL');

select col_type_is(
  'public', 'approvals', 'decided_at',
  'timestamp with time zone',
  'decided_at is timestamptz'
);
select col_not_null('public', 'approvals', 'decided_at', 'decided_at is NOT NULL');

select fk_ok(
  'public', 'approvals', 'work_package_id',
  'public', 'work_packages', 'id',
  'work_package_id FK references work_packages.id'
);
select fk_ok(
  'public', 'approvals', 'decided_by',
  'public', 'users', 'id',
  'decided_by FK references public.users.id'
);

-- Comment CHECK constraint exists. The behavioral assertions in section F
-- prove it fires correctly for the seven cases that matter; this is the
-- catalog-level guarantee that the constraint exists by name.
select is(
  (select count(*)::int from pg_constraint
     where conrelid = 'public.approvals'::regclass
       and contype = 'c'
       and conname = 'approvals_comment_required_when_negative'),
  1,
  'CHECK constraint approvals_comment_required_when_negative exists'
);

-- Composite index serves both "latest decision for WP X" (index seek then
-- first row) and "history for WP X" (pre-sorted scan).
select has_index(
  'public', 'approvals', 'approvals_work_package_id_decided_at_idx',
  'composite (work_package_id, decided_at desc) index exists'
);

-- ============================================================================
-- C. RLS configuration.
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'public.approvals'::regclass),
  true,
  'RLS enabled on public.approvals'
);

-- Policy commands on approvals are exactly INSERT + SELECT — NO UPDATE, NO
-- DELETE. Append-only. Same shape as photo_logs and audit_log.
select results_eq(
  $$ select cmd::text from pg_policies
     where schemaname = 'public' and tablename = 'approvals'
     order by cmd $$,
  array['INSERT'::text, 'SELECT'::text],
  'approvals has exactly INSERT/SELECT policies — no UPDATE, no DELETE policy'
);

-- ============================================================================
-- D. REVOKE privileges (layer 1 of triple enforcement).
-- ============================================================================

select ok(
  not has_table_privilege('authenticated', 'public.approvals', 'UPDATE'),
  'authenticated role lacks UPDATE on approvals'
);
select ok(
  not has_table_privilege('authenticated', 'public.approvals', 'DELETE'),
  'authenticated role lacks DELETE on approvals'
);

-- ============================================================================
-- E. Append-only enforcement — trigger as LAST line of defense (layer 3).
--
--    Insert as postgres (bypasses both layer 1 REVOKE and layer 2 RLS). The
--    trigger MUST still block UPDATE and DELETE. Mirrors the audit_log /
--    photo_logs immutability tests exactly.
-- ============================================================================

insert into public.approvals (id, work_package_id, decision, comment, decided_by)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
          'approved'::public.approval_decision,
          null,
          '11111111-1111-1111-1111-111111111111'::uuid);

select throws_ok(
  $$ update public.approvals
     set comment = 'tampered'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  'P0001',
  'approvals is append-only',
  'trigger raises on UPDATE attempt (last line of defense)'
);

select throws_ok(
  $$ delete from public.approvals
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  'P0001',
  'approvals is append-only',
  'trigger raises on DELETE attempt (last line of defense)'
);

-- ============================================================================
-- F. Comment CHECK behavioral. The constraint is:
--
--      decision = 'approved' OR (comment IS NOT NULL AND length(trim(comment)) > 0)
--
--    "Required" means present AND non-blank — a whitespace-only comment on
--    a negative decision must be rejected, not just NULL. 23514 is
--    check_violation.
-- ============================================================================

-- F.1 approved + NULL comment → OK
select lives_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'approved'::public.approval_decision,
             null,
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'approved + NULL comment satisfies CHECK'
);

-- F.2 approved + non-blank comment → OK
select lives_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'approved'::public.approval_decision,
             'looks good',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'approved + non-blank comment satisfies CHECK'
);

-- F.3 rejected + non-blank comment → OK
select lives_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'rejected'::public.approval_decision,
             'wrong project',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'rejected + non-blank comment satisfies CHECK'
);

-- F.4 needs_revision + non-blank comment → OK
select lives_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'needs_revision'::public.approval_decision,
             'please retake the After photos',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'needs_revision + non-blank comment satisfies CHECK'
);

-- F.5 rejected + NULL comment → FAILS
select throws_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'rejected'::public.approval_decision,
             null,
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '23514',
  null,
  'rejected + NULL comment is rejected by CHECK'
);

-- F.6 needs_revision + NULL comment → FAILS
select throws_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'needs_revision'::public.approval_decision,
             null,
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '23514',
  null,
  'needs_revision + NULL comment is rejected by CHECK'
);

-- F.7 rejected + whitespace-only comment → FAILS (the load-bearing "non-blank"
--     half of the constraint — a NULL check alone would not catch this).
select throws_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'rejected'::public.approval_decision,
             '   ',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '23514',
  null,
  'rejected + whitespace-only comment is rejected by CHECK (non-blank requirement)'
);

-- ============================================================================
-- G. Role-gated INSERT under authenticated. From here every assertion's
--    TAP-recording insert hits _tap_buf as the authenticated role; hence
--    the grants in section A.
-- ============================================================================

set local role authenticated;

-- G.1 project_manager can INSERT.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'approved'::public.approval_decision,
             'pm approval',
             '33333333-3333-3333-3333-333333333333'::uuid) $$,
  'project_manager can INSERT into approvals'
);

-- G.2 super_admin can INSERT.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select lives_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'approved'::public.approval_decision,
             'super approval',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'super_admin can INSERT into approvals'
);

-- G.3 site_admin INSERT is denied — LOAD-BEARING. SA can upload photos but
--     cannot approve. This is the key access split between photo_logs and
--     approvals (RLS WITH CHECK violation → SQLSTATE 42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'approved'::public.approval_decision,
             'sa attempting to approve',
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  '42501',
  null,
  'site_admin INSERT on approvals is denied by RLS (load-bearing — SA cannot approve)'
);

-- G.4 visitor INSERT is denied.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'approved'::public.approval_decision,
             'visitor attempting',
             '44444444-4444-4444-4444-444444444444'::uuid) $$,
  '42501',
  null,
  'visitor INSERT on approvals is denied by RLS'
);

-- ============================================================================
-- H. Role-gated SELECT visibility. SA must be able to read approvals so
--    they can see needs_revision comments for WPs they uploaded to.
-- ============================================================================

-- H.1 super_admin sees rows.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select isnt(
  (select count(*)::int from public.approvals),
  0,
  'super_admin sees at least one approval'
);

-- H.2 site_admin sees rows (load-bearing — SA reads needs_revision comments).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select isnt(
  (select count(*)::int from public.approvals),
  0,
  'site_admin sees at least one approval (needed for needs_revision flow)'
);

-- H.3 project_manager sees rows.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select isnt(
  (select count(*)::int from public.approvals),
  0,
  'project_manager sees at least one approval'
);

-- H.4 visitor sees NOTHING. Load-bearing for the role-level read contract.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is(
  (select count(*)::int from public.approvals),
  0,
  'visitor sees no approvals'
);

-- ============================================================================
-- I. History model: append-only event log preserves every decision; the
--    "current decision" for a WP is the row with max(decided_at).
--
--    Use the isolated fixture WP (ffffffff-…) so the count is independent
--    of section F's INSERTs. Insert as super_admin (authenticated). Use
--    EXPLICIT decided_at values because `default now()` resolves to
--    transaction_timestamp() — frozen within the test transaction — so
--    two unspecified inserts would share a timestamp and "latest" would
--    be ambiguous.
-- ============================================================================

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';

insert into public.approvals (work_package_id, decision, comment, decided_by, decided_at)
  values ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
          'needs_revision'::public.approval_decision,
          'please retake the After photos',
          '11111111-1111-1111-1111-111111111111'::uuid,
          '2026-01-01 09:00:00+00');

insert into public.approvals (work_package_id, decision, comment, decided_by, decided_at)
  values ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
          'approved'::public.approval_decision,
          null,
          '11111111-1111-1111-1111-111111111111'::uuid,
          '2026-02-01 09:00:00+00');

-- I.1 Both decisions persist — append-only event log, nothing is overwritten.
select is(
  (select count(*)::int from public.approvals
     where work_package_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
  2,
  'history model: both decisions persist (append-only event log)'
);

-- I.2 The latest decision by decided_at is the approved one. This is the
--     query the eventual PDF-generation unit will run; recording the shape
--     here pins it.
select is(
  (select decision
     from public.approvals
     where work_package_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
     order by decided_at desc
     limit 1),
  'approved'::public.approval_decision,
  'latest decision by decided_at is the approved one (current-decision semantic)'
);

-- ============================================================================
-- J. Enum + FK rejection. Run as postgres so any failure is unambiguously
--    from the constraint being tested, not from RLS.
-- ============================================================================

reset role;

-- J.1 Decision enum rejects values outside approved/rejected/needs_revision.
--     22P02 is invalid_text_representation (raised by the enum input function).
select throws_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'maybe'::public.approval_decision,
             'invalid decision',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '22P02',
  null,
  'decision enum rejects values outside approved/rejected/needs_revision'
);

-- J.2 work_package_id FK rejects a non-existent WP. 23503 is
--     foreign_key_violation.
select throws_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('00000000-0000-0000-0000-000000000999'::uuid,
             'approved'::public.approval_decision,
             null,
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '23503',
  null,
  'work_package_id FK rejects non-existent work_package'
);

-- ============================================================================
-- K. Tear down. Reset role to postgres before finish() / the runner's
--    appended dump from _tap_buf, so those run with full privileges.
-- ============================================================================

reset role;

select * from finish();
rollback;
