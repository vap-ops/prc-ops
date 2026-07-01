begin;
select plan(13);

-- ============================================================================
-- Spec 245 U1 — ordering-plan templates: supply_plans gains is_template/name,
-- project_id becomes nullable for template rows, and the 3 RPCs whose "null
-- project_id means unknown plan" check would otherwise misfire against a
-- template are fixed to distinguish "row not found" from "row is a template"
-- via FOUND, not a null check. Templates are readable by the existing
-- write-tier (procurement and super_admin/project_director already see any
-- project_id via can_see_project's existing permissive branches; only
-- project_manager needs a new narrow is_template branch).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111245', 'pm@sp245.local', '{}'::jsonb),
  ('a2222222-2222-2222-2222-222222222245', 'sa@sp245.local', '{}'::jsonb),
  ('a3333333-3333-3333-3333-333333333245', 'proc@sp245.local', '{}'::jsonb);
update public.users set role='project_manager' where id='a1111111-1111-1111-1111-111111111245';
update public.users set role='site_admin'      where id='a2222222-2222-2222-2222-222222222245';
update public.users set role='procurement'     where id='a3333333-3333-3333-3333-333333333245';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000245', 'SP245', 'โครงการ 245');
-- NOTE: the project_manager user above is NOT added to project_members and is NOT
-- the project_lead — deliberately a non-member, to prove template access doesn't
-- depend on any real-project membership, and that the real project's plan STILL
-- correctly denies a non-member PM (regression guard, assertion 12).
insert into public.catalog_items (id, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000245', 'วัสดุ 245', 'ชิ้น', true);
insert into public.supply_plans (id, project_id) values
  ('bb000000-0000-0000-0000-000000000245', 'aa000000-0000-0000-0000-000000000245');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A/B. Check constraint: exactly one of (is_template & null project) or
-- (not is_template & real project) may hold.
select throws_ok(
  $$ insert into public.supply_plans (is_template, project_id)
     values (true, 'aa000000-0000-0000-0000-000000000245') $$,
  '23514', null, 'is_template=true with a real project_id is rejected (23514)');
select throws_ok(
  $$ insert into public.supply_plans (is_template, project_id) values (false, null) $$,
  '23514', null, 'is_template=false with a null project_id is rejected (23514)');

-- C. A valid template row inserts fine (as the fixture writer, before RLS).
insert into public.supply_plans (id, is_template, project_id, name)
values ('cc000000-0000-0000-0000-000000000245', true, null, 'TFM ทดสอบ 245');
select ok(
  (select is_template from public.supply_plans where id = 'cc000000-0000-0000-0000-000000000245'),
  'a template row (is_template=true, project_id=null, named) inserts fine');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111245"}';

-- D. project_manager (non-member of anything) CAN read the template row.
select is(
  (select count(*)::int from public.supply_plans where id = 'cc000000-0000-0000-0000-000000000245'),
  1, 'a non-member project_manager can read the template row');

-- E. project_manager can add a line to the template (no membership needed).
select is(
  (select public.add_supply_plan_lines('cc000000-0000-0000-0000-000000000245', $json$[
     {"catalog_item_id":"ee000000-0000-0000-0000-000000000245","work_package_id":null,"qty":2}
   ]$json$::jsonb)),
  1, 'project_manager can bulk-add a line to the template');
select is(
  (select count(*)::int from public.supply_plan_lines
    where supply_plan_id = 'cc000000-0000-0000-0000-000000000245'),
  1, 'the line landed on the template');

-- F. project_manager can remove that line.
select lives_ok(
  $$ select public.remove_supply_plan_line(
       (select id from public.supply_plan_lines
         where supply_plan_id = 'cc000000-0000-0000-0000-000000000245')) $$,
  'project_manager can remove a line from the template');
select is(
  (select count(*)::int from public.supply_plan_lines
    where supply_plan_id = 'cc000000-0000-0000-0000-000000000245'),
  0, 'the line is gone after removal');

-- G. Regression: add_supply_plan_lines against a genuinely nonexistent plan id
-- still throws "unknown plan" (22023) — the FOUND-based fix must not swallow
-- the real not-found case.
select throws_ok(
  $$ select public.add_supply_plan_lines('00000000-0000-0000-0000-000000000000', $json$[
       {"catalog_item_id":"ee000000-0000-0000-0000-000000000245","work_package_id":null,"qty":1}
     ]$json$::jsonb) $$,
  '22023', null, 'add_supply_plan_lines against a nonexistent plan still throws unknown-plan (22023)');

-- H. Regression: remove_supply_plan_line against a nonexistent line id still
-- throws "unknown line" (22023).
select throws_ok(
  $$ select public.remove_supply_plan_line('00000000-0000-0000-0000-000000000000') $$,
  '22023', null, 'remove_supply_plan_line against a nonexistent line still throws unknown-line (22023)');

-- I. Regression: the SAME non-member project_manager is STILL denied on the
-- REAL (non-template) plan — proves the is_template skip did not accidentally
-- widen the ordinary per-project membership gate.
select throws_ok(
  $$ select public.add_supply_plan_lines('bb000000-0000-0000-0000-000000000245', $json$[
       {"catalog_item_id":"ee000000-0000-0000-0000-000000000245","work_package_id":null,"qty":1}
     ]$json$::jsonb) $$,
  '42501', null, 'a non-member project_manager is still denied on a REAL plan (42501)');

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222245"}';

-- J. site_admin CANNOT read the template row (the new branch is PM-only; site_admin
-- has no reason to see template management, matching page-level gating elsewhere).
select is(
  (select count(*)::int from public.supply_plans where id = 'cc000000-0000-0000-0000-000000000245'),
  0, 'site_admin cannot read the template row');

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3333333-3333-3333-3333-333333333245"}';

-- K. procurement (already cross-project via its own existing branch) can still
-- read the template row — a regression check, not new behavior.
select is(
  (select count(*)::int from public.supply_plans where id = 'cc000000-0000-0000-0000-000000000245'),
  1, 'procurement can read the template row (its existing cross-project branch)');

reset role;

select * from finish();
rollback;
