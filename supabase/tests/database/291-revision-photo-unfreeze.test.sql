begin;
select plan(17);

-- ============================================================================
-- Spec 291 amendment (feedback f2096ee4) — photo deletes reopen ONLY inside a
-- genuinely-open ให้แก้ไข window, and only for the person who took the photo.
--
-- Baseline (291-photo-delete-submit-gate): a submitted evidence set is frozen —
-- pending_approval and complete refuse the tombstone insert. That file still
-- pins photo_wp_deletable(), which keeps its status-only meaning; this file
-- pins photo_removal_allowed(p_wp, p_target), the target-aware rule the
-- photo_logs INSERT policy now calls.
--
-- Open window = status pending_approval
--             AND latest decision (decided_at desc, id desc) = needs_revision
--             AND that decision NOT yet answered by a wp_evidence_resubmitted
--                 audit row (resubmit_work_package_evidence writes no approvals
--                 row, so without this the window never closed)
--             AND the caller uploaded the photo being removed (the reviewer
--                 asks, the uploader fixes — an approver must not alter the
--                 evidence they are judging; PM/PD reach the same WP-detail
--                 delete affordance, only procurement is a read-only viewer).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000029a10', 'uploader@d291r.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-000000029a10', 'comember@d291r.local', '{}'::jsonb),
  ('99999999-9999-9999-9999-000000029a10', 'reviewer@d291r.local', '{}'::jsonb);
update public.users set role='site_admin',      full_name='ช่างอัปโหลด' where id='11111111-1111-1111-1111-000000029a10';
update public.users set role='site_admin',      full_name='ช่างร่วมทีม' where id='22222222-2222-2222-2222-000000029a10';
update public.users set role='project_manager', full_name='ผู้ตรวจ'     where id='99999999-9999-9999-9999-000000029a10';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000029a10', 'D291R-PROJ', 'โครงการทดสอบปลดล็อกลบรูป');

insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000029a10', '11111111-1111-1111-1111-000000029a10',
   '99999999-9999-9999-9999-000000029a10'),
  ('aa000000-0000-0000-0000-000000029a10', '22222222-2222-2222-2222-000000029a10',
   '99999999-9999-9999-9999-000000029a10'),
  ('aa000000-0000-0000-0000-000000029a10', '99999999-9999-9999-9999-000000029a10',
   '99999999-9999-9999-9999-000000029a10');

-- Status INSERT is safe: the work_packages transition/notify/audit triggers all
-- fire AFTER UPDATE, never on INSERT.
--   IP  = in_progress                                   → editable arm
--   PA0 = pending_approval, no decision                 → frozen
--   WIN = pending_approval, latest needs_revision       → OPEN window
--   ANS = WIN + the SA already pressed ส่งตรวจอีกครั้ง  → window CLOSED again
--   APP = needs_revision then approved                  → closed
--   CP  = complete carrying a needs_revision row        → never opens
--   TIE = two decisions sharing decided_at              → id desc decides
insert into public.work_packages (id, project_id, code, name, status) values
  ('e0000000-0000-0000-0000-000000029a10', 'aa000000-0000-0000-0000-000000029a10', 'WP-IP',  'กำลังทำ',        'in_progress'),
  ('e1000000-0000-0000-0000-000000029a10', 'aa000000-0000-0000-0000-000000029a10', 'WP-PA0', 'ส่งตรวจ รอผล',   'pending_approval'),
  ('e2000000-0000-0000-0000-000000029a10', 'aa000000-0000-0000-0000-000000029a10', 'WP-WIN', 'ส่งตรวจ ให้แก้ไข', 'pending_approval'),
  ('e3000000-0000-0000-0000-000000029a10', 'aa000000-0000-0000-0000-000000029a10', 'WP-ANS', 'ส่งตรวจอีกครั้ง',  'pending_approval'),
  ('e4000000-0000-0000-0000-000000029a10', 'aa000000-0000-0000-0000-000000029a10', 'WP-APP', 'ส่งตรวจ ผ่านแล้ว', 'pending_approval'),
  ('e5000000-0000-0000-0000-000000029a10', 'aa000000-0000-0000-0000-000000029a10', 'WP-CP',  'เสร็จ',           'complete'),
  ('e6000000-0000-0000-0000-000000029a10', 'aa000000-0000-0000-0000-000000029a10', 'WP-TIE', 'ตัดสินพร้อมกัน',   'pending_approval'),
  ('e7000000-0000-0000-0000-000000029a10', 'aa000000-0000-0000-0000-000000029a10', 'WP-RB',  'ตีกลับรอบสอง',     'pending_approval');

insert into public.approvals (id, work_package_id, decision, comment, decided_by, decided_at) values
  ('c2000000-0000-0000-0000-000000029a10', 'e2000000-0000-0000-0000-000000029a10', 'needs_revision', 'รูปหลังงานไม่ตรงกับงาน ถ่ายใหม่',
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 09:00:00+07'),
  ('c3000000-0000-0000-0000-000000029a10', 'e3000000-0000-0000-0000-000000029a10', 'needs_revision', 'ถ่ายใหม่',
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 09:00:00+07'),
  ('c4000000-0000-0000-0000-000000029a10', 'e4000000-0000-0000-0000-000000029a10', 'needs_revision', 'ถ่ายใหม่',
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 09:00:00+07'),
  ('c4100000-0000-0000-0000-000000029a10', 'e4000000-0000-0000-0000-000000029a10', 'approved', null,
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 10:00:00+07'),
  ('c5000000-0000-0000-0000-000000029a10', 'e5000000-0000-0000-0000-000000029a10', 'needs_revision', 'ถ่ายใหม่',
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 09:00:00+07'),
  -- TIE: identical decided_at. `order by decided_at desc, id desc` must pick the
  -- ffff… approved row, not the aaaa… revision ask.
  ('aa100000-0000-0000-0000-000000029a10', 'e6000000-0000-0000-0000-000000029a10', 'needs_revision', 'ถ่ายใหม่',
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 11:00:00+07'),
  ('ff100000-0000-0000-0000-000000029a10', 'e6000000-0000-0000-0000-000000029a10', 'approved', null,
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 11:00:00+07'),
  -- RB: first ask (answered below), then a SECOND ask nobody has answered yet.
  ('c7000000-0000-0000-0000-000000029a10', 'e7000000-0000-0000-0000-000000029a10', 'needs_revision', 'รอบแรก',
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 08:00:00+07'),
  ('c7100000-0000-0000-0000-000000029a10', 'e7000000-0000-0000-0000-000000029a10', 'needs_revision', 'รอบสอง',
   '99999999-9999-9999-9999-000000029a10', '2026-07-22 12:00:00+07');

-- ANS: the SA answered decision c3000000 — exactly the row
-- resubmit_work_package_evidence writes.
insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload) values
  ('11111111-1111-1111-1111-000000029a10', 'site_admin', 'other', 'work_packages',
   'e3000000-0000-0000-0000-000000029a10',
   jsonb_build_object('event', 'wp_evidence_resubmitted',
                      'answers_decision_id', 'c3000000-0000-0000-0000-000000029a10')),
  -- RB's FIRST ask was answered; the second (latest) one was not.
  ('11111111-1111-1111-1111-000000029a10', 'site_admin', 'other', 'work_packages',
   'e7000000-0000-0000-0000-000000029a10',
   jsonb_build_object('event', 'wp_evidence_resubmitted',
                      'answers_decision_id', 'c7000000-0000-0000-0000-000000029a10'));

-- Tombstone targets. All uploaded by the uploader except …f9…, which belongs to
-- the co-member and sits on the OPEN-window WP.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('f0000000-0000-0000-0000-000000029a10', 'e0000000-0000-0000-0000-000000029a10', 'before', 'd291r/ip/seed.jpg',  '11111111-1111-1111-1111-000000029a10'),
  ('f1000000-0000-0000-0000-000000029a10', 'e1000000-0000-0000-0000-000000029a10', 'before', 'd291r/pa0/seed.jpg', '11111111-1111-1111-1111-000000029a10'),
  ('f2000000-0000-0000-0000-000000029a10', 'e2000000-0000-0000-0000-000000029a10', 'before', 'd291r/win/seed.jpg', '11111111-1111-1111-1111-000000029a10'),
  ('f9000000-0000-0000-0000-000000029a10', 'e2000000-0000-0000-0000-000000029a10', 'after',  'd291r/win/other.jpg','22222222-2222-2222-2222-000000029a10'),
  ('f3000000-0000-0000-0000-000000029a10', 'e3000000-0000-0000-0000-000000029a10', 'before', 'd291r/ans/seed.jpg', '11111111-1111-1111-1111-000000029a10'),
  ('f4000000-0000-0000-0000-000000029a10', 'e4000000-0000-0000-0000-000000029a10', 'before', 'd291r/app/seed.jpg', '11111111-1111-1111-1111-000000029a10'),
  ('f5000000-0000-0000-0000-000000029a10', 'e5000000-0000-0000-0000-000000029a10', 'before', 'd291r/cp/seed.jpg',  '11111111-1111-1111-1111-000000029a10'),
  ('f6000000-0000-0000-0000-000000029a10', 'e6000000-0000-0000-0000-000000029a10', 'before', 'd291r/tie/seed.jpg', '11111111-1111-1111-1111-000000029a10'),
  ('f7000000-0000-0000-0000-000000029a10', 'e7000000-0000-0000-0000-000000029a10', 'before', 'd291r/rb/seed.jpg',  '11111111-1111-1111-1111-000000029a10');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Privilege posture (as postgres) — the new definer helper is not reachable
--    by an unauthenticated caller (spec 284 lesson: revoke from public AND anon,
--    since a bare `revoke … from anon` leaves Postgres's default PUBLIC grant).
-- ============================================================================
select is(
  has_function_privilege('anon', 'public.photo_removal_allowed(uuid,uuid)', 'EXECUTE'),
  false,
  'anon cannot execute photo_removal_allowed');

-- ============================================================================
-- B. photo_removal_allowed() truth table, evaluated AS THE UPLOADER — auth.uid()
--    is part of the rule, so these cannot be asserted as postgres.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000029a10"}';

select ok(
  public.photo_removal_allowed('e0000000-0000-0000-0000-000000029a10', 'f0000000-0000-0000-0000-000000029a10'),
  'in_progress → allowed (editable arm, unchanged)');

select ok(
  not public.photo_removal_allowed('e1000000-0000-0000-0000-000000029a10', 'f1000000-0000-0000-0000-000000029a10'),
  'pending_approval awaiting its first decision → refused');

select ok(
  public.photo_removal_allowed('e2000000-0000-0000-0000-000000029a10', 'f2000000-0000-0000-0000-000000029a10'),
  'OPEN ให้แก้ไข window, own photo → allowed');

select ok(
  not public.photo_removal_allowed('e2000000-0000-0000-0000-000000029a10', 'f9000000-0000-0000-0000-000000029a10'),
  'OPEN window but the photo belongs to someone else → refused');

select ok(
  not public.photo_removal_allowed('e3000000-0000-0000-0000-000000029a10', 'f3000000-0000-0000-0000-000000029a10'),
  'window CLOSES once ส่งตรวจอีกครั้ง answered that decision');

select ok(
  not public.photo_removal_allowed('e4000000-0000-0000-0000-000000029a10', 'f4000000-0000-0000-0000-000000029a10'),
  'a later approved decision closes the window');

select ok(
  not public.photo_removal_allowed('e5000000-0000-0000-0000-000000029a10', 'f5000000-0000-0000-0000-000000029a10'),
  'complete never opens, even carrying a needs_revision row');

select ok(
  not public.photo_removal_allowed('e6000000-0000-0000-0000-000000029a10', 'f6000000-0000-0000-0000-000000029a10'),
  'tied decided_at → id desc picks the approved row, window stays shut');

select ok(
  not public.photo_removal_allowed('00000000-0000-0000-0000-000000000999', 'f0000000-0000-0000-0000-000000029a10'),
  'missing WP → refused (fail-closed preserved)');

-- A SECOND cure cycle: the first ask was answered, then the reviewer bounced it
-- again. The window must be OPEN — which only holds if the not-exists is
-- correlated to the LATEST decision id rather than to "any resubmit ever".
select ok(
  public.photo_removal_allowed('e7000000-0000-0000-0000-000000029a10', 'f7000000-0000-0000-0000-000000029a10'),
  're-bounced WP: an older ANSWERED ask does not keep the new window shut');

-- Cross-WP: the tombstone names a WP whose window is open, but points at a photo
-- living on a frozen one. Both must be the same work package.
select ok(
  not public.photo_removal_allowed('e2000000-0000-0000-0000-000000029a10', 'f1000000-0000-0000-0000-000000029a10'),
  'target photo on ANOTHER work package → refused (no cross-WP supersede)');

select ok(
  not public.photo_removal_allowed('e0000000-0000-0000-0000-000000029a10', 'f1000000-0000-0000-0000-000000029a10'),
  'cross-WP refused on the editable arm too (pre-existing hole, closed)');

-- ============================================================================
-- C. The RLS tombstone gate follows the helper.
-- ============================================================================
select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e2000000-0000-0000-0000-000000029a10', 'before', null,
             'f2000000-0000-0000-0000-000000029a10', '11111111-1111-1111-1111-000000029a10') $$,
  'uploader tombstone admitted while the ให้แก้ไข ask is outstanding');

select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e3000000-0000-0000-0000-000000029a10', 'before', null,
             'f3000000-0000-0000-0000-000000029a10', '11111111-1111-1111-1111-000000029a10') $$,
  '42501', null,
  'tombstone REFUSED once the revision request was answered');

-- Uploads stay unaffected by the repointed conjunct.
select lives_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by)
     values ('e1000000-0000-0000-0000-000000029a10', 'during', 'd291r/pa0/new.jpg',
             '11111111-1111-1111-1111-000000029a10') $$,
  'a normal upload on a pending_approval WP is still admitted (gate is delete-only)');

-- ============================================================================
-- D. The approver does NOT gain a delete path inside the window. The PM is a
--    project member and the policy admits their role, so only the uploader
--    conjunct stops them.
-- ============================================================================
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "99999999-9999-9999-9999-000000029a10"}';

select throws_ok(
  $$ insert into public.photo_logs (work_package_id, phase, storage_path, superseded_by, uploaded_by)
     values ('e2000000-0000-0000-0000-000000029a10', 'before', null,
             'f2000000-0000-0000-0000-000000029a10', '99999999-9999-9999-9999-000000029a10') $$,
  '42501', null,
  'the reviewing PM cannot delete the SA''s photo inside the window they opened');

reset role;

select * from finish();
rollback;
