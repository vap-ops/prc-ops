begin;
select plan(9);

-- ============================================================================
-- Spec 176 U2 — remove_supply_plan_line(line) returns void.
--   SECURITY DEFINER, planner tier + member, draft-only. Unknown line / frozen
--   plan → 22023; wrong role / non-member → 42501.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111177', 'pmmember@spr.local',   '{}'::jsonb),
  ('12121212-1212-1212-1212-121212121177', 'pmoutsider@spr.local', '{}'::jsonb),
  ('14141414-1414-1414-1414-141414141177', 'visitor@spr.local',    '{}'::jsonb),
  ('19191919-1919-1919-1919-191919191177', 'super@spr.local',      '{}'::jsonb);
update public.users set role='project_manager' where id='11111111-1111-1111-1111-111111111177';
update public.users set role='project_manager' where id='12121212-1212-1212-1212-121212121177';
update public.users set role='super_admin'     where id='19191919-1919-1919-1919-191919191177';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000177', 'SPR-PROJ-1', 'ลบบรรทัด ทดสอบ 1'),
  ('bb000000-0000-0000-0000-000000000177', 'SPR-PROJ-2', 'ลบบรรทัด ทดสอบ 2');
insert into public.catalog_items (id, category, base_item, unit) values
  ('ee000000-0000-0000-0000-000000000177', 'electrical', 'วัสดุลบทดสอบ', 'ชิ้น');
-- pm_member on project 1 only.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000177', '11111111-1111-1111-1111-111111111177',
   '19191919-1919-1919-1919-191919191177');
-- Draft plan + line on project 1; submitted (frozen) plan + line on project 2.
insert into public.supply_plans (id, project_id, status) values
  ('f1000000-0000-0000-0000-000000000177', 'aa000000-0000-0000-0000-000000000177', 'draft'),
  ('f2000000-0000-0000-0000-000000000177', 'bb000000-0000-0000-0000-000000000177', 'submitted');
insert into public.supply_plan_lines (id, supply_plan_id, catalog_item_id, qty) values
  ('11aa0000-0000-0000-0000-000000000177', 'f1000000-0000-0000-0000-000000000177',
   'ee000000-0000-0000-0000-000000000177', 5),
  ('22bb0000-0000-0000-0000-000000000177', 'f2000000-0000-0000-0000-000000000177',
   'ee000000-0000-0000-0000-000000000177', 5);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select ok(to_regprocedure('public.remove_supply_plan_line(uuid)') is not null,
  'remove_supply_plan_line exists');
select is((select prosecdef from pg_proc
  where oid='public.remove_supply_plan_line(uuid)'::regprocedure),
  true, 'remove_supply_plan_line is SECURITY DEFINER');
select is(has_function_privilege('anon', 'public.remove_supply_plan_line(uuid)', 'EXECUTE'),
  false, 'anon cannot execute remove_supply_plan_line');

set local role authenticated;

-- B. PM member removes a draft line.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111177"}';
select lives_ok(
  $$ select public.remove_supply_plan_line('11aa0000-0000-0000-0000-000000000177') $$,
  'PM member removes a draft line');
select is(
  (select count(*)::int from public.supply_plan_lines
     where id='11aa0000-0000-0000-0000-000000000177'),
  0, 'the line is gone');
select throws_ok(
  $$ select public.remove_supply_plan_line('cccccccc-0000-0000-0000-000000000177') $$,
  '22023', null, 'remove unknown line → 22023');

-- C. Frozen plan (super sees all → reaches the draft-gate).
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-191919191177"}';
select throws_ok(
  $$ select public.remove_supply_plan_line('22bb0000-0000-0000-0000-000000000177') $$,
  '22023', null, 'cannot remove a line from a submitted (frozen) plan → 22023');

-- D. Role / membership gate (line in project 2 still exists).
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-121212121177"}';
select throws_ok(
  $$ select public.remove_supply_plan_line('22bb0000-0000-0000-0000-000000000177') $$,
  '42501', null, 'non-member PM remove denied (42501)');
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-141414141177"}';
select throws_ok(
  $$ select public.remove_supply_plan_line('22bb0000-0000-0000-0000-000000000177') $$,
  '42501', null, 'visitor remove denied (42501)');

reset role;

select * from finish();
rollback;
