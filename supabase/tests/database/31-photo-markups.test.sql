begin;
select plan(25);

-- ============================================================================
-- Spec 51 — photo_markups: append-only overlay markup on WP photos.
-- Sections: B catalog/posture, C checks + trigger (postgres), D role-sim RLS.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-11111111bbbb', 'pm@pmk-test.local',      '{}'::jsonb),
  ('22222222-2222-2222-2222-22222222bbbb', 'sa1@pmk-test.local',     '{}'::jsonb),
  ('55555555-5555-5555-5555-55555555bbbb', 'sa2@pmk-test.local',     '{}'::jsonb),
  ('44444444-4444-4444-4444-44444444bbbb', 'visitor@pmk-test.local', '{}'::jsonb);

update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-11111111bbbb';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-22222222bbbb';
update public.users set role = 'site_admin'      where id = '55555555-5555-5555-5555-55555555bbbb';
-- 4444…bbbb keeps default 'visitor'.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-ccccccccbbbb', 'PRC-TEST-PMK', 'PMK fixture project');

-- Spec 143 / ADR 0056: visibility is now membership-scoped — enrol this
-- fixture's PM/site_admin users so they can read the project.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-TEST-PMK')
     and u.id in (select au.id from auth.users au where au.email like '%@pmk-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeebbbb',
   'cccccccc-cccc-cccc-cccc-ccccccccbbbb', 'WP-PMK-1', 'PMK fixture WP');
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeebbbb', 'before',
   'cccccccc-cccc-cccc-cccc-ccccccccbbbb/eeeeeeee-eeee-eeee-eeee-eeeeeeeebbbb/f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg',
   '22222222-2222-2222-2222-22222222bbbb');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog + posture.
-- ============================================================================

select has_table('public', 'photo_markups', 'photo_markups table exists');
select has_view('public', 'photo_markups_current', 'current-state view exists');
select has_index('public', 'photo_markups', 'photo_markups_photo_idx', 'parent index exists');
select is((select relrowsecurity from pg_class where oid = 'public.photo_markups'::regclass),
  true, 'RLS enabled');
select policies_are('public', 'photo_markups',
  array['photo_markups readable by privileged roles',
        'photo_markups insert content or own tombstone'],
  'exactly the two policies — zero UPDATE/DELETE policies');
select is(has_table_privilege('authenticated', 'public.photo_markups', 'UPDATE'),
  false, 'authenticated has NO UPDATE privilege (layer 1)');
select is(has_table_privilege('authenticated', 'public.photo_markups', 'DELETE'),
  false, 'authenticated has NO DELETE privilege (layer 1)');

-- ============================================================================
-- C. Checks + trigger, as postgres (bypasses RLS, hits layer 3).
-- ============================================================================

-- Content row for trigger/view probes (postgres bypasses RLS, not CHECKs).
insert into public.photo_markups (id, photo_log_id, strokes, comment, created_by) values
  ('a1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '[{"points": [[0.1, 0.1], [0.9, 0.9]]}]'::jsonb, 'fixture comment',
   '11111111-1111-1111-1111-11111111bbbb');

select throws_ok(
  $$ insert into public.photo_markups (photo_log_id, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             '11111111-1111-1111-1111-11111111bbbb') $$,
  '23514', null,
  'malformed: no payload + supersedes nothing is rejected (well-formedness CHECK)');

select throws_ok(
  $$ insert into public.photo_markups (photo_log_id, comment, superseded_by, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'payload on a tombstone',
             'a1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             '11111111-1111-1111-1111-11111111bbbb') $$,
  '23514', null,
  'malformed: payload + supersedes something is rejected (no atomic replacement)');

select throws_ok(
  $$ insert into public.photo_markups (photo_log_id, comment, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', repeat('x', 1001),
             '11111111-1111-1111-1111-11111111bbbb') $$,
  '23514', null,
  'comment over 1000 chars is rejected');

select throws_ok(
  $$ update public.photo_markups set comment = 'edited'
     where id = 'a1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'P0001', null,
  'UPDATE raises via the append-only trigger (layer 3)');

select throws_ok(
  $$ delete from public.photo_markups
     where id = 'a1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'P0001', null,
  'DELETE raises via the append-only trigger (layer 3)');

select results_eq(
  $$ select id from public.photo_markups_current
     where photo_log_id = 'f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  $$ values ('a1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid) $$,
  'current view returns the content row before any tombstone');

-- ============================================================================
-- D. Role-sim RLS matrix.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222bbbb"}';

select lives_ok(
  $$ insert into public.photo_markups (id, photo_log_id, comment, created_by)
     values ('a2000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             'f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SA1 comment',
             '22222222-2222-2222-2222-22222222bbbb') $$,
  'site_admin can add a comment-only markup');

select lives_ok(
  $$ insert into public.photo_markups (photo_log_id, strokes, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             '[{"points": [[0.2, 0.2], [0.4, 0.6]]}]'::jsonb,
             '22222222-2222-2222-2222-22222222bbbb') $$,
  'site_admin can add a strokes-only markup');

select throws_ok(
  $$ insert into public.photo_markups (photo_log_id, comment, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'forged author',
             '55555555-5555-5555-5555-55555555bbbb') $$,
  '42501', null,
  'INSERT with a foreign created_by is denied (creator pin)');

-- SA2: cannot tombstone SA1's markup (creator-only removal).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-55555555bbbb"}';
select throws_ok(
  $$ insert into public.photo_markups (photo_log_id, superseded_by, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             'a2000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             '55555555-5555-5555-5555-55555555bbbb') $$,
  '42501', null,
  'foreign-creator tombstone is denied by RLS');

-- Visitor: nothing.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-44444444bbbb"}';
select throws_ok(
  $$ insert into public.photo_markups (photo_log_id, comment, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'visitor comment',
             '44444444-4444-4444-4444-44444444bbbb') $$,
  '42501', null,
  'visitor INSERT is denied');
select results_eq(
  $$ select count(*)::int from public.photo_markups $$,
  $$ values (0) $$,
  'visitor sees zero markup rows (SELECT role gate)');

-- SA1 tombstones their own markup; the view drops it.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222bbbb"}';
select lives_ok(
  $$ insert into public.photo_markups (photo_log_id, superseded_by, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             'a2000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             '22222222-2222-2222-2222-22222222bbbb') $$,
  'creator tombstones their own markup');

select results_eq(
  $$ select count(*)::int from public.photo_markups_current
     where id = 'a2000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  $$ values (0) $$,
  'tombstoned markup leaves the current-state view');

select throws_ok(
  $$ insert into public.photo_markups (photo_log_id, superseded_by, created_by)
     values ('f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             'a2000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             '22222222-2222-2222-2222-22222222bbbb') $$,
  '23505', null,
  'second tombstone for the same target is rejected (partial unique index)');

-- PM still reads the surviving rows (role-gated SELECT).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-11111111bbbb"}';
select results_eq(
  $$ select count(*)::int from public.photo_markups_current
     where photo_log_id = 'f1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  $$ values (2) $$,
  'PM reads the two surviving content rows via the view');

-- Authenticated UPDATE/DELETE die at the privilege layer (layer 1).
select throws_ok(
  $$ update public.photo_markups set comment = 'x'
     where id = 'a1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501', null,
  'authenticated UPDATE denied at the privilege layer');
select throws_ok(
  $$ delete from public.photo_markups
     where id = 'a1000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  '42501', null,
  'authenticated DELETE denied at the privilege layer');

reset role;

select * from finish();
rollback;
