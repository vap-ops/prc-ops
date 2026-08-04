begin;
select plan(43);

-- ============================================================================
-- Spec 394 U1 — เลือกรูปเข้ารายงานลูกค้า: the per-photo selection store.
--
-- Its own table, keyed by photo, because the two obvious homes are both wrong:
-- `photo_logs` is genuinely append-only (`photo_logs_block_update` raises on
-- UPDATE, so a mutable flag there is impossible), and sharing
-- `wp_catalog_reference_photos` via a `purpose` column would key two different
-- natural keys off one nullable CHECK-policed column — the mixed-content
-- reference column CLAUDE.md bans — and would re-collapse the two-judgments
-- distinction the spec exists to preserve.
--
-- ⚠️ `work_package_id` is stored, and it is the ONE denormalisation accepted
-- here: `position` is scoped WITHIN a work package (D6) so the unique index
-- needs a partition, and a photo's WP is immutable (photo_logs is append-only)
-- so it cannot drift. `project_id` stays DERIVED — one join, always correct.
--
-- ⚠️ The unique index is DEFERRABLE INITIALLY DEFERRED on purpose: a reorder
-- shuffles several rows in one statement and a non-deferred index would trip
-- mid-update. The full-reversal assert below is that clause's positive
-- control — it is the one case that cannot pass without it.
--
-- Gate is PM_ROLES (project_manager + super_admin + project_director) AND
-- can_see_project. All three PM_ROLES members can pass can_see_project
-- (super_admin/project_director blanket, project_manager by membership), so no
-- arm here is unreachable — checked live before writing this file.
-- ============================================================================

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0394-0394-0394-700000000394', 'pm@s394.local',      '{}'::jsonb),
  ('71000000-0394-0394-0394-710000000394', 'sa@s394.local',      '{}'::jsonb),
  ('72000000-0394-0394-0394-720000000394', 'pmout@s394.local',   '{}'::jsonb);
update public.users set role = 'project_manager' where id = '70000000-0394-0394-0394-700000000394';
update public.users set role = 'site_admin'      where id = '71000000-0394-0394-0394-710000000394';
update public.users set role = 'project_manager' where id = '72000000-0394-0394-0394-720000000394';

insert into public.projects (id, code, name) values
  ('a1000000-0394-0394-0394-a10000000394', 'TAP-394', 'โครงการทดสอบเลือกรูป');

-- The PM and the site_admin are on the project; the SECOND project_manager is
-- deliberately NOT — `can_see_project` is membership-scoped for that role, so
-- they are the control that proves the gate is project-scoped and not merely
-- role-scoped.
-- `added_by` is NOT NULL — omitting it errors the whole file with 23502 rather
-- than failing an assertion, which reads as a red for the wrong reason.
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0394-0394-0394-a10000000394', '70000000-0394-0394-0394-700000000394',
   '70000000-0394-0394-0394-700000000394'),
  ('a1000000-0394-0394-0394-a10000000394', '71000000-0394-0394-0394-710000000394',
   '70000000-0394-0394-0394-700000000394');

insert into public.work_packages (id, project_id, code, name, is_group, status) values
  ('d1000000-0394-0394-0394-d10000000394', 'a1000000-0394-0394-0394-a10000000394',
   'W394-01', 'งานเทพื้น', false, 'complete'),
  ('d2000000-0394-0394-0394-d20000000394', 'a1000000-0394-0394-0394-a10000000394',
   'W394-02', 'งานติดตั้งหลังคา', false, 'complete');

insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('f1000000-0394-0394-0394-f10000000394', 'd1000000-0394-0394-0394-d10000000394',
   'after', 'p/394/a1.jpg', '70000000-0394-0394-0394-700000000394'),
  ('f2000000-0394-0394-0394-f20000000394', 'd1000000-0394-0394-0394-d10000000394',
   'after', 'p/394/a2.jpg', '70000000-0394-0394-0394-700000000394'),
  ('f3000000-0394-0394-0394-f30000000394', 'd1000000-0394-0394-0394-d10000000394',
   'before', 'p/394/b1.jpg', '70000000-0394-0394-0394-700000000394'),
  ('f5000000-0394-0394-0394-f50000000394', 'd1000000-0394-0394-0394-d10000000394',
   'after', 'p/394/a3.jpg', '70000000-0394-0394-0394-700000000394'),
  -- a photo on the OTHER work package, for the reorder cross-WP control
  ('f9000000-0394-0394-0394-f90000000394', 'd2000000-0394-0394-0394-d20000000394',
   'after', 'p/394/c1.jpg', '70000000-0394-0394-0394-700000000394');

-- ⚠️ Gate-check finding: `photo_logs_path_supersede_well_formed` is
-- CHECK ((storage_path IS NULL) = (superseded_by IS NOT NULL)) — so a
-- tombstone and a supersede pointer are the SAME row. There is no such thing
-- as a path-less photo that supersedes nothing (the first draft of this
-- fixture assumed there was, and errored the whole file with 23514). f6 is the
-- tombstone that removes f5: f6 itself has no file, and f5 is the row it
-- points at. Both must be unselectable, for different reasons.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, superseded_by) values
  ('f6000000-0394-0394-0394-f60000000394', 'd1000000-0394-0394-0394-d10000000394',
   'after', null, '70000000-0394-0394-0394-700000000394',
   'f5000000-0394-0394-0394-f50000000394');

-- ============================================================================
-- A. Catalog + posture. No write grant reaches `authenticated` — every write
--    goes through the DEFINER RPCs, mirroring how starring works.
-- ============================================================================
select has_table('public', 'report_selected_photos', 'the selection table exists');
select col_is_pk('public', 'report_selected_photos', 'photo_log_id',
  'one row per photo — the PK is the photo, so re-selecting cannot duplicate');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.report_selected_photos'::regclass),
  'RLS is enabled');

select ok(
  has_table_privilege('authenticated', 'public.report_selected_photos', 'SELECT'),
  'authenticated may SELECT (the toggle has to read its own state)');
select ok(
  not has_table_privilege('authenticated', 'public.report_selected_photos', 'INSERT'),
  'authenticated may NOT INSERT directly');
select ok(
  not has_table_privilege('authenticated', 'public.report_selected_photos', 'UPDATE'),
  'authenticated may NOT UPDATE directly');
select ok(
  not has_table_privilege('authenticated', 'public.report_selected_photos', 'DELETE'),
  'authenticated may NOT DELETE directly');
select ok(
  not has_table_privilege('anon', 'public.report_selected_photos', 'SELECT'),
  'anon may not read the table at all');

select ok(
  (select bool_and(prosecdef) from pg_proc
    where proname in ('select_report_photo', 'unselect_report_photo', 'reorder_report_photos')),
  'all three RPCs are SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc
    where proname in ('select_report_photo', 'unselect_report_photo', 'reorder_report_photos')),
  3,
  'all three RPCs exist, and exactly once each (an overload would strand the caller)');

-- `has_function_privilege` resolves PUBLIC through role inheritance; the
-- `information_schema` view has no PUBLIC arm at all, so it reads "safe" for
-- both answers (the spec-363 blind spot).
select ok(
  not has_function_privilege('anon', 'public.select_report_photo(uuid)', 'EXECUTE'),
  'anon cannot execute select_report_photo');
select ok(
  not has_function_privilege('anon', 'public.unselect_report_photo(uuid)', 'EXECUTE'),
  'anon cannot execute unselect_report_photo');
select ok(
  not has_function_privilege('anon', 'public.reorder_report_photos(uuid, uuid[])', 'EXECUTE'),
  'anon cannot execute reorder_report_photos');

-- ============================================================================
-- B. The gate. Every refusal is paired with a positive control in the SAME
--    transaction — without it, a green refusal is equally consistent with
--    "the RPC refuses everyone".
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0394-0394-0394-710000000394"}';
select throws_ok(
  $$ select public.select_report_photo('f1000000-0394-0394-0394-f10000000394') $$,
  '42501', null,
  'a site_admin cannot select a photo for the client report');
select throws_ok(
  $$ select public.unselect_report_photo('f1000000-0394-0394-0394-f10000000394') $$,
  '42501', null,
  'a site_admin cannot unselect');
select throws_ok(
  $$ select public.reorder_report_photos('d1000000-0394-0394-0394-d10000000394', array['f1000000-0394-0394-0394-f10000000394']::uuid[]) $$,
  '42501', null,
  'a site_admin cannot reorder');
reset role;

-- The project_manager who is NOT a member of this project: right role, wrong
-- project. This is what makes the gate project-scoped rather than role-only.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0394-0394-0394-720000000394"}';
select throws_ok(
  $$ select public.select_report_photo('f1000000-0394-0394-0394-f10000000394') $$,
  '42501', null,
  'a project_manager who cannot see the project is refused');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0394-0394-0394-700000000394"}';
select lives_ok(
  $$ select public.select_report_photo('f1000000-0394-0394-0394-f10000000394') $$,
  'POSITIVE CONTROL — the project''s own project_manager succeeds in the same transaction');

select throws_ok(
  $$ select public.select_report_photo('00000000-0000-0000-0000-000000000000') $$,
  '22023', null,
  'an unknown photo is a permanent refusal');
select throws_ok(
  $$ select public.select_report_photo('f6000000-0394-0394-0394-f60000000394') $$,
  '22023', null,
  'a tombstone row (no file of its own) cannot be put in front of a client');
select throws_ok(
  $$ select public.select_report_photo('f5000000-0394-0394-0394-f50000000394') $$,
  '22023', null,
  'a superseded photo cannot be selected');

-- ============================================================================
-- C. Append, idempotence, and the gap-closing unselect.
-- ============================================================================
-- `position` is quoted throughout: it is a Postgres col_name_keyword, so a
-- bare `select position from t` makes the parser look for position(x in y).
select is(
  (select r."position" from public.report_selected_photos r
    where r.photo_log_id = 'f1000000-0394-0394-0394-f10000000394'),
  1,
  'the first selection lands at position 1');

select is(
  (public.select_report_photo('f2000000-0394-0394-0394-f20000000394'))->>'position',
  '2',
  'the next selection appends at max(position) + 1');

select is(
  (public.select_report_photo('f1000000-0394-0394-0394-f10000000394'))->>'changed',
  'false',
  're-selecting an already-selected photo is a no-op, not an error');
select is(
  (select count(*)::int from public.report_selected_photos
    where work_package_id = 'd1000000-0394-0394-0394-d10000000394'),
  2,
  'and it writes no second row');

select is(
  (public.select_report_photo('f3000000-0394-0394-0394-f30000000394'))->>'position',
  '3',
  'every phase is selectable — a before photo can sit beside its after');

-- Remove the MIDDLE one: the gap must close, or the next append collides with
-- a position that already exists.
select lives_ok(
  $$ select public.unselect_report_photo('f2000000-0394-0394-0394-f20000000394') $$,
  'the project_manager can unselect');
select results_eq(
  $$ select photo_log_id, "position" from public.report_selected_photos
      where work_package_id = 'd1000000-0394-0394-0394-d10000000394' order by "position" $$,
  $$ values ('f1000000-0394-0394-0394-f10000000394'::uuid, 1),
            ('f3000000-0394-0394-0394-f30000000394'::uuid, 2) $$,
  'unselecting closes the gap — positions stay dense');

select is(
  (public.unselect_report_photo('f2000000-0394-0394-0394-f20000000394'))->>'changed',
  'false',
  'unselecting something that is not selected is a no-op, not an error');

-- ============================================================================
-- D. Reorder — whole-list, and it refuses a stale client.
-- ============================================================================
select throws_ok(
  $$ select public.reorder_report_photos('d1000000-0394-0394-0394-d10000000394',
       array['f1000000-0394-0394-0394-f10000000394']::uuid[]) $$,
  '22023', null,
  'a list MISSING a currently-selected photo is refused — a stale client must re-read');
select throws_ok(
  $$ select public.reorder_report_photos('d1000000-0394-0394-0394-d10000000394',
       array['f1000000-0394-0394-0394-f10000000394',
             'f3000000-0394-0394-0394-f30000000394',
             'f9000000-0394-0394-0394-f90000000394']::uuid[]) $$,
  '22023', null,
  'a list carrying a photo from another WP is refused');
select throws_ok(
  $$ select public.reorder_report_photos('d1000000-0394-0394-0394-d10000000394',
       array['f1000000-0394-0394-0394-f10000000394',
             'f1000000-0394-0394-0394-f10000000394']::uuid[]) $$,
  '22023', null,
  'a list with a duplicate is refused');

-- THE deferrable-constraint control: a full reversal makes every row swap
-- position at once. With a non-deferred unique index this statement cannot
-- commit, so this assert is what proves the `deferrable` clause is load-bearing.
select lives_ok(
  $$ select public.reorder_report_photos('d1000000-0394-0394-0394-d10000000394',
       array['f3000000-0394-0394-0394-f30000000394',
             'f1000000-0394-0394-0394-f10000000394']::uuid[]) $$,
  'a FULL REVERSAL commits — the deferrable unique index is doing its job');
select results_eq(
  $$ select photo_log_id, "position" from public.report_selected_photos
      where work_package_id = 'd1000000-0394-0394-0394-d10000000394' order by "position" $$,
  $$ values ('f3000000-0394-0394-0394-f30000000394'::uuid, 1),
            ('f1000000-0394-0394-0394-f10000000394'::uuid, 2) $$,
  'and the order is exactly what was sent');

-- ============================================================================
-- E. The read side. The SELECT policy is PM_ROLES + project visibility, so it
--    must ADMIT the project's PM and REFUSE a site_admin on the same project —
--    the pair is what distinguishes "the policy works" from "the policy is
--    gone" or "the policy denies everyone".
-- ============================================================================
select is(
  (select count(*)::int from public.report_selected_photos),
  2,
  'the project''s own project_manager reads its selections');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0394-0394-0394-710000000394"}';
select is(
  (select count(*)::int from public.report_selected_photos),
  0,
  'a site_admin ON THE SAME PROJECT reads none of them');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0394-0394-0394-720000000394"}';
select is(
  (select count(*)::int from public.report_selected_photos),
  0,
  'a project_manager who cannot see the project reads none of them');
reset role;

-- ============================================================================
-- F. Audit + cascade.
-- ============================================================================
select ok(
  exists (select 1 from public.audit_log
           where target_table = 'report_selected_photos'
             and payload->>'event' = 'report_photo_selected'
             and target_id = 'f1000000-0394-0394-0394-f10000000394'),
  'selecting writes an audit row');
select ok(
  exists (select 1 from public.audit_log
           where target_table = 'report_selected_photos'
             and payload->>'event' = 'report_photo_unselected'),
  'unselecting writes an audit row');
select ok(
  exists (select 1 from public.audit_log
           where target_table = 'report_selected_photos'
             and payload->>'event' = 'report_photos_reordered'),
  'reordering writes an audit row');
select ok(
  (select actor_role from public.audit_log
    where target_table = 'report_selected_photos'
      and payload->>'event' = 'report_photo_selected'
    order by created_at desc limit 1) = 'project_manager',
  'the audit row records WHO, by role');

-- ⚠️ The photo-side cascade cannot be exercised, and that is worth stating
-- rather than quietly dropping: `photo_logs_block_write` raises P0001 on
-- DELETE (append-only, ADR 0004), so no photo row can ever be removed outside
-- break-glass. The first draft of this file deleted one and errored the whole
-- file for that reason. So both cascades are pinned in the CATALOG — the WP
-- one is reachable (a project hard-delete removes WPs), the photo one is
-- defensive.
select is(
  (select confdeltype from pg_constraint
    where conrelid = 'public.report_selected_photos'::regclass
      and confrelid = 'public.photo_logs'::regclass),
  'c'::"char",
  'the photo FK is ON DELETE CASCADE (defensive — photo_logs is append-only)');
select is(
  (select confdeltype from pg_constraint
    where conrelid = 'public.report_selected_photos'::regclass
      and confrelid = 'public.work_packages'::regclass),
  'c'::"char",
  'the work-package FK is ON DELETE CASCADE — a hard-deleted WP takes its selections with it');

select * from finish();
rollback;
