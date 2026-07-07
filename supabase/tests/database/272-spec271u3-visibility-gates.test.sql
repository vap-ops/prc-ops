-- Writing failing test first.
--
-- Spec 271 U3 / ADR 0075 — visibility + gates + transition audit + baseline RPCs:
--   1. can_see_project membership arms for site_owner + auditor (today both
--      hard-fall to the ELSE FALSE branch) + a project_members self-read policy
--      for the two roles.
--   2. set_work_package_schedule hardening: +site_owner, can_see_wp membership,
--      is_group reject (22023), and the direct planned_* column UPDATE grant is
--      REVOKED (the RPC becomes the only authenticated edit path — the
--      status/rework_round lockdown precedent).
--   3. Status-transition + schedule-edit audit rows via an AFTER UPDATE trigger
--      on work_packages (powers the D7 submit anchor + PM-lag metrics + the
--      date-edit trail). Fires on ALL paths incl. the admin-client submit/decide
--      updates (service role bypasses grants, never triggers).
--   4. reopen_work_package_for_defect: +auditor; role-conditional source —
--      auditor + site_admin file internal ONLY; PM/PD/super file both. (The
--      งาน-signer guard needs wp_signoffs and lands with U5.)
--   5. log_labor_day: p_date bounded to the Bangkok today (anti-forgery, §3).
--   6. propose_plan_baseline / approve_plan_baseline definer RPCs (D3):
--      propose (site_owner/PM-tier) freezes the snapshot into an audit_log
--      proposal event; approve (PD/super) lands the single INSERT stamping both
--      actors (plan_baselines is fully append-only — no post-insert stamping).

begin;
select plan(47);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-4000-8000-0000002710e1', 'super@u3-test.local',   '{}'::jsonb),
  ('22222222-0000-4000-8000-0000002710e2', 'sa@u3-test.local',      '{}'::jsonb),
  ('33333333-0000-4000-8000-0000002710e3', 'pm@u3-test.local',      '{}'::jsonb),
  ('44444444-0000-4000-8000-0000002710e4', 'sowner@u3-test.local',  '{}'::jsonb),
  ('55555555-0000-4000-8000-0000002710e5', 'pd@u3-test.local',      '{}'::jsonb),
  ('66666666-0000-4000-8000-0000002710e6', 'sowner2@u3-test.local', '{}'::jsonb),
  ('77777777-0000-4000-8000-0000002710e7', 'auditor@u3-test.local', '{}'::jsonb),
  ('88888888-0000-4000-8000-0000002710e8', 'auditor2@u3-test.local','{}'::jsonb);

update public.users set role='super_admin'      where id='11111111-0000-4000-8000-0000002710e1';
update public.users set role='site_admin'       where id='22222222-0000-4000-8000-0000002710e2';
update public.users set role='project_manager'  where id='33333333-0000-4000-8000-0000002710e3';
update public.users set role='site_owner'       where id='44444444-0000-4000-8000-0000002710e4';
update public.users set role='project_director' where id='55555555-0000-4000-8000-0000002710e5';
update public.users set role='site_owner'       where id='66666666-0000-4000-8000-0000002710e6';
update public.users set role='auditor'          where id='77777777-0000-4000-8000-0000002710e7';
update public.users set role='auditor'          where id='88888888-0000-4000-8000-0000002710e8';

-- P1: pm is lead; sa + sowner + auditor are members. sowner2/auditor2 are NOT.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a1a1a1-0000-4000-8000-0000002710a1', 'PRC-U3-P1', 'โครงการทดสอบ U3',
   '33333333-0000-4000-8000-0000002710e3');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a1a1a1-0000-4000-8000-0000002710a1', '22222222-0000-4000-8000-0000002710e2', '11111111-0000-4000-8000-0000002710e1'),
  ('a1a1a1a1-0000-4000-8000-0000002710a1', '44444444-0000-4000-8000-0000002710e4', '11111111-0000-4000-8000-0000002710e1'),
  ('a1a1a1a1-0000-4000-8000-0000002710a1', '77777777-0000-4000-8000-0000002710e7', '11111111-0000-4000-8000-0000002710e1');

-- Leaves first (flat, pre-adoption), the group row last (spec 270 forward guard
-- keys adoption on a group existing).
insert into public.work_packages (id, project_id, code, name, status) values
  ('c1c1c1c1-0000-4000-8000-0000002710c1', 'a1a1a1a1-0000-4000-8000-0000002710a1', 'WP-1', 'งานหนึ่ง', 'complete'),
  ('c2c2c2c2-0000-4000-8000-0000002710c2', 'a1a1a1a1-0000-4000-8000-0000002710a1', 'WP-2', 'งานสอง', 'in_progress'),
  ('c3c3c3c3-0000-4000-8000-0000002710c3', 'a1a1a1a1-0000-4000-8000-0000002710a1', 'WP-3', 'งานสาม', 'complete'),
  ('c4c4c4c4-0000-4000-8000-0000002710c4', 'a1a1a1a1-0000-4000-8000-0000002710a1', 'WP-4', 'งานสี่', 'in_progress');
insert into public.work_packages (id, project_id, code, name, status, is_group) values
  ('d1d1d1d1-0000-4000-8000-0000002710d1', 'a1a1a1a1-0000-4000-8000-0000002710a1', 'G-1', 'งานกลุ่ม', 'not_started', true);

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('b1b1b1b1-0000-4000-8000-0000002710b1', 'ช่างทดสอบ U3', 'daily', 'permanent', 400.00, true,
   '11111111-0000-4000-8000-0000002710e1');

create temp table _ids (k text primary key, v uuid);
grant insert, select on _ids to authenticated;

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ================================================================ A. visibility arms
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "44444444-0000-4000-8000-0000002710e4"}';
select is((select public.can_see_project('a1a1a1a1-0000-4000-8000-0000002710a1')),
  true, 'site_owner MEMBER sees the project');

set local "request.jwt.claims" = '{"sub": "66666666-0000-4000-8000-0000002710e6"}';
select is((select public.can_see_project('a1a1a1a1-0000-4000-8000-0000002710a1')),
  false, 'site_owner NON-member does not');

set local "request.jwt.claims" = '{"sub": "77777777-0000-4000-8000-0000002710e7"}';
select is((select public.can_see_project('a1a1a1a1-0000-4000-8000-0000002710a1')),
  true, 'auditor MEMBER sees the project');

set local "request.jwt.claims" = '{"sub": "88888888-0000-4000-8000-0000002710e8"}';
select is((select public.can_see_project('a1a1a1a1-0000-4000-8000-0000002710a1')),
  false, 'auditor NON-member does not');

-- ================================================================ B. project_members self-read
reset role;
select ok(exists (select 1 from pg_policies
   where schemaname='public' and tablename='project_members'
     and policyname='project members self readable by site roles'),
  'project_members has the self-read policy for the two site roles');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "44444444-0000-4000-8000-0000002710e4"}';
select is((select count(*)::int from public.project_members
   where project_id='a1a1a1a1-0000-4000-8000-0000002710a1'),
  1, 'site_owner reads exactly their own membership row');

set local "request.jwt.claims" = '{"sub": "88888888-0000-4000-8000-0000002710e8"}';
select is((select count(*)::int from public.project_members),
  0, 'non-member auditor reads no membership rows');

-- ================================================================ C. schedule hardening
reset role;
select ok(to_regprocedure('public.set_work_package_schedule(uuid,date,date)') is not null,
  'set_work_package_schedule(uuid,date,date) signature unchanged');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "44444444-0000-4000-8000-0000002710e4"}';
select is((select public.set_work_package_schedule(
    'c1c1c1c1-0000-4000-8000-0000002710c1', date '2026-07-10', date '2026-07-14')),
  true, 'site_owner MEMBER sets leaf dates');
select is((select planned_start from public.work_packages
   where id='c1c1c1c1-0000-4000-8000-0000002710c1'),
  date '2026-07-10', 'the dates landed');

set local "request.jwt.claims" = '{"sub": "66666666-0000-4000-8000-0000002710e6"}';
select throws_ok(
  $$ select public.set_work_package_schedule(
       'c1c1c1c1-0000-4000-8000-0000002710c1', date '2026-07-10', date '2026-07-14') $$,
  '42501', null, 'site_owner NON-member is rejected (membership check)');

set local "request.jwt.claims" = '{"sub": "33333333-0000-4000-8000-0000002710e3"}';
select is((select public.set_work_package_schedule(
    'c1c1c1c1-0000-4000-8000-0000002710c1', date '2026-07-12', date '2026-07-16')),
  true, 'PM lead still sets dates (regression)');

select throws_ok(
  $$ select public.set_work_package_schedule(
       'd1d1d1d1-0000-4000-8000-0000002710d1', date '2026-07-10', date '2026-07-14') $$,
  '22023', null, 'a งาน group is rejected — leaf-only dates');

reset role;
select is((select count(*)::int from public.audit_log
   where target_id='c1c1c1c1-0000-4000-8000-0000002710c1'
     and payload->>'event'='wp_schedule_edited'),
  2, 'each schedule edit wrote an audit row (old→new trail)');

select is((select count(*)::int from information_schema.column_privileges
   where table_schema='public' and table_name='work_packages'
     and grantee='authenticated' and privilege_type='UPDATE'
     and column_name in ('planned_start','planned_end')),
  0, 'direct planned_* UPDATE grant is revoked');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-0000-4000-8000-0000002710e3"}';
select throws_ok(
  $$ update public.work_packages set planned_start = date '2026-01-01'
      where id='c1c1c1c1-0000-4000-8000-0000002710c1' $$,
  '42501', null, 'direct planned_start UPDATE is refused even for a PM');

-- ================================================================ D. transition audit trigger
reset role;
select ok(exists (select 1 from pg_trigger
   where tgrelid='public.work_packages'::regclass
     and tgname='work_packages_transition_audit' and not tgisinternal),
  'work_packages_transition_audit trigger exists');

update public.work_packages set status='pending_approval'
 where id='c2c2c2c2-0000-4000-8000-0000002710c2';
select is((select count(*)::int from public.audit_log
   where target_id='c2c2c2c2-0000-4000-8000-0000002710c2'
     and payload->>'event'='wp_status_transition'
     and payload->>'from_status'='in_progress'
     and payload->>'to_status'='pending_approval'),
  1, 'a status flip writes one transition row (the D7 submit anchor)');

update public.work_packages
   set planned_start=date '2026-07-11', planned_end=date '2026-07-15'
 where id='c2c2c2c2-0000-4000-8000-0000002710c2';
select is((select count(*)::int from public.audit_log
   where target_id='c2c2c2c2-0000-4000-8000-0000002710c2'
     and payload->>'event'='wp_schedule_edited'
     and payload->>'old_start' is null
     and payload->>'new_start'='2026-07-11'
     and payload->>'new_end'='2026-07-15'),
  1, 'a planned_* edit writes one schedule row with the old→new diff');

-- ================================================================ E. reopen source rule
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "77777777-0000-4000-8000-0000002710e7"}';
select throws_ok(
  $$ select public.reopen_work_package_for_defect(
       'c1c1c1c1-0000-4000-8000-0000002710c1', 'ลูกค้าแจ้ง', 'client') $$,
  '42501', null, 'auditor may not file a CLIENT defect');

set local "request.jwt.claims" = '{"sub": "22222222-0000-4000-8000-0000002710e2"}';
select throws_ok(
  $$ select public.reopen_work_package_for_defect(
       'c1c1c1c1-0000-4000-8000-0000002710c1', 'ลูกค้าแจ้ง', 'client') $$,
  '42501', null, 'site_admin may not file a CLIENT defect (tightened)');

set local "request.jwt.claims" = '{"sub": "77777777-0000-4000-8000-0000002710e7"}';
select is((select public.reopen_work_package_for_defect(
    'c1c1c1c1-0000-4000-8000-0000002710c1', 'พบรอยร้าวก่อนส่งมอบ')),
  true, 'auditor member files an INTERNAL reopen');
select is((select status::text from public.work_packages
   where id='c1c1c1c1-0000-4000-8000-0000002710c1'),
  'rework', 'the WP moved to rework');

set local "request.jwt.claims" = '{"sub": "88888888-0000-4000-8000-0000002710e8"}';
select throws_ok(
  $$ select public.reopen_work_package_for_defect(
       'c3c3c3c3-0000-4000-8000-0000002710c3', 'ตรวจพบ', 'internal') $$,
  '42501', null, 'NON-member auditor is rejected (membership check)');

set local "request.jwt.claims" = '{"sub": "33333333-0000-4000-8000-0000002710e3"}';
select is((select public.reopen_work_package_for_defect(
    'c3c3c3c3-0000-4000-8000-0000002710c3', 'ลูกค้าแจ้งตำหนิ', 'client')),
  true, 'PM still files a client defect');
reset role;
select is((select payload->>'source' from public.audit_log
   where target_id='c3c3c3c3-0000-4000-8000-0000002710c3'
     and payload->>'event'='wp_reopened_for_defect'
     and (payload->>'round')::int = 1),
  'client', 'the client source is stamped');

-- ================================================================ F. labor date bound
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-0000-4000-8000-0000002710e2"}';
select throws_ok(
  format($f$ select public.log_labor_day(
       'c4c4c4c4-0000-4000-8000-0000002710c4',
       'b1b1b1b1-0000-4000-8000-0000002710b1',
       date %L, 'full') $f$,
    ((now() at time zone 'Asia/Bangkok')::date + 1)::text),
  'P0001', null, 'a future work_date is refused (Bangkok today bound)');
select ok((select public.log_labor_day(
    'c4c4c4c4-0000-4000-8000-0000002710c4',
    'b1b1b1b1-0000-4000-8000-0000002710b1',
    (now() at time zone 'Asia/Bangkok')::date, 'full')) is not null,
  'today (Bangkok) still logs');

-- ================================================================ G. baseline propose/approve
reset role;
select ok(to_regprocedure(
  'public.propose_plan_baseline(uuid,public.plan_baseline_kind,text,uuid[],date)') is not null,
  'propose_plan_baseline(project,kind,reason,wp_ids,scoring_go_live) exists');
select ok(to_regprocedure('public.approve_plan_baseline(uuid)') is not null,
  'approve_plan_baseline(proposal) exists');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-0000-4000-8000-0000002710e2"}';
select throws_ok(
  $$ select public.propose_plan_baseline(
       'a1a1a1a1-0000-4000-8000-0000002710a1', 'initial') $$,
  '42501', null, 'site_admin may not propose a baseline');

set local "request.jwt.claims" = '{"sub": "33333333-0000-4000-8000-0000002710e3"}';
insert into _ids (k, v)
select 'prop1', public.propose_plan_baseline(
  'a1a1a1a1-0000-4000-8000-0000002710a1', 'initial', null, null, date '2026-08-01');
select ok((select v from _ids where k='prop1') is not null,
  'PM proposes the initial baseline');
reset role;
select is((select count(*)::int from public.audit_log
   where id=(select v from _ids where k='prop1')
     and payload->>'event'='plan_baseline_proposed'),
  1, 'the proposal is an audit_log event (frozen snapshot payload)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-0000-4000-8000-0000002710e3"}';
select throws_ok(
  $$ select public.approve_plan_baseline((select v from _ids where k='prop1')) $$,
  '42501', null, 'a PM may not approve');

-- The plan drifts between propose and approve — the FROZEN snapshot must land.
reset role;
update public.work_packages set planned_end=date '2026-07-30'
 where id='c1c1c1c1-0000-4000-8000-0000002710c1';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55555555-0000-4000-8000-0000002710e5"}';
insert into _ids (k, v)
select 'bl1', public.approve_plan_baseline((select v from _ids where k='prop1'));
select ok((select v from _ids where k='bl1') is not null,
  'PD approves — the baseline row lands');

reset role;
select is((select version::text || '/' || kind::text || '/' || coalesce(scoring_go_live::text,'-')
     from public.plan_baselines where id=(select v from _ids where k='bl1')),
  '1/initial/2026-08-01', 'v1 initial with scoring_go_live (D8)');
select ok((select proposed_by='33333333-0000-4000-8000-0000002710e3'
        and approved_by='55555555-0000-4000-8000-0000002710e5'
     from public.plan_baselines where id=(select v from _ids where k='bl1')),
  'both actors stamped in the single INSERT');
select is((select count(*)::int from public.plan_baseline_items
   where baseline_id=(select v from _ids where k='bl1')),
  2, 'items = the two dated leaves (undated leaves omitted)');
select is((select planned_end from public.plan_baseline_items
   where baseline_id=(select v from _ids where k='bl1')
     and work_package_id='c1c1c1c1-0000-4000-8000-0000002710c1'),
  date '2026-07-16', 'the item carries the FROZEN date, not the drifted one');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55555555-0000-4000-8000-0000002710e5"}';
select throws_ok(
  $$ select public.approve_plan_baseline((select v from _ids where k='prop1')) $$,
  '22023', null, 'a proposal approves once');

set local "request.jwt.claims" = '{"sub": "33333333-0000-4000-8000-0000002710e3"}';
select throws_ok(
  $$ select public.propose_plan_baseline(
       'a1a1a1a1-0000-4000-8000-0000002710a1', 'initial') $$,
  '22023', null, 'initial is rejected once a baseline exists');
select throws_ok(
  $$ select public.propose_plan_baseline(
       'a1a1a1a1-0000-4000-8000-0000002710a1', 'scope_change', 'ปรับขอบเขต') $$,
  '22023', null, 'scope_change requires the explicit leaf diff (D3)');

set local "request.jwt.claims" = '{"sub": "44444444-0000-4000-8000-0000002710e4"}';
insert into _ids (k, v)
select 'prop2', public.propose_plan_baseline(
  'a1a1a1a1-0000-4000-8000-0000002710a1', 'scope_change', 'งานเพิ่มจากลูกค้า',
  array['c1c1c1c1-0000-4000-8000-0000002710c1']::uuid[]);
set local "request.jwt.claims" = '{"sub": "55555555-0000-4000-8000-0000002710e5"}';
insert into _ids (k, v)
select 'bl2', public.approve_plan_baseline((select v from _ids where k='prop2'));
reset role;
select is((select max(version)::int from public.plan_baselines
   where project_id='a1a1a1a1-0000-4000-8000-0000002710a1'),
  2, 'site_owner proposes a scope_change → v2');
select is((select count(*)::int from public.plan_baseline_items
   where baseline_id=(select v from _ids where k='bl2')),
  1, 'the scope_change version contains ONLY its diffed leaf');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-0000-4000-8000-0000002710e3"}';
select throws_ok(
  $$ select public.propose_plan_baseline(
       'a1a1a1a1-0000-4000-8000-0000002710a1', 'rebaseline') $$,
  '22023', null, 'a non-initial kind requires a reason');
select throws_ok(
  $$ select public.propose_plan_baseline(
       'a1a1a1a1-0000-4000-8000-0000002710a1', 'rebaseline', 'แผนใหม่',
       null, date '2026-09-01') $$,
  '22023', null, 'scoring_go_live is initial-only');

reset role;
select is(has_function_privilege('anon',
  'public.propose_plan_baseline(uuid,public.plan_baseline_kind,text,uuid[],date)', 'execute'),
  false, 'anon cannot execute propose_plan_baseline');

select * from finish();
rollback;
