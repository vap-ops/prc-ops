begin;
select plan(48);

-- ============================================================================
-- A. Setup as postgres (the test transaction's outer role, which bypasses
--    RLS). Insert four auth.users; the on_auth_user_created trigger creates
--    four matching public.users rows with default role 'visitor' (ADR 0010).
--    Promote three to the privileged roles tested below; the fourth stays
--    'visitor'.
--
--    Insert one parent project + two work_packages: one for the catalog /
--    CHECK / trigger / RLS fixtures, one isolated for the tombstone +
--    anti-join current-state test (section G) so that test is unaffected by
--    the photos inserted in earlier sections.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@photo-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@photo-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@photo-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@photo-test.local', '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'
  where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager'
  where id = '33333333-3333-3333-3333-333333333333';
-- '4444…' keeps the default 'visitor' role from the trigger.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PRC-TEST-PL-A', 'Photo fixture project A');

insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'WP-PL-A1', 'Photo fixture WP — primary'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'WP-PL-A2', 'Photo fixture WP — anti-join isolation');

-- Grant the runner's temp result buffer to authenticated, so the assertions
-- that run under `set local role authenticated` can still record their TAP
-- output via the runner's `insert into _tap_buf(line) select <pgtap>` rewrite.
-- Same pattern established in 06/07/08.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog: enum, table shape, columns, FKs, CHECK, indexes.
-- ============================================================================

select has_type('public', 'photo_phase', 'photo_phase enum exists');
select enum_has_labels(
  'public', 'photo_phase',
  array['before', 'during', 'after'],
  'photo_phase has the three expected values'
);

select has_table('public', 'photo_logs', 'public.photo_logs exists');

select col_is_pk('public', 'photo_logs', 'id', 'id is primary key');
select col_type_is('public', 'photo_logs', 'id', 'uuid', 'id is uuid');
select col_has_default('public', 'photo_logs', 'id', 'id has a default (gen_random_uuid)');

select col_type_is('public', 'photo_logs', 'work_package_id', 'uuid', 'work_package_id is uuid');
select col_not_null('public', 'photo_logs', 'work_package_id', 'work_package_id is NOT NULL');

select col_type_is('public', 'photo_logs', 'phase', 'photo_phase', 'phase is photo_phase');
select col_not_null('public', 'photo_logs', 'phase', 'phase is NOT NULL');

select col_type_is('public', 'photo_logs', 'storage_path', 'text', 'storage_path is text');
select col_is_null('public', 'photo_logs', 'storage_path', 'storage_path is NULLABLE (NULL = tombstone)');

select col_type_is('public', 'photo_logs', 'superseded_by', 'uuid', 'superseded_by is uuid');
select col_is_null('public', 'photo_logs', 'superseded_by', 'superseded_by is NULLABLE');

select col_type_is('public', 'photo_logs', 'uploaded_by', 'uuid', 'uploaded_by is uuid');
select col_not_null('public', 'photo_logs', 'uploaded_by', 'uploaded_by is NOT NULL');

select col_type_is(
  'public', 'photo_logs', 'created_at',
  'timestamp with time zone',
  'created_at is timestamptz'
);
select col_not_null('public', 'photo_logs', 'created_at', 'created_at is NOT NULL');

select col_type_is(
  'public', 'photo_logs', 'captured_at_client',
  'timestamp with time zone',
  'captured_at_client is timestamptz'
);
select col_is_null(
  'public', 'photo_logs', 'captured_at_client',
  'captured_at_client is NULLABLE (UNTRUSTED device time)'
);

select fk_ok(
  'public', 'photo_logs', 'work_package_id',
  'public', 'work_packages', 'id',
  'work_package_id FK references work_packages.id'
);
select fk_ok(
  'public', 'photo_logs', 'superseded_by',
  'public', 'photo_logs', 'id',
  'superseded_by FK references photo_logs.id (tombstone target)'
);
select fk_ok(
  'public', 'photo_logs', 'uploaded_by',
  'public', 'users', 'id',
  'uploaded_by FK references public.users.id'
);

-- ADR 0015 well-formedness invariant: every row is either a real photo
-- (storage_path NOT NULL, superseded_by NULL) or a tombstone (storage_path
-- NULL, superseded_by NOT NULL) — never malformed. Catalog assertion that
-- the constraint exists by name; behavioral assertions in section F prove
-- it fires correctly.
select is(
  (select count(*)::int from pg_constraint
     where conrelid = 'public.photo_logs'::regclass
       and contype = 'c'
       and conname = 'photo_logs_path_supersede_well_formed'),
  1,
  'CHECK constraint photo_logs_path_supersede_well_formed exists'
);

select has_index(
  'public', 'photo_logs', 'photo_logs_superseded_by_idx',
  'partial index on superseded_by exists (ADR 0009 anti-join requirement)'
);
select has_index(
  'public', 'photo_logs', 'photo_logs_work_package_id_idx',
  'index on work_package_id exists'
);

-- ============================================================================
-- C. RLS configuration.
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'public.photo_logs'::regclass),
  true,
  'RLS enabled on public.photo_logs'
);

-- Policy commands on photo_logs are exactly INSERT + SELECT — NO UPDATE,
-- NO DELETE. Load-bearing per ADR 0004 / ADR 0015 (append-only).
select results_eq(
  $$ select cmd::text from pg_policies
     where schemaname = 'public' and tablename = 'photo_logs'
     order by cmd $$,
  array['INSERT'::text, 'SELECT'::text],
  'photo_logs has exactly INSERT/SELECT policies — no UPDATE, no DELETE policy'
);

-- ============================================================================
-- D. REVOKE privileges (layer 1 of triple enforcement).
-- ============================================================================

select ok(
  not has_table_privilege('authenticated', 'public.photo_logs', 'UPDATE'),
  'authenticated role lacks UPDATE on photo_logs'
);
select ok(
  not has_table_privilege('authenticated', 'public.photo_logs', 'DELETE'),
  'authenticated role lacks DELETE on photo_logs'
);

-- ============================================================================
-- E. Append-only enforcement — trigger as LAST line of defense (layer 3).
--
--    Insert as postgres (the test transaction's outer role), which bypasses
--    both layer 1 (REVOKE) and layer 2 (RLS). The trigger MUST still block
--    UPDATE and DELETE attempts. Mirrors 04-audit-log-immutability.test.sql.
-- ============================================================================

insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
          'before'::public.photo_phase,
          'projects/A1/before/fixture.jpg',
          '11111111-1111-1111-1111-111111111111'::uuid);

select throws_ok(
  $$ update public.photo_logs
     set storage_path = 'projects/A1/before/hacked.jpg'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  'P0001',
  'photo_logs is append-only',
  'trigger raises on UPDATE attempt (last line of defense)'
);

select throws_ok(
  $$ delete from public.photo_logs
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  'P0001',
  'photo_logs is append-only',
  'trigger raises on DELETE attempt (last line of defense)'
);

-- ============================================================================
-- F. CHECK constraint behavioral — well-formedness invariant from ADR 0015.
--
--    The constraint encodes: ((storage_path IS NULL) = (superseded_by IS NOT
--    NULL)). Every row must be EITHER a real photo (path set, supersedes
--    nothing) OR a well-formed tombstone (no path, supersedes something).
--    23514 is check_violation.
-- ============================================================================

-- F.1 Real photo — well-formed.
select lives_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'before'::public.photo_phase,
             'projects/A1/before/F1-real.jpg',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'real photo (storage_path set, superseded_by NULL) satisfies CHECK'
);

-- F.2 Tombstone — well-formed. Supersedes the section-E fixture row.
select lives_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'before'::public.photo_phase,
             null,
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'tombstone (storage_path NULL, superseded_by set) satisfies CHECK'
);

-- F.3 Both NULL — malformed (neither a photo nor a tombstone).
select throws_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'before'::public.photo_phase,
             null,
             null,
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '23514',
  null,
  'CHECK rejects malformed row with both storage_path NULL and superseded_by NULL'
);

-- F.4 Both set — malformed (real photos cannot themselves supersede).
select throws_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'before'::public.photo_phase,
             'projects/A1/before/F4-hybrid.jpg',
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '23514',
  null,
  'CHECK rejects malformed row with both storage_path set and superseded_by set'
);

-- ============================================================================
-- G. Tombstone + anti-join current-state behavior (ADR 0015 + ADR 0009).
--
--    Uses the isolated fixture WP (ffffffff-…) so the result count is
--    independent of the rows added in earlier sections. Insert 2 real
--    photos (A, B) for WP2/before, then a tombstone superseding A. The
--    "current photos" query is the ADR 0009 anti-join PLUS the
--    storage_path IS NOT NULL tombstone filter — must return only B.
-- ============================================================================

insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by)
  values
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
     'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
     'before'::public.photo_phase,
     'projects/A2/before/anti-join-A.jpg',
     '11111111-1111-1111-1111-111111111111'::uuid),
    ('cccccc11-cccc-cccc-cccc-cccccccccccc'::uuid,
     'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
     'before'::public.photo_phase,
     'projects/A2/before/anti-join-B.jpg',
     '11111111-1111-1111-1111-111111111111'::uuid);

-- Tombstone removing photo A. Two appends (real-B already present plus
-- this tombstone) = the "replacement is two appends" pattern per ADR 0015.
insert into public.photo_logs
  (work_package_id, phase, storage_path, superseded_by, uploaded_by)
  values ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
          'before'::public.photo_phase,
          null,
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
          '11111111-1111-1111-1111-111111111111'::uuid);

select is(
  (select count(*)::int
   from public.photo_logs pl
   where pl.work_package_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
     and pl.phase = 'before'::public.photo_phase
     and pl.storage_path is not null
     and not exists (
       select 1 from public.photo_logs newer
       where newer.superseded_by = pl.id
     )),
  1,
  'anti-join + storage_path filter returns exactly 1 surviving real photo'
);

select is(
  (select id
   from public.photo_logs pl
   where pl.work_package_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
     and pl.phase = 'before'::public.photo_phase
     and pl.storage_path is not null
     and not exists (
       select 1 from public.photo_logs newer
       where newer.superseded_by = pl.id
     )),
  'cccccc11-cccc-cccc-cccc-cccccccccccc'::uuid,
  'the surviving row is photo B (un-tombstoned) — not A (tombstoned), not the tombstone row'
);

-- ============================================================================
-- H. Role-gated INSERT under authenticated. From here every assertion's
--    TAP-recording insert hits _tap_buf as the authenticated role; hence
--    the grants in section A.
-- ============================================================================

set local role authenticated;

-- H.1 super_admin can INSERT.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select lives_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'during'::public.photo_phase,
             'projects/A1/during/by-super.jpg',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'super_admin can INSERT into photo_logs'
);

-- H.2 site_admin can INSERT.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select lives_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'during'::public.photo_phase,
             'projects/A1/during/by-sa.jpg',
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'site_admin can INSERT into photo_logs'
);

-- H.3 project_manager can INSERT.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'during'::public.photo_phase,
             'projects/A1/during/by-pm.jpg',
             '33333333-3333-3333-3333-333333333333'::uuid) $$,
  'project_manager can INSERT into photo_logs'
);

-- H.4 visitor INSERT is denied (RLS WITH CHECK violation → SQLSTATE 42501).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'during'::public.photo_phase,
             'projects/A1/during/by-visitor.jpg',
             '44444444-4444-4444-4444-444444444444'::uuid) $$,
  '42501',
  null,
  'visitor INSERT on photo_logs is denied by RLS'
);

-- ============================================================================
-- I. Role-gated SELECT visibility.
-- ============================================================================

-- I.1 super_admin sees rows.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select isnt(
  (select count(*)::int from public.photo_logs),
  0,
  'super_admin sees at least one photo_log'
);

-- I.2 site_admin sees rows.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select isnt(
  (select count(*)::int from public.photo_logs),
  0,
  'site_admin sees at least one photo_log'
);

-- I.3 project_manager sees rows.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select isnt(
  (select count(*)::int from public.photo_logs),
  0,
  'project_manager sees at least one photo_log'
);

-- I.4 visitor sees NOTHING. Load-bearing for the role-level read contract.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is(
  (select count(*)::int from public.photo_logs),
  0,
  'visitor sees no photo_logs'
);

-- ============================================================================
-- J. Phase enum + FK rejection. Run as postgres so we know any failure is
--    from the constraint being tested, not from RLS.
-- ============================================================================

reset role;

-- J.1 Phase enum rejects values outside before/during/after. 22P02 is
--     invalid_text_representation (raised by the enum input function).
select throws_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, uploaded_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'in_progress'::public.photo_phase,
             'projects/A1/J1-bad-phase.jpg',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '22P02',
  null,
  'phase enum rejects values outside before/during/after'
);

-- J.2 work_package_id FK rejects a non-existent WP. 23503 is
--     foreign_key_violation.
select throws_ok(
  $$ insert into public.photo_logs
       (work_package_id, phase, storage_path, uploaded_by)
     values ('00000000-0000-0000-0000-000000000999'::uuid,
             'before'::public.photo_phase,
             'projects/A1/J2-bad-wp.jpg',
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
