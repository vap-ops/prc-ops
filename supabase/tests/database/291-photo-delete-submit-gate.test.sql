begin;
select plan(14);

-- ============================================================================
-- Spec 291 U1 — photo self-delete gated at submit.
--
-- A tombstone (a logical photo delete: storage_path NULL, superseded_by set —
-- ADR 0015) must be admitted only while the WP is still editable. Once the WP
-- is submitted for approval (pending_approval) or complete, the evidence set is
-- frozen: the tombstone-insert is refused so a submitted set cannot be altered.
--
-- Authority = the photo_logs INSERT policy, extended with
--   AND (superseded_by IS NULL OR photo_wp_deletable(work_package_id))
-- so it gates ONLY the supersede-insert (the delete), never a normal upload.
-- photo_wp_deletable(uuid) is a SECURITY DEFINER helper = status NOT IN
-- (pending_approval, complete), coalesce-false so a missing WP fails CLOSED.
--
-- Deletable statuses  = not_started · in_progress · on_hold · rework  → true
-- Locked (delete off) = pending_approval · complete                   → false
--
-- Fixture idiom mirrors 09-photo-logs + 289-record-site-purchase-scope:
-- auth.users → on_auth_user_created trigger makes public.users(visitor) →
-- promote; one project + members; six WPs, one per status; a real seed photo
-- on each WP we tombstone against.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000291', 'uploader@d291.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-000000000291', 'comember@d291.local', '{}'::jsonb),
  ('99999999-9999-9999-9999-000000000291', 'super@d291.local',    '{}'::jsonb);
update public.users set role='site_admin',  full_name='ช่างอัปโหลด'  where id='11111111-1111-1111-1111-000000000291';
update public.users set role='site_admin',  full_name='ช่างร่วมทีม'  where id='22222222-2222-2222-2222-000000000291';
update public.users set role='super_admin', full_name='ผู้ดูแลระบบ' where id='99999999-9999-9999-9999-000000000291';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000291', 'D291-PROJ', 'โครงการทดสอบลบรูป');

-- Enrol both site_admins so can_see_wp is true for them.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000291', '11111111-1111-1111-1111-000000000291',
   '99999999-9999-9999-9999-000000000291'),
  ('aa000000-0000-0000-0000-000000000291', '22222222-2222-2222-2222-000000000291',
   '99999999-9999-9999-9999-000000000291');

-- One WP per status. Direct status INSERT is safe: the work_packages
-- transition/notify/audit triggers all fire AFTER UPDATE, never on INSERT.
insert into public.work_packages (id, project_id, code, name, status) values
  ('e1000000-0000-0000-0000-000000000291', 'aa000000-0000-0000-0000-000000000291', 'WP-NS', 'ยังไม่เริ่ม',   'not_started'),
  ('e2000000-0000-0000-0000-000000000291', 'aa000000-0000-0000-0000-000000000291', 'WP-IP', 'กำลังทำ',       'in_progress'),
  ('e3000000-0000-0000-0000-000000000291', 'aa000000-0000-0000-0000-000000000291', 'WP-OH', 'พักไว้',        'on_hold'),
  ('e4000000-0000-0000-0000-000000000291', 'aa000000-0000-0000-0000-000000000291', 'WP-RW', 'แก้ไข',         'rework'),
  ('e5000000-0000-0000-0000-000000000291', 'aa000000-0000-0000-0000-000000000291', 'WP-PA', 'ส่งตรวจ',       'pending_approval'),
  ('e6000000-0000-0000-0000-000000000291', 'aa000000-0000-0000-0000-000000000291', 'WP-CP', 'เสร็จ',         'complete');

-- Real seed photos (as postgres, RLS-bypassing) — the tombstone targets. One on
-- each WP we delete against, plus a second on the in_progress WP for the
-- attribution-guard case.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('fa000000-0000-0000-0000-000000000291', 'e2000000-0000-0000-0000-000000000291', 'before', 'd291/ip/seed.jpg',   '11111111-1111-1111-1111-000000000291'),
  ('fb000000-0000-0000-0000-000000000291', 'e4000000-0000-0000-0000-000000000291', 'before', 'd291/rw/seed.jpg',   '11111111-1111-1111-1111-000000000291'),
  ('fc000000-0000-0000-0000-000000000291', 'e5000000-0000-0000-0000-000000000291', 'before', 'd291/pa/seed.jpg',   '11111111-1111-1111-1111-000000000291'),
  ('fd000000-0000-0000-0000-000000000291', 'e6000000-0000-0000-0000-000000000291', 'before', 'd291/cp/seed.jpg',   '11111111-1111-1111-1111-000000000291'),
  ('fe000000-0000-0000-0000-000000000291', 'e2000000-0000-0000-0000-000000000291', 'before', 'd291/ip/attr.jpg',   '11111111-1111-1111-1111-000000000291');

-- Assertions run under role=authenticated → grant the runner's _tap_buf collector
-- (+ its sequence) to authenticated, else the first wrapped insert 42501-aborts
-- the whole file (pgtap-tapbuf-grant-role-switch).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. photo_wp_deletable() truth table (as postgres). Deletable statuses → true;
--    submitted/complete → false; a missing WP → false (coalesce fail-closed).
-- ============================================================================
select ok(public.photo_wp_deletable('e1000000-0000-0000-0000-000000000291'), 'not_started → deletable');
select ok(public.photo_wp_deletable('e2000000-0000-0000-0000-000000000291'), 'in_progress → deletable');
select ok(public.photo_wp_deletable('e3000000-0000-0000-0000-000000000291'), 'on_hold → deletable');
select ok(public.photo_wp_deletable('e4000000-0000-0000-0000-000000000291'), 'rework → deletable');
select ok(not public.photo_wp_deletable('e5000000-0000-0000-0000-000000000291'), 'pending_approval → NOT deletable');
select ok(not public.photo_wp_deletable('e6000000-0000-0000-0000-000000000291'), 'complete → NOT deletable');
select ok(not public.photo_wp_deletable('00000000-0000-0000-0000-000000000999'), 'missing WP → NOT deletable (coalesce fail-closed)');

-- ============================================================================
-- B. anon cannot execute the definer helper (spec 284 lesson: revoke from anon).
-- ============================================================================
select is(
  has_function_privilege('anon', 'public.photo_wp_deletable(uuid)', 'EXECUTE'),
  false,
  'anon cannot execute photo_wp_deletable');

-- ============================================================================
-- C. Tombstone-insert RLS gate, as the uploader (site_admin member).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000291"}';

-- C.1 in_progress (deletable): the owner may tombstone their photo.
select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e2000000-0000-0000-0000-000000000291', 'before', null,
             'fa000000-0000-0000-0000-000000000291', '11111111-1111-1111-1111-000000000291') $$,
  'owner tombstone on an in_progress WP is admitted');

-- C.2 rework (deletable): a reopened, not-yet-resubmitted WP stays deletable.
select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e4000000-0000-0000-0000-000000000291', 'before', null,
             'fb000000-0000-0000-0000-000000000291', '11111111-1111-1111-1111-000000000291') $$,
  'owner tombstone on a rework WP is admitted');

-- C.3 pending_approval (locked): the submitted evidence set is frozen. THE GATE.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e5000000-0000-0000-0000-000000000291', 'before', null,
             'fc000000-0000-0000-0000-000000000291', '11111111-1111-1111-1111-000000000291') $$,
  '42501', null,
  'owner tombstone on a pending_approval WP is REFUSED (submitted → frozen)');

-- C.4 complete (locked): likewise refused.
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e6000000-0000-0000-0000-000000000291', 'before', null,
             'fd000000-0000-0000-0000-000000000291', '11111111-1111-1111-1111-000000000291') $$,
  '42501', null,
  'owner tombstone on a complete WP is REFUSED (frozen)');

-- C.5 uploads are UNAFFECTED: a normal photo insert (superseded_by NULL) on a
--     pending_approval WP still succeeds — the new conjunct gates deletes only.
select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by)
     values ('e5000000-0000-0000-0000-000000000291', 'during', 'd291/pa/new-upload.jpg',
             '11111111-1111-1111-1111-000000000291') $$,
  'a normal upload on a pending_approval WP is still admitted (gate is delete-only)');

-- ============================================================================
-- D. Attribution guard survives the policy rewrite: a tombstone attributed to
--    someone else (uploaded_by <> auth.uid()) is refused by the uploaded_by
--    clause — even on a deletable WP. Guards against dropping that conjunct.
-- ============================================================================
select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e2000000-0000-0000-0000-000000000291', 'before', null,
             'fe000000-0000-0000-0000-000000000291', '22222222-2222-2222-2222-000000000291') $$,
  '42501', null,
  'tombstone attributed to another user is REFUSED (uploaded_by = auth.uid() preserved)');

reset role;

select * from finish();
rollback;
