begin;
select plan(43);

-- ============================================================================
-- Spec 352 — ถอนงานกลับมาแก้ไข: recall a submitted WP to fix its evidence.
--
-- The submitter (or super_admin) pulls an UNDECIDED pending_approval WP back to
-- in_progress, where the existing remove/add-photo flow already works, then
-- re-submits. Preserves the 291/340 evidence freeze — changing photos requires
-- taking the WP OUT of review (this audited status change), never a silent
-- in-place edit on a frozen WP.
--
--   * can_recall_work_package(p_wp)  — STABLE SECURITY DEFINER predicate shared
--     by the RPC (enforce) and load-detail (render the button); DEFINER because
--     the submitter read hits audit_log (event-allowlisted for user sessions).
--   * recall_work_package_submission(p_wp) — SECURITY DEFINER, FOR UPDATE +
--     re-check, pending_approval → in_progress. The existing transition-audit
--     trigger attributes the recall (no new event; from/to is unambiguous).
--
-- Authority = the ORIGINAL SUBMITTER (derived from the spec-337 audit trail) or
-- super_admin. Recallable whenever pending_approval AND the ให้แก้ไข window is
-- CLOSED. Fails closed on a null submitter (pre-337) → super_admin only.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000352', 'super@s352.local', '{}'::jsonb),
  ('b0000000-0000-0000-0000-000000000352', 'sa@s352.local',    '{}'::jsonb),
  ('c0000000-0000-0000-0000-000000000352', 'saoth@s352.local', '{}'::jsonb),
  ('d0000000-0000-0000-0000-000000000352', 'pmgr@s352.local',  '{}'::jsonb),
  ('e0000000-0000-0000-0000-000000000352', 'pm@s352.local',    '{}'::jsonb),
  ('f0000000-0000-0000-0000-000000000352', 'demo@s352.local',  '{}'::jsonb),
  ('06660000-0000-0000-0000-000000000352', 'vis@s352.local',   '{}'::jsonb);

update public.users set role = 'super_admin'          where id = 'a0000000-0000-0000-0000-000000000352';
update public.users set role = 'site_admin'           where id = 'b0000000-0000-0000-0000-000000000352';
update public.users set role = 'site_admin'           where id = 'c0000000-0000-0000-0000-000000000352';
update public.users set role = 'procurement_manager'  where id = 'd0000000-0000-0000-0000-000000000352';
update public.users set role = 'project_manager'      where id = 'e0000000-0000-0000-0000-000000000352';
update public.users set role = 'site_admin'           where id = 'f0000000-0000-0000-0000-000000000352';
-- '0666…' stays visitor.

-- pm (e000) is the project lead → a member. sa (b000), saoth (c000), demo (f000)
-- are explicit members. pmgr (d000) + super (a000) see every project by role.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1520000-0000-0000-0000-000000000352', 'PRC-352-P1', 'โครงการทดสอบ 352',
   'e0000000-0000-0000-0000-000000000352');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1520000-0000-0000-0000-000000000352', 'b0000000-0000-0000-0000-000000000352', 'a0000000-0000-0000-0000-000000000352'),
  ('a1520000-0000-0000-0000-000000000352', 'c0000000-0000-0000-0000-000000000352', 'a0000000-0000-0000-0000-000000000352'),
  ('a1520000-0000-0000-0000-000000000352', 'f0000000-0000-0000-0000-000000000352', 'a0000000-0000-0000-0000-000000000352');

-- Submittable WPs start in_progress; they reach pending_approval ONLY via the
-- submit RPC below, so the wp_status_transition audit row (the submitter the
-- predicate derives) is real. wp_complete + wp_null are the exceptions.
insert into public.work_packages (id, project_id, code, name, status, rework_round) values
  ('c1520000-0000-0000-0000-000000000001', 'a1520000-0000-0000-0000-000000000352', 'W52-01', 'งานสด',          'in_progress',      0),
  ('c1520000-0000-0000-0000-000000000002', 'a1520000-0000-0000-0000-000000000352', 'W52-02', 'งานให้super',     'in_progress',      0),
  ('c1520000-0000-0000-0000-000000000003', 'a1520000-0000-0000-0000-000000000352', 'W52-03', 'งานคนอื่นถอน',    'in_progress',      0),
  ('c1520000-0000-0000-0000-000000000004', 'a1520000-0000-0000-0000-000000000352', 'W52-04', 'งานหน้าต่างเปิด',   'in_progress',      0),
  ('c1520000-0000-0000-0000-000000000005', 'a1520000-0000-0000-0000-000000000352', 'W52-05', 'งานตอบแล้ว',      'in_progress',      0),
  ('c1520000-0000-0000-0000-000000000006', 'a1520000-0000-0000-0000-000000000352', 'W52-06', 'งานผู้ส่งถูกลดสิทธิ์', 'in_progress',      0),
  ('c1520000-0000-0000-0000-000000000007', 'a1520000-0000-0000-0000-000000000352', 'W52-07', 'งานเสร็จแล้ว',    'complete',         0),
  ('c1520000-0000-0000-0000-000000000008', 'a1520000-0000-0000-0000-000000000352', 'W52-08', 'งานไม่มีผู้ส่ง',    'pending_approval', 0);

-- role-switched asserts write into the runner's collector (pgtap-tapbuf, PR #400)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- --- Submit the submittable WPs so each carries a real submitter -------------
-- Every function CALL is an assertion: the runner rewrites any top-level `select`
-- into the _tap_buf collector, so a bare `select fn()` would inject its return
-- value as a bogus TAP line. Wrapping also verifies the setup actually ran.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-0000-0000-000000000352"}';
select is((select public.submit_work_package_for_approval('c1520000-0000-0000-0000-000000000001')), true, 'setup: b000 submits wp_fresh');
select is((select public.submit_work_package_for_approval('c1520000-0000-0000-0000-000000000002')), true, 'setup: b000 submits wp_super');
select is((select public.submit_work_package_for_approval('c1520000-0000-0000-0000-000000000003')), true, 'setup: b000 submits wp_reject');
select is((select public.submit_work_package_for_approval('c1520000-0000-0000-0000-000000000004')), true, 'setup: b000 submits wp_window');
select is((select public.submit_work_package_for_approval('c1520000-0000-0000-0000-000000000005')), true, 'setup: b000 submits wp_answered');
-- wp_demote submitted by f000 (a site_admin AT SUBMIT TIME), demoted below.
set local "request.jwt.claims" = '{"sub": "f0000000-0000-0000-0000-000000000352"}';
select is((select public.submit_work_package_for_approval('c1520000-0000-0000-0000-000000000006')), true, 'setup: f000 submits wp_demote');
-- pm bounces wp_window + wp_answered (needs_revision) — opens the ให้แก้ไข window.
set local "request.jwt.claims" = '{"sub": "e0000000-0000-0000-0000-000000000352"}';
select is((select public.decide_work_package('c1520000-0000-0000-0000-000000000004', 'needs_revision', 'ถ่ายรูปใหม่', 'mismatch')), 'pending_approval', 'setup: pm bounces wp_window');
select is((select public.decide_work_package('c1520000-0000-0000-0000-000000000005', 'needs_revision', 'ถ่ายรูปใหม่', 'mismatch')), 'pending_approval', 'setup: pm bounces wp_answered');
reset role;

-- Demote f000 AFTER it submitted — a since-demoted submitter must not recall.
update public.users set role = 'procurement' where id = 'f0000000-0000-0000-0000-000000000352';

-- Answer wp_answered's window (simulates resubmit_work_package_evidence, which
-- writes this exact audit row) so its window is CLOSED again.
insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
select 'b0000000-0000-0000-0000-000000000352', 'site_admin', 'other', 'work_packages',
  'c1520000-0000-0000-0000-000000000005',
  jsonb_build_object('event', 'wp_evidence_resubmitted', 'answers_decision_id',
    (select id::text from public.approvals
      where work_package_id = 'c1520000-0000-0000-0000-000000000005'
      order by decided_at desc, id desc limit 1));

-- ============================================================================
-- A. Catalog + grants (house lockdown: revoke all from public, anon).
-- ============================================================================
select ok(to_regprocedure('public.can_recall_work_package(uuid)') is not null,
  'can_recall_work_package(uuid) exists');
select ok(to_regprocedure('public.recall_work_package_submission(uuid)') is not null,
  'recall_work_package_submission(uuid) exists');
select is((select prosecdef from pg_proc where oid = 'public.can_recall_work_package(uuid)'::regprocedure),
  true, 'can_recall_work_package is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid = 'public.recall_work_package_submission(uuid)'::regprocedure),
  true, 'recall_work_package_submission is SECURITY DEFINER');
select is(has_function_privilege('anon', 'public.can_recall_work_package(uuid)', 'EXECUTE'),
  false, 'anon cannot execute can_recall_work_package');
select is(has_function_privilege('anon', 'public.recall_work_package_submission(uuid)', 'EXECUTE'),
  false, 'anon cannot execute recall_work_package_submission');
select is(has_function_privilege('authenticated', 'public.can_recall_work_package(uuid)', 'EXECUTE'),
  true, 'authenticated can execute can_recall_work_package');
select is(has_function_privilege('authenticated', 'public.recall_work_package_submission(uuid)', 'EXECUTE'),
  true, 'authenticated can execute recall_work_package_submission');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'can_recall_work_package'
              and has_function_privilege('public', p.oid, 'EXECUTE')),
  0, 'PUBLIC has no EXECUTE on can_recall_work_package');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'recall_work_package_submission'
              and has_function_privilege('public', p.oid, 'EXECUTE')),
  0, 'PUBLIC has no EXECUTE on recall_work_package_submission');

-- ============================================================================
-- B. can_recall predicate on wp_fresh (fresh submit by b000, undecided).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000001')),
  true, 'the SUBMITTER (site_admin) may recall a fresh submission');
set local "request.jwt.claims" = '{"sub": "a0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000001')),
  true, 'super_admin may recall any fresh submission');
set local "request.jwt.claims" = '{"sub": "c0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000001')),
  false, 'a DIFFERENT site_admin member (not the submitter) may NOT recall');
set local "request.jwt.claims" = '{"sub": "d0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000001')),
  false, 'procurement_manager (see-all, not the submitter) may NOT recall');
set local "request.jwt.claims" = '{"sub": "06660000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000001')),
  false, 'a visitor may not recall');
set local "request.jwt.claims" = '{}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000001')),
  false, 'a null-role session may not recall (null-safe)');
reset role;

-- ============================================================================
-- C. recall execution — attribution + status flip.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c0000000-0000-0000-0000-000000000352"}';
select throws_ok(
  $$ select public.recall_work_package_submission('c1520000-0000-0000-0000-000000000003') $$,
  '42501', 'recall_work_package_submission: recall not permitted',
  'a non-submitter site_admin is refused at the RPC');
set local "request.jwt.claims" = '{"sub": "b0000000-0000-0000-0000-000000000352"}';
select is((select public.recall_work_package_submission('c1520000-0000-0000-0000-000000000001')),
  true, 'the submitter recalls the fresh WP');
set local "request.jwt.claims" = '{"sub": "a0000000-0000-0000-0000-000000000352"}';
select is((select public.recall_work_package_submission('c1520000-0000-0000-0000-000000000002')),
  true, 'super_admin recalls another fresh WP');
reset role;
select is((select status from public.work_packages where id = 'c1520000-0000-0000-0000-000000000001'),
  'in_progress'::public.work_package_status, 'the recalled WP is back to in_progress');
select is((select status from public.work_packages where id = 'c1520000-0000-0000-0000-000000000002'),
  'in_progress'::public.work_package_status, 'super_admin recall also lands in_progress');
select is((select actor_id from public.audit_log
            where target_table = 'work_packages'
              and target_id = 'c1520000-0000-0000-0000-000000000001'
              and payload->>'event' = 'wp_status_transition'
              and payload->>'to_status' = 'in_progress'),
  'b0000000-0000-0000-0000-000000000352'::uuid,
  'the recall transition is attributed to the recalling submitter');

-- ============================================================================
-- D. The ให้แก้ไข window is OPEN (wp_window) — recall is refused.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000004')),
  false, 'the submitter may NOT recall while a needs_revision window is open');
set local "request.jwt.claims" = '{"sub": "a0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000004')),
  false, 'super_admin may NOT recall while a needs_revision window is open');
set local "request.jwt.claims" = '{"sub": "b0000000-0000-0000-0000-000000000352"}';
select throws_ok(
  $$ select public.recall_work_package_submission('c1520000-0000-0000-0000-000000000004') $$,
  '42501', 'recall_work_package_submission: recall not permitted',
  'the RPC refuses recall while the window is open (use in-place removal)');
reset role;

-- ============================================================================
-- E. The window was answered (wp_answered) — CLOSED again → recallable.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000005')),
  true, 'the submitter may recall a re-submitted WP once the window is closed');
select is((select public.recall_work_package_submission('c1520000-0000-0000-0000-000000000005')),
  true, 'recall succeeds on the closed-window WP');
reset role;
select is((select status from public.work_packages where id = 'c1520000-0000-0000-0000-000000000005'),
  'in_progress'::public.work_package_status, 'the closed-window WP lands in_progress');

-- ============================================================================
-- F. A since-demoted submitter (wp_demote) — role gate refuses.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000006')),
  false, 'the submitter demoted to procurement (read-only WP viewer) may NOT recall');
select throws_ok(
  $$ select public.recall_work_package_submission('c1520000-0000-0000-0000-000000000006') $$,
  '42501', 'recall_work_package_submission: recall not permitted',
  'the RPC refuses the since-demoted submitter');
reset role;

-- ============================================================================
-- G. Wrong status (wp_complete) — not pending_approval → not recallable.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000007')),
  false, 'a complete WP is not recallable (wrong status)');
reset role;

-- ============================================================================
-- H. Null submitter (wp_null, direct pending_approval, pre-337) — super only.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000008')),
  true, 'super_admin may recall a null-submitter WP (fail-closed fallback)');
set local "request.jwt.claims" = '{"sub": "b0000000-0000-0000-0000-000000000352"}';
select is((select public.can_recall_work_package('c1520000-0000-0000-0000-000000000008')),
  false, 'a site_admin member may NOT recall a null-submitter WP (not the submitter)');
set local "request.jwt.claims" = '{"sub": "a0000000-0000-0000-0000-000000000352"}';
select is((select public.recall_work_package_submission('c1520000-0000-0000-0000-000000000008')),
  true, 'super_admin recalls the null-submitter WP');
reset role;
select is((select status from public.work_packages where id = 'c1520000-0000-0000-0000-000000000008'),
  'in_progress'::public.work_package_status, 'the null-submitter WP lands in_progress');

select * from finish();
rollback;
