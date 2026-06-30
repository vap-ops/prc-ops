begin;
select plan(16);

-- ============================================================================
-- Spec 144 U1 — reopen_work_package_for_defect(p_wp, p_reason).
--   SECURITY DEFINER; site_admin/PM/super, membership-gated (can_see_wp); only a
--   'complete' WP → 'rework'; writes an audit_log row with the reason.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@rwk-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'sitem@rwk-test.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pmlead@rwk-test.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'sitoth@rwk-test.local', '{}'::jsonb),
  ('88888888-8888-8888-8888-888888888888', 'vis@rwk-test.local',   '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111111111';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222222222';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333333';
update public.users set role='site_admin'      where id='44444444-4444-4444-4444-444444444444';
-- '8888…' stays visitor.

-- P1: pm_lead is lead, site_member is a member. site_other is NOT on P1.
-- WP1 + WP3 complete; WP2 in_progress.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'PRC-RWK-P1', 'โครงการแก้ไข',
   '33333333-3333-3333-3333-333333333333');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
insert into public.work_packages (id, project_id, code, name, status) values
  ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'WP-1', 'งานหนึ่ง', 'complete'),
  ('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'WP-2', 'งานสอง', 'in_progress'),
  ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'WP-3', 'งานสาม', 'complete');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog. Spec 217: the RPC now takes a third arg p_source (rework_source,
-- default 'internal'); the 2-arg signature was dropped.
select ok(to_regprocedure('public.reopen_work_package_for_defect(uuid,text,public.rework_source)') is not null,
  'reopen_work_package_for_defect(uuid,text,rework_source) exists');
select is((select prosecdef from pg_proc
            where oid='public.reopen_work_package_for_defect(uuid,text,public.rework_source)'::regprocedure),
  true, 'reopen_work_package_for_defect is SECURITY DEFINER');

set local role authenticated;

-- B.1 site_admin MEMBER reopens a complete WP → true, status flips to rework.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select is(
  (select public.reopen_work_package_for_defect('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'รอยร้าวที่ผนัง')),
  true, 'site_admin member reopens a complete WP');
select is(
  (select status::text from public.work_packages where id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'),
  'rework', 'the WP is now in rework');
select is(
  (select count(*)::int from public.audit_log
     where target_id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'
       and payload->>'event'='wp_reopened_for_defect'),
  1, 'an audit_log row recorded the defect reopen');

-- 216 U1: the reopen advanced the WP's rework_round counter 0 → 1, and stamped
-- the round into the audit payload so each cycle is addressable.
select is(
  (select rework_round::int from public.work_packages where id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'),
  1, 'reopen advances rework_round to 1');
select is(
  (select (payload->>'round')::int from public.audit_log
     where target_id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'
       and payload->>'event'='wp_reopened_for_defect'
     order by created_at desc limit 1),
  1, 'the audit payload records round 1');

-- 217: B.1 reopened with the 2-arg form → p_source defaults to 'internal' and is
-- stamped into the payload (ตรวจภายใน). Key on round=1 — in one pgTAP txn every
-- row shares created_at (now() is fixed per transaction), so order-by-time can't
-- pick a specific reopen.
select is(
  (select payload->>'source' from public.audit_log
     where target_id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'
       and payload->>'event'='wp_reopened_for_defect'
       and payload->>'round'='1'),
  'internal', 'the audit payload defaults source to internal');

-- 216 U1: a SECOND defect on the same WP (after its round-1 fix is re-approved
-- back to complete) advances to round 2 — multi-rework support. The status reset
-- drops to the table owner; the reopen itself runs as the authenticated member.
reset role;
update public.work_packages set status='complete' where id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
-- 217: this round-2 reopen is a CLIENT call (ลูกค้าแจ้ง) — pass p_source explicitly.
select is(
  (select public.reopen_work_package_for_defect('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'รอยร้าวกลับมาอีก', 'client')),
  true, 'the WP can be reopened a second time (client call)');
select is(
  (select rework_round::int from public.work_packages where id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'),
  2, 'a second reopen advances rework_round to 2');
select is(
  (select payload->>'source' from public.audit_log
     where target_id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'
       and payload->>'event'='wp_reopened_for_defect'
       and payload->>'round'='2'),
  'client', 'an explicit client-call reopen stamps source=client');

-- B.2 A non-complete WP cannot be reopened (22023).
select throws_ok(
  $$ select public.reopen_work_package_for_defect('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'x') $$,
  '22023', null, 'a non-complete WP cannot be reopened');

-- B.3 Empty reason rejected (22023).
select throws_ok(
  $$ select public.reopen_work_package_for_defect('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', '   ') $$,
  '22023', null, 'reason is required');

-- B.4 site_admin NOT on the project is denied (42501, membership).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ select public.reopen_work_package_for_defect('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'defect') $$,
  '42501', null, 'a non-member site_admin cannot reopen');

-- B.5 visitor denied (42501, role).
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888888888"}';
select throws_ok(
  $$ select public.reopen_work_package_for_defect('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'defect') $$,
  '42501', null, 'visitor cannot reopen');

-- B.6 super_admin reopens WP3 (sees all) → rework.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select is(
  (select public.reopen_work_package_for_defect('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'พื้นไม่เรียบ')),
  true, 'super_admin reopens a complete WP');

reset role;

select * from finish();
rollback;
