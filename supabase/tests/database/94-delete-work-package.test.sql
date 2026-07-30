begin;
select plan(35);

-- ============================================================================
-- Spec 157 / ADR 0059 — delete_work_package(p_work_package_id). Tier 1: hard
--   delete only when EMPTY. SECURITY DEFINER; PM/super/project_director,
--   membership-gated (can_see_wp). Refuses (P0001) if any child row exists
--   (photo_logs / labor_logs / approvals / purchase_requests / members / deps
--   / briefs — and, per the 377-U1-review FK audit, EVERY other live reference:
--   stock ledger, GL lines, plan/muster/supply rows, money config, provenance
--   PRs via requested_from_work_package_id, and child WPs). The deliberate
--   exceptions that still cascade: notification_outbox (system queue, no
--   reader) and a DRAFT wp_briefs row (published versions block instead —
--   377-wp-brief pins that lives_ok).
--   Writes an audit_log row. site_admin + visitor denied by role (42501); a
--   non-member PM denied by membership (42501). The labor_logs FK already exists.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110157', 'super@wpx-test.local',  '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220157', 'sa@wpx-test.local',     '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330157', 'pmlead@wpx-test.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550157', 'dir@wpx-test.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660157', 'pmoth@wpx-test.local',  '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880157', 'vis@wpx-test.local',    '{}'::jsonb);

update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110157';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220157';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330157';
update public.users set role='project_director'  where id='55555555-5555-5555-5555-555555550157';
update public.users set role='project_manager'  where id='66666666-6666-6666-6666-666666660157';
-- '8888…' stays visitor.

-- pm_lead (3333) is the lead → a member. site_admin (2222) is added as a member
-- (proves ROLE denial despite membership). pm_other (6666) is NOT on the project.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10157-0157-0157-0157-a1a1a1a10157', 'PRC-157-P1', 'โครงการ',
   '33333333-3333-3333-3333-333333330157');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a10157-0157-0157-0157-a1a1a1a10157',
   '22222222-2222-2222-2222-222222220157', '11111111-1111-1111-1111-111111110157');
insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, created_by)
  values ('aaaa0157-0157-0157-0157-aaaaaaaa0157', 'Own A', 'monthly', 'permanent', null, null, 500.00, true,
          '11111111-1111-1111-1111-111111110157');

-- Empty WPs (E1 pm-deletes, E2 super, E3 director, DENY survives the deny tests)
-- + WPs that each carry one child (photo / labor / purchase_request).
insert into public.work_packages (id, project_id, code, name) values
  ('c0010157-0157-0157-0157-c0c0c0c10157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-E1', 'ว่างหนึ่ง'),
  ('c0020157-0157-0157-0157-c0c0c0c20157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-E2', 'ว่างสอง'),
  ('c0030157-0157-0157-0157-c0c0c0c30157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-E3', 'ว่างสาม'),
  ('c0d00157-0157-0157-0157-c0d0c0d00157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-DN', 'กันลบ'),
  ('c00f0157-0157-0157-0157-c0c0c00f0157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-PH', 'มีรูป'),
  ('c00a0157-0157-0157-0157-c0c0c00a0157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-LA', 'มีแรงงาน'),
  ('c00b0157-0157-0157-0157-c0c0c00b0157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-PR', 'มีคำขอ');

insert into public.photo_logs (work_package_id, phase, storage_path, uploaded_by) values
  ('c00f0157-0157-0157-0157-c0c0c00f0157', 'before'::public.photo_phase, 'p/157.jpg',
   '11111111-1111-1111-1111-111111110157');
insert into public.labor_logs (work_package_id, worker_id, work_date, day_fraction,
    day_rate_snapshot, worker_name_snapshot, pay_type_snapshot, entered_by) values
  ('c00a0157-0157-0157-0157-c0c0c00a0157', 'aaaa0157-0157-0157-0157-aaaaaaaa0157',
   date '2026-06-15', 'full', 500.00, 'Own A', 'monthly', '11111111-1111-1111-1111-111111110157');
insert into public.purchase_requests
  (work_package_id, item_description, quantity, unit, requested_by, status) values
  ('c00b0157-0157-0157-0157-c0c0c00b0157', 'ปูน', 1, 'ถุง',
   '11111111-1111-1111-1111-111111110157', 'requested');

-- 377-U1-review FK-audit fixtures — one WP per newly-guarded reference class.
insert into public.work_packages (id, project_id, code, name) values
  ('c0100157-0157-0157-0157-c0c0c1000157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-SI', 'มีเบิกสต๊อก'),
  ('c0110157-0157-0157-0157-c0c0c1100157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-RF', 'มีที่มาคำขอ'),
  ('c0120157-0157-0157-0157-c0c0c1200157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-DP', 'มีแผนวัน'),
  ('c0130157-0157-0157-0157-c0c0c1300157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-EC', 'มีงบ'),
  ('c0150157-0157-0157-0157-c0c0c1500157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-CH', 'งานย่อย');
-- wp_hierarchy_guard: a parent must be a group (งาน) — insert WP-PA as one.
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('c0140157-0157-0157-0157-c0c0c1400157', 'a1a10157-0157-0157-0157-a1a1a1a10157', 'WP-PA', 'มีงานย่อย', true);
update public.work_packages
   set parent_id = 'c0140157-0157-0157-0157-c0c0c1400157'
 where id = 'c0150157-0157-0157-0157-c0c0c1500157';

insert into public.catalog_items (id, base_item, unit) values
  ('ca700157-0157-0157-0157-ca70ca700157', 'ปูนทดสอบ-94-guard', 'ถุง');
insert into public.stock_issues (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost) values
  ('a1a10157-0157-0157-0157-a1a1a1a10157', 'ca700157-0157-0157-0157-ca70ca700157',
   'c0100157-0157-0157-0157-c0c0c1000157', 1, 'ถุง', 10.00);

-- The store-first shape: provenance lives in requested_from_work_package_id,
-- work_package_id deliberately NULL (project_id explicit — normally derived
-- from the WP binding this row doesn't have).
insert into public.purchase_requests
  (project_id, requested_from_work_package_id, item_description, quantity, unit, requested_by, status) values
  ('a1a10157-0157-0157-0157-a1a1a1a10157', 'c0110157-0157-0157-0157-c0c0c1100157', 'ทรายทดสอบ', 1, 'คิว',
   '11111111-1111-1111-1111-111111110157', 'requested');

insert into public.daily_work_plans (id, project_id, plan_date, created_by) values
  ('da900157-0157-0157-0157-da90da900157', 'a1a10157-0157-0157-0157-a1a1a1a10157',
   date '2026-06-20', '11111111-1111-1111-1111-111111110157');
insert into public.daily_work_plan_items (plan_id, work_package_id) values
  ('da900157-0157-0157-0157-da90da900157', 'c0120157-0157-0157-0157-c0c0c1200157');

insert into public.wp_economics (work_package_id) values
  ('c0130157-0157-0157-0157-c0c0c1300157');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog + the pre-existing labor_logs FK that blocks WP delete.
select ok(to_regprocedure('public.delete_work_package(uuid)') is not null,
  'delete_work_package(uuid) exists');
select is((select prosecdef from pg_proc
            where oid='public.delete_work_package(uuid)'::regprocedure),
  true, 'delete_work_package is SECURITY DEFINER');
select ok(
  (select confdeltype from pg_constraint
     where conrelid='public.labor_logs'::regclass
       and confrelid='public.work_packages'::regclass and contype='f') in ('a', 'r'),
  'labor_logs.work_package_id FK already blocks a WP delete (NO ACTION/RESTRICT)');

set local role authenticated;

-- B.1 pm_lead (member) deletes an EMPTY WP → true, row gone, audit row written.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330157"}';
select is(
  (select public.delete_work_package('c0010157-0157-0157-0157-c0c0c0c10157')),
  true, 'project_manager member deletes an empty WP');
select is(
  (select count(*)::int from public.work_packages where id='c0010157-0157-0157-0157-c0c0c0c10157'),
  0, 'the empty WP row is gone');
select is(
  (select count(*)::int from public.audit_log
     where target_id='c0010157-0157-0157-0157-c0c0c0c10157' and payload->>'event'='wp_deleted'),
  1, 'an audit_log row recorded the delete');

-- B.2 a WP with a photo is refused (P0001) and survives.
select throws_ok(
  $$ select public.delete_work_package('c00f0157-0157-0157-0157-c0c0c00f0157') $$,
  'P0001', null, 'a WP with a photo cannot be deleted');
select is(
  (select count(*)::int from public.work_packages where id='c00f0157-0157-0157-0157-c0c0c00f0157'),
  1, 'the WP with a photo survives the refusal');

-- B.3 a WP with labor is refused (P0001).
select throws_ok(
  $$ select public.delete_work_package('c00a0157-0157-0157-0157-c0c0c00a0157') $$,
  'P0001', null, 'a WP with labor cannot be deleted');

-- B.4 a WP with a purchase request is refused (P0001).
select throws_ok(
  $$ select public.delete_work_package('c00b0157-0157-0157-0157-c0c0c00b0157') $$,
  'P0001', null, 'a WP with a purchase request cannot be deleted');

-- B.5 super_admin deletes an empty WP (see-all) → true.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110157"}';
select is(
  (select public.delete_work_package('c0020157-0157-0157-0157-c0c0c0c20157')),
  true, 'super_admin deletes an empty WP (see-all)');

-- B.6 project_director deletes an empty WP (see-all) → true.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550157"}';
select is(
  (select public.delete_work_package('c0030157-0157-0157-0157-c0c0c0c30157')),
  true, 'project_director deletes an empty WP (see-all)');

-- B.7 site_admin (a MEMBER) denied by role (42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220157"}';
select throws_ok(
  $$ select public.delete_work_package('c0d00157-0157-0157-0157-c0d0c0d00157') $$,
  '42501', null, 'a site_admin member is denied by role');

-- B.8 visitor denied (42501).
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880157"}';
select throws_ok(
  $$ select public.delete_work_package('c0d00157-0157-0157-0157-c0d0c0d00157') $$,
  '42501', null, 'visitor denied');

-- B.9 a project_manager NOT on the project denied by membership (42501).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660157"}';
select throws_ok(
  $$ select public.delete_work_package('c0d00157-0157-0157-0157-c0d0c0d00157') $$,
  '42501', null, 'a non-member project_manager denied by membership');

-- ── C. 377-U1-review FK audit: the guard covers EVERY live WP reference ──────
-- pm_lead (member) again for the behavioural arms.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330157"}';

-- C.1 a WP whose only history is a stock issue refuses with the GUARD's message
--     — not the stock_issues BEFORE DELETE trigger's, and no cascade fires.
select throws_ok(
  $$ select public.delete_work_package('c0100157-0157-0157-0157-c0c0c1000157') $$,
  'P0001',
  'delete_work_package: work package has history (photos/labor/approvals/requests/members/dependencies/brief/stock/plans/money) — cancel it instead',
  'a WP with a stock issue is refused by the guard, not the ledger trigger');
select is(
  (select count(*)::int from public.work_packages where id='c0100157-0157-0157-0157-c0c0c1000157'),
  1, 'the stock-issue WP survives');
select is(
  (select count(*)::int from public.stock_issues
    where work_package_id='c0100157-0157-0157-0157-c0c0c1000157'),
  1, 'the stock ledger row survives (no cascade)');

-- C.2 a WP referenced only as a PR's PROVENANCE (requested_from_work_package_id,
--     the store-first shape) is refused — never silently SET-NULL-orphaned.
select throws_ok(
  $$ select public.delete_work_package('c0110157-0157-0157-0157-c0c0c1100157') $$,
  'P0001',
  'delete_work_package: work package has history (photos/labor/approvals/requests/members/dependencies/brief/stock/plans/money) — cancel it instead',
  'a WP referenced by requested_from_work_package_id is refused');
select is(
  (select count(*)::int from public.purchase_requests
    where requested_from_work_package_id='c0110157-0157-0157-0157-c0c0c1100157'),
  1, 'the PR provenance link survives (no silent SET NULL)');

-- C.3 a WP on a daily work plan is refused (was a silent CASCADE).
select throws_ok(
  $$ select public.delete_work_package('c0120157-0157-0157-0157-c0c0c1200157') $$,
  'P0001',
  'delete_work_package: work package has history (photos/labor/approvals/requests/members/dependencies/brief/stock/plans/money) — cancel it instead',
  'a WP on a daily work plan is refused (no silent cascade)');

-- C.4 a WP with money config (wp_economics — set_wp_budget writes it) is refused.
select throws_ok(
  $$ select public.delete_work_package('c0130157-0157-0157-0157-c0c0c1300157') $$,
  'P0001',
  'delete_work_package: work package has history (photos/labor/approvals/requests/members/dependencies/brief/stock/plans/money) — cancel it instead',
  'a WP with wp_economics budget config is refused');

-- C.5 a parent WP refuses with the CHILDREN message (was a raw 23503).
select throws_ok(
  $$ select public.delete_work_package('c0140157-0157-0157-0157-c0c0c1400157') $$,
  'P0001',
  'delete_work_package: work package has child work packages — delete the children first',
  'a parent WP is refused with the children message, not a raw 23503');
select is(
  (select count(*)::int from public.work_packages
    where id in ('c0140157-0157-0157-0157-c0c0c1400157',
                 'c0150157-0157-0157-0157-c0c0c1500157')),
  2, 'parent and child both survive');

reset role;

-- C.6 wiring pins: every remaining guarded table appears in the LIVE body as a
--     guard read (behavioural coverage above carries the message contract; these
--     pin the arms whose fixtures would drag in whole subsystems).
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.journal_lines%', 'guard reads journal_lines');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.stock_returns%', 'guard reads stock_returns');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.equipment_usage_logs%', 'guard reads equipment_usage_logs');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.wp_labor_costs%', 'guard reads wp_labor_costs');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.wp_profit_bank%', 'guard reads wp_profit_bank');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.plan_baseline_items%', 'guard reads plan_baseline_items');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.variance_snapshots%', 'guard reads variance_snapshots');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.subcontract_wps%', 'guard reads subcontract_wps');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.muster_team_wps%', 'guard reads muster_team_wps');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.supply_plan_lines%', 'guard reads supply_plan_lines');
select ok(pg_get_functiondef('public.delete_work_package(uuid)'::regprocedure)
  ilike '%from public.site_issues%', 'guard reads site_issues');

select * from finish();
rollback;
