begin;
select plan(7);

-- ============================================================================
-- SA audit 2026-07 F2 — record_site_purchase membership scope.
--
-- record_site_purchase files a status='site_purchased' purchase_requests row
-- that carries an AMOUNT (a project EXPENSE, + Input VAT when vat_rate > 0). Its
-- siblings issue_stock / site_purchase_use_now gate on can_see_project; this RPC
-- carried only a role gate (ADR 0013 v1 role-level access), so ANY admitted role
-- could file an expense against a WP in a project they are NOT a member of.
--
-- Fix = a can_see_wp(p_work_package_id) gate placed AFTER the WP-existence check
-- (the RPC takes only the WP, so it scopes via can_see_wp not can_see_project; kept
-- after the existence check so an unknown WP stays P0001 — see B.2b). This file
-- proves: a NON-member site_admin (and PM) is denied
-- (42501) and writes no expense row, while a MEMBER site_admin — and super_admin
-- (unconditional can_see_project) — still succeed.
-- Mirrors 228-site-purchase-use-now (gate section) + 33-site-purchase (seed).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('15151515-1515-1515-1515-000000000289', 'samember@f2.local',    '{}'::jsonb),
  ('16161616-1616-1616-1616-000000000289', 'saoutsider@f2.local',  '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000289', 'pmoutsider@f2.local',  '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000289', 'super@f2.local',       '{}'::jsonb);
update public.users set role='site_admin',      full_name='ช่างสมาชิก'    where id='15151515-1515-1515-1515-000000000289';
update public.users set role='site_admin',      full_name='ช่างนอกโครงการ' where id='16161616-1616-1616-1616-000000000289';
update public.users set role='project_manager', full_name='พีเอ็มนอก'     where id='12121212-1212-1212-1212-000000000289';
update public.users set role='super_admin',     full_name='ซุปเปอร์'       where id='19191919-1919-1919-1919-000000000289';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000289', 'F2-PROJ', 'โครงการทดสอบ F2');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000000-0000-0000-0000-000000000289', 'aa000000-0000-0000-0000-000000000289',
   'WP-F2', 'งานทดสอบขอบเขต', 'in_progress');

-- Only the MEMBER site_admin is enrolled; the two outsiders are deliberately not
-- members and not the project lead (project_lead_id left null) → can_see_project
-- is false for them.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000289', '15151515-1515-1515-1515-000000000289',
   '19191919-1919-1919-1919-000000000289');

-- Assertions run while role=authenticated → grant the runner's _tap_buf collector
-- (+ its sequence) to authenticated, else the first wrapped insert 42501-aborts the
-- whole file (pgtap-tapbuf-grant-role-switch).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Structure — the anon lockdown my CREATE OR REPLACE must preserve.
-- ============================================================================
select is(has_function_privilege('anon',
  'public.record_site_purchase(uuid, text, numeric, text, purchase_request_reason_code, numeric, numeric)',
  'EXECUTE'),
  false, 'anon cannot execute record_site_purchase');

set local role authenticated;

-- ============================================================================
-- B. Membership scope (the fix).
-- ============================================================================
-- B.1 (guard) a MEMBER site_admin still records a site purchase.
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000289"}';
select lives_ok(
  $$ select public.record_site_purchase(
       'ee000000-0000-0000-0000-000000000289', 'F2-MEMBER-BUY', 1, 'ea', 'unplanned_miss') $$,
  'member site_admin records a site purchase');

-- B.2 (THE BUG) a NON-member site_admin is denied — was role-only, so this used
--     to SUCCEED and file a cross-project expense.
set local "request.jwt.claims" = '{"sub": "16161616-1616-1616-1616-000000000289"}';
select throws_ok(
  $$ select public.record_site_purchase(
       'ee000000-0000-0000-0000-000000000289', 'F2-OUTSIDER-BUY', 1, 'ea', 'unplanned_miss') $$,
  '42501', null, 'non-member site_admin is denied (42501)');

-- B.2b (placement) an UNKNOWN WP still fails P0001 'not found', NOT the membership
--      42501 — the gate sits AFTER the existence check, so the ONLY new behaviour is
--      the membership reject (guards against re-introducing the 33-site-purchase
--      collateral that a before-existence placement caused). Still the non-member SA.
select throws_ok(
  $$ select public.record_site_purchase(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeeffff', 'F2-UNKNOWN-WP', 1, 'ea', 'unplanned_miss') $$,
  'P0001', null, 'unknown WP still rejected P0001 (existence check precedes the membership gate)');

-- B.3 the gate scopes the PM tier too (mirrors the siblings): a non-member PM denied.
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000289"}';
select throws_ok(
  $$ select public.record_site_purchase(
       'ee000000-0000-0000-0000-000000000289', 'F2-PM-OUTSIDER-BUY', 1, 'ea', 'unplanned_miss') $$,
  '42501', null, 'non-member project_manager is denied (42501)');

-- B.4 (guard) super_admin bypasses membership (can_see_project is unconditional
--     for the privileged tier) — the gate must not over-block them.
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-000000000289"}';
select lives_ok(
  $$ select public.record_site_purchase(
       'ee000000-0000-0000-0000-000000000289', 'F2-SUPER-BUY', 1, 'ea', 'unplanned_miss') $$,
  'super_admin (non-member) still records — privileged bypass preserved');

reset role;

-- ============================================================================
-- C. The denied buy wrote NO expense row (the gate precedes the insert) — read
--    as the owner (purchase_requests is RLS-scoped under authenticated).
-- ============================================================================
select is(
  (select count(*)::int from public.purchase_requests
     where item_description = 'F2-OUTSIDER-BUY'),
  0, 'the denied non-member buy created no purchase_requests expense row');

select * from finish();
rollback;
