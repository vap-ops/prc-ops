begin;
select plan(10);

-- ============================================================================
-- Spec 181 U3 — generate_purchase_requests_from_plan: an APPROVED plan's lines
-- become born-`approved` purchase_requests, linked to the plan line (idempotent).
-- Whole-project lines (no WP) are rejected; a non-approved plan is rejected.
-- The accuracy measure EXCLUDES the plan-generated PRs (they are planned, not
-- reactive). Procurement can generate in the PM's stead.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1111111-1111-1111-1111-111111111191', 'proc@g191.local',  '{}'::jsonb),
  ('c2222222-2222-2222-2222-222222222191', 'pm@g191.local',    '{}'::jsonb),
  ('c9999999-9999-9999-9999-999999999191', 'super@g191.local', '{}'::jsonb);
update public.users set role='procurement'     where id='c1111111-1111-1111-1111-111111111191';
update public.users set role='project_manager' where id='c2222222-2222-2222-2222-222222222191';
update public.users set role='super_admin'     where id='c9999999-9999-9999-9999-999999999191';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000191', 'G191', 'แผน gen 191'),
  ('ab000000-0000-0000-0000-000000000191', 'G191B', 'โครงการ draft 191');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000191', 'aa000000-0000-0000-0000-000000000191', 'WP191', 'งาน 191');
insert into public.catalog_items (id, category, base_item, spec_attrs, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000191', 'electrical', 'สายไฟ', null, 'ม้วน', true),
  ('ef000000-0000-0000-0000-000000000191', 'electrical', 'ท่อ', '2 นิ้ว', 'เส้น', true);
-- PM is a member of the gen project (for the accuracy read); procurement is not.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000191', 'c2222222-2222-2222-2222-222222222191',
   'c9999999-9999-9999-9999-999999999191');

-- An APPROVED plan + lines: two WP-bound, one whole-project (null WP).
insert into public.supply_plans (id, project_id, status, approved_by, approved_at) values
  ('ff000000-0000-0000-0000-000000000191', 'aa000000-0000-0000-0000-000000000191',
   'approved', 'c9999999-9999-9999-9999-999999999191', now());
insert into public.supply_plan_lines (id, supply_plan_id, catalog_item_id, work_package_id, qty) values
  ('11000000-0000-0000-0000-000000000191', 'ff000000-0000-0000-0000-000000000191',
   'ee000000-0000-0000-0000-000000000191', 'cc000000-0000-0000-0000-000000000191', 10),
  ('12000000-0000-0000-0000-000000000191', 'ff000000-0000-0000-0000-000000000191',
   'ef000000-0000-0000-0000-000000000191', 'cc000000-0000-0000-0000-000000000191', 5),
  ('13000000-0000-0000-0000-000000000191', 'ff000000-0000-0000-0000-000000000191',
   'ee000000-0000-0000-0000-000000000191', null, 3);
-- A DRAFT plan on the other project (for the not-approved test).
insert into public.supply_plans (id, project_id, status) values
  ('fa000000-0000-0000-0000-000000000191', 'ab000000-0000-0000-0000-000000000191', 'draft');
-- A reactive PR on WP191 (reason unplanned_miss, NOT plan-linked) — the accuracy
-- measure must still count this one.
insert into public.purchase_requests
  (work_package_id, item_description, quantity, unit, reason_code, requested_by, source) values
  ('cc000000-0000-0000-0000-000000000191', 'ของขาด reactive', 1, 'ชิ้น',
   'unplanned_miss', 'c2222222-2222-2222-2222-222222222191', 'app');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select is(has_function_privilege('anon',
  'public.generate_purchase_requests_from_plan(uuid, uuid[])', 'EXECUTE'),
  false, 'anon cannot execute generate_purchase_requests_from_plan');

set local role authenticated;

-- A. procurement (cross-project, PM stead) generates from the two WP-bound lines.
set local "request.jwt.claims" = '{"sub": "c1111111-1111-1111-1111-111111111191"}';
select is(
  (select public.generate_purchase_requests_from_plan('ff000000-0000-0000-0000-000000000191',
     array['11000000-0000-0000-0000-000000000191',
           '12000000-0000-0000-0000-000000000191']::uuid[])),
  2, 'procurement generates 2 PRs from the approved plan');
select is(
  (select count(*)::int from public.purchase_requests
     where supply_plan_line_id in ('11000000-0000-0000-0000-000000000191',
                                   '12000000-0000-0000-0000-000000000191')),
  2, 'two plan-linked PRs exist');
select is(
  (select status::text from public.purchase_requests
     where supply_plan_line_id='11000000-0000-0000-0000-000000000191'),
  'approved', 'a generated PR is born approved (inherits the plan approval)');
select is(
  (select approved_by from public.purchase_requests
     where supply_plan_line_id='11000000-0000-0000-0000-000000000191'),
  'c9999999-9999-9999-9999-999999999191'::uuid, 'approved_by = the plan approver (PD/super)');

-- B. Idempotent: re-generating the same lines creates nothing.
select is(
  (select public.generate_purchase_requests_from_plan('ff000000-0000-0000-0000-000000000191',
     array['11000000-0000-0000-0000-000000000191',
           '12000000-0000-0000-0000-000000000191']::uuid[])),
  0, 'idempotent — already-converted lines are skipped (returns 0)');

-- C. A whole-project line (no WP) cannot become a PR.
select throws_ok(
  $$ select public.generate_purchase_requests_from_plan('ff000000-0000-0000-0000-000000000191',
       array['13000000-0000-0000-0000-000000000191']::uuid[]) $$,
  '22023', null, 'a whole-project line (no WP) is rejected (22023)');

-- D. A non-approved plan is rejected.
select throws_ok(
  $$ select public.generate_purchase_requests_from_plan('fa000000-0000-0000-0000-000000000191',
       array['11000000-0000-0000-0000-000000000191']::uuid[]) $$,
  '22023', null, 'a non-approved (draft) plan is rejected (22023)');

-- E. Accuracy EXCLUDES the plan-generated PRs (planned, not reactive). The PM
--    member reads the measure: WP191 has 2 generated PRs (excluded) + 1 reactive.
set local "request.jwt.claims" = '{"sub": "c2222222-2222-2222-2222-222222222191"}';
select is(
  (select untagged from public.supply_plan_accuracy('aa000000-0000-0000-0000-000000000191')
     where work_package_id='cc000000-0000-0000-0000-000000000191'),
  0, 'plan-generated PRs are excluded from untagged (reason null but planned)');
select is(
  (select unplanned_miss from public.supply_plan_accuracy('aa000000-0000-0000-0000-000000000191')
     where work_package_id='cc000000-0000-0000-0000-000000000191'),
  1, 'the reactive unplanned_miss PR still counts');

reset role;

select * from finish();
rollback;
