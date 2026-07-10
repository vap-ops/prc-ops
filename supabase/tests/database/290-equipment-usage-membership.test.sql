begin;
select plan(11);

-- ============================================================================
-- SA audit 2026-07 F3 — scope the equipment usage RPCs to project membership.
--
-- check_out_equipment (item -> WP, accrues daily rental cost) and
-- check_in_equipment were ROLE-only gated: any admitted role could open / close a
-- usage span against a WP in a project they are NOT a member of. This mirrors the
-- F2 record_site_purchase hole (mig 075580 / #428) — a WP-bound cost written by a
-- non-member.
--
-- THE CRUX (why the gate is role-NARROWED, not a bare can_see_wp): the RPCs admit
-- procurement / procurement_manager, and public.can_see_project returns FALSE for
-- those roles (they hold no project_members rows) — a bare `if not can_see_wp then
-- raise` would lock central logistics out of ALL equipment. The gate therefore
-- fires only for the membership-scoped callers (site_admin / project_manager);
-- super_admin / project_director keep see-all (can_see_wp true), procurement /
-- procurement_manager keep their cross-project authority.
--
-- UUIDs HEX-ONLY (the recurring pgTAP lesson).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110290', 'super@f3.local',   '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550290', 'dir@f3.local',     '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220290', 'samember@f3.local','{}'::jsonb),
  ('2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0290', 'sanon@f3.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330290', 'pmnon@f3.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440290', 'proc@f3.local',    '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110290';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550290';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220290';
update public.users set role='site_admin'       where id='2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0290';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330290';
update public.users set role='procurement'      where id='44444444-4444-4444-4444-444444440290';

-- One project; the sa-member and pm are NOT auto-members — only sa-member is bound.
insert into public.projects (id, code, name) values
  ('a0a00290-0290-0290-0290-a0a0a0a00290', 'PRC-290-F3', 'โครงการ F3');
insert into public.work_packages (id, project_id, code, name, status) values
  ('b0b00290-0290-0290-0290-b0b0b0b00290', 'a0a00290-0290-0290-0290-a0a0a0a00290',
   'WP-1', 'งานเช่าอุปกรณ์', 'in_progress');

-- Membership: ONLY the sa-member is a member of the project (added by super).
insert into public.project_members (project_id, user_id, added_by) values
  ('a0a00290-0290-0290-0290-a0a0a0a00290', '22222222-2222-2222-2222-222222220290',
   '11111111-1111-1111-1111-111111110290');

insert into public.equipment_owners (id, name, created_by) values
  ('0a0a0290-0290-0290-0290-0a0a0a0a0290', 'บริษัทพี่น้อง',
   '11111111-1111-1111-1111-111111110290');
insert into public.equipment_categories (id, name, created_by) values
  ('caca0290-0290-0290-0290-cacacaca0290', 'เครื่องมือหนัก',
   '11111111-1111-1111-1111-111111110290');

-- Priced items (default status 'available' passes the F2 physical guard). itemR is
-- shared by the reject arms (post-fix the gate throws before the insert, so it is
-- never consumed); itemM/itemP/itemD are each consumed by one lives_ok checkout.
insert into public.equipment_items (id, category_id, owner_id, name, daily_rate, created_by) values
  ('e1e10290-0290-0290-0290-e1e1e1e10290', 'caca0290-0290-0290-0290-cacacaca0290',
   '0a0a0290-0290-0290-0290-0a0a0a0a0290', 'itemR REJECT', 500, '11111111-1111-1111-1111-111111110290'),
  ('e2e20290-0290-0290-0290-e2e2e2e20290', 'caca0290-0290-0290-0290-cacacaca0290',
   '0a0a0290-0290-0290-0290-0a0a0a0a0290', 'itemM MEMBER', 500, '11111111-1111-1111-1111-111111110290'),
  ('e3e30290-0290-0290-0290-e3e3e3e30290', 'caca0290-0290-0290-0290-cacacaca0290',
   '0a0a0290-0290-0290-0290-0a0a0a0a0290', 'itemP PROC',   500, '11111111-1111-1111-1111-111111110290'),
  ('e4e40290-0290-0290-0290-e4e4e4e40290', 'caca0290-0290-0290-0290-cacacaca0290',
   '0a0a0290-0290-0290-0290-0a0a0a0a0290', 'itemD DIR',    500, '11111111-1111-1111-1111-111111110290'),
  ('e5e50290-0290-0290-0290-e5e5e5e50290', 'caca0290-0290-0290-0290-cacacaca0290',
   '0a0a0290-0290-0290-0290-0a0a0a0a0290', 'itemU CHECKIN-M', 500, '11111111-1111-1111-1111-111111110290'),
  ('e6e60290-0290-0290-0290-e6e6e6e60290', 'caca0290-0290-0290-0290-cacacaca0290',
   '0a0a0290-0290-0290-0290-0a0a0a0a0290', 'itemU2 CHECKIN-P', 500, '11111111-1111-1111-1111-111111110290');

-- Seed two OPEN usage spans on WP-1 (privileged, pre-set-role) for the check_in arms.
insert into public.equipment_usage_logs
  (id, item_id, work_package_id, checked_out_on, daily_rate_snapshot, entered_by) values
  ('0d5d0290-0290-0290-0290-0d5d0d5d0290', 'e5e50290-0290-0290-0290-e5e5e5e50290',
   'b0b00290-0290-0290-0290-b0b0b0b00290', date '2026-06-01', 500,
   '11111111-1111-1111-1111-111111110290'),
  ('0d6d0290-0290-0290-0290-0d6d0d6d0290', 'e6e60290-0290-0290-0290-e6e6e6e60290',
   'b0b00290-0290-0290-0290-b0b0b0b00290', date '2026-06-01', 500,
   '11111111-1111-1111-1111-111111110290');

-- Structural — the signatures survived (re-source insurance).
select has_function('public', 'check_out_equipment', ARRAY['uuid','uuid','date'], 'check_out_equipment(uuid,uuid,date) exists');
select has_function('public', 'check_in_equipment', ARRAY['uuid','date'], 'check_in_equipment(uuid,date) exists');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- check_out_equipment — membership scope.
-- ============================================================================
-- A non-member site_admin is rejected (the F3 hole, now closed).
set local "request.jwt.claims" = '{"sub": "2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0290"}';
select throws_ok(
  $$ select public.check_out_equipment('e1e10290-0290-0290-0290-e1e1e1e10290',
       'b0b00290-0290-0290-0290-b0b0b0b00290', date '2026-06-01') $$,
  '42501', 'check_out_equipment: not a project member',
  'F3: a NON-member site_admin cannot check out equipment to the WP');

-- A non-member project_manager is scoped the same way.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330290"}';
select throws_ok(
  $$ select public.check_out_equipment('e1e10290-0290-0290-0290-e1e1e1e10290',
       'b0b00290-0290-0290-0290-b0b0b0b00290', date '2026-06-01') $$,
  '42501', 'check_out_equipment: not a project member',
  'F3: a NON-member project_manager cannot check out equipment to the WP');

-- A MEMBER site_admin succeeds.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220290"}';
select lives_ok(
  $$ select public.check_out_equipment('e2e20290-0290-0290-0290-e2e2e2e20290',
       'b0b00290-0290-0290-0290-b0b0b0b00290', date '2026-06-01') $$,
  'F3: a MEMBER site_admin may check out equipment');

-- THE CRUX: procurement (central logistics, can_see_project=false) is NOT gated —
-- a bare can_see_wp gate would have locked it out of all equipment.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440290"}';
select lives_ok(
  $$ select public.check_out_equipment('e3e30290-0290-0290-0290-e3e3e3e30290',
       'b0b00290-0290-0290-0290-b0b0b0b00290', date '2026-06-01') $$,
  'F3 crux: procurement (non-member central role) is NOT locked out of check-out');

-- project_director keeps see-all.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550290"}';
select lives_ok(
  $$ select public.check_out_equipment('e4e40290-0290-0290-0290-e4e4e4e40290',
       'b0b00290-0290-0290-0290-b0b0b0b00290', date '2026-06-01') $$,
  'F3: project_director keeps see-all check-out');

-- Placement guard: for a non-member caller, an UNKNOWN WP still returns the P0001
-- existence error, not 42501 — the gate sits AFTER the WP-existence check (#428 lesson).
set local "request.jwt.claims" = '{"sub": "2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0290"}';
select throws_ok(
  $$ select public.check_out_equipment('e1e10290-0290-0290-0290-e1e1e1e10290',
       'bfbf0290-0290-0290-0290-bfbfbfbf0290', date '2026-06-01') $$,
  'P0001', 'check_out_equipment: work package not found',
  'F3 placement: an unknown WP stays P0001 (existence check precedes the membership gate)');

-- ============================================================================
-- check_in_equipment — membership scope (WP carried by the loaded checkout row).
-- ============================================================================
-- A non-member site_admin cannot close a span on the WP.
set local "request.jwt.claims" = '{"sub": "2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b0290"}';
select throws_ok(
  $$ select public.check_in_equipment('0d5d0290-0290-0290-0290-0d5d0d5d0290', date '2026-06-10') $$,
  '42501', 'check_in_equipment: not a project member',
  'F3: a NON-member site_admin cannot check in a span on the WP');

-- A MEMBER site_admin closes it.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220290"}';
select lives_ok(
  $$ select public.check_in_equipment('0d5d0290-0290-0290-0290-0d5d0d5d0290', date '2026-06-10') $$,
  'F3: a MEMBER site_admin may check in the span');

-- THE CRUX (check-in side): procurement is not gated.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440290"}';
select lives_ok(
  $$ select public.check_in_equipment('0d6d0290-0290-0290-0290-0d6d0d6d0290', date '2026-06-10') $$,
  'F3 crux: procurement (non-member central role) is NOT locked out of check-in');

reset role;

select * from finish();
rollback;
