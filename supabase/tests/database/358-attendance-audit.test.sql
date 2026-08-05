begin;
select plan(50);

-- ============================================================================
-- Spec 358 U1 — attendance audit read RPCs for the office/payroll audience.
--   audit_attendance_summary(from,to,project?)  → per-worker aggregates + signals
--   audit_attendance_detail(from,to,project?,worker?) → per-session rows + signals
-- Both SECURITY DEFINER, 42501-gated on ATTENDANCE_AUDIT_ROLES (7 roles); the full
-- set (6, minus project_manager) sees every project, project_manager is scoped by
-- can_see_project. Read-only, money-free. muster_* RLS (can_see_project) is FALSE
-- for accounting/hr — hence the DEFINER read, not a policy change.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0358-0358-0358-000000000009', 'super@s358.local', '{}'::jsonb),
  ('70000000-0358-0358-0358-00000000000a', 'acct@s358.local',  '{}'::jsonb),
  ('70000000-0358-0358-0358-00000000000b', 'pm@s358.local',    '{}'::jsonb),
  ('70000000-0358-0358-0358-0000000000fe', 'probe@s358.local', '{}'::jsonb);
update public.users set role = 'super_admin', full_name = 'ผู้ดูแลระบบ' where id = '70000000-0358-0358-0358-000000000009';
update public.users set role = 'accounting'                            where id = '70000000-0358-0358-0358-00000000000a';
update public.users set role = 'project_manager'                       where id = '70000000-0358-0358-0358-00000000000b';
-- probe (70..fe) stays visitor; its role is flipped through all 17 for the gate loop.

-- Workers: worker1 (project A, all signal rows), worker2 (project B), a team lead.
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, user_id) values
  ('e1000000-0358-0358-0358-000000000001', 'ช่าง หนึ่ง', 'daily', 'temporary', 400, true, '70000000-0358-0358-0358-000000000009', null),
  ('e2000000-0358-0358-0358-000000000002', 'ช่าง สอง',   'daily', 'temporary', 400, true, '70000000-0358-0358-0358-000000000009', null),
  ('e9000000-0358-0358-0358-000000000009', 'หัวหน้า',     'daily', 'temporary', 400, true, '70000000-0358-0358-0358-000000000009', null);

insert into public.projects (id, code, name) values
  ('a1000000-0358-0358-0358-000000000001', 'TAP-358A', 'โครงการเอ'),
  ('a2000000-0358-0358-0358-000000000002', 'TAP-358B', 'โครงการบี');

-- pm is a member of project A ONLY (the can_see_project membership arm).
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0358-0358-0358-000000000001', '70000000-0358-0358-0358-00000000000b', '70000000-0358-0358-0358-000000000009');

-- Teams: A on 07-22/23/24 (same lead), B on 07-24. (muster_teams unique project+date+lead.)
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('71000000-0358-0358-0358-000000000022', 'a1000000-0358-0358-0358-000000000001', '2026-07-22', 'e9000000-0358-0358-0358-000000000009', '70000000-0358-0358-0358-000000000009'),
  ('71000000-0358-0358-0358-000000000023', 'a1000000-0358-0358-0358-000000000001', '2026-07-23', 'e9000000-0358-0358-0358-000000000009', '70000000-0358-0358-0358-000000000009'),
  ('71000000-0358-0358-0358-000000000024', 'a1000000-0358-0358-0358-000000000001', '2026-07-24', 'e9000000-0358-0358-0358-000000000009', '70000000-0358-0358-0358-000000000009'),
  ('72000000-0358-0358-0358-000000000024', 'a2000000-0358-0358-0358-000000000002', '2026-07-24', 'e9000000-0358-0358-0358-000000000009', '70000000-0358-0358-0358-000000000009');

-- worker1's rows (project A) — engineered to exercise every signal:
--   07-24 regular: manual in, checked out 17:00, out_auto=false
--   07-24 ot     : manual in, checked out 20:00, ot_hours=2.0
--   07-23 regular: QR in, out_at NULL (open), out_auto=false
--   07-22 regular: manual in, out 17:00, out_auto=TRUE (close-day auto-out)
insert into public.muster_attendance
  (team_id, worker_id, work_date, session, in_method, out_at, out_auto, ot_hours, scanned_by) values
  ('71000000-0358-0358-0358-000000000024', 'e1000000-0358-0358-0358-000000000001', '2026-07-24', 'regular', 'manual', '2026-07-24 17:00:00+07', false, null, '70000000-0358-0358-0358-000000000009'),
  ('71000000-0358-0358-0358-000000000024', 'e1000000-0358-0358-0358-000000000001', '2026-07-24', 'ot',      'manual', '2026-07-24 20:00:00+07', false, 2.0,  '70000000-0358-0358-0358-000000000009'),
  ('71000000-0358-0358-0358-000000000023', 'e1000000-0358-0358-0358-000000000001', '2026-07-23', 'regular', 'qr',     null,                     false, null, '70000000-0358-0358-0358-000000000009'),
  ('71000000-0358-0358-0358-000000000022', 'e1000000-0358-0358-0358-000000000001', '2026-07-22', 'regular', 'manual', '2026-07-22 17:00:00+07', true,  null, '70000000-0358-0358-0358-000000000009');
-- worker2 in project B (cross-project reach test).
insert into public.muster_attendance
  (team_id, worker_id, work_date, session, in_method, out_at, out_auto, ot_hours, scanned_by) values
  ('72000000-0358-0358-0358-000000000024', 'e2000000-0358-0358-0358-000000000002', '2026-07-24', 'regular', 'manual', '2026-07-24 17:00:00+07', false, null, '70000000-0358-0358-0358-000000000009');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + grants (revoke-all-from-public / anon-leak guard, spec 229/336).
-- ============================================================================
select has_function('public', 'audit_attendance_summary', 'audit_attendance_summary exists');
select has_function('public', 'audit_attendance_detail',  'audit_attendance_detail exists');
select ok(not has_function_privilege('anon', 'public.audit_attendance_summary(date,date,uuid)', 'execute'),
  'anon cannot execute summary');
select ok(not has_function_privilege('anon', 'public.audit_attendance_detail(date,date,uuid,uuid)', 'execute'),
  'anon cannot execute detail');
select ok(has_function_privilege('authenticated', 'public.audit_attendance_summary(date,date,uuid)', 'execute'),
  'authenticated can execute summary');
select ok(has_function_privilege('authenticated', 'public.audit_attendance_detail(date,date,uuid,uuid)', 'execute'),
  'authenticated can execute detail');
select ok(not has_function_privilege('public', 'public.audit_attendance_summary(date,date,uuid)', 'execute'),
  'PUBLIC (default) cannot execute summary — revoke all from public held');
select ok(not has_function_privilege('public', 'public.audit_attendance_detail(date,date,uuid,uuid)', 'execute'),
  'PUBLIC (default) cannot execute detail — revoke all from public held');

-- ============================================================================
-- B. Exhaustive-domain pin — a NEW user_role value reds the plan, forcing the
--    author to classify it into the gate (doctrine allowlist rule).
-- ============================================================================
select is(array_length(enum_range(null::public.user_role), 1), 17,
  'user_role has 17 values — a new one must be classified into the audit gate below');

-- ============================================================================
-- C. Summary gate over ALL 17 roles: the 8 audit roles live, the other 9 raise
--    42501. (probe user id fixed; only its role flips.)
--    Spec 397 U1 moved `procurement` from the denied block into the audit block —
--    that team runs the attendance double-check.
-- ============================================================================
-- 8 AUDIT roles → lives_ok
reset role;
update public.users set role = 'accounting' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, 'accounting may audit');
reset role;
update public.users set role = 'hr' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, 'hr may audit');
reset role;
update public.users set role = 'project_director' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, 'project_director may audit');
reset role;
update public.users set role = 'project_coordinator' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, 'project_coordinator may audit');
reset role;
update public.users set role = 'procurement_manager' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, 'procurement_manager may audit');
reset role;
update public.users set role = 'super_admin' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, 'super_admin may audit');
reset role;
update public.users set role = 'project_manager' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, 'project_manager may audit (scoped)');
reset role;
update public.users set role = 'procurement' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, 'procurement may audit (spec 397 U1 — the double-check team)');
reset role;
-- 9 NON-audit roles → throws 42501
update public.users set role = 'site_admin' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'site_admin denied (cockpit, not this office surface)');
reset role;
update public.users set role = 'technician' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'technician denied');
reset role;
update public.users set role = 'subcon_manager' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'subcon_manager denied');
reset role;
update public.users set role = 'visitor' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'visitor denied');
reset role;
update public.users set role = 'contractor' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'contractor denied');
reset role;
update public.users set role = 'client' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'client denied');
reset role;
update public.users set role = 'site_owner' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'site_owner denied');
reset role;
update public.users set role = 'auditor' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'auditor denied (not in the audit set — v1)');
reset role;
update public.users set role = 'legal' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'legal denied');
reset role;

-- ============================================================================
-- D. Detail gate — identical allowlist code, spot-checked positive + negative.
-- ============================================================================
update public.users set role = 'accounting' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select lives_ok($$select * from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date)$$, 'accounting may read detail');
reset role;
update public.users set role = 'technician' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select throws_ok($$select * from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'technician denied on detail');
reset role;

-- Unbound caller — a jwt sub with NO public.users row → current_user_role() is
-- NULL → must be DENIED (the is-null gate hardening), not silently see empty.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0358-0358-0358-000000000000"}';
select throws_ok($$select * from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'unbound caller (null role) denied on summary');
select throws_ok($$select * from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date)$$, '42501', null, 'unbound caller (null role) denied on detail');
reset role;

-- ============================================================================
-- E. Cross-project reach — accounting (full set) sees BOTH projects' workers.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-00000000000a"}';
-- Scope to the SEEDED workers/projects — the pgTAP txn sees LIVE muster rows too,
-- so a global count would be polluted (doctrine: never assert a global table count).
select is((select count(*)::int from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)
             where worker_id in ('e1000000-0358-0358-0358-000000000001','e2000000-0358-0358-0358-000000000002')),
  2, 'accounting summary spans both seeded projects (worker1 A + worker2 B)');
select is((select count(distinct project_id)::int from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date)
             where project_id in ('a1000000-0358-0358-0358-000000000001','a2000000-0358-0358-0358-000000000002')),
  2, 'accounting detail spans both seeded projects');
reset role;

-- Spec 397 U1 — procurement joins the CROSS-PROJECT tier, not just the outer gate.
-- This is the assertion that matters: widening only the outer allowlist would drop
-- procurement into the `can_see_project` arm, which is FALSE for that role, so the
-- report would open and render NOTHING — a silent empty, not a 42501.
update public.users set role = 'procurement' where id = '70000000-0358-0358-0358-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-0000000000fe"}';
select is((select count(*)::int from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)
             where worker_id in ('e1000000-0358-0358-0358-000000000001','e2000000-0358-0358-0358-000000000002')),
  2, 'procurement summary spans both seeded projects (cross-project tier, no membership)');
select is((select count(distinct project_id)::int from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date)
             where project_id in ('a1000000-0358-0358-0358-000000000001','a2000000-0358-0358-0358-000000000002')),
  2, 'procurement detail spans both seeded projects');
reset role;

-- ============================================================================
-- F. PM scope — the A-only PM sees ONLY project A (worker2/B never leaks).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-00000000000b"}';
select is((select count(*)::int from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)),
  1, 'PM summary = only their project (1 worker)');
select is((select worker_id from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date)),
  'e1000000-0358-0358-0358-000000000001'::uuid, 'PM sees worker1 (project A), not worker2');
select is((select count(distinct project_id)::int from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date)),
  1, 'PM detail = only project A');
reset role;

-- ============================================================================
-- G. Signal counts (accounting, worker1) — every column, seeded-property asserts.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-00000000000a"}';
select is((select days_present from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  3, 'worker1 days_present = 3 distinct regular dates');
select is((select ot_hours_total from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  2.0::numeric, 'worker1 ot_hours_total = 2.0');
select is((select manual_in_count from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  3, 'worker1 manual_in_count = 3 (2 regular + 1 ot)');
select is((select qr_in_count from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  1, 'worker1 qr_in_count = 1 (the 07-23 QR)');
select is((select auto_out_count from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  1, 'worker1 auto_out_count = 1 (07-22 close-day auto-out)');
select is((select open_out_count from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  1, 'worker1 open_out_count = 1 (07-23 never checked out)');
select is((select project_count from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  1, 'worker1 project_count = 1');
select is((select unclosed_day_count from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  3, 'worker1 unclosed_day_count = 3 (no closures seeded yet)');
reset role;

-- Seed a closure for (project A, 07-24) → unclosed drops to 2, that day closes.
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0358-0358-0358-000000000001', '2026-07-24', now(), '70000000-0358-0358-0358-000000000009');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0358-0358-0358-00000000000a"}';
select is((select unclosed_day_count from public.audit_attendance_summary('2026-07-01'::date,'2026-07-31'::date, 'a1000000-0358-0358-0358-000000000001'::uuid) where worker_id='e1000000-0358-0358-0358-000000000001'),
  2, 'worker1 unclosed_day_count = 2 after (A,07-24) closed');

-- ============================================================================
-- H. Detail row fields — scanned_by resolves, lead resolves, day_closed reflects.
-- ============================================================================
select is((select scanned_by_name from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date, null, 'e1000000-0358-0358-0358-000000000001'::uuid) where work_date='2026-07-24' and session='regular'),
  'ผู้ดูแลระบบ', 'detail scanned_by_name resolves the scanner''s users.full_name');
select is((select team_lead_name from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date, null, 'e1000000-0358-0358-0358-000000000001'::uuid) where work_date='2026-07-24' and session='regular'),
  'หัวหน้า', 'detail team_lead_name resolves the team''s lead worker');
select is((select day_closed from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date, null, 'e1000000-0358-0358-0358-000000000001'::uuid) where work_date='2026-07-24' and session='regular'),
  true, 'detail day_closed = true for the closed (A,07-24) day');
select is((select day_closed from public.audit_attendance_detail('2026-07-01'::date,'2026-07-31'::date, null, 'e1000000-0358-0358-0358-000000000001'::uuid) where work_date='2026-07-23' and session='regular'),
  false, 'detail day_closed = false for the still-open 07-23 day');
reset role;

select * from finish();
rollback;
