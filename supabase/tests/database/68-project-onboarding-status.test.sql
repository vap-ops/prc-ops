begin;
select plan(19);

-- ============================================================================
-- Spec 142 U3 — onboarding checklist data layer.
--   projects.onboarding_dismissed_at (timestamptz, nullable)
--   project_onboarding_status(p_project_id) returns a row of booleans
--     (dates_lead_set / budget_set / team_added / work_packages_added /
--      client_set / dismissed) — SECURITY DEFINER so it can read the
--      money-isolated budget column and return only a boolean. PM/super only.
--   dismiss_project_onboarding(p_project_id) returns boolean — stamps
--     onboarding_dismissed_at. PM/super only.
--
-- Setup as postgres (bypasses RLS + the budget column revoke): users, a client,
-- an EMPTY project (nothing set) and a FULL project (dates+lead+budget+client +
-- a member + a work package).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@onbs-test.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@onbs-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@onbs-test.local', '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-333333333333';
-- '4444…' stays 'visitor'.

insert into public.clients (id, name, created_by) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'ลูกค้า ทดสอบ', '11111111-1111-1111-1111-111111111111');

-- EMPTY project: identity only, nothing enriched.
insert into public.projects (id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'PRC-ONB-EMPTY', 'โครงการว่าง');

-- FULL project: every checklist item satisfied.
insert into public.projects
  (id, code, name, start_date, planned_completion_date, project_lead_id,
   budget_amount_thb, client_id)
values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'PRC-ONB-FULL', 'โครงการครบ',
   '2026-07-01', '2026-12-31', '33333333-3333-3333-3333-333333333333',
   1500000.00, 'cccccccc-cccc-cccc-cccc-cccccccccccc');

insert into public.project_members (project_id, user_id, added_by) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   '33333333-3333-3333-3333-333333333333',
   '33333333-3333-3333-3333-333333333333');

insert into public.work_packages (project_id, code, name) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'WP-001', 'งานแรก');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Catalog.
-- ============================================================================

select col_type_is(
  'public', 'projects', 'onboarding_dismissed_at',
  'timestamp with time zone', 'onboarding_dismissed_at is timestamptz');
select col_is_null(
  'public', 'projects', 'onboarding_dismissed_at',
  'onboarding_dismissed_at is NULLABLE');

select ok(
  to_regprocedure('public.project_onboarding_status(uuid)') is not null,
  'project_onboarding_status(uuid) exists');
select ok(
  to_regprocedure('public.dismiss_project_onboarding(uuid)') is not null,
  'dismiss_project_onboarding(uuid) exists');

-- ============================================================================
-- B. Status under an authenticated PM session.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';

-- B.1 EMPTY project — every flag false.
select is((select dates_lead_set from public.project_onboarding_status(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')), false, 'EMPTY: dates_lead_set false');
select is((select budget_set from public.project_onboarding_status(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')), false, 'EMPTY: budget_set false');
select is((select team_added from public.project_onboarding_status(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')), false, 'EMPTY: team_added false');
select is((select work_packages_added from public.project_onboarding_status(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')), false, 'EMPTY: work_packages_added false');
select is((select client_set from public.project_onboarding_status(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')), false, 'EMPTY: client_set false');
select is((select dismissed from public.project_onboarding_status(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')), false, 'EMPTY: dismissed false');

-- B.2 FULL project — the five enrichment flags true, dismissed still false.
select is((select dates_lead_set from public.project_onboarding_status(
  'ffffffff-ffff-ffff-ffff-ffffffffffff')), true, 'FULL: dates_lead_set true');
select is((select budget_set from public.project_onboarding_status(
  'ffffffff-ffff-ffff-ffff-ffffffffffff')), true, 'FULL: budget_set true');
select is((select team_added from public.project_onboarding_status(
  'ffffffff-ffff-ffff-ffff-ffffffffffff')), true, 'FULL: team_added true');
select is((select work_packages_added from public.project_onboarding_status(
  'ffffffff-ffff-ffff-ffff-ffffffffffff')), true, 'FULL: work_packages_added true');
select is((select client_set from public.project_onboarding_status(
  'ffffffff-ffff-ffff-ffff-ffffffffffff')), true, 'FULL: client_set true');

-- ============================================================================
-- C. Role gate + dismiss.
-- ============================================================================

-- C.1 visitor cannot read the status.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ select * from public.project_onboarding_status('ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '42501', null, 'visitor project_onboarding_status is denied (42501)');

-- C.2 visitor cannot dismiss.
select throws_ok(
  $$ select public.dismiss_project_onboarding('ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  '42501', null, 'visitor dismiss_project_onboarding is denied (42501)');

-- C.3 PM dismiss returns true, and the status then reports dismissed.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select ok(
  (select public.dismiss_project_onboarding('ffffffff-ffff-ffff-ffff-ffffffffffff')),
  'PM dismiss_project_onboarding returns true');
select is((select dismissed from public.project_onboarding_status(
  'ffffffff-ffff-ffff-ffff-ffffffffffff')), true, 'after dismiss: dismissed true');

reset role;

select * from finish();
rollback;
