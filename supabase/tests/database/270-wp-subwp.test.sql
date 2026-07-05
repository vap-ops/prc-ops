begin;
select plan(34);

-- ============================================================================
-- Spec 270 U1 / ADR 0074 — two-level work packages (งาน groups + งานย่อย leaves).
--   work_packages.parent_id (self-FK) + is_group; depth exactly 2; is_group
--   immutable; parent must be a same-project group. Group (งาน) rows: status is
--   DERIVED (rollup trigger; manual writes rejected), priority immutable,
--   photos/money/members/deps bindings rejected via wp_reject_group_binding()
--   on 15 tables. Rollup: all-complete→complete · all-not_started/empty→
--   not_started · all-on_hold→on_hold · else in_progress.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110270', 'super@wps-test.local', '{}'::jsonb);
update public.users set role='super_admin' where id='11111111-1111-1111-1111-111111110270';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10270-0270-0270-0270-a1a1a1a10270', 'PRC-270-P1', 'โครงการหนึ่ง',
   '11111111-1111-1111-1111-111111110270'),
  ('a2a20270-0270-0270-0270-a2a2a2a20270', 'PRC-270-P2', 'โครงการสอง',
   '11111111-1111-1111-1111-111111110270');

-- ---------------------------------------------------------------------------
-- A. Schema catalog.
-- ---------------------------------------------------------------------------
select ok(exists(select 1 from information_schema.columns
  where table_schema='public' and table_name='work_packages' and column_name='is_group'),
  'work_packages.is_group exists');
select is((select is_nullable from information_schema.columns
  where table_schema='public' and table_name='work_packages' and column_name='is_group'),
  'NO', 'is_group is NOT NULL');
select is((select column_default from information_schema.columns
  where table_schema='public' and table_name='work_packages' and column_name='is_group'),
  'false', 'is_group defaults to false');
select ok(exists(select 1 from information_schema.columns
  where table_schema='public' and table_name='work_packages' and column_name='parent_id'),
  'work_packages.parent_id exists');
select ok(exists(select 1 from pg_constraint
  where conrelid='public.work_packages'::regclass and contype='f'
    and pg_get_constraintdef(oid) like '%(parent_id)%REFERENCES work_packages(id)%'),
  'parent_id is a self-FK to work_packages(id)');
select ok(exists(select 1 from pg_indexes
  where schemaname='public' and tablename='work_packages' and indexname='work_packages_parent_id_idx'),
  'partial index work_packages_parent_id_idx exists');
select ok(exists(select 1 from pg_trigger
  where tgrelid='public.work_packages'::regclass and tgname='work_packages_hierarchy_guard'),
  'hierarchy guard trigger exists on work_packages');

-- ---------------------------------------------------------------------------
-- B. Binding-guard coverage: wp_reject_group_binding() attached to all 15 tables.
-- ---------------------------------------------------------------------------
select is(
  (select count(distinct tgrelid)::int from pg_trigger
    where tgfoid = 'public.wp_reject_group_binding()'::regprocedure
      and tgrelid = any (array[
        'public.approvals','public.equipment_usage_logs','public.journal_lines',
        'public.labor_logs','public.photo_logs','public.purchase_requests',
        'public.stock_issues','public.stock_returns','public.subcontract_wps',
        'public.supply_plan_lines','public.work_package_members','public.wp_economics',
        'public.wp_labor_costs','public.wp_profit_bank','public.work_package_dependencies'
      ]::regclass[])),
  15, 'group-binding reject trigger attached to all 15 WP-binding tables');

-- ---------------------------------------------------------------------------
-- Fixtures: the parentless leaf is inserted BEFORE any group exists in P1
-- (legacy state) — once a project has งาน rows, U6 forbids new parentless
-- งานย่อย (asserted in section F).
-- ---------------------------------------------------------------------------
insert into public.work_packages (id, project_id, code, name) values
  ('c3c30270-0270-0270-0270-c3c3c3c30270', 'a1a10270-0270-0270-0270-a1a1a1a10270', 'WP-003', 'งานย่อยอิสระ');
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('91910270-0270-0270-0270-919191910270', 'a1a10270-0270-0270-0270-a1a1a1a10270', 'WP-263', 'งานกลุ่มหนึ่ง', true),
  ('92920270-0270-0270-0270-929292920270', 'a1a10270-0270-0270-0270-a1a1a1a10270', 'WP-264', 'งานกลุ่มสอง', true),
  ('93930270-0270-0270-0270-939393930270', 'a2a20270-0270-0270-0270-a2a2a2a20270', 'WP-901', 'งานกลุ่มต่างโครงการ', true);

-- ---------------------------------------------------------------------------
-- C. Hierarchy guard behavior.
-- ---------------------------------------------------------------------------
-- C.1 a leaf cannot be a parent.
select throws_ok($$
  insert into public.work_packages (project_id, code, name, parent_id)
  values ('a1a10270-0270-0270-0270-a1a1a1a10270', 'WP-C1', 'ใต้งานย่อย',
          'c3c30270-0270-0270-0270-c3c3c3c30270') $$,
  '23514', null, 'a งานย่อย cannot be a parent');

-- C.2 a group cannot itself have a parent (depth cap 2).
select throws_ok($$
  insert into public.work_packages (project_id, code, name, is_group, parent_id)
  values ('a1a10270-0270-0270-0270-a1a1a1a10270', 'WP-C2', 'กลุ่มซ้อนกลุ่ม', true,
          '91910270-0270-0270-0270-919191910270') $$,
  '23514', null, 'a งาน cannot have a parent (depth capped at 2)');

-- C.3 parent must be in the same project.
select throws_ok($$
  insert into public.work_packages (project_id, code, name, parent_id)
  values ('a1a10270-0270-0270-0270-a1a1a1a10270', 'WP-C3', 'พ่อต่างโครงการ',
          '93930270-0270-0270-0270-939393930270') $$,
  '23514', null, 'a cross-project parent is rejected');

-- C.4 + C.5 is_group is immutable both ways.
select throws_ok($$
  update public.work_packages set is_group = true
  where id = 'c3c30270-0270-0270-0270-c3c3c3c30270' $$,
  '23514', null, 'leaf→group flip rejected');
select throws_ok($$
  update public.work_packages set is_group = false
  where id = '91910270-0270-0270-0270-919191910270' $$,
  '23514', null, 'group→leaf flip rejected');

-- C.6 a group must be born not_started.
select throws_ok($$
  insert into public.work_packages (project_id, code, name, is_group, status)
  values ('a1a10270-0270-0270-0270-a1a1a1a10270', 'WP-C6', 'กลุ่มเกิดผิดสถานะ', true, 'complete') $$,
  '23514', null, 'a งาน must start not_started');

-- C.7 manual status write on a group is rejected (status is derived).
select throws_ok($$
  update public.work_packages set status = 'in_progress'
  where id = '91910270-0270-0270-0270-919191910270' $$,
  '23514', null, 'manual งาน status write rejected');

-- C.8 group priority is not editable.
select throws_ok($$
  update public.work_packages set priority = 'urgent'
  where id = '91910270-0270-0270-0270-919191910270' $$,
  '23514', null, 'งาน priority write rejected');

-- ---------------------------------------------------------------------------
-- D. Binding guards behavior (representative tables; same fn everywhere).
-- ---------------------------------------------------------------------------
select throws_ok($$
  insert into public.photo_logs (work_package_id, phase, uploaded_by)
  values ('91910270-0270-0270-0270-919191910270', 'before',
          '11111111-1111-1111-1111-111111110270') $$,
  '23514', null, 'a photo cannot bind a งาน');
select throws_ok($$
  insert into public.work_package_members (work_package_id, user_id, added_by)
  values ('91910270-0270-0270-0270-919191910270',
          '11111111-1111-1111-1111-111111110270',
          '11111111-1111-1111-1111-111111110270') $$,
  '23514', null, 'a member cannot bind a งาน');
select throws_ok($$
  insert into public.work_package_dependencies (predecessor_id, successor_id, created_by)
  values ('91910270-0270-0270-0270-919191910270',
          'c3c30270-0270-0270-0270-c3c3c3c30270',
          '11111111-1111-1111-1111-111111110270') $$,
  '23514', null, 'a dependency predecessor cannot be a งาน');
select throws_ok($$
  insert into public.work_package_dependencies (predecessor_id, successor_id, created_by)
  values ('c3c30270-0270-0270-0270-c3c3c3c30270',
          '91910270-0270-0270-0270-919191910270',
          '11111111-1111-1111-1111-111111110270') $$,
  '23514', null, 'a dependency successor cannot be a งาน');

-- ---------------------------------------------------------------------------
-- E. Status rollup.
-- ---------------------------------------------------------------------------
-- E.1 an empty group is not_started.
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'not_started', 'empty งาน is not_started');

-- E.2 two not_started children → parent not_started.
insert into public.work_packages (id, project_id, code, name, parent_id) values
  ('c1c10270-0270-0270-0270-c1c1c1c10270', 'a1a10270-0270-0270-0270-a1a1a1a10270',
   'WP-001', 'งานย่อยหนึ่ง', '91910270-0270-0270-0270-919191910270'),
  ('c2c20270-0270-0270-0270-c2c2c2c20270', 'a1a10270-0270-0270-0270-a1a1a1a10270',
   'WP-002', 'งานย่อยสอง', '91910270-0270-0270-0270-919191910270');
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'not_started', 'all-not_started children → งาน not_started');

-- E.3 one child in_progress → parent in_progress.
update public.work_packages set status='in_progress' where id='c1c10270-0270-0270-0270-c1c1c1c10270';
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'in_progress', 'mixed children → งาน in_progress');

-- E.4 all children complete → parent complete.
update public.work_packages set status='complete'
 where id in ('c1c10270-0270-0270-0270-c1c1c1c10270','c2c20270-0270-0270-0270-c2c2c2c20270');
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'complete', 'all-complete children → งาน complete');

-- E.5 a child reopened to rework → parent back to in_progress.
update public.work_packages set status='rework' where id='c1c10270-0270-0270-0270-c1c1c1c10270';
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'in_progress', 'reopened child pulls งาน back to in_progress');

-- E.6 child completes again → parent complete again.
update public.work_packages set status='complete' where id='c1c10270-0270-0270-0270-c1c1c1c10270';
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'complete', 'งาน returns to complete');

-- E.7 all children on_hold → parent on_hold.
update public.work_packages set status='on_hold'
 where id in ('c1c10270-0270-0270-0270-c1c1c1c10270','c2c20270-0270-0270-0270-c2c2c2c20270');
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'on_hold', 'all-on_hold children → งาน on_hold');

-- E.8 pending_approval child (other on_hold) → mixed → in_progress.
update public.work_packages set status='pending_approval' where id='c1c10270-0270-0270-0270-c1c1c1c10270';
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'in_progress', 'pending_approval child → งาน in_progress (never pending_approval itself)');

-- E.9 re-parenting recomputes BOTH groups.
update public.work_packages set parent_id='92920270-0270-0270-0270-929292920270'
 where id='c2c20270-0270-0270-0270-c2c2c2c20270';   -- c2 is on_hold
select is((select status from public.work_packages where id='92920270-0270-0270-0270-929292920270'),
  'on_hold', 're-parented child recomputes the receiving งาน');
select is((select status from public.work_packages where id='91910270-0270-0270-0270-919191910270'),
  'in_progress', 'the old งาน recomputes from its remaining child');

-- E.10 deleting the last child empties the group → not_started.
delete from public.work_packages where id='c2c20270-0270-0270-0270-c2c2c2c20270';
select is((select status from public.work_packages where id='92920270-0270-0270-0270-929292920270'),
  'not_started', 'งาน empties → not_started');

-- E.11 a parentless งานย่อย keeps today's behavior (manual status writes fine).
update public.work_packages set status='complete' where id='c3c30270-0270-0270-0270-c3c3c3c30270';
select is((select status from public.work_packages where id='c3c30270-0270-0270-0270-c3c3c3c30270'),
  'complete', 'parentless งานย่อย still hand-editable');

-- ---------------------------------------------------------------------------
-- F. U6 (amended): grouping mandatory FORWARD, per adopted project.
-- ---------------------------------------------------------------------------
-- F.1 a project that has งาน rows rejects a new parentless งานย่อย.
select throws_ok($$
  insert into public.work_packages (project_id, code, name)
  values ('a1a10270-0270-0270-0270-a1a1a1a10270', 'WP-F1', 'งานย่อยหลุดกลุ่ม') $$,
  '23514', null, 'an adopted project rejects a new parentless งานย่อย');

-- F.2 a legacy project (no งาน rows) still accepts one.
insert into public.projects (id, code, name, project_lead_id) values
  ('a3a30270-0270-0270-0270-a3a3a3a30270', 'PRC-270-P3', 'โครงการเก่า',
   '11111111-1111-1111-1111-111111110270');
insert into public.work_packages (project_id, code, name)
  values ('a3a30270-0270-0270-0270-a3a3a3a30270', 'WP-F2', 'งานเดี่ยวโครงการเก่า');
select is((select count(*)::int from public.work_packages
            where project_id='a3a30270-0270-0270-0270-a3a3a3a30270'), 1,
  'a legacy (group-less) project still accepts a parentless งานย่อย');

select * from finish();
rollback;
