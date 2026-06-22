begin;
select plan(17);

-- ============================================================================
-- Spec 176 U3 — supply-plan lifecycle: submit / approve / reject.
--   Planner submits (draft|rejected → submitted); PD/super approve (→ approved,
--   frozen) or reject (→ rejected, editable again). Separation: PM ≠ approver.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111178', 'pm@spl.local',      '{}'::jsonb),
  ('13131313-1313-1313-1313-131313131178', 'pd@spl.local',      '{}'::jsonb),
  ('19191919-1919-1919-1919-191919191178', 'super@spl.local',   '{}'::jsonb),
  ('14141414-1414-1414-1414-141414141178', 'visitor@spl.local', '{}'::jsonb);
update public.users set role='project_manager'  where id='11111111-1111-1111-1111-111111111178';
update public.users set role='project_director' where id='13131313-1313-1313-1313-131313131178';
update public.users set role='super_admin'      where id='19191919-1919-1919-1919-191919191178';

insert into public.projects (id, code, name) values
  ('a1000000-0000-0000-0000-000000000178', 'SPL-P1', 'lifecycle 1'),
  ('a2000000-0000-0000-0000-000000000178', 'SPL-P2', 'lifecycle 2'),
  ('a3000000-0000-0000-0000-000000000178', 'SPL-P3', 'lifecycle 3');
insert into public.catalog_items (id, category, base_item, unit) values
  ('ee000000-0000-0000-0000-000000000178', 'electrical', 'วัสดุไลฟ์ไซเคิล', 'ชิ้น');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0000-0000-0000-000000000178', '11111111-1111-1111-1111-111111111178',
   '19191919-1919-1919-1919-191919191178');
insert into public.supply_plans (id, project_id, status) values
  ('f1000000-0000-0000-0000-000000000178', 'a1000000-0000-0000-0000-000000000178', 'draft'),
  ('f2000000-0000-0000-0000-000000000178', 'a2000000-0000-0000-0000-000000000178', 'submitted'),
  ('f3000000-0000-0000-0000-000000000178', 'a3000000-0000-0000-0000-000000000178', 'submitted');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select ok(to_regprocedure('public.submit_supply_plan(uuid)') is not null, 'submit_supply_plan exists');
select ok(to_regprocedure('public.approve_supply_plan(uuid)') is not null, 'approve_supply_plan exists');
select ok(to_regprocedure('public.reject_supply_plan(uuid)') is not null, 'reject_supply_plan exists');
select is(has_function_privilege('anon', 'public.submit_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute submit_supply_plan');
select is(has_function_privilege('anon', 'public.approve_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute approve_supply_plan');
select is(has_function_privilege('anon', 'public.reject_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute reject_supply_plan');

set local role authenticated;

-- B. PM submits the draft plan; PM cannot approve (separation of duties).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111178"}';
select lives_ok(
  $$ select public.submit_supply_plan('f1000000-0000-0000-0000-000000000178') $$,
  'PM submits the draft plan');
select is(
  (select status::text from public.supply_plans where id='f1000000-0000-0000-0000-000000000178'),
  'submitted', 'plan is now submitted');
select throws_ok(
  $$ select public.approve_supply_plan('f2000000-0000-0000-0000-000000000178') $$,
  '42501', null, 'PM cannot approve (42501)');

-- C. PD approves + rejects.
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-131313131178"}';
select lives_ok(
  $$ select public.approve_supply_plan('f2000000-0000-0000-0000-000000000178') $$,
  'PD approves a submitted plan');
select is(
  (select status::text from public.supply_plans where id='f2000000-0000-0000-0000-000000000178'),
  'approved', 'plan is now approved');
select lives_ok(
  $$ select public.reject_supply_plan('f3000000-0000-0000-0000-000000000178') $$,
  'PD rejects a submitted plan');
select is(
  (select status::text from public.supply_plans where id='f3000000-0000-0000-0000-000000000178'),
  'rejected', 'plan is now rejected');
select throws_ok(
  $$ select public.approve_supply_plan('f3000000-0000-0000-0000-000000000178') $$,
  '22023', null, 'cannot approve a non-submitted (rejected) plan → 22023');

-- D. Editability: rejected is editable again; approved is frozen (super = planner + see-all).
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-191919191178"}';
select lives_ok(
  $$ select public.add_supply_plan_line('f3000000-0000-0000-0000-000000000178',
       'ee000000-0000-0000-0000-000000000178', null, 5, null) $$,
  'a rejected plan accepts new lines again');
select throws_ok(
  $$ select public.add_supply_plan_line('f2000000-0000-0000-0000-000000000178',
       'ee000000-0000-0000-0000-000000000178', null, 5, null) $$,
  '22023', null, 'an approved plan is frozen → 22023');

-- E. Role gate on submit.
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-141414141178"}';
select throws_ok(
  $$ select public.submit_supply_plan('f1000000-0000-0000-0000-000000000178') $$,
  '42501', null, 'visitor cannot submit (42501)');

reset role;

select * from finish();
rollback;
