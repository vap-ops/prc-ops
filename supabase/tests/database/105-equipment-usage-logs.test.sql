begin;
select plan(41);

-- ============================================================================
-- Spec 146 U3 / ADR 0055 + ADR 0060 §2 — equipment_usage_logs: attribute
-- equipment to a WORK PACKAGE via a check-out / check-in SPAN, derive a per-WP
-- equipment charge LIVE (wp_equipment_sell, mirror wp_labor_sell), wire into
-- wp_profit. Append-only + supersede (the labor_logs shape): a check-in inserts a
-- closed row superseding the open one; daily_rate_snapshot is MONEY (no auth
-- grant). The WP is charged the per-item CHARGE-OUT daily rate × whole days on
-- site (transfer price; PRC keeps the margin over the batch cost — Case A).
-- UUIDs HEX-ONLY (the recurring pgTAP lesson).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110104', 'super@usage.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550104', 'dir@usage.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330104', 'pm@usage.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220104', 'sa@usage.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880104', 'vis@usage.local',   '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110104';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550104';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330104';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220104';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('ca0a0104-0104-0104-0104-ca0aca0a0104', 'PRC-104-P1', 'โครงการ U3');

-- WP-A/B/D open; WP-C complete (the check-out complete-WP guard).
insert into public.work_packages (id, project_id, code, name, status) values
  ('ea0a0104-0104-0104-0104-ea0aea0a0104', 'ca0a0104-0104-0104-0104-ca0aca0a0104',
   'WP-A', 'งานเช่า', 'in_progress'),
  ('eb0b0104-0104-0104-0104-eb0beb0b0104', 'ca0a0104-0104-0104-0104-ca0aca0a0104',
   'WP-B', 'งานเปิดค้าง', 'in_progress'),
  ('ec0c0104-0104-0104-0104-ec0cec0c0104', 'ca0a0104-0104-0104-0104-ca0aca0a0104',
   'WP-C', 'งานปิดแล้ว', 'complete'),
  ('ed0d0104-0104-0104-0104-ed0ded0d0104', 'ca0a0104-0104-0104-0104-ca0aca0a0104',
   'WP-D', 'งานแยก', 'in_progress');

-- WP-A budget so wp_profit is computable (no labor/materials seeded → 0 each).
insert into public.wp_economics (work_package_id, budget) values
  ('ea0a0104-0104-0104-0104-ea0aea0a0104', 20000);

insert into public.equipment_owners (id, name, created_by) values
  ('0a0a0104-0104-0104-0104-0a0a0a0a0104', 'บริษัทพี่น้อง',
   '11111111-1111-1111-1111-111111110104');
insert into public.equipment_categories (id, name, created_by) values
  ('cae00104-0104-0104-0104-cae0cae00104', 'เครื่องมือหนัก',
   '11111111-1111-1111-1111-111111110104');

-- Items: P priced 800 (the WP-A closed span), Q priced 500 (the WP-B open span),
-- U unpriced (the unpriced guard), R priced 300 (the complete-WP guard), S priced
-- 700 (the double-open guard), D priced 100 (site_admin gate + the append-only
-- seed). daily_rate is seeded directly (privileged runner, pre-set-role).
insert into public.equipment_items (id, category_id, owner_id, name, daily_rate, created_by) values
  ('17e00104-0104-0104-0104-17e017e00104', 'cae00104-0104-0104-0104-cae0cae00104',
   '0a0a0104-0104-0104-0104-0a0a0a0a0104', 'เครื่องผสมปูน P', 800,
   '11111111-1111-1111-1111-111111110104'),
  ('17e20104-0104-0104-0104-17e217e20104', 'cae00104-0104-0104-0104-cae0cae00104',
   '0a0a0104-0104-0104-0104-0a0a0a0a0104', 'นั่งร้าน Q', 500,
   '11111111-1111-1111-1111-111111110104'),
  ('17e10104-0104-0104-0104-17e117e10104', 'cae00104-0104-0104-0104-cae0cae00104',
   '0a0a0104-0104-0104-0104-0a0a0a0a0104', 'สว่าน U (ยังไม่ตั้งราคา)', null,
   '11111111-1111-1111-1111-111111110104'),
  ('17e30104-0104-0104-0104-17e317e30104', 'cae00104-0104-0104-0104-cae0cae00104',
   '0a0a0104-0104-0104-0104-0a0a0a0a0104', 'ปั๊ม R', 300,
   '11111111-1111-1111-1111-111111110104'),
  ('17e50104-0104-0104-0104-17e517e50104', 'cae00104-0104-0104-0104-cae0cae00104',
   '0a0a0104-0104-0104-0104-0a0a0a0a0104', 'เครื่องตัด S', 700,
   '11111111-1111-1111-1111-111111110104'),
  ('17ed0104-0104-0104-0104-17ed17ed0104', 'cae00104-0104-0104-0104-cae0cae00104',
   '0a0a0104-0104-0104-0104-0a0a0a0a0104', 'รอก D', 100,
   '11111111-1111-1111-1111-111111110104');

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_table('public', 'equipment_usage_logs', 'equipment_usage_logs exists');
select has_column('public', 'equipment_usage_logs', 'work_package_id', 'has work_package_id (WP grain)');
select has_column('public', 'equipment_usage_logs', 'checked_out_on', 'has checked_out_on');
select has_column('public', 'equipment_usage_logs', 'checked_in_on', 'has checked_in_on (null = open)');
select has_column('public', 'equipment_usage_logs', 'daily_rate_snapshot', 'has daily_rate_snapshot (money)');
select has_column('public', 'equipment_usage_logs', 'superseded_by', 'has superseded_by (supersede chain)');
select has_function('public', 'check_out_equipment', ARRAY['uuid','uuid','date'], 'check_out_equipment(uuid,uuid,date) exists');
select has_function('public', 'check_in_equipment', ARRAY['uuid','date'], 'check_in_equipment(uuid,date) exists');
select has_function('public', 'wp_equipment_sell', ARRAY['uuid'], 'wp_equipment_sell(uuid) exists');
select is((select prosecdef from pg_proc where oid='public.check_out_equipment(uuid,uuid,date)'::regprocedure),
  true, 'check_out_equipment is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid='public.wp_equipment_sell(uuid)'::regprocedure),
  true, 'wp_equipment_sell is SECURITY DEFINER');

-- ============================================================================
-- B. Money posture + append-only (run privileged: names roles / trips trigger).
-- ============================================================================
select is(has_column_privilege('authenticated', 'public.equipment_usage_logs', 'daily_rate_snapshot', 'SELECT'),
  false, 'authenticated has NO SELECT on daily_rate_snapshot (money, anti-grant)');
select is(has_column_privilege('authenticated', 'public.equipment_usage_logs', 'work_package_id', 'SELECT'),
  true, 'authenticated CAN read work_package_id (column-scoped grant)');
select is((select relrowsecurity from pg_class where oid='public.equipment_usage_logs'::regclass),
  true, 'RLS enabled on equipment_usage_logs');
select is(has_table_privilege('authenticated', 'public.equipment_usage_logs', 'INSERT'),
  false, 'authenticated has NO INSERT (RPC-only write path)');

-- A seed row on the isolated WP-D for the append-only trigger (closed → never an
-- open conflict for item D's site_admin checkout below).
insert into public.equipment_usage_logs
  (id, item_id, work_package_id, checked_out_on, checked_in_on, daily_rate_snapshot, entered_by)
values
  ('0aaa0104-0104-0104-0104-0aaa0aaa0104', '17ed0104-0104-0104-0104-17ed17ed0104',
   'ed0d0104-0104-0104-0104-ed0ded0d0104', date '2026-05-01', date '2026-05-02', 100,
   '11111111-1111-1111-1111-111111110104');
select throws_ok(
  $$ update public.equipment_usage_logs set checked_in_on=date '2026-05-03'
       where id='0aaa0104-0104-0104-0104-0aaa0aaa0104' $$,
  'P0001', null, 'equipment_usage_logs is append-only — UPDATE blocked');
select throws_ok(
  $$ delete from public.equipment_usage_logs where id='0aaa0104-0104-0104-0104-0aaa0aaa0104' $$,
  'P0001', null, 'equipment_usage_logs is append-only — DELETE blocked');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- C. check_out_equipment — gate + guards.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880104"}';
select throws_ok(
  $$ select public.check_out_equipment('17e00104-0104-0104-0104-17e017e00104',
       'ea0a0104-0104-0104-0104-ea0aea0a0104', date '2026-06-01') $$,
  '42501', null, 'visitor cannot check out equipment');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110104"}';
select throws_ok(
  $$ select public.check_out_equipment('17e10104-0104-0104-0104-17e117e10104',
       'ea0a0104-0104-0104-0104-ea0aea0a0104', date '2026-06-01') $$,
  'P0001', null, 'an unpriced item (daily_rate null) cannot be checked out');
select throws_ok(
  $$ select public.check_out_equipment('17e30104-0104-0104-0104-17e317e30104',
       'ec0c0104-0104-0104-0104-ec0cec0c0104', date '2026-06-01') $$,
  'P0001', null, 'a complete work package takes no new checkout');
select lives_ok(
  $$ select public.check_out_equipment('17e00104-0104-0104-0104-17e017e00104',
       'ea0a0104-0104-0104-0104-ea0aea0a0104', date '2026-06-01') $$,
  'super checks item P out to WP-A (open span)');
select lives_ok(
  $$ select public.check_out_equipment('17e20104-0104-0104-0104-17e217e20104',
       'eb0b0104-0104-0104-0104-eb0beb0b0104', current_date) $$,
  'super checks item Q out to WP-B (open, accrues to today)');
select lives_ok(
  $$ select public.check_out_equipment('17e50104-0104-0104-0104-17e517e50104',
       'ed0d0104-0104-0104-0104-ed0ded0d0104', date '2026-06-02') $$,
  'super checks item S out to WP-D (open)');
select throws_ok(
  $$ select public.check_out_equipment('17e50104-0104-0104-0104-17e517e50104',
       'ea0a0104-0104-0104-0104-ea0aea0a0104', date '2026-06-03') $$,
  'P0001', null, 'item S already out — cannot be checked out to a second WP');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220104"}';
select lives_ok(
  $$ select public.check_out_equipment('17ed0104-0104-0104-0104-17ed17ed0104',
       'ed0d0104-0104-0104-0104-ed0ded0d0104', date '2026-06-05') $$,
  'site_admin (field) may check out equipment');

-- ============================================================================
-- D. check_in_equipment — closes the open row via a superseding successor.
--    logA = item P open on WP-A (current open: checked_in_on null, superseded_by null).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110104"}';
select throws_ok(
  $$ select public.check_in_equipment(
       (select id from public.equipment_usage_logs
          where item_id='17e00104-0104-0104-0104-17e017e00104'
            and work_package_id='ea0a0104-0104-0104-0104-ea0aea0a0104'
            and checked_in_on is null and superseded_by is null),
       date '2026-05-30') $$,
  'P0001', null, 'check-in date before check-out is rejected');
select lives_ok(
  $$ select public.check_in_equipment(
       (select id from public.equipment_usage_logs
          where item_id='17e00104-0104-0104-0104-17e017e00104'
            and work_package_id='ea0a0104-0104-0104-0104-ea0aea0a0104'
            and checked_in_on is null and superseded_by is null),
       date '2026-06-10') $$,
  'super checks item P back in on 06-10 (closes the span)');
select throws_ok(
  $$ select public.check_in_equipment(
       (select id from public.equipment_usage_logs
          where item_id='17e00104-0104-0104-0104-17e017e00104'
            and work_package_id='ea0a0104-0104-0104-0104-ea0aea0a0104'
            and checked_in_on is null and superseded_by is null),
       date '2026-06-11') $$,
  'P0001', null, 'an already-superseded checkout cannot be checked in again');
select throws_ok(
  $$ select public.check_in_equipment(
       (select id from public.equipment_usage_logs
          where item_id='17e00104-0104-0104-0104-17e017e00104'
            and work_package_id='ea0a0104-0104-0104-0104-ea0aea0a0104'
            and checked_in_on is not null limit 1),
       date '2026-06-12') $$,
  'P0001', null, 'an already-closed checkout cannot be checked in again');
select is(
  (select checked_in_on from public.equipment_usage_logs
     where superseded_by = (select id from public.equipment_usage_logs
       where item_id='17e00104-0104-0104-0104-17e017e00104'
         and work_package_id='ea0a0104-0104-0104-0104-ea0aea0a0104'
         and checked_in_on is null and superseded_by is null)),
  date '2026-06-10', 'the closed successor supersedes the open row and carries the check-in date');
select is(
  (select count(*) from public.equipment_usage_logs e
     where e.work_package_id='ea0a0104-0104-0104-0104-ea0aea0a0104'
       and e.checked_in_on is not null
       and not exists (select 1 from public.equipment_usage_logs n where n.superseded_by = e.id)),
  1::bigint, 'WP-A has exactly one current (non-superseded) closed checkout');

-- ============================================================================
-- E. wp_equipment_sell — gate + the live whole-day charge.
-- ============================================================================
select is(public.wp_equipment_sell('ea0a0104-0104-0104-0104-ea0aea0a0104'),
  8000::numeric, 'WP-A equipment charge = 10 days (06-01→06-10 incl) × ฿800 = 8000');
select is(public.wp_equipment_sell('eb0b0104-0104-0104-0104-eb0beb0b0104'),
  500::numeric, 'WP-B equipment charge = open checkout accrues 1 day today × ฿500 = 500');
select throws_ok(
  $$ select public.wp_equipment_sell('dddd0104-0104-0104-0104-dddddddd0104') $$,
  'P0001', null, 'wp_equipment_sell rejects an unknown work package');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550104"}';
select lives_ok(
  $$ select public.wp_equipment_sell('ea0a0104-0104-0104-0104-ea0aea0a0104') $$,
  'project_director may read the equipment charge');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330104"}';
select throws_ok(
  $$ select public.wp_equipment_sell('ea0a0104-0104-0104-0104-ea0aea0a0104') $$,
  '42501', null, 'project_manager cannot read the equipment charge');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220104"}';
select throws_ok(
  $$ select public.wp_equipment_sell('ea0a0104-0104-0104-0104-ea0aea0a0104') $$,
  '42501', null, 'site_admin cannot read the equipment charge');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880104"}';
select throws_ok(
  $$ select public.wp_equipment_sell('ea0a0104-0104-0104-0104-ea0aea0a0104') $$,
  '42501', null, 'visitor cannot read the equipment charge');

-- ============================================================================
-- F. wp_profit now folds equipment in (equipment_costed = true).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110104"}';
select is((select equipment_cost from public.wp_profit('ea0a0104-0104-0104-0104-ea0aea0a0104')),
  8000::numeric, 'wp_profit.equipment_cost = wp_equipment_sell = 8000');
select is((select equipment_costed from public.wp_profit('ea0a0104-0104-0104-0104-ea0aea0a0104')),
  true, 'wp_profit.equipment_costed = true (the gap is closed)');
select is((select profit from public.wp_profit('ea0a0104-0104-0104-0104-ea0aea0a0104')),
  12000::numeric, 'WP-A profit = 20000 − 0 labor − 0 materials − 8000 equipment = 12000');

reset role;

select * from finish();
rollback;
