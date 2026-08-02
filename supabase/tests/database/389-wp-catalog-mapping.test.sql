-- Spec 389 U4 — map_wp_to_catalog: the PD mapping RPC for legacy projects.
--
-- The two behaviours that earn their own asserts (spec §7 recorded decision):
-- stars are keyed to the catalogue item AT STAR TIME, so a re-map must MOVE the
-- WP's stars to the new item (deduping pair collisions) and an un-map must
-- RETIRE them — otherwise stars strand on the old item and surface the photo as
-- reference for a work-type it no longer represents.

begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- fixtures: catalogue (one group, two leaves) · project · WPs · photo · users
-- ---------------------------------------------------------------------------
insert into public.wp_catalog_items (id, code, name, code_prefix, work_category_id, is_group) values
  ('00000000-0000-0000-0000-0000000489e1', 'S-97', 'กลุ่มทดสอบ U4', 'S',
   (select id from public.work_categories where code = 'W02'), true);
insert into public.wp_catalog_items (id, code, name, code_prefix, work_category_id, parent_id) values
  ('00000000-0000-0000-0000-0000000489e2', 'S-97-01', 'งานเดิม U4', 'S',
   (select id from public.work_categories where code = 'W02'),
   '00000000-0000-0000-0000-0000000489e1'),
  ('00000000-0000-0000-0000-0000000489e3', 'S-97-02', 'งานใหม่ U4', 'S',
   (select id from public.work_categories where code = 'W02'),
   '00000000-0000-0000-0000-0000000489e1');
insert into public.wp_catalog_items (id, code, name, code_prefix, work_category_id, parent_id, is_active) values
  ('00000000-0000-0000-0000-0000000489e4', 'S-97-03', 'งานเลิกใช้ U4', 'S',
   (select id from public.work_categories where code = 'W02'),
   '00000000-0000-0000-0000-0000000489e1', false);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000489a1', 'map-pd@t.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000489a2', 'map-tech@t.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000489a3', 'map-su@t.local', '{}'::jsonb);
update public.users set role = 'project_director'
  where id = '00000000-0000-0000-0000-0000000489a1';
update public.users set role = 'technician'
  where id = '00000000-0000-0000-0000-0000000489a2';
update public.users set role = 'super_admin'
  where id = '00000000-0000-0000-0000-0000000489a3';

insert into public.projects (id, code, name) values
  ('00000000-0000-0000-0000-0000000489b0', 'PRJ-489', 'โครงการทดสอบ U4');

insert into public.work_packages (id, project_id, code, name) values
  ('00000000-0000-0000-0000-0000000489c1', '00000000-0000-0000-0000-0000000489b0',
   'M-01', 'งานที่จะจับคู่'),
  ('00000000-0000-0000-0000-0000000489c2', '00000000-0000-0000-0000-0000000489b0',
   'M-02', 'งานเปรียบเทียบ');

insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('00000000-0000-0000-0000-0000000489d1', '00000000-0000-0000-0000-0000000489c1',
   'after', 'test/489/p1.jpg', '00000000-0000-0000-0000-0000000489a1'),
  ('00000000-0000-0000-0000-0000000489d2', '00000000-0000-0000-0000-0000000489c2',
   'after', 'test/489/p2.jpg', '00000000-0000-0000-0000-0000000489a1');

-- ---------------------------------------------------------------------------
-- A. shape + ACL
-- ---------------------------------------------------------------------------
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'map_wp_to_catalog'),
  true, 'map_wp_to_catalog exists and is SECURITY DEFINER');

select is(has_function_privilege('anon', 'public.map_wp_to_catalog(uuid, uuid)', 'EXECUTE'),
  false, 'anon (and therefore PUBLIC) cannot execute map_wp_to_catalog');
select is(has_function_privilege('authenticated', 'public.map_wp_to_catalog(uuid, uuid)', 'EXECUTE'),
  true, 'authenticated may execute it (gate inside, 42501)');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ---------------------------------------------------------------------------
-- B. gates + validation
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000489a2"}';

select throws_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c1',
                                     '00000000-0000-0000-0000-0000000489e2') $$,
  '42501', null, 'a technician cannot map');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000489a1"}';

select throws_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489e2',
                                     '00000000-0000-0000-0000-0000000489e2') $$,
  '22023', null, 'unknown WP refused');
select throws_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c1',
                                     '00000000-0000-0000-0000-0000000489c1') $$,
  '22023', null, 'unknown catalogue item refused');
select throws_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c1',
                                     '00000000-0000-0000-0000-0000000489e1') $$,
  '22023', null, 'a leaf WP cannot map to a GROUP item (grain mismatch)');
select throws_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c1',
                                     '00000000-0000-0000-0000-0000000489e4') $$,
  '22023', null, 'a RETIRED catalogue item cannot be a mapping target');

-- ---------------------------------------------------------------------------
-- C. map + audit
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c1',
                                     '00000000-0000-0000-0000-0000000489e2') $$,
  'PD maps a WP to a leaf item');

select is(
  (select wp_catalog_item_id from public.work_packages
    where id = '00000000-0000-0000-0000-0000000489c1'),
  '00000000-0000-0000-0000-0000000489e2'::uuid, 'the WP now carries the item');

select is(
  (select count(*)::int from public.audit_log
    where target_table = 'work_packages'
      and target_id = '00000000-0000-0000-0000-0000000489c1'
      and payload ->> 'event' = 'wp_catalog_mapped'),
  1, 'one audit row per mapping change');

-- no-op re-map writes no second audit row
select lives_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c1',
                                     '00000000-0000-0000-0000-0000000489e2') $$,
  'idempotent re-map is a no-op success');
select is(
  (select count(*)::int from public.audit_log
    where target_table = 'work_packages'
      and target_id = '00000000-0000-0000-0000-0000000489c1'
      and payload ->> 'event' = 'wp_catalog_mapped'),
  1, 'the no-op wrote no second audit row');

-- ---------------------------------------------------------------------------
-- D. star handling on re-map / un-map (spec §7) — with the two CONTAINMENT
--    controls the logic exists for: another WP's star on the same old item
--    must survive untouched, and the collision-dedupe must remove ONLY the
--    colliding old-item row.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000489d1', 'อ้างอิง U4') $$,
  'PD stars the mapped WP''s photo (star lands on the OLD item)');

-- M-02 maps to the SAME old item and its photo is starred there too — the
-- containment control: M-01's re-map must not touch it. (super_admin does this
-- map — the second allowed role's positive control.)
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000489a3"}';
select lives_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c2',
                                     '00000000-0000-0000-0000-0000000489e2') $$,
  'super_admin (the second allowed role) can map');
select lives_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000489d2', null) $$,
  'the other WP''s photo is starred under the same old item');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000489a1"}';

-- a pre-existing star on the TARGET pair (postgres-context insert — cannot
-- arise via the RPC flow, exists to exercise the dedupe arm)
reset role;
insert into public.wp_catalog_reference_photos
  (wp_catalog_item_id, photo_log_id, starred_by)
values ('00000000-0000-0000-0000-0000000489e3', '00000000-0000-0000-0000-0000000489d1',
        '00000000-0000-0000-0000-0000000489a1');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000489a1"}';

-- re-map M-01 to the sibling leaf: the colliding old-item star is DEDUPED
-- (target pair already exists), and nothing else is touched
select is(
  (select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c1',
                                   '00000000-0000-0000-0000-0000000489e3')
     - 'old' - 'new'),
  '{"changed": true, "stars_moved": 0, "stars_deduped": 1, "stars_retired": 0}'::jsonb,
  're-map with a target collision: deduped 1, moved 0, retired 0');

select is(
  (select count(*)::int from public.wp_catalog_reference_photos
    where photo_log_id = '00000000-0000-0000-0000-0000000489d1'),
  1, 'exactly one star remains for the photo — on the target item');
select is(
  (select wp_catalog_item_id from public.wp_catalog_reference_photos
    where photo_log_id = '00000000-0000-0000-0000-0000000489d1'),
  '00000000-0000-0000-0000-0000000489e3'::uuid,
  'and it is the target item''s star');

select is(
  (select wp_catalog_item_id from public.wp_catalog_reference_photos
    where photo_log_id = '00000000-0000-0000-0000-0000000489d2'),
  '00000000-0000-0000-0000-0000000489e2'::uuid,
  'CONTAINMENT: the other WP''s star on the old item is untouched');

-- un-map: the star must be retired, not orphaned
select lives_ok(
  $$ select public.map_wp_to_catalog('00000000-0000-0000-0000-0000000489c1', null) $$,
  'un-map (leave-unmapped is an explicit PD choice)');

select is(
  (select count(*)::int from public.wp_catalog_reference_photos
    where photo_log_id = '00000000-0000-0000-0000-0000000489d1'),
  0, 'un-mapping retired the WP''s stars');

select * from finish();
rollback;
