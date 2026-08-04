-- Spec 389 U1 — WP catalogue (wp_catalog_items) + reference stars.
--
-- The live findings this file pins (checked 2026-08-03):
--
--   * `photo_logs` SELECT RLS = can_see_wp() → can_see_project(), which falls
--     to `else false` for `technician` and is membership-gated for SA/PM. A
--     นายาว principal can NEVER read a โพธิ์ทอง photo row directly — so the
--     cross-project ตัวอย่างงาน read MUST be a DEFINER RPC. Section D asserts
--     the wall directly (count 0) beside the RPC's positive control, so a later
--     policy widening reds here and gets re-justified.
--
--   * Starring is PD-tier (project_director + super_admin), 42501 otherwise —
--     probed as a real role-switched caller, not just ACL introspection.
--
--   * has_function_privilege('anon', …) resolves PUBLIC through inheritance —
--     the house pattern for "no default PUBLIC EXECUTE survived the revoke"
--     (an information_schema.role_routine_grants count reads safe either way).

begin;
select plan(40);

-- ---------------------------------------------------------------------------
-- A. Structure: tables, column, category seeds, RLS, grants, unique code
-- ---------------------------------------------------------------------------
select has_table('public', 'wp_catalog_items', 'wp_catalog_items exists');
select has_table('public', 'wp_catalog_reference_photos', 'wp_catalog_reference_photos exists');
select has_column('public', 'work_packages', 'wp_catalog_item_id', 'work_packages.wp_catalog_item_id exists');

select is(
  (select count(*)::int from public.work_categories
    where (code = 'W10' and code_prefix = 'O')
       or (code = 'W11' and code_prefix = 'SIS')),
  2,
  'W10 (O) and W11 (SIS) are seeded with their prefixes'
);

select is(
  (select string_agg(code_prefix, ',' order by code)
     from public.work_categories where length(code) = 3),
  'PR,S,A,PL,E,H,SG,EX,F,O,SIS',
  'code_prefix seeded across W01–W11 per the Prefix Mapping tab'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.wp_catalog_items'::regclass),
  true, 'RLS enabled on wp_catalog_items');
select is(
  (select relrowsecurity from pg_class where oid = 'public.wp_catalog_reference_photos'::regclass),
  true, 'RLS enabled on wp_catalog_reference_photos');

select is(has_table_privilege('authenticated', 'public.wp_catalog_items', 'SELECT'),
  true,  'authenticated may SELECT the catalogue (firm-wide library)');
select is(has_table_privilege('authenticated', 'public.wp_catalog_items', 'INSERT'),
  false, 'authenticated may NOT INSERT the catalogue directly');
select is(has_table_privilege('authenticated', 'public.wp_catalog_reference_photos', 'SELECT'),
  true,  'authenticated may SELECT stars');
select is(has_table_privilege('authenticated', 'public.wp_catalog_reference_photos', 'INSERT'),
  false, 'authenticated may NOT INSERT stars directly');
select is(has_table_privilege('authenticated', 'public.wp_catalog_reference_photos', 'DELETE'),
  false, 'authenticated may NOT DELETE stars directly');

-- fixture catalogue rows (postgres context bypasses RLS for setup)
insert into public.wp_catalog_items (id, code, name, code_prefix, work_category_id, is_group) values
  ('00000000-0000-0000-0000-000000003891', 'S-98', 'กลุ่มทดสอบ 389', 'S',
   (select id from public.work_categories where code = 'W02'), true);
insert into public.wp_catalog_items (id, code, name, code_prefix, work_category_id, parent_id) values
  ('00000000-0000-0000-0000-000000003892', 'S-98-01', 'งานทดสอบอ้างอิง 389', 'S',
   (select id from public.work_categories where code = 'W02'),
   '00000000-0000-0000-0000-000000003891');

select throws_ok(
  $$ insert into public.wp_catalog_items (code, name, code_prefix)
     values ('S-98-01', 'ซ้ำ', 'S') $$,
  '23505', null,
  'catalogue code is unique'
);

-- ---------------------------------------------------------------------------
-- B. RPC shape + ACLs
-- ---------------------------------------------------------------------------
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'star_reference_photo'),
  true, 'star_reference_photo exists and is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'unstar_reference_photo'),
  true, 'unstar_reference_photo exists and is SECURITY DEFINER');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_wp_reference_photos'),
  true, 'get_wp_reference_photos exists and is SECURITY DEFINER');

select is(has_function_privilege('anon', 'public.star_reference_photo(uuid, text)', 'EXECUTE'),
  false, 'anon (and therefore PUBLIC) cannot execute star_reference_photo');
-- Spec 391 U1b widened this to (uuid, uuid): the reader now takes the VIEWING
-- work package so it can exclude it, after live data showed all 144 complete
-- mapped WPs being served their OWN photos as their examples (403 of 403). The
-- 1-arg form was DROPPED rather than left beside it — an overload would have
-- kept the shipped caller bound to the old body. A 1-arg call still resolves
-- here through the DEFAULT, so this assertion moves rather than relaxes.
select is(has_function_privilege('anon', 'public.get_wp_reference_photos(uuid, uuid)', 'EXECUTE'),
  false, 'anon (and therefore PUBLIC) cannot execute get_wp_reference_photos');
select is(has_function_privilege('authenticated', 'public.star_reference_photo(uuid, text)', 'EXECUTE'),
  true, 'authenticated may execute star_reference_photo (gate is inside, 42501)');
select is(has_function_privilege('authenticated', 'public.get_wp_reference_photos(uuid, uuid)', 'EXECUTE'),
  true, 'authenticated may execute get_wp_reference_photos');

-- ---------------------------------------------------------------------------
-- principals + project fixtures. The technician is bound to NO project — the
-- cross-project consumer of section D.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000389a1', 'ref-pd@t.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000389a2', 'ref-tech@t.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000389a3', 'ref-su@t.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000389a4', 'ref-pm@t.local', '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000389a5', 'ref-visitor@t.local', '{}'::jsonb);
update public.users set role = 'project_director'
  where id = '00000000-0000-0000-0000-0000000389a1';
update public.users set role = 'technician'
  where id = '00000000-0000-0000-0000-0000000389a2';
update public.users set role = 'super_admin'
  where id = '00000000-0000-0000-0000-0000000389a3';
update public.users set role = 'project_manager'
  where id = '00000000-0000-0000-0000-0000000389a4';
-- a5 stays the signup default (visitor)

insert into public.projects (id, code, name) values
  ('00000000-0000-0000-0000-0000000389b0', 'PRJ-389', 'โครงการทดสอบ 389');

-- w1 mapped to the catalogue leaf; w2 unmapped. (No groups in this project, so
-- parentless leaves are legal under wp_hierarchy_guard.)
insert into public.work_packages (id, project_id, code, name, wp_catalog_item_id) values
  ('00000000-0000-0000-0000-0000000389c1', '00000000-0000-0000-0000-0000000389b0',
   'T-01', 'งานที่จับคู่แล้ว', '00000000-0000-0000-0000-000000003892');
insert into public.work_packages (id, project_id, code, name) values
  ('00000000-0000-0000-0000-0000000389c2', '00000000-0000-0000-0000-0000000389b0',
   'T-02', 'งานที่ยังไม่จับคู่');

-- photos: p1 current (star target) · p2 current + unstarred · p3 removed by a
-- tombstone (the `photo_logs_path_supersede_well_formed` CHECK forces
-- (storage_path is null) = (superseded_by is not null): a superseding row IS a
-- tombstone — supersede on this table is removal, not substitution) · p5 on the
-- unmapped WP.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('00000000-0000-0000-0000-0000000389d1', '00000000-0000-0000-0000-0000000389c1',
   'after', 'test/389/p1.jpg', '00000000-0000-0000-0000-0000000389a1'),
  ('00000000-0000-0000-0000-0000000389d2', '00000000-0000-0000-0000-0000000389c1',
   'during', 'test/389/p2.jpg', '00000000-0000-0000-0000-0000000389a1'),
  ('00000000-0000-0000-0000-0000000389d3', '00000000-0000-0000-0000-0000000389c1',
   'during', 'test/389/p3.jpg', '00000000-0000-0000-0000-0000000389a1'),
  ('00000000-0000-0000-0000-0000000389d5', '00000000-0000-0000-0000-0000000389c2',
   'after', 'test/389/p5.jpg', '00000000-0000-0000-0000-0000000389a1');
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, superseded_by) values
  ('00000000-0000-0000-0000-0000000389d4', '00000000-0000-0000-0000-0000000389c1',
   'during', null, '00000000-0000-0000-0000-0000000389a1',
   '00000000-0000-0000-0000-0000000389d3');

-- allow role switches to write TAP (the _tap_buf grant trap)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ---------------------------------------------------------------------------
-- C. Behaviour as the PD
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000389a1"}';

select lives_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000389d1', 'มุมนี้ถูกต้อง') $$,
  'PD stars a current photo on a mapped WP');

select is(
  (select count(*)::int from public.wp_catalog_reference_photos
    where photo_log_id = '00000000-0000-0000-0000-0000000389d1'),
  1, 'exactly one star row for the photo');

select lives_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000389d1', null) $$,
  'duplicate star is an idempotent success, not an error');

select is(
  (select count(*)::int from public.wp_catalog_reference_photos
    where photo_log_id = '00000000-0000-0000-0000-0000000389d1'),
  1, 'still exactly one star row after the duplicate call');

select is(
  (select note from public.wp_catalog_reference_photos
    where photo_log_id = '00000000-0000-0000-0000-0000000389d1'),
  'มุมนี้ถูกต้อง', 'the note survived the null re-star (coalesce keeps)');

select throws_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000389d3', null) $$,
  '22023', null, 'a superseded photo cannot be starred');

select throws_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000389d5', null) $$,
  '22023', null, 'a photo on an unmapped WP cannot be starred');

select lives_ok(
  $$ select public.unstar_reference_photo('00000000-0000-0000-0000-0000000389d1') $$,
  'PD un-stars');
select is(
  (select count(*)::int from public.wp_catalog_reference_photos
    where photo_log_id = '00000000-0000-0000-0000-0000000389d1'),
  0, 'the star row is gone after unstar');

-- re-star for section D's reader assertions
select lives_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000389d1', 'ตัวอย่างที่ดี') $$,
  're-star after unstar works');

-- ---------------------------------------------------------------------------
-- D. The cross-project consumer: a technician with NO membership anywhere.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000389a2"}';

select is(
  (select count(*)::int from public.photo_logs),
  0, 'the RLS wall is real: a technician reads ZERO photo_logs rows directly');

select throws_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000389d1', null) $$,
  '42501', null, 'a technician cannot star');
select throws_ok(
  $$ select public.unstar_reference_photo('00000000-0000-0000-0000-0000000389d1') $$,
  '42501', null, 'a technician cannot unstar');

select is(
  (select count(*)::int from public.get_wp_reference_photos('00000000-0000-0000-0000-000000003892')),
  1, 'POSITIVE CONTROL: the reader returns the starred photo across the RLS wall');

select is(
  (select photo_log_id from public.get_wp_reference_photos('00000000-0000-0000-0000-000000003892')),
  '00000000-0000-0000-0000-0000000389d1'::uuid,
  'only the STARRED photo comes back — the unstarred current photo (p2) does not');

select is(
  (select project_name from public.get_wp_reference_photos('00000000-0000-0000-0000-000000003892')),
  'โครงการทดสอบ 389', 'the source project name rides along for the chip');

-- ---------------------------------------------------------------------------
-- E. Both gate directions + the recorded reader-wideness decision + the
--    star-then-remove case (the one path that exercises the reader's filters).
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000389a3"}';
select lives_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000389d2', null) $$,
  'super_admin (the second allowed role) can star');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000389a4"}';
select throws_ok(
  $$ select public.star_reference_photo('00000000-0000-0000-0000-0000000389d2', null) $$,
  '42501', null, 'project_manager cannot star — a widening must red here first');

-- the DELIBERATE decision (migration §6 header): the reader is world-readable
-- to authenticated, visitor included — paths + project names, never bytes.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000389a5"}';
select is(
  (select count(*)::int from public.get_wp_reference_photos('00000000-0000-0000-0000-000000003892')),
  2, 'RECORDED DECISION: a visitor can read the starred set (d1 + d2)');

-- star-then-remove: tombstone d1 AFTER it was starred — the reader must drop
-- exactly it while the untouched star (d2) survives.
reset role;
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by, superseded_by) values
  ('00000000-0000-0000-0000-0000000389d6', '00000000-0000-0000-0000-0000000389c1',
   'after', null, '00000000-0000-0000-0000-0000000389a1',
   '00000000-0000-0000-0000-0000000389d1');

select is(
  (select array_agg(photo_log_id) from public.get_wp_reference_photos('00000000-0000-0000-0000-000000003892')),
  array['00000000-0000-0000-0000-0000000389d2'::uuid],
  'a starred photo removed by tombstone drops out of the reader; the other star survives');

select * from finish();
rollback;
