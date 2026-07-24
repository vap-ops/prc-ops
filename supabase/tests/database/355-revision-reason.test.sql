begin;
select plan(19);

-- ============================================================================
-- Spec 355 U1 — structured reject-evidence reasons.
--
-- decide_work_package gains p_revision_reason (approval_revision_reason enum:
-- incomplete/mismatch/premature). needs_revision now REQUIRES a reason (the
-- comment demotes to optional detail); rejected keeps its required comment and
-- must NOT carry a reason; approved carries neither. The rejected → rework +
-- rework_round++ + wp_reopened_for_defect audit write is preserved verbatim
-- (pinned in 337-approval-rpcs).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110355', 'super@s355.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330355', 'pm@s355.local',    '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-111111110355';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-333333330355';

insert into public.projects (id, code, name, project_lead_id) values
  ('a3550355-0355-0355-0355-a3550355a355', 'PRC-355-P1', 'โครงการทดสอบ 355',
   '33333333-3333-3333-3333-333333330355');

insert into public.work_packages (id, project_id, code, name, status, rework_round) values
  ('c3550355-0355-0355-0355-c355000000a1', 'a3550355-0355-0355-0355-a3550355a355',
   'W99-A1', 'งานสำหรับเทสต์ throw', 'pending_approval', 0),
  ('c3550355-0355-0355-0355-c355000000b2', 'a3550355-0355-0355-0355-a3550355a355',
   'W99-B2', 'needs_revision mismatch', 'pending_approval', 0),
  ('c3550355-0355-0355-0355-c355000000c3', 'a3550355-0355-0355-0355-a3550355a355',
   'W99-C3', 'needs_revision + detail', 'pending_approval', 0),
  ('c3550355-0355-0355-0355-c355000000d4', 'a3550355-0355-0355-0355-a3550355a355',
   'W99-D4', 'rejected', 'pending_approval', 0),
  ('c3550355-0355-0355-0355-c355000000e5', 'a3550355-0355-0355-0355-a3550355a355',
   'W99-E5', 'approved', 'pending_approval', 0);

-- role-switched asserts write into the runner's collector (pgtap-tapbuf, PR #400)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog — the enum, the column, the new signature + grants.
-- ============================================================================
select has_type('public', 'approval_revision_reason', 'the approval_revision_reason enum exists');
select is(
  (select array_agg(e order by e) from unnest(enum_range(null::public.approval_revision_reason)::text[]) e),
  array['incomplete', 'mismatch', 'premature'],
  'the enum has exactly incomplete/mismatch/premature');

select has_column('public', 'approvals', 'revision_reason', 'approvals.revision_reason exists');
select col_is_null('public', 'approvals', 'revision_reason', 'approvals.revision_reason is nullable');

select ok(
  to_regprocedure('public.decide_work_package(uuid,approval_decision,text,approval_revision_reason)') is not null,
  'decide_work_package gains the p_revision_reason argument');
select is((select prosecdef from pg_proc
            where oid = 'public.decide_work_package(uuid,approval_decision,text,approval_revision_reason)'::regprocedure),
  true, 'decide_work_package is still SECURITY DEFINER');
select is(has_function_privilege('anon',
  'public.decide_work_package(uuid,approval_decision,text,approval_revision_reason)', 'EXECUTE'),
  false, 'anon cannot execute decide_work_package');
select is(has_function_privilege('authenticated',
  'public.decide_work_package(uuid,approval_decision,text,approval_revision_reason)', 'EXECUTE'),
  true, 'authenticated can execute decide_work_package');
select ok(not exists (
    select 1 from pg_proc p,
                  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'decide_work_package'
       and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no EXECUTE on decide_work_package');

-- ============================================================================
-- B. The validation matrix (as the deciding PM member).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330355"}';

-- needs_revision REQUIRES a reason (comment no longer required).
select throws_ok(
  $$ select public.decide_work_package('c3550355-0355-0355-0355-c355000000a1', 'needs_revision', null, null) $$,
  '22023', 'decide_work_package: revision reason required',
  'needs_revision without a structured reason is refused');

-- rejected must NOT carry a reason (it is a reject-work, not reject-evidence).
select throws_ok(
  $$ select public.decide_work_package('c3550355-0355-0355-0355-c355000000a1', 'rejected', 'ผนังเอียง', 'mismatch') $$,
  '22023', 'decide_work_package: revision reason only for needs_revision',
  'rejected with a revision reason is refused');

-- rejected still requires its defect comment (unchanged).
select throws_ok(
  $$ select public.decide_work_package('c3550355-0355-0355-0355-c355000000a1', 'rejected', null, null) $$,
  '22023', 'decide_work_package: comment required for this decision',
  'rejected without a comment is still refused');

-- needs_revision + reason (no comment) succeeds and persists the reason.
select is(
  (select public.decide_work_package('c3550355-0355-0355-0355-c355000000b2', 'needs_revision', null, 'mismatch')),
  'pending_approval', 'needs_revision with a reason (no comment) succeeds, WP stays pending');
reset role;
select is((select revision_reason from public.approvals
            where work_package_id = 'c3550355-0355-0355-0355-c355000000b2'),
  'mismatch'::public.approval_revision_reason, 'the approvals row carries the structured reason');

-- needs_revision + reason + optional comment detail succeeds.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330355"}';
select is(
  (select public.decide_work_package('c3550355-0355-0355-0355-c355000000c3', 'needs_revision', 'เพิ่มรูปเตรียมงาน', 'incomplete')),
  'pending_approval', 'needs_revision with a reason AND a comment detail succeeds');

-- rejected + comment (no reason) still flips to rework (F3 preserved).
select is(
  (select public.decide_work_package('c3550355-0355-0355-0355-c355000000d4', 'rejected', 'งานไม่ได้ระดับ')),
  'rework', 'rejected with a comment (no reason) still flips to rework');
reset role;
select is((select rework_round from public.work_packages
            where id = 'c3550355-0355-0355-0355-c355000000d4'),
  1::smallint, 'F3 preserved: rejected advances rework_round');

-- approved carries neither.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330355"}';
select is(
  (select public.decide_work_package('c3550355-0355-0355-0355-c355000000e5', 'approved', null)),
  'complete', 'approved (no comment, no reason) still completes the WP');
reset role;
select is((select revision_reason from public.approvals
            where work_package_id = 'c3550355-0355-0355-0355-c355000000e5'),
  null, 'an approved decision carries no revision_reason');

select * from finish();
rollback;
