begin;
select plan(54);

-- ============================================================================
-- Spec 263 U1c (ADR 0071) — the AUTHORITATIVE approve/reject path.
--
-- approve_technician_registration(p_id, p_project_id default null) — ATOMIC,
-- one transaction: gate (procurement_manager | project_director | super_admin) →
-- assert the target is pending → assert the floor (full_name present + a live
-- id_card attachment) → set status='approved' + reviewed_by/at + updated_at →
-- flip users.role to 'technician' INLINE (NOT a nested set_user_role — its gate
-- is super_admin-only and would reject a proc_mgr/PD caller) + a 'role_change'
-- audit row (users) → INSERT exactly one workers row (worker_type='own',
-- employee_id CARRIED, active=true, project_id=p_project_id, name=full_name) +
-- a 'worker_change' create audit row (house style, create_worker). Returns the
-- new worker id.
--
-- reject_technician_registration(p_id, p_reason) — same gate → assert pending →
-- set status='rejected' + reviewed_by/at + reject_reason + updated_at. NO role
-- change, NO workers row. Writes one 'role_change'-free audit row for the
-- rejection (action 'worker_change', kind 'registration_reject', house
-- action-enum only — no invented value).
--
-- Coverage: gate (3 approvers CAN, every other role incl. plain procurement /
-- site_admin / technician / project_manager / site_owner / visitor DENIED);
-- approve flips status + role + creates exactly ONE workers row (employee_id
-- carried, active, project_id set when passed) + role_change audit; the floor
-- (missing full_name / missing id_card → refused); double-approve refused (no
-- 2nd worker); atomic rollback on a duplicate employee_id unique violation
-- (status change rolls back too); reject writes rejected + reason + NO worker +
-- NO role change + audit present; reject of a non-pending row refused; anon-exec
-- grant posture (revoke public,anon / grant authenticated) for both new RPCs.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
-- Applicants stay 'visitor' (handle_new_user default). Approvers + denied roles
-- get set explicitly.
insert into auth.users (id, email, raw_user_meta_data) values
  ('b1111111-1111-1111-1111-11111111c263', 'appA@u1c.local',  '{}'::jsonb),  -- applicant A (approve, complete)
  ('b2222222-2222-2222-2222-22222222c263', 'appB@u1c.local',  '{}'::jsonb),  -- applicant B (reject)
  ('b3333333-3333-3333-3333-33333333c263', 'appC@u1c.local',  '{}'::jsonb),  -- applicant C (no id_card → floor)
  ('b4444444-4444-4444-4444-44444444c263', 'appD@u1c.local',  '{}'::jsonb),  -- applicant D (no full_name → floor)
  ('b5555555-5555-5555-5555-55555555c263', 'appE@u1c.local',  '{}'::jsonb),  -- applicant E (atomic rollback dup id)
  ('bcbcbcbc-cccc-cccc-cccc-ccccccccc263', 'appF@u1c.local', '{}'::jsonb), -- applicant F (project_id carry)
  ('baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaac263', 'pmgr@u1c.local',  '{}'::jsonb),  -- procurement_manager (approver)
  ('bddddddd-dddd-dddd-dddd-ddddddddc263', 'pd@u1c.local',    '{}'::jsonb),  -- project_director (approver)
  ('beeeeeee-eeee-eeee-eeee-eeeeeeeec263', 'super@u1c.local', '{}'::jsonb),  -- super_admin (approver)
  ('bfffffff-ffff-ffff-ffff-ffffffffc263', 'proc@u1c.local',  '{}'::jsonb),  -- plain procurement (DENIED)
  ('b6666666-6666-6666-6666-66666666c263', 'sa@u1c.local',    '{}'::jsonb),  -- site_admin (DENIED)
  ('b7777777-7777-7777-7777-77777777c263', 'tech@u1c.local',  '{}'::jsonb),  -- technician (DENIED)
  ('b8888888-8888-8888-8888-88888888c263', 'pm@u1c.local',    '{}'::jsonb),  -- project_manager (DENIED — not an approver)
  ('b9999999-9999-9999-9999-99999999c263', 'owner@u1c.local', '{}'::jsonb);  -- site_owner (DENIED — read-only)

update public.users set role='procurement_manager' where id='baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaac263';
update public.users set role='project_director'     where id='bddddddd-dddd-dddd-dddd-ddddddddc263';
update public.users set role='super_admin'          where id='beeeeeee-eeee-eeee-eeee-eeeeeeeec263';
update public.users set role='procurement'          where id='bfffffff-ffff-ffff-ffff-ffffffffc263';
update public.users set role='site_admin'           where id='b6666666-6666-6666-6666-66666666c263';
update public.users set role='technician'           where id='b7777777-7777-7777-7777-77777777c263';
update public.users set role='project_manager'      where id='b8888888-8888-8888-8888-88888888c263';
update public.users set role='site_owner'           where id='b9999999-9999-9999-9999-99999999c263';

-- --- Registrations (direct insert — pgTAP runs as owner; states set precisely).
-- A: complete + pending (full_name + id_card present).
insert into public.technician_registrations (id, user_id, employee_id, full_name, phone, status)
values ('c0000001-0000-0000-0000-0000000000a1', 'b1111111-1111-1111-1111-11111111c263',
        'PRC-90-0001', 'สมชาย ช่างเอก', '0811111111', 'pending');
insert into public.technician_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('c0000001-0000-0000-0000-0000000000a1', 'id_card',
        'technician/b1111111-1111-1111-1111-11111111c263/id_card/v1.jpg', 'b1111111-1111-1111-1111-11111111c263');

-- B: complete + pending (to be rejected).
insert into public.technician_registrations (id, user_id, employee_id, full_name, phone, status)
values ('c0000002-0000-0000-0000-0000000000b2', 'b2222222-2222-2222-2222-22222222c263',
        'PRC-90-0002', 'Aung Min', '0822222222', 'pending');
insert into public.technician_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('c0000002-0000-0000-0000-0000000000b2', 'id_card',
        'technician/b2222222-2222-2222-2222-22222222c263/id_card/v1.jpg', 'b2222222-2222-2222-2222-22222222c263');

-- C: pending, full_name present but NO id_card attachment (floor must refuse).
insert into public.technician_registrations (id, user_id, employee_id, full_name, phone, status)
values ('c0000003-0000-0000-0000-0000000000c3', 'b3333333-3333-3333-3333-33333333c263',
        'PRC-90-0003', 'No Idcard', '0833333333', 'pending');

-- D: pending, id_card present but NO full_name (floor must refuse).
insert into public.technician_registrations (id, user_id, employee_id, full_name, phone, status)
values ('c0000004-0000-0000-0000-0000000000d4', 'b4444444-4444-4444-4444-44444444c263',
        'PRC-90-0004', null, '0844444444', 'pending');
insert into public.technician_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('c0000004-0000-0000-0000-0000000000d4', 'id_card',
        'technician/b4444444-4444-4444-4444-44444444c263/id_card/v1.jpg', 'b4444444-4444-4444-4444-44444444c263');

-- E: pending + complete; used to prove atomic rollback — a pre-seeded workers
-- row already carries the same employee_id, so the approve INSERT trips the
-- partial-unique and the WHOLE approve (status flip + role flip) must roll back.
insert into public.technician_registrations (id, user_id, employee_id, full_name, phone, status)
values ('c0000005-0000-0000-0000-0000000000e5', 'b5555555-5555-5555-5555-55555555c263',
        'PRC-90-0005', 'Dup Emp', '0855555555', 'pending');
insert into public.technician_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('c0000005-0000-0000-0000-0000000000e5', 'id_card',
        'technician/b5555555-5555-5555-5555-55555555c263/id_card/v1.jpg', 'b5555555-5555-5555-5555-55555555c263');
-- Pre-seed a workers row holding PRC-90-0005 (blocks the approve INSERT).
insert into public.workers (name, worker_type, employee_id, active, created_by)
values ('Existing Holder', 'own', 'PRC-90-0005', true, 'beeeeeee-eeee-eeee-eeee-eeeeeeeec263');

-- F: pending + complete; used to prove project_id carry when p_project_id passed.
insert into public.projects (id, code, name, project_lead_id)
values ('cf000000-0000-0000-0000-0000000000f0', 'PRC-U1C-FIX', 'โครงการยูวันซี', null);
insert into public.technician_registrations (id, user_id, employee_id, full_name, phone, status)
values ('c0000006-0000-0000-0000-0000000000f6', 'bcbcbcbc-cccc-cccc-cccc-ccccccccc263',
        'PRC-90-0006', 'Proj Bound', '0866666666', 'pending');
insert into public.technician_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('c0000006-0000-0000-0000-0000000000f6', 'id_card',
        'technician/proj/id_card/v1.jpg', 'bcbcbcbc-cccc-cccc-cccc-ccccccccc263');

create temporary table _fix (k text primary key, v text) on commit drop;
grant select on _fix to authenticated;
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Catalog — both RPCs exist, SECURITY DEFINER, correct grant posture.
-- ============================================================================
select has_function('public', 'approve_technician_registration', array['uuid','uuid'],
  'approve_technician_registration(uuid, uuid) exists');
select has_function('public', 'reject_technician_registration', array['uuid','text'],
  'reject_technician_registration(uuid, text) exists');
select is((select prosecdef from pg_proc
            where oid = 'public.approve_technician_registration(uuid,uuid)'::regprocedure),
  true, 'approve is SECURITY DEFINER');
select is((select prosecdef from pg_proc
            where oid = 'public.reject_technician_registration(uuid,text)'::regprocedure),
  true, 'reject is SECURITY DEFINER');
-- anon-exec lockdown: no PUBLIC/anon EXECUTE on either.
select function_privs_are('public', 'approve_technician_registration', array['uuid','uuid'],
  'anon', array[]::text[], 'anon cannot execute approve');
select function_privs_are('public', 'approve_technician_registration', array['uuid','uuid'],
  'authenticated', array['EXECUTE'], 'authenticated can execute approve');
select function_privs_are('public', 'reject_technician_registration', array['uuid','text'],
  'anon', array[]::text[], 'anon cannot execute reject');
select function_privs_are('public', 'reject_technician_registration', array['uuid','text'],
  'authenticated', array['EXECUTE'], 'authenticated can execute reject');

-- ----------------------------------------------------------------------------
-- Role discipline: RPC CALLS run as `authenticated` with the caller's JWT (the
-- gate reads current_user_role()/auth.uid() from it). Every VERIFICATION select
-- runs in OWNER context (reset role) so the workers column-grant + RLS (which
-- only expose granted columns to specific roles) never block the assertion —
-- we are checking the RPC's WRITE effect, not the app read path.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- B. Gate — every non-approver role is DENIED (42501) on approve AND reject.
--    Plain procurement, site_admin, technician, project_manager, site_owner,
--    visitor, unbound.
-- ============================================================================
set local role authenticated;
-- plain procurement
set local "request.jwt.claims" = '{"sub": "bfffffff-ffff-ffff-ffff-ffffffffc263"}';
select throws_ok($$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'plain procurement DENIED approve');
select throws_ok($$ select public.reject_technician_registration('c0000001-0000-0000-0000-0000000000a1', 'no') $$,
  '42501', null, 'plain procurement DENIED reject');
-- site_admin (read-only, never approves)
set local "request.jwt.claims" = '{"sub": "b6666666-6666-6666-6666-66666666c263"}';
select throws_ok($$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'site_admin DENIED approve');
-- technician
set local "request.jwt.claims" = '{"sub": "b7777777-7777-7777-7777-77777777c263"}';
select throws_ok($$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'technician DENIED approve');
-- project_manager (deliberately NOT an approver — the spec gate is proc_mgr/PD/super only)
set local "request.jwt.claims" = '{"sub": "b8888888-8888-8888-8888-88888888c263"}';
select throws_ok($$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'plain project_manager DENIED approve (not in approver set)');
select throws_ok($$ select public.reject_technician_registration('c0000001-0000-0000-0000-0000000000a1', 'no') $$,
  '42501', null, 'plain project_manager DENIED reject');
-- site_owner (read-only)
set local "request.jwt.claims" = '{"sub": "b9999999-9999-9999-9999-99999999c263"}';
select throws_ok($$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'site_owner DENIED approve');
-- visitor (the applicant themselves cannot approve)
set local "request.jwt.claims" = '{"sub": "b1111111-1111-1111-1111-11111111c263"}';
select throws_ok($$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'visitor (applicant) DENIED approve');
-- unbound / null role fails closed
set local "request.jwt.claims" = '{}';
select throws_ok($$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'null-role caller DENIED approve (fail closed)');
select throws_ok($$ select public.reject_technician_registration('c0000001-0000-0000-0000-0000000000a1', 'no') $$,
  '42501', null, 'null-role caller DENIED reject (fail closed)');
reset role;

-- ============================================================================
-- C. Floor — approve refuses when the completeness floor is not met.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaac263"}';
-- C: full_name present but NO id_card → refuse.
select throws_ok($$ select public.approve_technician_registration('c0000003-0000-0000-0000-0000000000c3') $$,
  'P0001', null, 'approve refused when no id_card attachment (floor)');
-- D: id_card present but NO full_name → refuse.
select throws_ok($$ select public.approve_technician_registration('c0000004-0000-0000-0000-0000000000d4') $$,
  'P0001', null, 'approve refused when full_name missing (floor)');
-- Unknown / not-found target → refuse.
select throws_ok($$ select public.approve_technician_registration('c9999999-9999-9999-9999-999999999999') $$,
  null, null, 'approve of an unknown registration is refused');
select throws_ok($$ select public.reject_technician_registration('c9999999-9999-9999-9999-999999999999', 'x') $$,
  null, null, 'reject of an unknown registration is refused');
reset role;
-- Neither C nor D got a workers row from the refused approve (owner-context read).
select is((select count(*)::int from public.workers w
             where w.user_id in ('b3333333-3333-3333-3333-33333333c263','b4444444-4444-4444-4444-44444444c263')),
  0, 'floor-refused applicants have no workers row');
-- Neither C nor D changed status.
select is((select count(*)::int from public.technician_registrations
             where id in ('c0000003-0000-0000-0000-0000000000c3','c0000004-0000-0000-0000-0000000000d4')
               and status <> 'pending'),
  0, 'floor-refused registrations still pending');
-- Neither C nor D got role flipped.
select is((select count(*)::int from public.users
             where id in ('b3333333-3333-3333-3333-33333333c263','b4444444-4444-4444-4444-44444444c263')
               and role = 'technician'),
  0, 'floor-refused applicants keep visitor role');

-- ============================================================================
-- E. Happy approve (procurement_manager) — atomic role + worker + audit.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaac263"}';
select lives_ok(
  $$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  'procurement_manager approves applicant A');
reset role;
-- status flipped to approved + reviewer stamped.
select is((select status::text from public.technician_registrations where id='c0000001-0000-0000-0000-0000000000a1'),
  'approved', 'A registration status = approved');
select is((select reviewed_by::text from public.technician_registrations where id='c0000001-0000-0000-0000-0000000000a1'),
  'baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaac263', 'A reviewed_by = the approver');
select isnt((select reviewed_at from public.technician_registrations where id='c0000001-0000-0000-0000-0000000000a1'),
  null, 'A reviewed_at stamped');
-- role flipped to technician.
select is((select role::text from public.users where id='b1111111-1111-1111-1111-11111111c263'),
  'technician', 'A role flipped to technician');
-- exactly ONE workers row, worker_type=own, employee_id carried, active, project_id null (no p_project_id).
select is((select count(*)::int from public.workers where user_id='b1111111-1111-1111-1111-11111111c263'),
  1, 'exactly one workers row for A');
select is((select worker_type::text from public.workers where user_id='b1111111-1111-1111-1111-11111111c263'),
  'own', 'A worker_type = own');
select is((select employee_id from public.workers where user_id='b1111111-1111-1111-1111-11111111c263'),
  'PRC-90-0001', 'A workers.employee_id carried from registration (not re-minted)');
select is((select active from public.workers where user_id='b1111111-1111-1111-1111-11111111c263'),
  true, 'A worker active=true');
select is((select project_id from public.workers where user_id='b1111111-1111-1111-1111-11111111c263'),
  null, 'A worker project_id NULL when no p_project_id passed');
-- role_change audit row present (users target).
select is((select count(*)::int from public.audit_log
             where action='role_change' and target_table='users'
               and target_id='b1111111-1111-1111-1111-11111111c263'),
  1, 'exactly one role_change audit row for A (users)');
-- worker_change create audit row present (house style).
select is((select count(*)::int from public.audit_log
             where action='worker_change' and target_table='workers'
               and payload->>'source' = 'technician_registration'
               and payload->>'registration_id' = 'c0000001-0000-0000-0000-0000000000a1'),
  1, 'one worker_change create audit row for A (house style)');

-- ============================================================================
-- F. Double-approve — a second approve on the now-approved A is refused and
--    creates NO second worker row.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaac263"}';
select throws_ok($$ select public.approve_technician_registration('c0000001-0000-0000-0000-0000000000a1') $$,
  null, null, 'double-approve refused (status no longer pending)');
reset role;
select is((select count(*)::int from public.workers where user_id='b1111111-1111-1111-1111-11111111c263'),
  1, 'still exactly one workers row after refused double-approve');

-- ============================================================================
-- G. Atomicity — E's approve trips the workers.employee_id partial-unique
--    (a pre-seeded row already holds PRC-90-0005), so the WHOLE approve rolls
--    back: no status change, no role change, no partial worker.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "baaaaaaa-aaaa-aaaa-aaaa-aaaaaaaac263"}';
select throws_ok($$ select public.approve_technician_registration('c0000005-0000-0000-0000-0000000000e5') $$,
  null, null, 'approve raises on duplicate carried employee_id');
reset role;
select is((select status::text from public.technician_registrations where id='c0000005-0000-0000-0000-0000000000e5'),
  'pending', 'E registration still pending after failed approve (status rolled back)');
select is((select role::text from public.users where id='b5555555-5555-5555-5555-55555555c263'),
  'visitor', 'E role NOT flipped after failed approve (role rolled back)');
select is((select count(*)::int from public.workers where user_id='b5555555-5555-5555-5555-55555555c263'),
  0, 'E has no workers row after failed approve (no partial insert)');

-- ============================================================================
-- H. project_id carry — approve F (project_director) with p_project_id sets it.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "bddddddd-dddd-dddd-dddd-ddddddddc263"}';
select lives_ok(
  $$ select public.approve_technician_registration('c0000006-0000-0000-0000-0000000000f6', 'cf000000-0000-0000-0000-0000000000f0') $$,
  'project_director approves F with a project id');
reset role;
select is((select project_id::text from public.workers where user_id='bcbcbcbc-cccc-cccc-cccc-ccccccccc263'),
  'cf000000-0000-0000-0000-0000000000f0', 'F worker project_id = the passed p_project_id');

-- ============================================================================
-- I. Reject (super_admin) — status rejected + reason; NO worker, NO role change.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "beeeeeee-eeee-eeee-eeee-eeeeeeeec263"}';
select lives_ok(
  $$ select public.reject_technician_registration('c0000002-0000-0000-0000-0000000000b2', 'เอกสารไม่ครบ') $$,
  'super_admin rejects applicant B');
reset role;
select is((select status::text from public.technician_registrations where id='c0000002-0000-0000-0000-0000000000b2'),
  'rejected', 'B registration status = rejected');
select is((select reject_reason from public.technician_registrations where id='c0000002-0000-0000-0000-0000000000b2'),
  'เอกสารไม่ครบ', 'B reject_reason stored');
select is((select reviewed_by::text from public.technician_registrations where id='c0000002-0000-0000-0000-0000000000b2'),
  'beeeeeee-eeee-eeee-eeee-eeeeeeeec263', 'B reviewed_by = the rejecter');
-- No worker, no role change for B.
select is((select count(*)::int from public.workers where user_id='b2222222-2222-2222-2222-22222222c263'),
  0, 'rejected B has NO workers row');
select is((select role::text from public.users where id='b2222222-2222-2222-2222-22222222c263'),
  'visitor', 'rejected B keeps visitor role (no role change)');
select is((select count(*)::int from public.audit_log
             where action='role_change' and target_id='b2222222-2222-2222-2222-22222222c263'),
  0, 'no role_change audit row for a rejected applicant');

-- ============================================================================
-- J. Reject of a non-pending row is refused (B is now rejected).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "beeeeeee-eeee-eeee-eeee-eeeeeeeec263"}';
select throws_ok($$ select public.reject_technician_registration('c0000002-0000-0000-0000-0000000000b2', 'again') $$,
  null, null, 'reject of an already-rejected registration is refused');
-- And approve of the rejected B is refused too.
select throws_ok($$ select public.approve_technician_registration('c0000002-0000-0000-0000-0000000000b2') $$,
  null, null, 'approve of a rejected registration is refused');
reset role;

select * from finish();
rollback;
