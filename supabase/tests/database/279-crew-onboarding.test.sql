begin;
select plan(21);

-- ============================================================================
-- Spec 279 U1 / ADR 0079 — self-governance onboarding: crew entity + dedup key.
--
-- crews + crew_members (SSOT, one ACTIVE crew per human) + reuse workers.tax_id
-- as the firm-wide anti-ghost dedup key + create_crew / reassign_crew_lead
-- (gate is_back_office — the live 5-role onboarding set) + current_user_led_crew_ids()
-- + the current_user_worker_id() = crews.lead_worker_id AUTHORITY PREDICATE (a
-- crew-lead is a bound worker, NOT a role — claim_worker_invite forces
-- role=contractor) + RLS (writes only via the definer RPCs).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0279-0279-0279-700000000279', 'pm@s279-test.local',   '{}'::jsonb),
  ('73000000-0279-0279-0279-730000000279', 'pmgr@s279-test.local', '{}'::jsonb),
  ('7c000000-0279-0279-0279-7c0000000279', 'lead@s279-test.local', '{}'::jsonb),
  ('71000000-0279-0279-0279-710000000279', 'visitor@s279-test.local', '{}'::jsonb);

update public.users set role = 'project_manager'     where id = '70000000-0279-0279-0279-700000000279';
update public.users set role = 'procurement_manager' where id = '73000000-0279-0279-0279-730000000279';
update public.users set role = 'contractor'          where id = '7c000000-0279-0279-0279-7c0000000279';
-- 7100… stays visitor (negative control).

insert into public.projects (id, code, name) values
  ('72000000-0279-0279-0279-720000000201', 'TAP-279-1', 'Spec 279 fixture project 1'),
  ('72000000-0279-0279-0279-720000000202', 'TAP-279-2', 'Spec 279 fixture project 2');

-- Spec 330 U3c: create_crew now also checks can_see_project(p_project), so the
-- PM must actually be a member of the project it creates a crew in. (Project 2
-- needs no member row — it is only ever written to directly, as superuser.)
insert into public.project_members (project_id, user_id, added_by) values
  ('72000000-0279-0279-0279-720000000201', '70000000-0279-0279-0279-700000000279',
   '70000000-0279-0279-0279-700000000279');

-- The crew-lead is a CLAIMED worker (user_id set → its login is role=contractor).
-- The second worker is an unclaimed crew member (for the one-active-crew constraint).
insert into public.workers (id, name, pay_type, employment_type, user_id, day_rate, active, created_by, tax_id) values
  ('7d000000-0279-4000-8000-7d0000000201', 'หัวหน้าต้า', 'daily', 'permanent',
     '7c000000-0279-0279-0279-7c0000000279', 500.00, true,
     '70000000-0279-0279-0279-700000000279', '1100000000015'),
  ('7e000000-0279-4000-8000-7e0000000202', 'ลูกทีม A', 'daily', 'permanent',
     null, 400.00, true, '70000000-0279-0279-0279-700000000279', null);

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Schema — the crew entity + the dedup key exist, RLS on.
-- ============================================================================
select has_table('public'::name, 'crews'::name, 'crews table exists');
select has_table('public'::name, 'crew_members'::name, 'crew_members table exists');
select has_column('public'::name, 'crews'::name, 'lead_worker_id'::name, 'crews.lead_worker_id (named accountable head)');
select has_column('public'::name, 'crews'::name, 'kind'::name, 'crews.kind (dc|subcon discriminator)');
select has_column('public'::name, 'crews'::name, 'default_day_rate'::name, 'crews.default_day_rate (money)');
select has_column('public'::name, 'crew_members'::name, 'removed_at'::name, 'crew_members.removed_at (tombstone)');
select ok((select relrowsecurity from pg_class where oid = 'public.crews'::regclass), 'RLS enabled on crews');
select ok((select relrowsecurity from pg_class where oid = 'public.crew_members'::regclass), 'RLS enabled on crew_members');

-- ============================================================================
-- B. Constraints (owner-level) — the airtight invariants.
-- ============================================================================
-- tax_id firm-wide partial-unique = the anti-ghost / anti-double-count key.
select throws_ok(
  $$ insert into public.workers (name, pay_type, employment_type, day_rate, active, created_by, tax_id)
     values ('ผี', 'daily', 'permanent', 400, true,
             '70000000-0279-0279-0279-700000000279', '1100000000015') $$,
  '23505', null, 'a duplicate workers.tax_id is refused (firm-wide dedup key)');

-- crews UNIQUE(project_id, name) WHERE active.
insert into public.crews (project_id, name, kind, active, created_by)
  values ('72000000-0279-0279-0279-720000000202', 'ชุดซ้ำ', 'dc', true,
          '70000000-0279-0279-0279-700000000279');
select throws_ok(
  $$ insert into public.crews (project_id, name, kind, active, created_by)
     values ('72000000-0279-0279-0279-720000000202', 'ชุดซ้ำ', 'dc', true,
             '70000000-0279-0279-0279-700000000279') $$,
  '23505', null, 'a duplicate active crew name in one project is refused');

-- crew_members UNIQUE(worker_id) WHERE removed_at IS NULL — one active crew per human.
insert into public.crews (id, project_id, name, kind, active, created_by)
  values ('7c000000-0279-4000-8000-7c0000000c01', '72000000-0279-0279-0279-720000000202',
          'ชุด B', 'dc', true, '70000000-0279-0279-0279-700000000279');
insert into public.crew_members (crew_id, worker_id, added_by)
  values ('7c000000-0279-4000-8000-7c0000000c01', '7e000000-0279-4000-8000-7e0000000202',
          '70000000-0279-0279-0279-700000000279');
select throws_ok(
  $$ insert into public.crew_members (crew_id, worker_id, added_by)
     values ('7c000000-0279-4000-8000-7c0000000c01', '7e000000-0279-4000-8000-7e0000000202',
             '70000000-0279-0279-0279-700000000279') $$,
  '23505', null, 'a worker in a second active crew is refused (one active crew per human)');

-- ============================================================================
-- C. create_crew / reassign_crew_lead gate on is_back_office; RLS blocks direct writes.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0279-0279-0279-700000000279"}';
select ok(
  (select public.create_crew('72000000-0279-0279-0279-720000000201', 'ทีมช่างต้า',
     '7d000000-0279-4000-8000-7d0000000201', 'dc', 500)) is not null,
  'project_manager (is_back_office) create_crew makes a crew + binds the lead');

select ok(
  (select public.create_crew('72000000-0279-0279-0279-720000000201', 'ชุดลุงนัน',
     null, 'dc', null)) is not null,
  'project_manager creates a second, lead-less crew');

-- ⚖️ CONTRACT CHANGE (spec 330 U3c). This assert previously read
-- "procurement_manager (verified in is_back_office) create_crew is admitted".
-- is_back_office does admit procurement_manager — but can_see_project never
-- does, and procurement is not in PM_ROLES so /projects/:id/team is closed to
-- it. Being able to form the crews that feed the plan → mark-present →
-- log_labor_day → payroll chain, in any project, through a screen it cannot
-- open, was the hole U3c closes. The role gate is unchanged; the scope gate is
-- what refuses here. The only production caller of create_crew is the
-- PM_ROLES-gated team map, so nothing live depended on the old behaviour.
set local "request.jwt.claims" = '{"sub": "73000000-0279-0279-0279-730000000279"}';
select throws_ok(
  $$ select public.create_crew('72000000-0279-0279-0279-720000000201', 'ชุดต้องห้าม',
       null, 'dc', null) $$,
  '42501', 'not a member of this project',
  'procurement_manager is back-office but sees NO project — create_crew refuses it');

set local "request.jwt.claims" = '{"sub": "70000000-0279-0279-0279-700000000279"}';
select lives_ok(
  $$ select public.reassign_crew_lead(
       (select id from public.crews where name = 'ชุดลุงนัน'),
       '7e000000-0279-4000-8000-7e0000000202') $$,
  'project_manager reassign_crew_lead sets a new lead');

set local "request.jwt.claims" = '{"sub": "71000000-0279-0279-0279-710000000279"}';
select throws_ok(
  $$ select public.create_crew('72000000-0279-0279-0279-720000000201', 'ชุดโกง',
       null, 'dc', null) $$,
  '42501', null, 'a visitor is refused create_crew (the gate did not fall open)');
select throws_ok(
  $$ insert into public.crews (project_id, name, kind, active, created_by)
     values ('72000000-0279-0279-0279-720000000201', 'ตรงๆ', 'dc', true,
             '71000000-0279-0279-0279-710000000279') $$,
  '42501', null, 'a direct authenticated INSERT into crews is denied by RLS (definer-only writes)');

-- ============================================================================
-- D. Lead authority predicate — current_user_led_crew_ids() is null-safe.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "7c000000-0279-0279-0279-7c0000000279"}';
select ok(
  (select public.current_user_worker_id() = '7d000000-0279-4000-8000-7d0000000201'::uuid),
  'the lead login resolves to its bound worker (the authority-predicate anchor)');
select is(
  (select count(*)::int from public.current_user_led_crew_ids()),
  1, 'the crew-lead leads exactly their one crew via current_user_led_crew_ids()');

-- an unbound caller (visitor, no worker row) → EMPTY set, never an error (spec-131 null-safe).
set local "request.jwt.claims" = '{"sub": "71000000-0279-0279-0279-710000000279"}';
select is(
  (select count(*)::int from public.current_user_led_crew_ids()),
  0, 'an unbound caller leads no crews (coalesce/null-safe — no gate fall-open)');

-- ============================================================================
-- E. Audit trail.
-- ============================================================================
reset role;
select ok(
  (select count(*) from public.audit_log where target_table = 'crews' and action = 'crew_change') >= 2,
  'create_crew / reassign_crew_lead wrote crew_change audit rows');

select * from finish();
rollback;
