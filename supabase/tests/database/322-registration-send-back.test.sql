begin;
select plan(19);

-- ============================================================================
-- Spec 322 — send_back_staff_registration: the non-terminal "return for edit"
-- action. Keeps status='pending', writes the reviewer note to reject_reason,
-- stamps reviewed_by/at, audits. Modeled on reject_staff_registration; same
-- approver gate; a blank note and a non-pending target both RAISE.
-- ============================================================================

-- --- exists + anon-exec posture ---------------------------------------------
select has_function('public', 'send_back_staff_registration', array['uuid', 'text'],
  'send_back_staff_registration(uuid, text) exists');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public' and routine_name='send_back_staff_registration'
      and grantee in ('public','anon')),
  0, 'no PUBLIC/anon EXECUTE on send_back_staff_registration');
select function_privs_are('public', 'send_back_staff_registration', array['uuid','text'],
  'authenticated', array['EXECUTE'], 'authenticated can execute send_back_staff_registration');

-- --- actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000322-0000-0000-0000-0000000000a1', 'appSB@t322.local',   '{}'::jsonb),  -- applicant (send-back target)
  ('00000322-0000-0000-0000-0000000000a2', 'appAppr@t322.local', '{}'::jsonb),  -- applicant (already approved)
  ('00000322-0000-0000-0000-0000000000a3', 'appRej@t322.local',  '{}'::jsonb),  -- applicant (already rejected)
  ('00000322-0000-0000-0000-0000000000b1', 'pmgr@t322.local',    '{}'::jsonb),  -- procurement_manager (approver)
  ('00000322-0000-0000-0000-0000000000c1', 'super@t322.local',   '{}'::jsonb),  -- super_admin (approver)
  ('00000322-0000-0000-0000-0000000000d1', 'pm@t322.local',      '{}'::jsonb);  -- plain project_manager (DENIED)
update public.users set role='procurement_manager' where id='00000322-0000-0000-0000-0000000000b1';
update public.users set role='super_admin'          where id='00000322-0000-0000-0000-0000000000c1';
update public.users set role='project_manager'      where id='00000322-0000-0000-0000-0000000000d1';

-- pending target for send-back
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000322-0000-0000-0000-0000000000a1', '00000322-0000-0000-0000-0000000000a1',
  'PRC-91-0322', 'ส่งกลับ ทดสอบ', '0800000322', 'pending');
-- already-approved reg (non-pending guard)
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000322-0000-0000-0000-0000000000a2', '00000322-0000-0000-0000-0000000000a2',
  'PRC-91-0323', 'อนุมัติ แล้ว', '0800000323', 'approved');
-- already-rejected reg (non-pending guard)
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000322-0000-0000-0000-0000000000a3', '00000322-0000-0000-0000-0000000000a3',
  'PRC-91-0324', 'ปฏิเสธ แล้ว', '0800000324', 'rejected');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Approver gate — proc_mgr/PD/super CAN; every other caller DENIED (42501).
-- ============================================================================
set local role authenticated;
-- plain project_manager DENIED
set local "request.jwt.claims" = '{"sub": "00000322-0000-0000-0000-0000000000d1"}';
select throws_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a1', 'แก้ไข') $$,
  '42501', null, 'plain project_manager DENIED send-back');
-- the applicant themselves (visitor) DENIED
set local "request.jwt.claims" = '{"sub": "00000322-0000-0000-0000-0000000000a1"}';
select throws_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a1', 'แก้ไข') $$,
  '42501', null, 'visitor applicant DENIED send-back');
-- null-role fails closed
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a1', 'แก้ไข') $$,
  '42501', null, 'null-role caller DENIED send-back (fail closed)');

-- ============================================================================
-- Note is REQUIRED — a blank / whitespace-only note raises (would else silently
-- un-return the row). Checked as a valid approver so the note guard is what raises.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "00000322-0000-0000-0000-0000000000b1"}';
select throws_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a1', '') $$,
  'P0001', null, 'blank note raises (note required)');
select throws_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a1', '   ') $$,
  'P0001', null, 'whitespace-only note raises (note required)');

-- ============================================================================
-- Happy path — proc_mgr sends the pending row back; status STAYS pending, note
-- lands on reject_reason, reviewed_by/at stamped, one audit row.
-- ============================================================================
select lives_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a1', E'- เอกสารไม่ครบ\n- รูปกลับด้าน') $$,
  'procurement_manager sends a pending registration back for edit');
reset role;
select is((select status::text from public.staff_registrations where id='e0000322-0000-0000-0000-0000000000a1'),
  'pending', 'send-back KEEPS status pending (non-terminal)');
select is((select reject_reason from public.staff_registrations where id='e0000322-0000-0000-0000-0000000000a1'),
  E'- เอกสารไม่ครบ\n- รูปกลับด้าน', 'reviewer note stored on reject_reason');
select is((select reviewed_by from public.staff_registrations where id='e0000322-0000-0000-0000-0000000000a1'),
  '00000322-0000-0000-0000-0000000000b1'::uuid, 'reviewed_by = the approver');
select ok((select reviewed_at is not null from public.staff_registrations where id='e0000322-0000-0000-0000-0000000000a1'),
  'reviewed_at stamped');
select is((select count(*)::int from public.audit_log
             where action='worker_change' and target_table='staff_registrations'
               and target_id='e0000322-0000-0000-0000-0000000000a1'
               and payload->>'kind'='registration_send_back'
               and payload->>'employee_id'='PRC-91-0322'),
  1, 'one registration_send_back audit row written');

-- ============================================================================
-- Re-send-back — a returned row is still pending, so it can be sent back again;
-- the note is overwritten.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000322-0000-0000-0000-0000000000c1"}';
select lives_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a1', 'แก้ไขเพิ่มเติม') $$,
  're-send-back allowed on a still-pending returned row');
reset role;
select is((select reject_reason from public.staff_registrations where id='e0000322-0000-0000-0000-0000000000a1'),
  'แก้ไขเพิ่มเติม', 're-send-back overwrites the note');

-- ============================================================================
-- Non-pending targets — approved / rejected / missing all raise (P0001).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000322-0000-0000-0000-0000000000b1"}';
select throws_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a2', 'แก้ไข') $$,
  'P0001', null, 'send-back refused on an APPROVED registration');
select throws_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-0000000000a3', 'แก้ไข') $$,
  'P0001', null, 'send-back refused on a REJECTED registration (terminal stays terminal)');
select throws_ok(
  $$ select public.send_back_staff_registration('e0000322-0000-0000-0000-000000000fff', 'แก้ไข') $$,
  'P0001', null, 'send-back refused when the registration does not exist');
reset role;

select * from finish();
rollback;
