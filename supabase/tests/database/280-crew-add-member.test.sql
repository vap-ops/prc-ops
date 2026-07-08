begin;
select plan(22);

-- ============================================================================
-- Spec 279 U2 / ADR 0079 — crew-lead adds a member → staging → PM confirms.
--
-- crew_lead_add_member (own-crew predicate; mint PRC-YY-NNNN; Thai national-ID
-- checksum + age≥18 + firm-wide dedup; NO money params) → crew_registrations
-- staging → approve_crew_registration (STAFF_APPROVAL_ROLES; INLINES the worker
-- insert + crew_members + project-assign — never nests create_worker /
-- assign_worker_to_project, which re-resolve the caller under DEFINER and 42501
-- a procurement_manager approver; day_rate inherits crews.default_day_rate) →
-- confirm_worker_cost (super_admin sets level → stamps cost_confirmed_at; an
-- unconfirmed worker is NOT cost-loggable). reject_crew_registration.
-- Valid Thai IDs (mod-11): 1101700000001 · 3201200000008 · 5000000000010 · 3400000000001.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0280-0280-0280-700000000280', 'pmgr@s280-test.local', '{}'::jsonb),
  ('7c000000-0280-0280-0280-7c0000000280', 'lead@s280-test.local', '{}'::jsonb),
  ('75000000-0280-0280-0280-750000000280', 'super@s280-test.local', '{}'::jsonb),
  ('71000000-0280-0280-0280-710000000280', 'visitor@s280-test.local', '{}'::jsonb);
update public.users set role = 'procurement_manager' where id = '70000000-0280-0280-0280-700000000280';
update public.users set role = 'contractor'          where id = '7c000000-0280-0280-0280-7c0000000280';
update public.users set role = 'super_admin'          where id = '75000000-0280-0280-0280-750000000280';

insert into public.projects (id, code, name) values
  ('72000000-0280-0280-0280-720000000280', 'TAP-280', 'Spec 280 fixture project');

-- The lead: a claimed worker (tax_id set, for the dedup collision test) bound to a crew.
insert into public.workers (id, name, pay_type, employment_type, user_id, day_rate, active, created_by, tax_id) values
  ('7d000000-0280-4000-8000-7d0000000280', 'หัวหน้าลุงนัน', 'daily', 'permanent',
   '7c000000-0280-0280-0280-7c0000000280', 500.00, true,
   '70000000-0280-0280-0280-700000000280', '1101700000001');
insert into public.crews (id, project_id, name, lead_worker_id, kind, default_day_rate, active, created_by) values
  ('7c000000-0280-4000-8000-7c0000000c01', '72000000-0280-0280-0280-720000000280', 'ชุดลุงนัน',
   '7d000000-0280-4000-8000-7d0000000280', 'dc', 480.00, true, '70000000-0280-0280-0280-700000000280');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Schema.
-- ============================================================================
select has_table('public'::name, 'crew_registrations'::name, 'crew_registrations staging table exists');
select has_column('public'::name, 'crew_registrations'::name, 'national_id'::name, 'crew_registrations.national_id (dedup key)');
select has_column('public'::name, 'crew_registrations'::name, 'status'::name, 'crew_registrations.status');
select has_column('public'::name, 'workers'::name, 'cost_confirmed_at'::name, 'workers.cost_confirmed_at (cost-loggable gate)');
select ok((select relrowsecurity from pg_class where oid = 'public.crew_registrations'::regclass), 'RLS enabled on crew_registrations');

-- ============================================================================
-- B. crew_lead_add_member — own-crew gate; checksum + age + dedup; mints employee_id.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "7c000000-0280-0280-0280-7c0000000280"}';
select ok(
  (select public.crew_lead_add_member('7c000000-0280-4000-8000-7c0000000c01', 'สมชาย ใจดี',
     '0810000000', '3201200000008', '1990-05-01')) is not null,
  'the crew-lead adds a member to their own crew (returns the registration id)');

set local "request.jwt.claims" = '{"sub": "71000000-0280-0280-0280-710000000280"}';
select throws_ok(
  $$ select public.crew_lead_add_member('7c000000-0280-4000-8000-7c0000000c01', 'ต่างทีม',
       null, '5000000000010', '1990-01-01') $$,
  '42501', null, 'a non-lead (visitor) cannot add to a crew they do not lead');

set local "request.jwt.claims" = '{"sub": "7c000000-0280-0280-0280-7c0000000280"}';
select throws_ok(
  $$ select public.crew_lead_add_member('7c000000-0280-4000-8000-7c0000000c01', 'ผีซ้ำ',
       null, '1101700000001', '1990-01-01') $$,
  'P0001', null, 'a national-ID already on a worker is refused (firm-wide dedup)');
select throws_ok(
  $$ select public.crew_lead_add_member('7c000000-0280-4000-8000-7c0000000c01', 'เลขมั่ว',
       null, '1101700000000', '1990-01-01') $$,
  'P0001', null, 'an invalid Thai national-ID checksum is refused');
select throws_ok(
  $$ select public.crew_lead_add_member('7c000000-0280-4000-8000-7c0000000c01', 'เด็ก',
       null, '3400000000001', '2015-01-01') $$,
  'P0001', null, 'a worker under 18 is refused');

-- capture the pending registration (owner read — staging is service-role/owner only).
reset role;
select is(
  (select left(employee_id, 4) from public.crew_registrations where national_id = '3201200000008'),
  'PRC-', 'crew_lead_add_member minted a PRC-YY-NNNN employee_id');
select is(
  (select status::text from public.crew_registrations where national_id = '3201200000008'),
  'pending', 'the new registration is pending');
select set_config('t.reg1', (select id::text from public.crew_registrations where national_id = '3201200000008'), false);

-- a second member for the reject + negative-approve paths.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "7c000000-0280-0280-0280-7c0000000280"}';
select ok(
  (select public.crew_lead_add_member('7c000000-0280-4000-8000-7c0000000c01', 'สายบัว',
     null, '5000000000010', '1985-03-03')) is not null,
  'the lead adds a second member (for reject/negative paths)');
reset role;
select set_config('t.reg2', (select id::text from public.crew_registrations where national_id = '5000000000010'), false);

-- ============================================================================
-- C. approve_crew_registration — STAFF_APPROVAL_ROLES; inlined promote.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0280-0280-0280-710000000280"}';
select throws_ok(
  $$ select public.approve_crew_registration(current_setting('t.reg2')::uuid, 'daily', null, 'permanent') $$,
  '42501', null, 'a visitor cannot approve a crew registration');

set local "request.jwt.claims" = '{"sub": "70000000-0280-0280-0280-700000000280"}';
select ok(
  (select public.approve_crew_registration(current_setting('t.reg1')::uuid, 'daily', null, 'permanent')) is not null,
  'procurement_manager approves → returns the new worker id (inlined promote, no nested DEFINER)');

reset role;
select set_config('t.worker1', (select id::text from public.workers where tax_id = '3201200000008'), false);
select is(
  (select day_rate from public.workers where tax_id = '3201200000008'),
  480.00, 'the promoted worker inherits the crew default_day_rate (p_day_rate null)');
select is(
  (select user_id from public.workers where tax_id = '3201200000008'),
  null, 'the promoted worker has NO user_id (phoneless — bound only at self-claim)');
select is(
  (select count(*)::int from public.crew_members
    where worker_id = current_setting('t.worker1')::uuid and removed_at is null),
  1, 'approve inserted an active crew_members row');
select is(
  (select project_id from public.workers where id = current_setting('t.worker1')::uuid),
  '72000000-0280-0280-0280-720000000280'::uuid, 'approve inlined the project assignment');
select is(
  (select count(*)::int from public.worker_project_moves where worker_id = current_setting('t.worker1')::uuid),
  1, 'approve wrote a worker_project_moves row');
select ok(
  (select cost_confirmed_at is null and level is null from public.workers where id = current_setting('t.worker1')::uuid),
  'the approved worker is NOT yet cost-loggable (level + cost_confirmed_at null)');
select is(
  (select status::text from public.crew_registrations where id = current_setting('t.reg1')::uuid),
  'approved', 'the registration is marked approved');

-- ============================================================================
-- D. confirm_worker_cost — super_admin sets level → stamps cost_confirmed_at.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0280-0280-0280-700000000280"}';
select throws_ok(
  $$ select public.confirm_worker_cost(current_setting('t.worker1')::uuid, 'mid') $$,
  '42501', null, 'only super_admin may confirm cost (set level)');

set local "request.jwt.claims" = '{"sub": "75000000-0280-0280-0280-750000000280"}';
select lives_ok(
  $$ select public.confirm_worker_cost(current_setting('t.worker1')::uuid, 'mid') $$,
  'super_admin confirms cost (level=mid)');
reset role;
select ok(
  (select level = 'mid' and cost_confirmed_at is not null
     from public.workers where id = current_setting('t.worker1')::uuid),
  'after confirm the worker has level + cost_confirmed_at set (now cost-loggable)');

-- ============================================================================
-- E. reject_crew_registration.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0280-0280-0280-700000000280"}';
select lives_ok(
  $$ select public.reject_crew_registration(current_setting('t.reg2')::uuid, 'ข้อมูลไม่ครบ') $$,
  'procurement_manager rejects a pending registration');
reset role;
select is(
  (select status::text from public.crew_registrations where id = current_setting('t.reg2')::uuid),
  'rejected', 'the rejected registration is marked rejected');

select * from finish();
rollback;
