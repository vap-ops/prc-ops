begin;
select plan(17);

-- ============================================================================
-- Spec 270 U2b — import_wp_grouping(p_project_id, p_rows jsonb).
--   SECURITY DEFINER, super_admin only (42501 otherwise, null-safe). Applies an
--   engineer grouping file in ONE transaction: creates งาน rows, re-parents,
--   renames, and renumbers via a two-phase code swap (unique (project_id, code)
--   survives full permutations). Hard-validates (22023): project exists, every
--   existing WP covered exactly once by old_code, no silent drops, grouping
--   mandatory, no is_group flips, no cross-project old_code. Audit-logged.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110271', 'super@wpg-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220271', 'pm@wpg-test.local',    '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110271';
update public.users set role='project_manager' where id='22222222-2222-2222-2222-222222220271';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10271-0271-0271-0271-a1a1a1a10271', 'PRC-271-P1', 'โครงการนำเข้า',
   '11111111-1111-1111-1111-111111110271'),
  ('a2a20271-0271-0271-0271-a2a2a2a20271', 'PRC-271-P2', 'โครงการอื่น',
   '11111111-1111-1111-1111-111111110271');

insert into public.work_packages (id, project_id, code, name) values
  ('c1c10271-0271-0271-0271-c1c1c1c10271', 'a1a10271-0271-0271-0271-a1a1a1a10271', 'WP-001', 'งานเอ'),
  ('c2c20271-0271-0271-0271-c2c2c2c20271', 'a1a10271-0271-0271-0271-a1a1a1a10271', 'WP-002', 'งานบี'),
  ('c9c90271-0271-0271-0271-c9c9c9c90271', 'a2a20271-0271-0271-0271-a2a2a2a20271', 'WP-001', 'งานต่างโครงการ');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select ok(to_regprocedure('public.import_wp_grouping(uuid,jsonb)') is not null,
  'import_wp_grouping(uuid, jsonb) exists');
select is((select prosecdef from pg_proc
            where oid='public.import_wp_grouping(uuid,jsonb)'::regprocedure),
  true, 'import_wp_grouping is SECURITY DEFINER');

-- B. Gates.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220271"}';
select throws_ok($$
  select public.import_wp_grouping('a1a10271-0271-0271-0271-a1a1a1a10271', '[]'::jsonb) $$,
  '42501', null, 'project_manager is rejected');
set local "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000000271"}';
select throws_ok($$
  select public.import_wp_grouping('a1a10271-0271-0271-0271-a1a1a1a10271', '[]'::jsonb) $$,
  '42501', null, 'an unknown / null-role session is rejected (null-safe gate)');

-- C. Happy path — 2 new groups; the two leaves SWAP codes (two-phase proof),
--    one is renamed; both parented.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110271"}';
select lives_ok($$
  select public.import_wp_grouping('a1a10271-0271-0271-0271-a1a1a1a10271', '[
    {"sub_of": null,     "code": "WP-501", "old_code": null,     "name": "กลุ่มหนึ่ง"},
    {"sub_of": null,     "code": "WP-502", "old_code": null,     "name": "กลุ่มสอง"},
    {"sub_of": "WP-501", "code": "WP-002", "old_code": "WP-001", "name": "งานเอใหม่"},
    {"sub_of": "WP-502", "code": "WP-001", "old_code": "WP-002", "name": "งานบี"}
  ]'::jsonb) $$,
  'a valid grouping file applies');

reset role;

select is((select count(*)::int from public.work_packages
            where project_id='a1a10271-0271-0271-0271-a1a1a1a10271' and is_group), 2,
  'two งาน rows were created');
select is((select code from public.work_packages where id='c1c10271-0271-0271-0271-c1c1c1c10271'),
  'WP-002', 'leaf A recoded to WP-002 (swap survived the unique index)');
select is((select name from public.work_packages where id='c1c10271-0271-0271-0271-c1c1c1c10271'),
  'งานเอใหม่', 'leaf A renamed');
select is((select code from public.work_packages where id='c2c20271-0271-0271-0271-c2c2c2c20271'),
  'WP-001', 'leaf B recoded to WP-001 (other side of the swap)');
select is((select p.code from public.work_packages c
            join public.work_packages p on p.id = c.parent_id
            where c.id='c1c10271-0271-0271-0271-c1c1c1c10271'),
  'WP-501', 'leaf A parented under กลุ่มหนึ่ง');
select is((select status from public.work_packages
            where project_id='a1a10271-0271-0271-0271-a1a1a1a10271' and code='WP-501'),
  'not_started', 'new งาน rolled up to not_started');
select is((select count(*)::int from public.audit_log
            where target_table='work_packages'
              and target_id='a1a10271-0271-0271-0271-a1a1a1a10271'
              and payload->>'kind'='wp_grouping_import'), 1,
  'the import wrote one audit_log row');

-- D. Hard validation, all-or-nothing.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110271"}';

-- D.1 unknown old_code.
select throws_ok($$
  select public.import_wp_grouping('a1a10271-0271-0271-0271-a1a1a1a10271', '[
    {"sub_of": null,     "code": "WP-601", "old_code": null,     "name": "กลุ่ม"},
    {"sub_of": "WP-601", "code": "WP-602", "old_code": "WP-999", "name": "ปริศนา"},
    {"sub_of": "WP-601", "code": "WP-603", "old_code": "WP-001", "name": "งานบี"},
    {"sub_of": "WP-601", "code": "WP-604", "old_code": "WP-002", "name": "งานเอใหม่"},
    {"sub_of": "WP-601", "code": "WP-605", "old_code": "WP-501", "name": "ก1"},
    {"sub_of": "WP-601", "code": "WP-606", "old_code": "WP-502", "name": "ก2"}
  ]'::jsonb) $$,
  '22023', null, 'an unknown old_code rejects the whole file');

-- D.2 a leaf row without sub_of (grouping mandatory / is_group flip attempt).
select throws_ok($$
  select public.import_wp_grouping('a1a10271-0271-0271-0271-a1a1a1a10271', '[
    {"sub_of": null, "code": "WP-601", "old_code": "WP-002", "name": "งานเอถูกทำเป็นกลุ่ม"},
    {"sub_of": null, "code": "WP-602", "old_code": "WP-001", "name": "งานบีหลุดกลุ่ม"},
    {"sub_of": null, "code": "WP-605", "old_code": "WP-501", "name": "ก1"},
    {"sub_of": null, "code": "WP-606", "old_code": "WP-502", "name": "ก2"}
  ]'::jsonb) $$,
  '22023', null, 'a งานย่อย old_code on a group-shaped row is rejected');

-- D.3 dropped existing WP (coverage).
select throws_ok($$
  select public.import_wp_grouping('a1a10271-0271-0271-0271-a1a1a1a10271', '[
    {"sub_of": null,     "code": "WP-601", "old_code": "WP-501", "name": "ก1"},
    {"sub_of": null,     "code": "WP-602", "old_code": "WP-502", "name": "ก2"},
    {"sub_of": "WP-601", "code": "WP-603", "old_code": "WP-002", "name": "งานเอ"}
  ]'::jsonb) $$,
  '22023', null, 'a missing existing WP (silent drop) rejects the file');

-- D.4 cross-project old_code.
select throws_ok($$
  select public.import_wp_grouping('a2a20271-0271-0271-0271-a2a2a2a20271', '[
    {"sub_of": null,     "code": "WP-601", "old_code": null,     "name": "กลุ่ม"},
    {"sub_of": "WP-601", "code": "WP-602", "old_code": "WP-002", "name": "ของโครงการอื่น"},
    {"sub_of": "WP-601", "code": "WP-603", "old_code": "WP-001", "name": "งานต่างโครงการ"}
  ]'::jsonb) $$,
  '22023', null, 'an old_code from another project is rejected');

reset role;

-- D.5 atomicity: the failed imports left no partial state behind.
select is((select count(*)::int from public.work_packages
            where project_id='a1a10271-0271-0271-0271-a1a1a1a10271'), 4,
  'failed imports left the project untouched (2 งาน + 2 งานย่อย only)');

select * from finish();
rollback;
