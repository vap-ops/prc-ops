begin;
select plan(9);

-- ============================================================================
-- Spec 189 follow-up — delete_supply_plan(plan): a planner may delete a supply
-- plan while it is still EDITABLE (draft or rejected). submitted/approved are
-- locked (an approved plan may already have generated born-approved PRs, spec
-- 181). Planner tier (PM/super/director) + procurement (PM's stead, spec 181);
-- membership skipped for procurement. Lines cascade.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1204204-1111-1111-1111-111111111204', 'super@sp204.local', '{}'::jsonb),
  ('a2204204-1111-1111-1111-111111111204', 'sa@sp204.local',    '{}'::jsonb),
  ('a3204204-1111-1111-1111-111111111204', 'pm@sp204.local',    '{}'::jsonb);
update public.users set role='super_admin'     where id='a1204204-1111-1111-1111-111111111204';
update public.users set role='site_admin'      where id='a2204204-1111-1111-1111-111111111204';
update public.users set role='project_manager' where id='a3204204-1111-1111-1111-111111111204';

insert into public.projects (id, code, name) values
  ('aa204204-0000-0000-0000-000000000204', 'SP204', 'delete-plan 204');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('cc204204-0000-0000-0000-000000000204', 'electrical', 'วัสดุ 204', 'ชิ้น', true);

-- Four plans in distinct states + a line on the draft.
insert into public.supply_plans (id, project_id, status) values
  ('d0204204-0000-0000-0000-000000000204', 'aa204204-0000-0000-0000-000000000204', 'draft'),
  ('d1204204-0000-0000-0000-000000000204', 'aa204204-0000-0000-0000-000000000204', 'rejected'),
  ('d2204204-0000-0000-0000-000000000204', 'aa204204-0000-0000-0000-000000000204', 'submitted'),
  ('d3204204-0000-0000-0000-000000000204', 'aa204204-0000-0000-0000-000000000204', 'approved');
insert into public.supply_plan_lines (id, supply_plan_id, catalog_item_id, qty) values
  ('e0204204-0000-0000-0000-000000000204', 'd0204204-0000-0000-0000-000000000204',
   'cc204204-0000-0000-0000-000000000204', 5);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select is(has_function_privilege('anon', 'public.delete_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute delete_supply_plan');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1204204-1111-1111-1111-111111111204"}';

-- A. super deletes the DRAFT plan; the plan and its line are gone (cascade).
select lives_ok(
  $$ select public.delete_supply_plan('d0204204-0000-0000-0000-000000000204') $$,
  'super deletes a draft plan');
select is((select count(*)::int from public.supply_plans where id='d0204204-0000-0000-0000-000000000204'),
  0, 'the draft plan is gone');
select is((select count(*)::int from public.supply_plan_lines where supply_plan_id='d0204204-0000-0000-0000-000000000204'),
  0, 'its lines cascaded');

-- B. a REJECTED plan is deletable (still editable).
select lives_ok(
  $$ select public.delete_supply_plan('d1204204-0000-0000-0000-000000000204') $$,
  'a rejected plan is deletable');

-- C. submitted + approved are LOCKED.
select throws_ok(
  $$ select public.delete_supply_plan('d2204204-0000-0000-0000-000000000204') $$,
  '22023', null, 'a submitted plan cannot be deleted (22023)');
select throws_ok(
  $$ select public.delete_supply_plan('d3204204-0000-0000-0000-000000000204') $$,
  '22023', null, 'an approved plan cannot be deleted (22023)');

-- D. site_admin (role gate) — re-add a draft to attempt on.
reset role;
insert into public.supply_plans (id, project_id, status) values
  ('d4204204-0000-0000-0000-000000000204', 'aa204204-0000-0000-0000-000000000204', 'draft');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2204204-1111-1111-1111-111111111204"}';
select throws_ok(
  $$ select public.delete_supply_plan('d4204204-0000-0000-0000-000000000204') $$,
  '42501', null, 'site_admin cannot delete a supply plan (role gate)');

-- E. a non-member PM is blocked (membership gate).
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3204204-1111-1111-1111-111111111204"}';
select throws_ok(
  $$ select public.delete_supply_plan('d4204204-0000-0000-0000-000000000204') $$,
  '42501', null, 'a non-member PM is blocked (membership gate)');

reset role;
select * from finish();
rollback;
