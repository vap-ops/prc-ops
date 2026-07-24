begin;
select plan(65);

-- ============================================================================
-- Spec 337 U1 — attributed WP transitions via SECURITY DEFINER RPCs.
--
-- F1: every WP status write ran on the ADMIN client, so wp_transition_audit's
-- auth.uid() / current_user_role() were NULL — 100% of transition audit rows
-- were anonymous. The three transitions move onto DEFINER RPCs called under the
-- USER session, so the audit trigger sees the actor.
--   * submit_work_package_for_approval(p_wp)   — SITE_STAFF_ROLES, from
--     not_started/in_progress/on_hold/rework → pending_approval. The PHOTO gate
--     stays in the server action (needs the current-photos anti-join read).
--   * decide_work_package(p_wp, p_decision, p_comment) — PM_ROLES; inserts the
--     approvals row + flips status atomically. F3: rejected → rework AND
--     rework_round + 1 (reuses the spec 144/216-218 machinery, no new enum
--     value). needs_revision does NOT flip.
--   * resubmit_work_package_evidence(p_wp)     — SITE_STAFF_ROLES; the explicit
--     ส่งตรวจอีกครั้ง after a needs_revision, gated on a CURRENT after/after_fix
--     photo newer than that decision. No status change; writes the audit row +
--     the wp_evidence_resubmitted outbox row that pings the decider.
--   * Same-errcode guards carry DISTINCT messages and every throws_ok pins the
--     message (spec 330 U3c lesson).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110337', 'super@s337.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220337', 'sa@s337.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330337', 'pm@s337.local',    '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440337', 'pmoth@s337.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550337', 'proc@s337.local',  '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660337', 'vis@s337.local',   '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-111111110337';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220337';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-333333330337';
update public.users set role = 'project_manager' where id = '44444444-4444-4444-4444-444444440337';
update public.users set role = 'procurement'     where id = '55555555-5555-5555-5555-555555550337';
-- '6666…' stays visitor.

-- pm (3333) is the project lead → a member. sa (2222) is an explicit member.
-- pmoth (4444) is deliberately NOT on the project (the membership gate).
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10337-0337-0337-0337-a1a1a1a10337', 'PRC-337-P1', 'โครงการทดสอบ 337',
   '33333333-3333-3333-3333-333333330337');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a10337-0337-0337-0337-a1a1a1a10337',
   '22222222-2222-2222-2222-222222220337', '11111111-1111-1111-1111-111111110337');

-- Statuses are set at INSERT time (never via a fixture UPDATE) so the only
-- transition audit rows on these WPs are the ones the RPCs write — that is what
-- makes the "zero NULL-actor rows" F1 pins below meaningful.
insert into public.work_packages (id, project_id, code, name, status, rework_round) values
  ('c1c10337-0337-0337-0337-c1c1c1c10337', 'a1a10337-0337-0337-0337-a1a1a1a10337',
   'W99-01', 'งานส่งตรวจ',        'not_started',      0),
  ('c2c20337-0337-0337-0337-c2c2c2c20337', 'a1a10337-0337-0337-0337-a1a1a1a10337',
   'W99-02', 'งานเสร็จแล้ว',      'complete',         0),
  ('c3c30337-0337-0337-0337-c3c3c3c30337', 'a1a10337-0337-0337-0337-a1a1a1a10337',
   'W99-03', 'งานรออนุมัติ',      'pending_approval', 0),
  ('c4c40337-0337-0337-0337-c4c4c4c40337', 'a1a10337-0337-0337-0337-a1a1a1a10337',
   'W99-04', 'งานรอตรวจจะถูกตีกลับ', 'pending_approval', 0),
  ('c5c50337-0337-0337-0337-c5c5c5c50337', 'a1a10337-0337-0337-0337-a1a1a1a10337',
   'W99-05', 'งานรอถ่ายรูปเพิ่ม',   'pending_approval', 0),
  ('c6c60337-0337-0337-0337-c6c6c6c60337', 'a1a10337-0337-0337-0337-a1a1a1a10337',
   'W99-06', 'งานแก้ไข',          'rework',           2),
  ('c7c70337-0337-0337-0337-c7c7c7c70337', 'a1a10337-0337-0337-0337-a1a1a1a10337',
   'W99-07', 'งานรอตรวจยังไม่มีผล',  'pending_approval', 0);

-- The STALE evidence on wp5: an after photo shot BEFORE the needs_revision
-- decision. now() is the transaction timestamp, so this is unambiguously older
-- than the decision the RPC records at now() below.
insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, created_at) values
  ('c5c50337-0337-0337-0337-c5c5c5c50337', 'after', 's337/old.jpg',
   '22222222-2222-2222-2222-222222220337', now() - interval '20 minutes');

-- role-switched asserts write into the runner's collector (pgtap-tapbuf lesson, PR #400)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + grants (house lockdown: revoke all from public, anon).
-- ============================================================================
select ok(to_regprocedure('public.submit_work_package_for_approval(uuid)') is not null,
  'submit_work_package_for_approval(uuid) exists');
select ok(to_regprocedure('public.decide_work_package(uuid,approval_decision,text,approval_revision_reason)') is not null,
  'decide_work_package(uuid,approval_decision,text,approval_revision_reason) exists');
select ok(to_regprocedure('public.resubmit_work_package_evidence(uuid)') is not null,
  'resubmit_work_package_evidence(uuid) exists');

select is((select prosecdef from pg_proc
            where oid = 'public.submit_work_package_for_approval(uuid)'::regprocedure),
  true, 'submit_work_package_for_approval is SECURITY DEFINER');
select is((select prosecdef from pg_proc
            where oid = 'public.decide_work_package(uuid,approval_decision,text,approval_revision_reason)'::regprocedure),
  true, 'decide_work_package is SECURITY DEFINER');
select is((select prosecdef from pg_proc
            where oid = 'public.resubmit_work_package_evidence(uuid)'::regprocedure),
  true, 'resubmit_work_package_evidence is SECURITY DEFINER');

select is(has_function_privilege('anon',
  'public.submit_work_package_for_approval(uuid)', 'EXECUTE'),
  false, 'anon cannot execute submit_work_package_for_approval');
select is(has_function_privilege('anon',
  'public.decide_work_package(uuid,approval_decision,text,approval_revision_reason)', 'EXECUTE'),
  false, 'anon cannot execute decide_work_package');
select is(has_function_privilege('anon',
  'public.resubmit_work_package_evidence(uuid)', 'EXECUTE'),
  false, 'anon cannot execute resubmit_work_package_evidence');

select is(has_function_privilege('authenticated',
  'public.submit_work_package_for_approval(uuid)', 'EXECUTE'),
  true, 'authenticated can execute submit_work_package_for_approval');
select is(has_function_privilege('authenticated',
  'public.decide_work_package(uuid,approval_decision,text,approval_revision_reason)', 'EXECUTE'),
  true, 'authenticated can execute decide_work_package');
select is(has_function_privilege('authenticated',
  'public.resubmit_work_package_evidence(uuid)', 'EXECUTE'),
  true, 'authenticated can execute resubmit_work_package_evidence');

-- PUBLIC keeps Postgres's default EXECUTE unless revoked explicitly — spec 336
-- shipped `revoke … from anon` alone and the 229 lockdown caught it. grantee = 0
-- is PUBLIC in aclitem.
select ok(not exists (
    select 1 from pg_proc p,
                  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'submit_work_package_for_approval'
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no EXECUTE on submit_work_package_for_approval');
select ok(not exists (
    select 1 from pg_proc p,
                  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'decide_work_package'
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no EXECUTE on decide_work_package');
select ok(not exists (
    select 1 from pg_proc p,
                  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'resubmit_work_package_evidence'
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no EXECUTE on resubmit_work_package_evidence');

-- ============================================================================
-- B. The notification enum gains the resubmit event (U2's ping rides U1's
--    migration — see also the enum-lockstep pin in 25-notification-outbox).
-- ============================================================================
select ok('wp_evidence_resubmitted' = any (enum_range(null::public.notification_event_type)::text[]),
  'notification_event_type gains wp_evidence_resubmitted');

-- The SA AUTHORS the resubmit audit row, so they must be able to read it back
-- (their audit_log policy is an event allowlist, not `using(true)`).
select ok((select qual from pg_policies
            where schemaname = 'public' and tablename = 'audit_log'
              and policyname = 'audit_log select wp rework events')
          like '%wp_evidence_resubmitted%',
  'site_admin audit_log policy admits the resubmit event');

-- ============================================================================
-- C. submit_work_package_for_approval — role, membership, status, attribution.
-- ============================================================================
set local role authenticated;

-- A session with no JWT is what the ADMIN client looks like to the RPC: the
-- null-safe gate refuses it, which is the point of the whole unit.
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.submit_work_package_for_approval('c1c10337-0337-0337-0337-c1c1c1c10337') $$,
  '42501', 'submit_work_package_for_approval: role not permitted',
  'a null-role session cannot submit (null-safe gate)');

set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660337"}';
select throws_ok(
  $$ select public.submit_work_package_for_approval('c1c10337-0337-0337-0337-c1c1c1c10337') $$,
  '42501', 'submit_work_package_for_approval: role not permitted',
  'visitor cannot submit');

set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550337"}';
select throws_ok(
  $$ select public.submit_work_package_for_approval('c1c10337-0337-0337-0337-c1c1c1c10337') $$,
  '42501', 'submit_work_package_for_approval: role not permitted',
  'procurement (read-only WP viewer) cannot submit');

set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440337"}';
select throws_ok(
  $$ select public.submit_work_package_for_approval('c1c10337-0337-0337-0337-c1c1c1c10337') $$,
  '42501', 'submit_work_package_for_approval: not a member of this project',
  'a project_manager who is not a member cannot submit');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220337"}';
select is(
  (select public.submit_work_package_for_approval('c1c10337-0337-0337-0337-c1c1c1c10337')),
  true, 'site_admin member submits the WP for approval');
reset role;

select is((select status from public.work_packages
            where id = 'c1c10337-0337-0337-0337-c1c1c1c10337'),
  'pending_approval'::public.work_package_status, 'the WP is now pending_approval');

-- ★ THE F1 PIN — the whole reason this unit exists.
select is((select count(*)::int from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c1c10337-0337-0337-0337-c1c1c1c10337'
              and payload->>'event' = 'wp_status_transition'
              and actor_id is null),
  0, 'F1: the submit transition left NO anonymous audit row');
select is((select actor_id from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c1c10337-0337-0337-0337-c1c1c1c10337'
              and payload->>'event' = 'wp_status_transition'
              and payload->>'to_status' = 'pending_approval'),
  '22222222-2222-2222-2222-222222220337'::uuid,
  'F1: the submit transition is attributed to the submitting site_admin');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220337"}';
select throws_ok(
  $$ select public.submit_work_package_for_approval('c1c10337-0337-0337-0337-c1c1c1c10337') $$,
  '22023', 'submit_work_package_for_approval: cannot submit from status pending_approval',
  're-submitting a pending WP is refused (never regresses the queue)');
select throws_ok(
  $$ select public.submit_work_package_for_approval('c2c20337-0337-0337-0337-c2c2c2c20337') $$,
  '22023', 'submit_work_package_for_approval: cannot submit from status complete',
  'a complete WP cannot be submitted');

-- Spec 144: rework IS a submittable state — fixing a defect sends it back.
select is(
  (select public.submit_work_package_for_approval('c6c60337-0337-0337-0337-c6c6c6c60337')),
  true, 'a rework WP can be submitted for approval');
reset role;
select is((select status from public.work_packages
            where id = 'c6c60337-0337-0337-0337-c6c6c6c60337'),
  'pending_approval'::public.work_package_status, 'the rework WP is now pending_approval');

-- ============================================================================
-- D. decide_work_package — role, membership, comment rule, the three flips.
-- ============================================================================
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220337"}';
select throws_ok(
  $$ select public.decide_work_package('c3c30337-0337-0337-0337-c3c3c3c30337', 'approved', null) $$,
  '42501', 'decide_work_package: role not permitted',
  'site_admin cannot decide (evidence author is not the acceptor)');

set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440337"}';
select throws_ok(
  $$ select public.decide_work_package('c3c30337-0337-0337-0337-c3c3c3c30337', 'approved', null) $$,
  '42501', 'decide_work_package: not a member of this project',
  'a project_manager who is not a member cannot decide');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330337"}';
select throws_ok(
  $$ select public.decide_work_package('c5c50337-0337-0337-0337-c5c5c5c50337', 'needs_revision', null) $$,
  '22023', 'decide_work_package: revision reason required',
  'spec 355: needs_revision without a structured reason is refused (comment no longer required)');
select throws_ok(
  $$ select public.decide_work_package('c4c40337-0337-0337-0337-c4c4c4c40337', 'rejected', '   ') $$,
  '22023', 'decide_work_package: comment required for this decision',
  'rejected with a space-only comment is refused');
-- btrim(x) strips SPACES only — a tab-only comment slipped past the SQL backstop
-- while the form's JS .trim() rejected it.
select throws_ok(
  $$ select public.decide_work_package('c4c40337-0337-0337-0337-c4c4c4c40337', 'rejected', E'\t\n') $$,
  '22023', 'decide_work_package: comment required for this decision',
  'rejected with a tab/newline-only comment is refused too');

-- D.1 needs_revision — evidence cure: records the decision, does NOT flip.
select is(
  (select public.decide_work_package('c5c50337-0337-0337-0337-c5c5c5c50337',
     'needs_revision', '  ถ่ายรูปหลังทำงานใหม่  ', 'incomplete')),
  'pending_approval', 'needs_revision returns the unchanged status');
reset role;
select is((select status from public.work_packages
            where id = 'c5c50337-0337-0337-0337-c5c5c5c50337'),
  'pending_approval'::public.work_package_status, 'needs_revision leaves the WP pending_approval');
select is((select decided_by from public.approvals
            where work_package_id = 'c5c50337-0337-0337-0337-c5c5c5c50337'),
  '33333333-3333-3333-3333-333333330337'::uuid,
  'the approvals row is attributed to the deciding PM');

-- D.2 rejected — F3: the work send-back reuses the rework machinery.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330337"}';
select is(
  (select public.decide_work_package('c4c40337-0337-0337-0337-c4c4c4c40337',
     'rejected', 'ผนังไม่ได้ระดับ')),
  'rework', 'rejected returns the new rework status');
reset role;
select is((select status from public.work_packages
            where id = 'c4c40337-0337-0337-0337-c4c4c4c40337'),
  'rework'::public.work_package_status, 'F3: rejected flips the WP to rework');
select is((select rework_round from public.work_packages
            where id = 'c4c40337-0337-0337-0337-c4c4c4c40337'),
  1::smallint, 'F3: rejected advances rework_round');
-- The round's REASON must land in the one shape every rework reader consumes —
-- and the only audit event the SA's RLS policy admits. Without it the PM's
-- mandatory comment is invisible to the person who has to act on it.
select is((select a.payload->>'reason' from public.audit_log a
            where a.target_id = 'c4c40337-0337-0337-0337-c4c4c4c40337'
              and a.payload->>'event' = 'wp_reopened_for_defect'),
  'ผนังไม่ได้ระดับ', 'F3: the rejection comment becomes the rework round reason');
select is((select a.payload->>'round' from public.audit_log a
            where a.target_id = 'c4c40337-0337-0337-0337-c4c4c4c40337'
              and a.payload->>'event' = 'wp_reopened_for_defect'),
  '1', 'F3: the reason row carries the NEW rework round');
select is((select a.payload->>'source' from public.audit_log a
            where a.target_id = 'c4c40337-0337-0337-0337-c4c4c4c40337'
              and a.payload->>'event' = 'wp_reopened_for_defect'),
  'internal', 'F3: a review rejection is an internal-source rework');
select is((select a.payload->>'via' from public.audit_log a
            where a.target_id = 'c4c40337-0337-0337-0337-c4c4c4c40337'
              and a.payload->>'event' = 'wp_reopened_for_defect'),
  'review_rejection',
  'F3: `via` keeps a review rejection distinguishable from a defect reopen (spec 325 arm)');
select is((select count(*)::int from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c4c40337-0337-0337-0337-c4c4c4c40337'
              and payload->>'event' = 'wp_status_transition'
              and actor_id is null),
  0, 'F1: the reject transition left NO anonymous audit row');
select is((select actor_id from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c4c40337-0337-0337-0337-c4c4c4c40337'
              and payload->>'event' = 'wp_status_transition'
              and payload->>'to_status' = 'rework'),
  '33333333-3333-3333-3333-333333330337'::uuid,
  'F1: the reject transition is attributed to the deciding PM');

-- D.3 approved — the existing close path.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330337"}';
select is(
  (select public.decide_work_package('c3c30337-0337-0337-0337-c3c3c3c30337', 'approved', null)),
  'complete', 'approved returns the new complete status');
reset role;
select is((select status from public.work_packages
            where id = 'c3c30337-0337-0337-0337-c3c3c3c30337'),
  'complete'::public.work_package_status, 'approved flips the WP to complete');
select is((select count(*)::int from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c3c30337-0337-0337-0337-c3c3c3c30337'
              and payload->>'event' = 'wp_status_transition'
              and actor_id is null),
  0, 'F1: the approve transition left NO anonymous audit row');
select is((select actor_id from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c3c30337-0337-0337-0337-c3c3c3c30337'
              and payload->>'event' = 'wp_status_transition'
              and payload->>'to_status' = 'complete'),
  '33333333-3333-3333-3333-333333330337'::uuid,
  'F1: the approve transition is attributed to the deciding PM');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330337"}';
select throws_ok(
  $$ select public.decide_work_package('c3c30337-0337-0337-0337-c3c3c3c30337', 'approved', null) $$,
  '22023', 'decide_work_package: work package is not pending approval',
  'deciding a WP that already left the queue is refused');

-- ============================================================================
-- E. resubmit_work_package_evidence — the explicit ส่งตรวจอีกครั้ง.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660337"}';
select throws_ok(
  $$ select public.resubmit_work_package_evidence('c5c50337-0337-0337-0337-c5c5c5c50337') $$,
  '42501', 'resubmit_work_package_evidence: role not permitted',
  'visitor cannot resubmit');

set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440337"}';
select throws_ok(
  $$ select public.resubmit_work_package_evidence('c5c50337-0337-0337-0337-c5c5c5c50337') $$,
  '42501', 'resubmit_work_package_evidence: not a member of this project',
  'a project_manager who is not a member cannot resubmit');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220337"}';
select throws_ok(
  $$ select public.resubmit_work_package_evidence('c3c30337-0337-0337-0337-c3c3c3c30337') $$,
  '22023', 'resubmit_work_package_evidence: work package is not pending approval',
  'a WP that is not pending approval cannot be resubmitted');
select throws_ok(
  $$ select public.resubmit_work_package_evidence('c7c70337-0337-0337-0337-c7c7c7c70337') $$,
  '22023', 'resubmit_work_package_evidence: no revision request to answer',
  'a pending WP with no needs_revision decision cannot be resubmitted');
select throws_ok(
  $$ select public.resubmit_work_package_evidence('c5c50337-0337-0337-0337-c5c5c5c50337') $$,
  '22023', 'resubmit_work_package_evidence: no new photo since the revision request',
  'the stale pre-decision photo does not satisfy the resubmit gate');
reset role;

-- The cure: a CURRENT after photo shot after the decision. clock_timestamp()
-- advances inside the transaction; now() (the decision's decided_at) does not.
insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by, created_at) values
  ('c5c50337-0337-0337-0337-c5c5c5c50337', 'after', 's337/new.jpg',
   '22222222-2222-2222-2222-222222220337', clock_timestamp());

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220337"}';
select is(
  (select public.resubmit_work_package_evidence('c5c50337-0337-0337-0337-c5c5c5c50337')),
  true, 'a new post-decision photo unlocks the resubmit');
reset role;

select is((select status from public.work_packages
            where id = 'c5c50337-0337-0337-0337-c5c5c5c50337'),
  'pending_approval'::public.work_package_status,
  'resubmit does not change the WP status');
select is((select actor_id from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c5c50337-0337-0337-0337-c5c5c5c50337'
              and payload->>'event' = 'wp_evidence_resubmitted'),
  '22222222-2222-2222-2222-222222220337'::uuid,
  'the resubmit audit row is attributed to the resubmitting site_admin');
select is((select count(*)::int from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c5c50337-0337-0337-0337-c5c5c5c50337'
              and payload->>'event' = 'wp_evidence_resubmitted'
              and actor_id is null),
  0, 'F1: the resubmit left NO anonymous audit row');
select is((select count(*)::int from public.notification_outbox
            where work_package_id = 'c5c50337-0337-0337-0337-c5c5c5c50337'
              and event_type = 'wp_evidence_resubmitted'),
  1, 'the resubmit enqueues one wp_evidence_resubmitted outbox row');
select is((select payload->>'decided_by' from public.notification_outbox
            where work_package_id = 'c5c50337-0337-0337-0337-c5c5c5c50337'
              and event_type = 'wp_evidence_resubmitted'),
  '33333333-3333-3333-3333-333333330337',
  'the outbox payload targets the DECIDER who asked for the re-shoot');
-- resolveRecipients excludes the resubmitter and composeNotification names the
-- WP; both read these keys, and neither is pinned anywhere else against the RPC.
select is((select payload->>'resubmitted_by' from public.notification_outbox
            where work_package_id = 'c5c50337-0337-0337-0337-c5c5c5c50337'
              and event_type = 'wp_evidence_resubmitted'),
  '22222222-2222-2222-2222-222222220337',
  'the outbox payload carries the resubmitter (the self-ping exclusion)');
select is((select payload->>'code' from public.notification_outbox
            where work_package_id = 'c5c50337-0337-0337-0337-c5c5c5c50337'
              and event_type = 'wp_evidence_resubmitted'),
  'W99-05', 'the outbox payload names the WP (the Thai message would be blank without it)');

-- One resubmit per decision: a double-tap on a flaky connection must not ping
-- the decider twice.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220337"}';
select throws_ok(
  $$ select public.resubmit_work_package_evidence('c5c50337-0337-0337-0337-c5c5c5c50337') $$,
  '22023', 'resubmit_work_package_evidence: this revision request was already answered',
  'a second resubmit answering the same decision is refused (idempotent)');
reset role;

select * from finish();
rollback;
