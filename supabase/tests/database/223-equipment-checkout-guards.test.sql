begin;
select plan(24);

-- ============================================================================
-- Spec 202 U3 / ADR 0055 — equipment check-out coherence guards.
--   F2: check_out_equipment rejects an item not physically on hand
--       (status not in available/on_site/in_use → maintenance/returned/lost).
--   F3: check-out sets equipment_items.status='in_use'; check-in restores the
--       status the item's LATEST movement implies (no movement → available).
-- Re-source guard: the five-role gate (incl. project_director, ADR 0058) must
-- survive the CREATE OR REPLACE — asserted via the director lives / visitor 42501
-- cases. Existing guards (unpriced/complete/double-open) re-asserted (regression).
-- UUIDs HEX-ONLY (the recurring pgTAP lesson).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110202', 'super@u3.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550202', 'dir@u3.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220202', 'sa@u3.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880202', 'vis@u3.local',   '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110202';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550202';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220202';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('aa020202-0202-0202-0202-aaaaaa020202', 'PRC-202-U3', 'โครงการ U3');

-- WP-G open; WP-C complete (the complete-WP guard regression).
insert into public.work_packages (id, project_id, code, name, status) values
  ('ba020202-0202-0202-0202-bbbbbb020202', 'aa020202-0202-0202-0202-aaaaaa020202',
   'WP-G', 'งานเช่าอุปกรณ์', 'in_progress'),
  ('bc020202-0202-0202-0202-cccccc020202', 'aa020202-0202-0202-0202-aaaaaa020202',
   'WP-C', 'งานปิดแล้ว', 'complete');

-- SA audit F3 (mig 075590): the site_admin field caller must be a project member
-- to check equipment out/in. Bind it so the site_admin check-out arm stays a member.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa020202-0202-0202-0202-aaaaaa020202', '22222222-2222-2222-2222-222222220202',
   '11111111-1111-1111-1111-111111110202');

insert into public.equipment_owners (id, name, created_by) values
  ('0a020202-0202-0202-0202-0a0a0a020202', 'บริษัทพี่น้อง',
   '11111111-1111-1111-1111-111111110202');
insert into public.equipment_categories (id, name, created_by) values
  ('ca020202-0202-0202-0202-cacaca020202', 'เครื่องมือหนัก',
   '11111111-1111-1111-1111-111111110202');

-- Items: explicit status drives F2; daily_rate seeded directly (privileged).
--   AVAIL/ONSITE pass F2; MAINT/RET/LOST are blocked. MOVE gets a deployed
--   movement (trigger → on_site) for the restore-to-on_site case; NOMOVE has no
--   movement (restore-to-available). GATE for the visitor gate; UNPRICED/COMP/DBL
--   for the regression cases.
insert into public.equipment_items (id, category_id, owner_id, name, status, daily_rate, created_by) values
  ('17e10202-0202-0202-0202-17e1e1020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'เครื่องผสมปูน AVAIL', 'available',   800, '11111111-1111-1111-1111-111111110202'),
  ('17e20202-0202-0202-0202-17e2e2020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'นั่งร้าน ONSITE',     'on_site',     500, '11111111-1111-1111-1111-111111110202'),
  ('17e30202-0202-0202-0202-17e3e3020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'ปั๊ม MAINT',          'maintenance', 300, '11111111-1111-1111-1111-111111110202'),
  ('17e40202-0202-0202-0202-17e4e4020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'รอก RET',             'returned',    200, '11111111-1111-1111-1111-111111110202'),
  ('17e50202-0202-0202-0202-17e5e5020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'เครื่องตัด LOST',     'lost',        100, '11111111-1111-1111-1111-111111110202'),
  ('17e60202-0202-0202-0202-17e6e6020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'เครื่องเชื่อม MOVE',  'available',   400, '11111111-1111-1111-1111-111111110202'),
  ('17e70202-0202-0202-0202-17e7e7020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'สว่าน NOMOVE',        'available',   600, '11111111-1111-1111-1111-111111110202'),
  ('17e80202-0202-0202-0202-17e8e8020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'เลื่อย GATE',         'available',   700, '11111111-1111-1111-1111-111111110202'),
  ('17e90202-0202-0202-0202-17e9e9020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'กบ UNPRICED',         'available',   null, '11111111-1111-1111-1111-111111110202'),
  ('17ea0202-0202-0202-0202-17eaea020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'แม่แรง COMP',         'available',   900, '11111111-1111-1111-1111-111111110202'),
  ('17eb0202-0202-0202-0202-17ebeb020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'ค้อนลม DBL',          'available',   150, '11111111-1111-1111-1111-111111110202'),
  -- INUSE: seeded status='in_use' with NO open usage log — pins the F2 pass-through
  -- arm (a manually-set in_use item is legitimately checkout-able).
  ('17ec0202-0202-0202-0202-17ecec020202', 'ca020202-0202-0202-0202-cacaca020202',
   '0a020202-0202-0202-0202-0a0a0a020202', 'เครื่องขัด INUSE',    'in_use',      250, '11111111-1111-1111-1111-111111110202');

-- MOVE gets a deployed movement → the AFTER INSERT trigger sets its status='on_site'.
insert into public.equipment_movements (id, item_id, kind, project_id, created_by) values
  ('0d020202-0202-0202-0202-0d0d0d020202', '17e60202-0202-0202-0202-17e6e6020202',
   'deployed', 'aa020202-0202-0202-0202-aaaaaa020202', '11111111-1111-1111-1111-111111110202');

-- ============================================================================
-- Structural — the replace kept the signatures + grants (re-source insurance).
-- ============================================================================
select has_function('public', 'check_out_equipment', ARRAY['uuid','uuid','date'], 'check_out_equipment(uuid,uuid,date) exists');
select has_function('public', 'check_in_equipment', ARRAY['uuid','date'], 'check_in_equipment(uuid,date) exists');
select is(has_function_privilege('authenticated', 'public.check_out_equipment(uuid,uuid,date)', 'EXECUTE'),
  true, 'check_out_equipment EXECUTE grant preserved across replace');
select is(has_function_privilege('authenticated', 'public.check_in_equipment(uuid,date)', 'EXECUTE'),
  true, 'check_in_equipment EXECUTE grant preserved across replace');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- F2 — physical-availability guard (super_admin caller).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110202"}';
select throws_ok(
  $$ select public.check_out_equipment('17e30202-0202-0202-0202-17e3e3020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'P0001', null, 'F2: an item in maintenance cannot be checked out');
select throws_ok(
  $$ select public.check_out_equipment('17e40202-0202-0202-0202-17e4e4020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'P0001', null, 'F2: a returned item cannot be checked out');
select throws_ok(
  $$ select public.check_out_equipment('17e50202-0202-0202-0202-17e5e5020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'P0001', null, 'F2: a lost item cannot be checked out');
select lives_ok(
  $$ select public.check_out_equipment('17e10202-0202-0202-0202-17e1e1020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'F2: an available item checks out');
select is(
  (select status::text from public.equipment_items where id='17e10202-0202-0202-0202-17e1e1020202'),
  'in_use', 'F3: check-out sets the item status to in_use');
select lives_ok(
  $$ select public.check_out_equipment('17e20202-0202-0202-0202-17e2e2020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'F2: an on_site item checks out');
select lives_ok(
  $$ select public.check_out_equipment('17ec0202-0202-0202-0202-17ecec020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'F2: a manually-set in_use item (no open span) is checkout-able — the pass-through arm');

-- ============================================================================
-- Gate regression — the five-role gate survived the replace (re-source guard).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550202"}';
select lives_ok(
  $$ select public.check_out_equipment('17e60202-0202-0202-0202-17e6e6020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'gate: project_director may check out (director arm preserved — ADR 0058)');
-- F3-set (MOVE) — proves the checkout drove status to in_use, so the restore assert
-- below is non-vacuous (director jwt reads under the SELECT policy).
select is(
  (select status::text from public.equipment_items where id='17e60202-0202-0202-0202-17e6e6020202'),
  'in_use', 'F3: check-out set the MOVE item to in_use');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880202"}';
select throws_ok(
  $$ select public.check_out_equipment('17e80202-0202-0202-0202-17e8e8020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  '42501', null, 'gate: a visitor cannot check out');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220202"}';
select lives_ok(
  $$ select public.check_out_equipment('17e70202-0202-0202-0202-17e7e7020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'gate: site_admin (field) may check out');
-- F3-set (NOMOVE) — same, so the restore-to-available assert below is non-vacuous.
select is(
  (select status::text from public.equipment_items where id='17e70202-0202-0202-0202-17e7e7020202'),
  'in_use', 'F3: check-out set the NOMOVE item to in_use');

-- ============================================================================
-- F3 restore — check-in returns the movement-derived status.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110202"}';
select lives_ok(
  $$ select public.check_in_equipment(
       (select id from public.equipment_usage_logs
          where item_id='17e60202-0202-0202-0202-17e6e6020202'
            and checked_in_on is null and superseded_by is null),
       date '2026-06-10') $$,
  'check-in the MOVE item (had a deployed movement)');
select is(
  (select status::text from public.equipment_items where id='17e60202-0202-0202-0202-17e6e6020202'),
  'on_site', 'F3 restore: check-in returns a deployed item to on_site (latest movement)');
select lives_ok(
  $$ select public.check_in_equipment(
       (select id from public.equipment_usage_logs
          where item_id='17e70202-0202-0202-0202-17e7e7020202'
            and checked_in_on is null and superseded_by is null),
       date '2026-06-10') $$,
  'check-in the NOMOVE item (no movements)');
select is(
  (select status::text from public.equipment_items where id='17e70202-0202-0202-0202-17e7e7020202'),
  'available', 'F3 restore: a no-movement item returns to available');

-- ============================================================================
-- Regression — the existing guards still fire (proves the re-source kept them).
-- ============================================================================
select throws_ok(
  $$ select public.check_out_equipment('17e90202-0202-0202-0202-17e9e9020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'P0001', null, 'regression: an unpriced item is still rejected (priced check intact)');
select throws_ok(
  $$ select public.check_out_equipment('17ea0202-0202-0202-0202-17eaea020202',
       'bc020202-0202-0202-0202-cccccc020202', date '2026-06-01') $$,
  'P0001', null, 'regression: a complete WP still takes no checkout');
select lives_ok(
  $$ select public.check_out_equipment('17eb0202-0202-0202-0202-17ebeb020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-01') $$,
  'regression: DBL item checks out (now in_use)');
select throws_ok(
  $$ select public.check_out_equipment('17eb0202-0202-0202-0202-17ebeb020202',
       'ba020202-0202-0202-0202-bbbbbb020202', date '2026-06-02') $$,
  'P0001', 'check_out_equipment: item is already checked out',
  'regression: an in_use item passes F2 but the one-open-checkout guard fires (right message)');

reset role;

select * from finish();
rollback;
