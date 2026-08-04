begin;
select plan(37);

-- ============================================================================
-- Spec 392 U1 — ผังโซนโครงการ: zone maps as an axis that CROSSES the work
-- package tree.
--
-- A zone is not a parent WP. `wp_hierarchy_guard` caps depth at 2 and a WP
-- carries exactly one work-category, while a zone spans concrete + steel +
-- paint at once — so grouping by trade and grouping by area cannot be the
-- same column. `work_packages.zone_id` is therefore a second, independent
-- axis, the shape ADR 0080 chose for the org chart.
--
-- Geometry is normalised to [0,1] fractions of the map box, the convention
-- `validate-markup.ts` already uses for photo strokes. That is what lets a
-- background image be swapped, or a whole map be cloned onto a differently
-- photographed site, without moving a zone. The CHECK is the authority; the
-- client validator only mirrors it.
--
-- Gate is `is_manager(current_user_role())` (project_manager, super_admin,
-- project_director — read live) AND `can_see_project`. Both arms are
-- reachable: project_manager passes can_see_project by membership, so no
-- clause here is dead.
--
-- ⚠️ Every count below is scoped to THIS file's own seeded rows. A global
-- count(*) on a table the app writes to is what ejected every lane's PR on
-- 2026-08-04 (#954) — the same trap, and `can_see_project`'s blanket arm
-- (super_admin, project_coordinator, project_director, procurement_manager)
-- would hide it here exactly as it did there.
-- ============================================================================

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0392-0392-0392-700000000392', 'pm@s392.local',    '{}'::jsonb),
  ('71000000-0392-0392-0392-710000000392', 'sa@s392.local',    '{}'::jsonb),
  ('72000000-0392-0392-0392-720000000392', 'pmout@s392.local', '{}'::jsonb),
  ('73000000-0392-0392-0392-730000000392', 'tech@s392.local',  '{}'::jsonb);
update public.users set role = 'project_manager' where id = '70000000-0392-0392-0392-700000000392';
update public.users set role = 'site_admin'      where id = '71000000-0392-0392-0392-710000000392';
-- Right role, wrong project: this is what makes the gate project-scoped and
-- not merely role-scoped.
update public.users set role = 'project_manager' where id = '72000000-0392-0392-0392-720000000392';
-- `can_see_project` returns FALSE for technician on every arm — read live
-- 2026-08-04. A ช่าง reaches a WP through DEFINER RPCs, never through table
-- RLS, so the zone read must be proven invisible to them here: spec 392 §5
-- claims "the field roles that already open a WP can see its zone", and for
-- this role that claim is false. U3 owes them an RPC, not a chip.
update public.users set role = 'technician'      where id = '73000000-0392-0392-0392-730000000392';

insert into public.projects (id, code, name) values
  ('a1000000-0392-0392-0392-a10000000392', 'TAP-392A', 'โครงการทดสอบผังโซน'),
  ('a2000000-0392-0392-0392-a20000000392', 'TAP-392B', 'โครงการปลายทางคัดลอกผัง');

insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0392-0392-0392-a10000000392', '70000000-0392-0392-0392-700000000392',
   '70000000-0392-0392-0392-700000000392'),
  ('a1000000-0392-0392-0392-a10000000392', '71000000-0392-0392-0392-710000000392',
   '70000000-0392-0392-0392-700000000392'),
  ('a2000000-0392-0392-0392-a20000000392', '70000000-0392-0392-0392-700000000392',
   '70000000-0392-0392-0392-700000000392');

insert into public.work_packages (id, project_id, code, name, is_group, status) values
  ('d1000000-0392-0392-0392-d10000000392', 'a1000000-0392-0392-0392-a10000000392',
   'W392-01', 'งานเข้าแบบพื้นลานด้านซ้าย', false, 'in_progress');

-- ============================================================================
-- A. Catalog + posture. No write grant reaches `authenticated`: every write
--    goes through the DEFINER RPCs, mirroring how the brief and the report
--    selection already work.
-- ============================================================================
select has_table('public', 'project_zone_maps', 'the zone map table exists');
select has_table('public', 'project_zones', 'the zone table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.project_zone_maps'::regclass),
  'RLS is enabled on project_zone_maps');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.project_zones'::regclass),
  'RLS is enabled on project_zones');

select ok(
  has_table_privilege('authenticated', 'public.project_zones', 'SELECT'),
  'authenticated may SELECT zones (the chip and the rollup have to read them)');
select ok(
  not has_table_privilege('authenticated', 'public.project_zones', 'INSERT'),
  'authenticated may NOT INSERT a zone directly');
select ok(
  not has_table_privilege('authenticated', 'public.project_zones', 'UPDATE'),
  'authenticated may NOT UPDATE a zone directly');
select ok(
  not has_table_privilege('authenticated', 'public.project_zones', 'DELETE'),
  'authenticated may NOT DELETE a zone directly');
select ok(
  not has_table_privilege('anon', 'public.project_zones', 'SELECT'),
  'anon may not read zones at all');

select has_column('public', 'work_packages', 'zone_id',
  'work_packages carries the zone axis');
select ok(
  has_column_privilege('authenticated', 'public.work_packages', 'zone_id', 'SELECT'),
  'authenticated may read work_packages.zone_id');
-- `work_packages` UPDATE is column-granted and excludes every structural
-- column (status, is_group, parent_id, rework_round) — zone_id joins them.
select ok(
  not has_column_privilege('authenticated', 'public.work_packages', 'zone_id', 'UPDATE'),
  'authenticated may NOT write work_packages.zone_id directly — set_wp_zone only');

select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'zone_shape'),
  array['rect', 'rounded_rect', 'ellipse', 'polygon'],
  'zone_shape carries exactly the four shapes the editor can draw');

-- pronamespace-filtered: a same-named function in another schema would
-- otherwise skew both the count and the bool_and.
select ok(
  (select bool_and(prosecdef) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('save_project_zone_map', 'upsert_project_zone',
                      'delete_project_zone', 'set_wp_zone', 'clone_project_zones')),
  'all five zone RPCs are SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('save_project_zone_map', 'upsert_project_zone',
                      'delete_project_zone', 'set_wp_zone', 'clone_project_zones')),
  5,
  'all five exist, exactly once each (an overload would strand the caller)');
select ok(
  not has_function_privilege('anon', 'public.set_wp_zone(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute set_wp_zone');

-- ============================================================================
-- B. The geometry CHECK is the authority, not the client validator.
-- ============================================================================
-- The source map DOES carry a background. Without it the "the clone drops the
-- background" assertion below passes for the wrong reason — there would be
-- nothing to drop.
insert into public.project_zone_maps (id, project_id, name, background_path, created_by) values
  ('b1000000-0392-0392-0392-b10000000392', 'a1000000-0392-0392-0392-a10000000392',
   'ผังชั้น 1', 'zone-maps/392/plan-a.jpg', '70000000-0392-0392-0392-700000000392');

select lives_ok(
  $$ insert into public.project_zones (id, map_id, project_id, code, name, shape, geometry, created_by)
     values ('c1000000-0392-0392-0392-c10000000392',
             'b1000000-0392-0392-0392-b10000000392',
             'a1000000-0392-0392-0392-a10000000392',
             'A', 'พื้นลานด้านซ้าย', 'rect',
             '{"x": 0.05, "y": 0.1, "w": 0.4, "h": 0.5}'::jsonb,
             '70000000-0392-0392-0392-700000000392') $$,
  'a rect wholly inside the unit box is accepted');

select throws_ok(
  $$ insert into public.project_zones (map_id, project_id, code, name, shape, geometry, created_by)
     values ('b1000000-0392-0392-0392-b10000000392',
             'a1000000-0392-0392-0392-a10000000392',
             'X', 'นอกกรอบ', 'rect',
             '{"x": 0.8, "y": 0.1, "w": 0.5, "h": 0.2}'::jsonb,
             '70000000-0392-0392-0392-700000000392') $$,
  '23514', null,
  'a rect running past the right edge is refused — x + w must stay within 1');

select throws_ok(
  $$ insert into public.project_zones (map_id, project_id, code, name, shape, geometry, created_by)
     values ('b1000000-0392-0392-0392-b10000000392',
             'a1000000-0392-0392-0392-a10000000392',
             'Y', 'พิกัดติดลบ', 'polygon',
             '{"points": [[0.1, 0.1], [0.5, -0.2], [0.4, 0.6]]}'::jsonb,
             '70000000-0392-0392-0392-700000000392') $$,
  '23514', null,
  'a polygon point outside [0,1] is refused');

select throws_ok(
  $$ insert into public.project_zones (map_id, project_id, code, name, shape, geometry, created_by)
     values ('b1000000-0392-0392-0392-b10000000392',
             'a1000000-0392-0392-0392-a10000000392',
             'Z', 'รูปทรงไม่ตรงกับพิกัด', 'polygon',
             '{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}'::jsonb,
             '70000000-0392-0392-0392-700000000392') $$,
  '23514', null,
  'a polygon carrying box geometry is refused — shape and geometry must agree');

-- ============================================================================
-- C. The gate. Every refusal is paired with a positive control in the SAME
--    transaction: without one, a green refusal is equally consistent with
--    "the RPC refuses everyone".
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0392-0392-0392-710000000392"}';
select throws_ok(
  $$ select public.upsert_project_zone('b1000000-0392-0392-0392-b10000000392', null,
       'B', 'ห้องถังน้ำดี', 'rect', '{"x":0.5,"y":0.1,"w":0.2,"h":0.2}'::jsonb, null, 1) $$,
  '42501', null,
  'a site_admin on the project cannot draw a zone');
select throws_ok(
  $$ select public.set_wp_zone('d1000000-0392-0392-0392-d10000000392',
       'c1000000-0392-0392-0392-c10000000392') $$,
  '42501', null,
  'a site_admin cannot move a WP between zones');
select throws_ok(
  $$ select public.delete_project_zone('c1000000-0392-0392-0392-c10000000392') $$,
  '42501', null,
  'a site_admin cannot delete a zone');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0392-0392-0392-720000000392"}';
select throws_ok(
  $$ select public.upsert_project_zone('b1000000-0392-0392-0392-b10000000392', null,
       'B', 'ห้องถังน้ำดี', 'rect', '{"x":0.5,"y":0.1,"w":0.2,"h":0.2}'::jsonb, null, 1) $$,
  '42501', null,
  'a project_manager who cannot see the project is refused');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0392-0392-0392-700000000392"}';
select isnt(
  (select public.upsert_project_zone('b1000000-0392-0392-0392-b10000000392', null,
     'B', 'ห้องถังน้ำดี', 'rect', '{"x":0.5,"y":0.1,"w":0.2,"h":0.2}'::jsonb, null, 1)),
  null,
  'the project_manager on the project CAN draw a zone');
select lives_ok(
  $$ select public.set_wp_zone('d1000000-0392-0392-0392-d10000000392',
       'c1000000-0392-0392-0392-c10000000392') $$,
  'the project_manager CAN put a work package in a zone');
select is(
  (select zone_id from public.work_packages
    where id = 'd1000000-0392-0392-0392-d10000000392'),
  'c1000000-0392-0392-0392-c10000000392'::uuid,
  'the WP now reads back its zone');
select lives_ok(
  $$ select public.set_wp_zone('d1000000-0392-0392-0392-d10000000392', null) $$,
  'clearing the zone is allowed — a WP that spans the whole site has none');
select throws_ok(
  $$ select public.clone_project_zones('a1000000-0392-0392-0392-a10000000392',
       'a1000000-0392-0392-0392-a10000000392') $$,
  '22023', null,
  'cloning a project onto itself is refused');
select is(
  (select public.clone_project_zones('a1000000-0392-0392-0392-a10000000392',
     'a2000000-0392-0392-0392-a20000000392')),
  2,
  'the clone copies both zones into the destination project');
select is(
  (select count(*)::int from public.project_zones
    where project_id = 'a2000000-0392-0392-0392-a20000000392'),
  2,
  'the destination now holds its own copies — scoped to this project, never a global count');
-- The background hangs on the MAP, not the zone: one photograph of one site's
-- plan, shared by every zone drawn on it. The source's own background is the
-- positive control — without it there would be nothing for the clone to drop.
select is(
  (select count(*)::int from public.project_zone_maps
    where project_id = 'a1000000-0392-0392-0392-a10000000392'
      and background_path is not null),
  1,
  'the source map does carry a background');
select is(
  (select count(*)::int from public.project_zone_maps
    where project_id = 'a2000000-0392-0392-0392-a20000000392'
      and background_path is not null),
  0,
  'the cloned map carries no background — that image belongs to the site it was photographed on');
-- A double-tap must not silently produce a second set of identical โซน A.
select throws_ok(
  $$ select public.clone_project_zones('a1000000-0392-0392-0392-a10000000392',
       'a2000000-0392-0392-0392-a20000000392') $$,
  '22023', null,
  'cloning again into a project that already has a map is refused, not duplicated');
reset role;

-- ============================================================================
-- D. Read RLS mirrors the work_packages read policy, and the technician gap
--    is pinned rather than assumed away.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0392-0392-0392-710000000392"}';
select is(
  (select count(*)::int from public.project_zones
    where project_id = 'a1000000-0392-0392-0392-a10000000392'),
  2,
  'a site_admin on the project reads its zones — same reach as the WP itself');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0392-0392-0392-720000000392"}';
select is(
  (select count(*)::int from public.project_zones
    where project_id = 'a1000000-0392-0392-0392-a10000000392'),
  0,
  'a project_manager off the project reads none of its zones');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "73000000-0392-0392-0392-730000000392"}';
select is(
  (select count(*)::int from public.project_zones
    where project_id = 'a1000000-0392-0392-0392-a10000000392'),
  0,
  'a technician reads NO zone through table RLS — can_see_project is false for that role, so U3 owes them an RPC');
reset role;

select * from finish();
rollback;
