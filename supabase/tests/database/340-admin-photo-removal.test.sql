begin;
select plan(13);

-- ============================================================================
-- Spec 340 U1 — super_admin removes a wrong photo on the uploader's behalf.
--
-- Spec 291's window arm ends with `uploaded_by = auth.uid()`: inside a ให้แก้ไข
-- window only the person who took the photo may remove it, so the approver can
-- never quietly alter the evidence they are judging. That left nobody able to
-- help when the uploader cannot (off site, lost phone, cannot find the button).
--
-- Operator call 2026-07-22: super_admin bypasses the UPLOADER check only — the
-- FREEZE stays. On a submitted-and-not-bounced or complete WP nobody deletes,
-- super_admin included; the honest path is ผอ./PM press ให้แก้ไข first, so a
-- reviewer decision is always on record before the evidence changes.
--
-- This file pins exactly that asymmetry. The rest of the truth table lives in
-- 291-revision-photo-unfreeze.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000034010', 'uploader@d340.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-000000034010', 'comember@d340.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-000000034010', 'operator@d340.local', '{}'::jsonb),
  ('99999999-9999-9999-9999-000000034010', 'reviewer@d340.local', '{}'::jsonb);
update public.users set role='site_admin',      full_name='ช่างอัปโหลด' where id='11111111-1111-1111-1111-000000034010';
update public.users set role='site_admin',      full_name='ช่างร่วมทีม' where id='22222222-2222-2222-2222-000000034010';
update public.users set role='super_admin',     full_name='ผู้ดูแลระบบ' where id='33333333-3333-3333-3333-000000034010';
update public.users set role='project_manager', full_name='ผู้ตรวจ'     where id='99999999-9999-9999-9999-000000034010';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000034010', 'D340-PROJ', 'โครงการทดสอบลบแทน');

insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000034010', '11111111-1111-1111-1111-000000034010',
   '99999999-9999-9999-9999-000000034010'),
  ('aa000000-0000-0000-0000-000000034010', '22222222-2222-2222-2222-000000034010',
   '99999999-9999-9999-9999-000000034010'),
  ('aa000000-0000-0000-0000-000000034010', '99999999-9999-9999-9999-000000034010',
   '99999999-9999-9999-9999-000000034010');

--   WIN = pending_approval, latest needs_revision, unanswered → OPEN window
--   PA0 = pending_approval, no decision                       → frozen
--   CP  = complete                                            → frozen forever
--   SELF = like WIN, but the operator is the one who pressed ให้แก้ไข
insert into public.work_packages (id, project_id, code, name, status) values
  ('e2000000-0000-0000-0000-000000034010', 'aa000000-0000-0000-0000-000000034010', 'WP340-WIN',  'ส่งตรวจ ให้แก้ไข', 'pending_approval'),
  ('e1000000-0000-0000-0000-000000034010', 'aa000000-0000-0000-0000-000000034010', 'WP340-PA0',  'ส่งตรวจ รอผล',    'pending_approval'),
  ('e5000000-0000-0000-0000-000000034010', 'aa000000-0000-0000-0000-000000034010', 'WP340-CP',   'เสร็จ',            'complete'),
  ('e8000000-0000-0000-0000-000000034010', 'aa000000-0000-0000-0000-000000034010', 'WP340-SELF', 'ผู้ดูแลตีกลับเอง', 'pending_approval');

insert into public.approvals (id, work_package_id, decision, comment, decided_by, decided_at) values
  ('c2000000-0000-0000-0000-000000034010', 'e2000000-0000-0000-0000-000000034010', 'needs_revision', 'รูปไม่ตรงกับงาน ถ่ายใหม่',
   '99999999-9999-9999-9999-000000034010', '2026-07-22 09:00:00+07'),
  ('c5000000-0000-0000-0000-000000034010', 'e5000000-0000-0000-0000-000000034010', 'needs_revision', 'ถ่ายใหม่',
   '99999999-9999-9999-9999-000000034010', '2026-07-22 09:00:00+07'),
  -- super_admin is in the approvals INSERT policy, so the operator can be the
  -- decider too. Delete-on-behalf must not become alter-my-own-evidence.
  ('c8000000-0000-0000-0000-000000034010', 'e8000000-0000-0000-0000-000000034010', 'needs_revision', 'ถ่ายใหม่',
   '33333333-3333-3333-3333-000000034010', '2026-07-22 09:00:00+07');

-- Every photo below belongs to the UPLOADER, so any pass by another caller is
-- the delete-on-behalf arm and nothing else.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('f2000000-0000-0000-0000-000000034010', 'e2000000-0000-0000-0000-000000034010', 'during', 'd340/win/seed.jpg', '11111111-1111-1111-1111-000000034010'),
  ('f2100000-0000-0000-0000-000000034010', 'e2000000-0000-0000-0000-000000034010', 'during', 'd340/win/two.jpg',  '11111111-1111-1111-1111-000000034010'),
  ('f1000000-0000-0000-0000-000000034010', 'e1000000-0000-0000-0000-000000034010', 'during', 'd340/pa0/seed.jpg', '11111111-1111-1111-1111-000000034010'),
  ('f5000000-0000-0000-0000-000000034010', 'e5000000-0000-0000-0000-000000034010', 'during', 'd340/cp/seed.jpg',  '11111111-1111-1111-1111-000000034010'),
  ('f8000000-0000-0000-0000-000000034010', 'e8000000-0000-0000-0000-000000034010', 'during', 'd340/self/seed.jpg','11111111-1111-1111-1111-000000034010');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. As SUPER_ADMIN — the new arm, and the freeze that survives it.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-000000034010"}';

select ok(
  public.photo_removal_allowed('e2000000-0000-0000-0000-000000034010', 'f2000000-0000-0000-0000-000000034010'),
  'super_admin may remove ANOTHER user''s photo inside an open ให้แก้ไข window');

select ok(
  not public.photo_removal_allowed('e1000000-0000-0000-0000-000000034010', 'f1000000-0000-0000-0000-000000034010'),
  'super_admin is STILL refused on a submitted WP awaiting its first decision');

select ok(
  not public.photo_removal_allowed('e5000000-0000-0000-0000-000000034010', 'f5000000-0000-0000-0000-000000034010'),
  'super_admin is STILL refused on a complete WP (the freeze is not a role check)');

select ok(
  not public.photo_removal_allowed('e2000000-0000-0000-0000-000000034010', 'f1000000-0000-0000-0000-000000034010'),
  'super_admin does not gain a cross-WP supersede');

select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e2000000-0000-0000-0000-000000034010', 'during', null,
             'f2000000-0000-0000-0000-000000034010', '33333333-3333-3333-3333-000000034010') $$,
  'the RLS tombstone gate admits the super_admin removal too');

select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e5000000-0000-0000-0000-000000034010', 'during', null,
             'f5000000-0000-0000-0000-000000034010', '33333333-3333-3333-3333-000000034010') $$,
  '42501', null,
  'RLS still refuses a super_admin tombstone on a complete WP');

-- The operator is also in the approvals INSERT policy, so without this they could
-- press ให้แก้ไข and then delete the uploader's photo — the approver-alters-the-
-- evidence-they-judge hazard 291 exists to close, reopened for one principal.
select ok(
  not public.photo_removal_allowed('e8000000-0000-0000-0000-000000034010', 'f8000000-0000-0000-0000-000000034010'),
  'super_admin who MADE the ให้แก้ไข decision cannot delete on it (no self-judged removal)');

-- Delete-on-behalf is REMOVAL, never substitution. A fresh-eyes pass read the
-- INSERT policy and concluded the widened arm also let the operator swap another
-- user''s evidence for an image of their own; the TABLE refutes it —
-- `check ((storage_path is null) = (superseded_by is not null))` makes every
-- superseding row a tombstone, for every role. Pinned here as 23514 (the
-- constraint) rather than 42501, because that is the layer that actually holds
-- and the distinction is the whole finding.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e2000000-0000-0000-0000-000000034010', 'during', 'd340/win/swap.jpg',
             'f2100000-0000-0000-0000-000000034010', '33333333-3333-3333-3333-000000034010') $$,
  '23514', null,
  'no supersede-with-replacement for super_admin — the table forbids it, not RLS');

-- ============================================================================
-- B. As a NON-uploader who is not super_admin — 291's rule is untouched.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-000000034010"}';

select ok(
  not public.photo_removal_allowed('e2000000-0000-0000-0000-000000034010', 'f2100000-0000-0000-0000-000000034010'),
  'a co-member site_admin still cannot remove a photo they did not take');

-- ============================================================================
-- C. As the uploader — the original arm still passes.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000034010"}';

select ok(
  public.photo_removal_allowed('e2000000-0000-0000-0000-000000034010', 'f2100000-0000-0000-0000-000000034010'),
  'the uploader keeps their own delete inside the window');

select ok(
  not public.photo_removal_allowed('e5000000-0000-0000-0000-000000034010', 'f5000000-0000-0000-0000-000000034010'),
  'the uploader is still frozen out of a complete WP');

-- Symmetry proof that the rule above is a TABLE invariant and not a role check:
-- the photo's own uploader cannot substitute in place either. A re-shoot is a
-- tombstone plus a fresh row, which is what the app does.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e2000000-0000-0000-0000-000000034010', 'during', 'd340/win/reshoot.jpg',
             'f2100000-0000-0000-0000-000000034010', '11111111-1111-1111-1111-000000034010') $$,
  '23514', null,
  'the uploader cannot substitute in place either — supersede means tombstone');

select ok(
  public.photo_removal_allowed('e8000000-0000-0000-0000-000000034010', 'f8000000-0000-0000-0000-000000034010'),
  'the uploader is unaffected by who made the decision');

select * from finish();
rollback;
