begin;
select plan(18);

-- ============================================================================
-- Spec 248 U1 — defect photos + answers_photo_id pairing.
--   M1: photo_phase += 'defect'.
--   M2: answers_photo_id column/CHECK/index + BEFORE INSERT guard trigger
--       (pairing validation + defect-removal role gate) + uploaded_by pin on
--       the INSERT policy + client-portal defect exclusion.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11110000-0000-4000-8000-000000024801', 'super@s248.local', '{}'::jsonb),
  ('22220000-0000-4000-8000-000000024801', 'sa@s248.local',    '{}'::jsonb),
  ('33330000-0000-4000-8000-000000024801', 'pm@s248.local',    '{}'::jsonb),
  ('dddd0000-0000-4000-8000-000000024801', 'client@s248.local','{}'::jsonb);

update public.users set role='super_admin'     where id='11110000-0000-4000-8000-000000024801';
update public.users set role='site_admin'      where id='22220000-0000-4000-8000-000000024801';
update public.users set role='project_manager' where id='33330000-0000-4000-8000-000000024801';
update public.users set role='client'          where id='dddd0000-0000-4000-8000-000000024801';

-- P1 (internal): PM lead, SA member. WP1 in rework round 1 + WP1b sibling.
-- P2 (client-visible): WP2 complete, live portal grant for the client user.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1110000-0000-4000-8000-000000024801', 'PRC-248-P1', 'โครงการจับคู่รูป',
   '33330000-0000-4000-8000-000000024801'),
  ('a2220000-0000-4000-8000-000000024801', 'PRC-248-P2', 'โครงการลูกค้า',
   '33330000-0000-4000-8000-000000024801');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1110000-0000-4000-8000-000000024801',
   '22220000-0000-4000-8000-000000024801', '11110000-0000-4000-8000-000000024801');
insert into public.work_packages (id, project_id, code, name, status, rework_round) values
  ('c1110000-0000-4000-8000-000000024801', 'a1110000-0000-4000-8000-000000024801', 'WP-1',  'งานหลัก', 'rework',   1),
  ('c1bb0000-0000-4000-8000-000000024801', 'a1110000-0000-4000-8000-000000024801', 'WP-1b', 'งานรอง',  'rework',   1),
  ('c2220000-0000-4000-8000-000000024801', 'a2220000-0000-4000-8000-000000024801', 'WP-2',  'งานลูกค้า', 'complete', 1);

insert into public.client_portal_access (user_id, project_id, granted_by, expires_at, revoked_at, revoked_by) values
  ('dddd0000-0000-4000-8000-000000024801', 'a2220000-0000-4000-8000-000000024801',
   '11110000-0000-4000-8000-000000024801', now() + interval '30 days', null, null);

-- Fixture photos (superuser; RLS not yet in play):
--   D1  defect round 1 on WP1 (the live pairing target)
--   D0  defect round 0 on WP1 (stale round — cross-round test)
--   DT  defect round 1 on WP1, tombstoned (TT) — tombstoned-target test
--   A1  after (original cycle) on WP1 — non-defect-target test
--   D2  defect round 1 on WP2 (complete) + A2 after on WP2 — portal read tests
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, rework_round) values
  ('d1110000-0000-4000-8000-000000024801', 'c1110000-0000-4000-8000-000000024801', 'defect', 'p248/d1.jpg', '33330000-0000-4000-8000-000000024801', 1),
  ('d0000000-0000-4000-8000-000000024801', 'c1110000-0000-4000-8000-000000024801', 'defect', 'p248/d0.jpg', '33330000-0000-4000-8000-000000024801', 0),
  ('de110000-0000-4000-8000-000000024801', 'c1110000-0000-4000-8000-000000024801', 'defect', 'p248/dt.jpg', '33330000-0000-4000-8000-000000024801', 1),
  ('a1110000-0000-4000-8000-000000024801', 'c1110000-0000-4000-8000-000000024801', 'after',  'p248/a1.jpg', '22220000-0000-4000-8000-000000024801', 0),
  ('d2220000-0000-4000-8000-000000024801', 'c2220000-0000-4000-8000-000000024801', 'defect', 'p248/d2.jpg', '33330000-0000-4000-8000-000000024801', 1),
  ('a2220000-0000-4000-8000-000000024801', 'c2220000-0000-4000-8000-000000024801', 'after',  'p248/a2.jpg', '33330000-0000-4000-8000-000000024801', 0);
-- Tombstone of DT. The guard trigger's removal gate reads current_user_role()
-- (fail-closed on NULL), so even this superuser fixture insert must carry the
-- PM's identity in the JWT claims.
set local "request.jwt.claims" = '{"sub": "33330000-0000-4000-8000-000000024801"}';
insert into public.photo_logs (id, work_package_id, phase, storage_path, superseded_by, uploaded_by, rework_round) values
  ('ee110000-0000-4000-8000-000000024801', 'c1110000-0000-4000-8000-000000024801', 'defect', null,
   'de110000-0000-4000-8000-000000024801', '33330000-0000-4000-8000-000000024801', 1);
set local "request.jwt.claims" = '';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select ok('defect' = any(enum_range(null::public.photo_phase)::text[]),
  'photo_phase enum carries the defect value');
select has_column('public', 'photo_logs', 'answers_photo_id',
  'photo_logs.answers_photo_id exists');
select ok(exists(select 1 from pg_constraint
    where conrelid = 'public.photo_logs'::regclass
      and conname = 'photo_logs_answer_only_on_real_photo'),
  'tombstones-never-answer CHECK exists');
select ok(exists(select 1 from pg_trigger
    where tgrelid = 'public.photo_logs'::regclass
      and tgname = 'photo_logs_spec248_guard'),
  'spec-248 BEFORE INSERT guard trigger exists');

-- ============================================================================
-- B. Guard trigger + RLS pin, as the site_admin member.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22220000-0000-4000-8000-000000024801"}';

-- B.1 valid pair: after_fix, same WP, same round, real defect target.
select lives_ok(
  $$ insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, rework_round, answers_photo_id)
     values ('f1110000-0000-4000-8000-000000024801', 'c1110000-0000-4000-8000-000000024801', 'after_fix', 'p248/f1.jpg',
             '22220000-0000-4000-8000-000000024801', 1, 'd1110000-0000-4000-8000-000000024801') $$,
  'a valid same-WP same-round pair inserts');

-- B.2 answers_photo_id on a non-after_fix phase → rejected.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, rework_round, answers_photo_id)
     values ('c1110000-0000-4000-8000-000000024801', 'after', 'p248/x1.jpg',
             '22220000-0000-4000-8000-000000024801', 0, 'd1110000-0000-4000-8000-000000024801') $$,
  '23514', null, 'only after_fix rows may answer');

-- B.3 cross-WP target → rejected.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, rework_round, answers_photo_id)
     values ('c1bb0000-0000-4000-8000-000000024801', 'after_fix', 'p248/x2.jpg',
             '22220000-0000-4000-8000-000000024801', 1, 'd1110000-0000-4000-8000-000000024801') $$,
  '23514', null, 'an answer cannot target another WP''s defect photo');

-- B.4 non-defect target → rejected.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, rework_round, answers_photo_id)
     values ('c1110000-0000-4000-8000-000000024801', 'after_fix', 'p248/x3.jpg',
             '22220000-0000-4000-8000-000000024801', 1, 'a1110000-0000-4000-8000-000000024801') $$,
  '23514', null, 'an answer must target a defect-phase photo');

-- B.5 tombstoned defect target → rejected (target must be a REAL photo).
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, rework_round, answers_photo_id)
     values ('c1110000-0000-4000-8000-000000024801', 'after_fix', 'p248/x4.jpg',
             '22220000-0000-4000-8000-000000024801', 1, 'de110000-0000-4000-8000-000000024801') $$,
  '23514', null, 'an answer cannot target a tombstoned defect photo');

-- B.6 cross-round target → rejected (stale evidence never satisfies a new round).
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, rework_round, answers_photo_id)
     values ('c1110000-0000-4000-8000-000000024801', 'after_fix', 'p248/x5.jpg',
             '22220000-0000-4000-8000-000000024801', 1, 'd0000000-0000-4000-8000-000000024801') $$,
  '23514', null, 'an answer cannot target a prior round''s defect photo');

-- B.7 tombstone carrying answers_photo_id → rejected by the CHECK (ADR 0015:
-- ALL payload columns NULL on a tombstone).
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by, rework_round, answers_photo_id)
     values ('c1110000-0000-4000-8000-000000024801', 'after_fix', null,
             'f1110000-0000-4000-8000-000000024801',
             '22220000-0000-4000-8000-000000024801', 1, 'd1110000-0000-4000-8000-000000024801') $$,
  '23514', null, 'a tombstone can never carry an answer');

-- B.8 plain after_fix tombstone (answers NULL) → fine; SA may remove after_fix.
select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by, rework_round)
     values ('c1110000-0000-4000-8000-000000024801', 'after_fix', null,
             'f1110000-0000-4000-8000-000000024801',
             '22220000-0000-4000-8000-000000024801', 1) $$,
  'an after_fix tombstone with NULL answer inserts (SA may remove after_fix)');

-- B.9 defect tombstone by site_admin → blocked (removal gate: else the gated SA
-- deletes the PM's evidence and dodges the pairing rule).
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by, rework_round)
     values ('c1110000-0000-4000-8000-000000024801', 'defect', null,
             'd1110000-0000-4000-8000-000000024801',
             '22220000-0000-4000-8000-000000024801', 1) $$,
  '42501', null, 'a site_admin cannot tombstone a defect photo');

-- B.10 uploaded_by forgery → blocked by the INSERT policy pin.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, rework_round)
     values ('c1110000-0000-4000-8000-000000024801', 'before', 'p248/x6.jpg',
             '33330000-0000-4000-8000-000000024801', 0) $$,
  '42501', null, 'uploaded_by must be the caller (attribution pin)');

-- B.11 correct uploaded_by still inserts.
select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, rework_round)
     values ('c1110000-0000-4000-8000-000000024801', 'before', 'p248/x7.jpg',
             '22220000-0000-4000-8000-000000024801', 0) $$,
  'a correctly-attributed insert still works');

-- B.12 defect tombstone by the PM → allowed (filing roles own removal).
set local "request.jwt.claims" = '{"sub": "33330000-0000-4000-8000-000000024801"}';
select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by, rework_round)
     values ('c1110000-0000-4000-8000-000000024801', 'defect', null,
             'd0000000-0000-4000-8000-000000024801',
             '33330000-0000-4000-8000-000000024801', 0) $$,
  'a project_manager can tombstone a defect photo');

-- ============================================================================
-- C. Client portal — defect photos never reach the client.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "dddd0000-0000-4000-8000-000000024801"}';
select is(
  (select count(*) from public.photo_logs
    where work_package_id = 'c2220000-0000-4000-8000-000000024801' and phase = 'after'),
  1::bigint, 'client still reads the complete WP''s after photo');
select is(
  (select count(*) from public.photo_logs
    where work_package_id = 'c2220000-0000-4000-8000-000000024801' and phase = 'defect'),
  0::bigint, 'client never reads defect photos, even on a complete WP');

reset role;

select * from finish();
rollback;
