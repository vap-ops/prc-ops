begin;
select plan(20);

-- ============================================================================
-- Spec 372 U4 — the PM says WHICH phases (and, in U4b, which photos) are wrong.
--
-- "ถ่ายรูปใหม่" on a work package carrying a median of 10 photos makes the SA
-- search for an unnamed fault. The cause decides the axis: `incomplete` points at
-- ABSENCE, so only a PHASE can carry it (you cannot tap a photo never taken);
-- `mismatch` points at things that EXIST, so it points at photos.
--
-- One table carries both shapes with a CHECK enforcing exactly-one, so U4b needs
-- no further schema. Writes go through decide_work_package ONLY — the table has a
-- read policy and no write policy at all.
-- ============================================================================

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-1111111104b2', 'super@s372b.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-2222222204b2', 'sa@s372b.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333304b2', 'pm@s372b.local',    '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-1111111104b2';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-2222222204b2';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-3333333304b2';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1a104b2-04b2-04b2-04b2-a1a1a1a104b2', 'PRC-372B', 'โครงการทดสอบ 372b',
   '33333333-3333-3333-3333-3333333304b2');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a104b2-04b2-04b2-04b2-a1a1a1a104b2',
   '22222222-2222-2222-2222-2222222204b2', '11111111-1111-1111-1111-1111111104b2');

insert into public.work_packages (id, project_id, code, name, status, rework_round) values
  ('c1c104b2-04b2-04b2-04b2-c1c1c1c104b2', 'a1a104b2-04b2-04b2-04b2-a1a1a1a104b2',
   'W4-01', 'งานรูปไม่ครบ',    'pending_approval', 0),
  ('c2c204b2-04b2-04b2-04b2-c2c2c2c204b2', 'a1a104b2-04b2-04b2-04b2-a1a1a1a104b2',
   'W4-02', 'งานรูปไม่ตรง',    'pending_approval', 0),
  ('c3c304b2-04b2-04b2-04b2-c3c3c3c304b2', 'a1a104b2-04b2-04b2-04b2-a1a1a1a104b2',
   'W4-03', 'งานกติกา',        'pending_approval', 0),
  ('c4c404b2-04b2-04b2-04b2-c4c4c4c404b2', 'a1a104b2-04b2-04b2-04b2-a1a1a1a104b2',
   'W4-04', 'งานเจ้าของรูปอื่น', 'pending_approval', 0);

-- A current photo on wp2, a SUPERSEDED one on wp2, and one belonging to wp4.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, rework_round) values
  ('d1d104b2-04b2-04b2-04b2-d1d1d1d104b2', 'c2c204b2-04b2-04b2-04b2-c2c2c2c204b2',
   'during', 'p/wp2/current.jpg', '22222222-2222-2222-2222-2222222204b2', 0),
  ('d2d204b2-04b2-04b2-04b2-d2d2d2d204b2', 'c2c204b2-04b2-04b2-04b2-c2c2c2c204b2',
   'during', 'p/wp2/old.jpg',     '22222222-2222-2222-2222-2222222204b2', 0),
  ('d4d404b2-04b2-04b2-04b2-d4d4d4d404b2', 'c4c404b2-04b2-04b2-04b2-c4c4c4c404b2',
   'during', 'p/wp4/other.jpg',   '22222222-2222-2222-2222-2222222204b2', 0);
-- The tombstone that supersedes d2 (ADR 0004 write pattern).
insert into public.photo_logs (id, work_package_id, phase, storage_path, superseded_by, uploaded_by, rework_round) values
  ('d3d304b2-04b2-04b2-04b2-d3d3d3d304b2', 'c2c204b2-04b2-04b2-04b2-c2c2c2c204b2',
   'during', null, 'd2d204b2-04b2-04b2-04b2-d2d2d2d204b2',
   '22222222-2222-2222-2222-2222222204b2', 0);

-- ── A. Shape ────────────────────────────────────────────────────────────────
select has_table('public', 'approval_revision_targets', 'the targets table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.approval_revision_targets'::regclass),
  'RLS is enabled on it');
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.approval_revision_targets'::regclass and polcmd = 'a'),
  0, 'it has NO insert policy — decide_work_package is the only writer');
select ok(
  (select count(*) > 0 from pg_policy where polrelid = 'public.approval_revision_targets'::regclass and polcmd = 'r'),
  'it IS readable — the SA must see which phases came back');

-- ── B. The RPC records phase targets ────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333304b2"}';

select is(
  public.decide_work_package('c1c104b2-04b2-04b2-04b2-c1c1c1c104b2', 'needs_revision',
                             null, 'incomplete',
                             array['before', 'after']::public.photo_phase[], null),
  'pending_approval',
  'incomplete with flagged phases still leaves the WP in the queue');

select is(
  (select count(*)::int from public.approval_revision_targets t
     join public.approvals a on a.id = t.approval_id
    where a.work_package_id = 'c1c104b2-04b2-04b2-04b2-c1c1c1c104b2'),
  2, 'both flagged phases were recorded');

select is(
  (select string_agg(t.phase::text, ',' order by t.phase::text)
     from public.approval_revision_targets t
     join public.approvals a on a.id = t.approval_id
    where a.work_package_id = 'c1c104b2-04b2-04b2-04b2-c1c1c1c104b2'),
  'after,before', 'the recorded phases are the ones the PM ticked');

select is(
  (select count(*)::int from public.approval_revision_targets t
     join public.approvals a on a.id = t.approval_id
    where a.work_package_id = 'c1c104b2-04b2-04b2-04b2-c1c1c1c104b2'
      and t.photo_log_id is not null),
  0, 'a phase target carries no photo id');

-- ── C. The RPC records photo targets (U4b schema, wired later) ──────────────
select is(
  public.decide_work_package('c2c204b2-04b2-04b2-04b2-c2c2c2c204b2', 'needs_revision',
                             null, 'mismatch', null,
                             array['d1d104b2-04b2-04b2-04b2-d1d1d1d104b2']::uuid[]),
  'pending_approval',
  'mismatch with flagged photos still leaves the WP in the queue');

select is(
  (select count(*)::int from public.approval_revision_targets t
     join public.approvals a on a.id = t.approval_id
    where a.work_package_id = 'c2c204b2-04b2-04b2-04b2-c2c2c2c204b2'
      and t.photo_log_id = 'd1d104b2-04b2-04b2-04b2-d1d1d1d104b2'),
  1, 'the flagged photo was recorded');

-- ── D. The axis is enforced — the cause decides which shape is legal ────────
select throws_ok(
  $$ select public.decide_work_package('c3c304b2-04b2-04b2-04b2-c3c3c3c304b2', 'needs_revision',
                                       null, 'mismatch',
                                       array['before']::public.photo_phase[], null) $$,
  '22023', 'decide_work_package: flagged phases are only for incomplete',
  'phases are refused on mismatch — that cause points at photos, not absence');

select throws_ok(
  $$ select public.decide_work_package('c3c304b2-04b2-04b2-04b2-c3c3c3c304b2', 'needs_revision',
                                       null, 'incomplete', null,
                                       array['d1d104b2-04b2-04b2-04b2-d1d1d1d104b2']::uuid[]) $$,
  '22023', 'decide_work_package: flagged photos are only for mismatch',
  'photo ids are refused on incomplete — you cannot tap a photo never taken');

select throws_ok(
  $$ select public.decide_work_package('c3c304b2-04b2-04b2-04b2-c3c3c3c304b2', 'approved',
                                       null, null,
                                       array['before']::public.photo_phase[], null) $$,
  '22023', 'decide_work_package: targets are only for needs_revision',
  'targets are refused on any decision but needs_revision');

select throws_ok(
  $$ select public.decide_work_package('c3c304b2-04b2-04b2-04b2-c3c3c3c304b2', 'needs_revision',
                                       null, 'incomplete',
                                       array['after_fix']::public.photo_phase[], null) $$,
  '22023', 'decide_work_package: only lifecycle phases can be flagged',
  'after_fix cannot be flagged as missing — it is not the WPs completion evidence');

-- ── E. A flagged photo must be a CURRENT photo OF THIS work package ─────────
select throws_ok(
  $$ select public.decide_work_package('c3c304b2-04b2-04b2-04b2-c3c3c3c304b2', 'needs_revision',
                                       null, 'mismatch', null,
                                       array['d4d404b2-04b2-04b2-04b2-d4d4d4d404b2']::uuid[]) $$,
  '22023', 'decide_work_package: a flagged photo must be a current photo of this work package',
  'a photo belonging to another WP is refused');

select throws_ok(
  $$ select public.decide_work_package('c3c304b2-04b2-04b2-04b2-c3c3c3c304b2', 'needs_revision',
                                       null, 'mismatch', null,
                                       array['d2d204b2-04b2-04b2-04b2-d2d2d2d204b2']::uuid[]) $$,
  '22023', 'decide_work_package: a flagged photo must be a current photo of this work package',
  'a SUPERSEDED photo is refused — the ADR 0009 anti-join, so no dangling mark');

-- ── F. Back-compat + no overload ────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc where proname = 'decide_work_package'),
  1, 'exactly ONE decide_work_package — the old 4-arg overload is gone, not shadowed');

select is(
  public.decide_work_package('c3c304b2-04b2-04b2-04b2-c3c3c3c304b2', 'needs_revision',
                             null, 'incomplete'),
  'pending_approval',
  'a 4-arg call still resolves — the deployed app keeps working through the deploy window');

-- ── G. The table itself refuses a malformed row ─────────────────────────────
set local role postgres;
select throws_ok(
  $$ insert into public.approval_revision_targets (approval_id, phase, photo_log_id)
     select id, 'before', 'd1d104b2-04b2-04b2-04b2-d1d1d1d104b2' from public.approvals limit 1 $$,
  '23514',
  'new row for relation "approval_revision_targets" violates check constraint "approval_revision_targets_exactly_one"',
  'a row carrying BOTH a phase and a photo is refused by the CHECK');

select throws_ok(
  $$ insert into public.approval_revision_targets (approval_id, phase, photo_log_id)
     select id, null, null from public.approvals limit 1 $$,
  '23514',
  'new row for relation "approval_revision_targets" violates check constraint "approval_revision_targets_exactly_one"',
  'a row carrying NEITHER is refused too');

select * from finish();
rollback;
