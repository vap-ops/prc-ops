begin;
select plan(44);

-- ============================================================================
-- Spec 273 U1 / ADR 0076 — แผนพรุ่งนี้: the SA next-day work board.
--   A separate per-(project,date) daily-plan layer: daily_work_plans (one board
--   per project per day) → daily_work_plan_items (leaf-only งานย่อย, same project)
--   → daily_work_plan_crew (flexible worker set, ≤1 หัวหน้า/lead per item).
--   Writes via 5 SECURITY DEFINER RPCs gated on
--   {site_admin, project_manager, project_director, super_admin, site_owner}
--   AND can_see_project membership; reads via can_see_project RLS. Mutable,
--   non-money — NOT append-only. The master schedule/baselines are never touched.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110273', 'super@dwp.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330273', 'pm@dwp.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220273', 'sa@dwp.local',    '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440273', 'sa2@dwp.local',   '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660273', 'owner@dwp.local', '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880273', 'vis@dwp.local',   '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110273';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330273';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220273';
update public.users set role='site_admin'       where id='44444444-4444-4444-4444-444444440273';
update public.users set role='site_owner'       where id='66666666-6666-6666-6666-666666660273';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('a1a10273-0273-0273-0273-a1a1a1a10273', 'PRC-273-P1', 'โครงการหนึ่ง'),
  ('a2a20273-0273-0273-0273-a2a2a2a20273', 'PRC-273-P2', 'โครงการสอง');

-- Membership on P1 for pm/sa/owner (sa2 is deliberately NOT a member).
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a10273-0273-0273-0273-a1a1a1a10273', '33333333-3333-3333-3333-333333330273',
   '11111111-1111-1111-1111-111111110273'),
  ('a1a10273-0273-0273-0273-a1a1a1a10273', '22222222-2222-2222-2222-222222220273',
   '11111111-1111-1111-1111-111111110273'),
  ('a1a10273-0273-0273-0273-a1a1a1a10273', '66666666-6666-6666-6666-666666660273',
   '11111111-1111-1111-1111-111111110273');

-- Two workers (crew).
insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, created_by) values
  ('d1d10273-0273-0273-0273-d1d1d1d10273', 'ช่าง ก', 'daily', 'permanent', null, null, 0, true,
   '11111111-1111-1111-1111-111111110273'),
  ('d2d20273-0273-0273-0273-d2d2d2d20273', 'ช่าง ข', 'daily', 'permanent', null, null, 0, true,
   '11111111-1111-1111-1111-111111110273');

-- WPs: a งาน group (G1) with two งานย่อย leaves (L1, L1b) on P1; a leaf (L2) on P2.
insert into public.work_packages (id, project_id, code, name, is_group, parent_id, status) values
  ('91910273-0273-0273-0273-919191910273', 'a1a10273-0273-0273-0273-a1a1a1a10273',
   'WP-273-01', 'งานกลุ่ม', true, null, 'not_started'),
  ('b1b10273-0273-0273-0273-b1b1b1b10273', 'a1a10273-0273-0273-0273-a1a1a1a10273',
   'WP-273-01-01', 'ฉาบผนัง', false, '91910273-0273-0273-0273-919191910273', 'not_started'),
  ('b2b20273-0273-0273-0273-b2b2b2b20273', 'a1a10273-0273-0273-0273-a1a1a1a10273',
   'WP-273-01-02', 'ทาสี', false, '91910273-0273-0273-0273-919191910273', 'not_started'),
  ('c2c20273-0273-0273-0273-c2c2c2c20273', 'a2a20273-0273-0273-0273-a2a2a2a20273',
   'WP-273-99-01', 'งานอีกโครงการ', false, null, 'not_started');

-- ------------------------------------------------------------------ A. Catalog
select has_table('public', 'daily_work_plans',      'daily_work_plans exists');
select has_table('public', 'daily_work_plan_items', 'daily_work_plan_items exists');
select has_table('public', 'daily_work_plan_crew',  'daily_work_plan_crew exists');

select is((select relrowsecurity from pg_class where oid='public.daily_work_plans'::regclass),
  true, 'RLS enabled on daily_work_plans');
select is((select relrowsecurity from pg_class where oid='public.daily_work_plan_items'::regclass),
  true, 'RLS enabled on daily_work_plan_items');
select is((select relrowsecurity from pg_class where oid='public.daily_work_plan_crew'::regclass),
  true, 'RLS enabled on daily_work_plan_crew');

select col_is_unique('public', 'daily_work_plans', ARRAY['project_id','plan_date'],
  'one board per project per day');
select col_is_unique('public', 'daily_work_plan_items', ARRAY['plan_id','work_package_id'],
  'a leaf appears once per board');
select col_is_unique('public', 'daily_work_plan_crew', ARRAY['item_id','worker_id'],
  'a worker appears once per item');

select is((select prosecdef from pg_proc where oid='public.add_daily_plan_item(uuid,date,uuid)'::regprocedure),
  true, 'add_daily_plan_item is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid='public.remove_daily_plan_item(uuid)'::regprocedure),
  true, 'remove_daily_plan_item is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid='public.set_daily_plan_item_note(uuid,text)'::regprocedure),
  true, 'set_daily_plan_item_note is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid='public.reorder_daily_plan_items(uuid,uuid[])'::regprocedure),
  true, 'reorder_daily_plan_items is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid='public.set_daily_plan_item_crew(uuid,uuid[],uuid)'::regprocedure),
  true, 'set_daily_plan_item_crew is SECURITY DEFINER');

-- Let assertion selects run under `set role authenticated`.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ------------------------------------------------------- B. add + gate + guards
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220273"}';
select lives_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'b1b10273-0273-0273-0273-b1b1b1b10273') $$,
  'site_admin (member) adds a leaf to tomorrow''s board');

select is(
  (select count(*)::int from public.daily_work_plans
     where project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and plan_date='2026-07-07'),
  1, 'exactly one board row created for (project, date)');

-- Idempotent: re-adding the same leaf does not duplicate the item.
select lives_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'b1b10273-0273-0273-0273-b1b1b1b10273') $$,
  're-adding the same leaf is idempotent');
select is(
  (select count(*)::int from public.daily_work_plan_items i
     join public.daily_work_plans p on p.id=i.plan_id
    where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'),
  1, 'still one item after the duplicate add');

select lives_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'b2b20273-0273-0273-0273-b2b2b2b20273') $$,
  'a second distinct leaf is added');
select is(
  (select count(*)::int from public.daily_work_plan_items i
     join public.daily_work_plans p on p.id=i.plan_id
    where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'),
  2, 'two items on the board');

-- A งาน group cannot be added (leaf-only).
select throws_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       '91910273-0273-0273-0273-919191910273') $$,
  '22023', null, 'a group work package (งาน) cannot be planned');

-- A leaf from another project cannot be added to this project's board.
select throws_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'c2c20273-0273-0273-0273-c2c2c2c20273') $$,
  '22023', null, 'a leaf from another project is rejected');

-- Non-member site_admin: membership gate (can_see_project false).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440273"}';
select throws_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'b1b10273-0273-0273-0273-b1b1b1b10273') $$,
  '42501', null, 'a non-member site_admin is blocked by membership');

-- Visitor: role gate.
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880273"}';
select throws_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'b1b10273-0273-0273-0273-b1b1b1b10273') $$,
  '42501', null, 'a visitor cannot write the board');

-- PM (member), site_owner (member), super_admin (non-member, sees all) may write.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330273"}';
select lives_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'b1b10273-0273-0273-0273-b1b1b1b10273') $$,
  'project_manager (member) may write the board');
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660273"}';
select lives_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'b1b10273-0273-0273-0273-b1b1b1b10273') $$,
  'site_owner (member) may write the board');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110273"}';
select lives_ok(
  $$ select public.add_daily_plan_item('a1a10273-0273-0273-0273-a1a1a1a10273', '2026-07-07',
       'b1b10273-0273-0273-0273-b1b1b1b10273') $$,
  'super_admin (non-member, all-projects) may write the board');

-- --------------------------------------------------------------------- C. crew
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220273"}';
select lives_ok(
  $$ select public.set_daily_plan_item_crew(
       (select i.id from public.daily_work_plan_items i join public.daily_work_plans p on p.id=i.plan_id
         where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'
           and i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273'),
       ARRAY['d1d10273-0273-0273-0273-d1d1d1d10273','d2d20273-0273-0273-0273-d2d2d2d20273']::uuid[],
       'd1d10273-0273-0273-0273-d1d1d1d10273') $$,
  'crew of two set, ช่าง ก as หัวหน้า');
select is(
  (select count(*)::int from public.daily_work_plan_crew c
     join public.daily_work_plan_items i on i.id=c.item_id
    where i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273'),
  2, 'two crew rows on the item');
select is(
  (select count(*)::int from public.daily_work_plan_crew c
     join public.daily_work_plan_items i on i.id=c.item_id
    where i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273' and c.is_lead),
  1, 'exactly one หัวหน้า');
select is(
  (select c.worker_id from public.daily_work_plan_crew c
     join public.daily_work_plan_items i on i.id=c.item_id
    where i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273' and c.is_lead),
  'd1d10273-0273-0273-0273-d1d1d1d10273'::uuid, 'the lead is ช่าง ก');

-- Replacing the crew set is idempotent (delete-then-insert).
select lives_ok(
  $$ select public.set_daily_plan_item_crew(
       (select i.id from public.daily_work_plan_items i join public.daily_work_plans p on p.id=i.plan_id
         where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'
           and i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273'),
       ARRAY['d2d20273-0273-0273-0273-d2d2d2d20273']::uuid[],
       'd2d20273-0273-0273-0273-d2d2d2d20273') $$,
  'crew replaced with a single worker');
select is(
  (select count(*)::int from public.daily_work_plan_crew c
     join public.daily_work_plan_items i on i.id=c.item_id
    where i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273'),
  1, 'crew set was replaced, not appended');

-- ------------------------------------------------------------------- D. note
select lives_ok(
  $$ select public.set_daily_plan_item_note(
       (select i.id from public.daily_work_plan_items i join public.daily_work_plans p on p.id=i.plan_id
         where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'
           and i.work_package_id='b2b20273-0273-0273-0273-b2b2b2b20273'),
       'เริ่มเช้า') $$,
  'a note is set on an item');
select is(
  (select note from public.daily_work_plan_items i
    where i.work_package_id='b2b20273-0273-0273-0273-b2b2b2b20273'),
  'เริ่มเช้า', 'the note persisted');

-- ---------------------------------------------------------------- E. reorder
select lives_ok(
  $$ select public.reorder_daily_plan_items(
       (select p.id from public.daily_work_plans p
         where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'),
       ARRAY[
         (select i.id from public.daily_work_plan_items i join public.daily_work_plans p on p.id=i.plan_id
           where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'
             and i.work_package_id='b2b20273-0273-0273-0273-b2b2b2b20273'),
         (select i.id from public.daily_work_plan_items i join public.daily_work_plans p on p.id=i.plan_id
           where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'
             and i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273')
       ]::uuid[]) $$,
  'items reordered (ทาสี first)');
select is(
  (select i.sort_order from public.daily_work_plan_items i
    where i.work_package_id='b2b20273-0273-0273-0273-b2b2b2b20273'),
  0, 'ทาสี is now first (sort_order 0)');

-- ----------------------------------------------------- F. remove + crew cascade
select lives_ok(
  $$ select public.remove_daily_plan_item(
       (select i.id from public.daily_work_plan_items i join public.daily_work_plans p on p.id=i.plan_id
         where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'
           and i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273')) $$,
  'the ฉาบผนัง item (with crew) is removed');
select is(
  (select count(*)::int from public.daily_work_plan_items i
     join public.daily_work_plans p on p.id=i.plan_id
    where p.project_id='a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date='2026-07-07'),
  1, 'one item remains after removal');
select is(
  (select count(*)::int from public.daily_work_plan_crew c
     join public.daily_work_plan_items i on i.id=c.item_id
    where i.work_package_id='b1b10273-0273-0273-0273-b1b1b1b10273'),
  0, 'crew rows cascade-deleted with the item');

reset role;

-- --------------------------------------------------- G. one-lead-per-item guard
-- Direct insert as owner (bypassing the RPC) must still be refused a second lead.
select throws_ok(
  $$ insert into public.daily_work_plan_crew (item_id, worker_id, is_lead)
     select i.id, w, true
       from public.daily_work_plan_items i,
            unnest(ARRAY['d1d10273-0273-0273-0273-d1d1d1d10273',
                         'd2d20273-0273-0273-0273-d2d2d2d20273']::uuid[]) w
      where i.work_package_id='b2b20273-0273-0273-0273-b2b2b2b20273' $$,
  '23505', null, 'a second หัวหน้า on one item violates the partial unique index');

-- ----------------------------------------------------------------- H. read RLS
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220273"}';
select is(
  (select count(*)::int from public.daily_work_plans
     where project_id='a1a10273-0273-0273-0273-a1a1a1a10273'),
  1, 'a member site_admin can read the board');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440273"}';
select is(
  (select count(*)::int from public.daily_work_plans
     where project_id='a1a10273-0273-0273-0273-a1a1a1a10273'),
  0, 'a non-member site_admin cannot read the board');
reset role;

-- ----------------------------------------------- I. WP delete cascades to board
-- An empty leaf WP that sits on a board drops from it when hard-deleted — the
-- board is ephemeral, so the FK cascades rather than blocking the delete
-- (delete_work_package guards WP history but not the daily board).
delete from public.work_packages where id = 'b2b20273-0273-0273-0273-b2b2b2b20273';
select is(
  (select count(*)::int from public.daily_work_plan_items i
     join public.daily_work_plans p on p.id = i.plan_id
    where p.project_id = 'a1a10273-0273-0273-0273-a1a1a1a10273' and p.plan_date = '2026-07-07'),
  0, 'deleting a WP cascades its board item away');

select * from finish();
rollback;
