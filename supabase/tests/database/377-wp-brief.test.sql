-- Spec 377 U1 — WP brief (ข้อมูลงาน): registry + draft head + criteria/slots +
-- immutable versions + tombstone attachments. ADR 0086. Migrations 075873 + 075874.
--
-- Key invariants under test:
--   * publish event = the append-only wp_brief_versions row (NOT approvals),
--     numbered IN-DB (BEFORE INSERT derives max+1 — caller input is ignored, so
--     a gap / re-publish-at-lower-number / trusted-RPC bug is unrepresentable);
--   * briefs bind to LEAF WPs only (wp_reject_group_binding, 23514);
--   * read model mirrors work_packages: procurement tiers unconditional OR
--     can_see_wp — probed BEHAVIOURALLY per role, with positive controls;
--   * delete_work_package refuses a brief-carrying WP with its FRIENDLY P0001
--     (the fresh-eyes 🔴: raw 23503 before 075874) while a draft-only WP still
--     deletes (the FK cascades the draft);
--   * criteria cannot re-parent; a slot maps only its own brief's criteria;
--   * attachments follow ADR 0015 tombstone shape with a supersede guard
--     (same-brief, content-row target, no double-tombstone).
begin;

-- Role-switch asserts need the collector visible to the switched roles
-- (the run-pgtap transform writes assertions into _tap_buf).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;

select plan(62);

-- ── fixtures ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-4000-8000-000000000377', 'sa@377.local',   '{}'::jsonb),
  ('bb000000-0000-4000-8000-000000000377', 'pm@377.local',   '{}'::jsonb),
  ('cc000000-0000-4000-8000-000000000377', 'proc@377.local', '{}'::jsonb),
  ('dd000000-0000-4000-8000-000000000377', 'sup@377.local',  '{}'::jsonb),
  ('ee000000-0000-4000-8000-000000000377', 'pd@377.local',   '{}'::jsonb);
update public.users set role = 'site_admin'       where id = 'aa000000-0000-4000-8000-000000000377';
update public.users set role = 'project_manager'  where id = 'bb000000-0000-4000-8000-000000000377';
update public.users set role = 'procurement'      where id = 'cc000000-0000-4000-8000-000000000377';
update public.users set role = 'super_admin'      where id = 'dd000000-0000-4000-8000-000000000377';
update public.users set role = 'project_director' where id = 'ee000000-0000-4000-8000-000000000377';

insert into public.projects (id, code, name, project_lead_id) values
  ('aa370000-0377-4000-8000-000000000377', 'PRC-377-P1', 'โครงการทดสอบ 377', null);
-- sa is a member; pm deliberately NOT (the RLS negative control — a PD or
-- super_admin sees everything unconditionally, the spec-371 lesson; the PD
-- probe below is the POSITIVE side of that same fact).
insert into public.project_members (project_id, user_id, added_by) values
  ('aa370000-0377-4000-8000-000000000377', 'aa000000-0000-4000-8000-000000000377',
   'dd000000-0000-4000-8000-000000000377');

-- Group first, then leaves with parent (the 270 U6 forward guard).
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('cc370000-0377-4000-8000-000000000001', 'aa370000-0377-4000-8000-000000000377',
   'G377', 'งานกลุ่มทดสอบ', true);
insert into public.work_packages (id, project_id, code, name, parent_id) values
  ('cc370000-0377-4000-8000-000000000002', 'aa370000-0377-4000-8000-000000000377',
   'W377-01', 'งานย่อยทดสอบ', 'cc370000-0377-4000-8000-000000000001'),
  ('cc370000-0377-4000-8000-000000000003', 'aa370000-0377-4000-8000-000000000377',
   'W377-02', 'งานย่อยทดสอบสอง', 'cc370000-0377-4000-8000-000000000001');

-- ── 1) shape + blanket posture ───────────────────────────────────────────────
select has_table('public', 'wp_brief_attachment_types', 'registry table exists');
select has_table('public', 'wp_briefs',                 'draft head table exists');
select has_table('public', 'wp_brief_criteria',         'criteria table exists');
select has_table('public', 'wp_brief_evidence_slots',   'evidence slots table exists');
select has_table('public', 'wp_brief_versions',         'versions table exists');
select has_table('public', 'wp_brief_attachments',      'attachments table exists');
select col_not_null('public', 'wp_brief_versions', 'published_by',
  'a publish is always attributed (published_by NOT NULL)');
select has_column('public', 'wp_briefs', 'display_config',
  'the PD display-selection seam exists (operator ruling 2026-07-30)');
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.wp_brief_attachment_types'::regclass, 'public.wp_briefs'::regclass,
    'public.wp_brief_criteria'::regclass, 'public.wp_brief_evidence_slots'::regclass,
    'public.wp_brief_versions'::regclass, 'public.wp_brief_attachments'::regclass)),
  'RLS is enabled on all six tables'
);
select ok(
  not has_table_privilege('anon', 'public.wp_brief_attachment_types', 'SELECT')
  and not has_table_privilege('anon', 'public.wp_briefs', 'SELECT')
  and not has_table_privilege('anon', 'public.wp_brief_criteria', 'SELECT')
  and not has_table_privilege('anon', 'public.wp_brief_evidence_slots', 'SELECT')
  and not has_table_privilege('anon', 'public.wp_brief_versions', 'SELECT')
  and not has_table_privilege('anon', 'public.wp_brief_attachments', 'SELECT'),
  'anon reads nothing anywhere'
);

-- ── 2) registry seed + posture ───────────────────────────────────────────────
select ok(
  (select count(*) from public.wp_brief_attachment_types
    where code in ('sheet_crop', 'iso_render', 'model_3d', 'bar_schedule', 'other')) = 5,
  'the 5 ADR-0086 seed types are present'
);
select ok(
  not exists (select 1 from public.wp_brief_attachment_types where is_active = false),
  'all seeds start active (the dial starts ON)'
);
select ok(
  has_table_privilege('authenticated', 'public.wp_brief_attachment_types', 'SELECT'),
  'authenticated may read the registry'
);
select ok(
  not has_table_privilege('authenticated', 'public.wp_brief_attachment_types', 'INSERT')
  and not has_table_privilege('authenticated', 'public.wp_brief_attachment_types', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.wp_brief_attachment_types', 'DELETE'),
  'authenticated cannot write the registry (RPC-only)'
);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000377"}';
select ok(
  (select count(*) from public.wp_brief_attachment_types) >= 5,
  'positive control: an authenticated session actually reads the registry'
);
reset role;
select throws_ok(
  $$insert into public.wp_brief_attachment_types (code, name_th) values ('  ', 'ว่าง')$$,
  '23514', null,
  'a blank registry code is rejected (the dial RPC matches on btrim)'
);

-- ── 3) the dial RPC ──────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon',
    'public.set_wp_brief_attachment_type_active(text, boolean)', 'EXECUTE'),
  'anon cannot execute the dial RPC (PUBLIC default grant revoked)'
);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000377"}';
select throws_ok(
  $$select public.set_wp_brief_attachment_type_active('iso_render', false)$$,
  '42501', null,
  'a non-super role cannot flip the dial'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$select public.set_wp_brief_attachment_type_active('iso_render', false)$$,
  '42501', null,
  'an unbound session (null role) is refused — coalesce-to-false, never open'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "dd000000-0000-4000-8000-000000000377"}';
select lives_ok(
  $$select public.set_wp_brief_attachment_type_active('iso_render', false)$$,
  'super_admin flips a type off'
);
select throws_ok(
  $$select public.set_wp_brief_attachment_type_active('no_such_type', false)$$,
  '22023', null,
  'unknown code is 22023'
);
select throws_ok(
  $$select public.set_wp_brief_attachment_type_active('iso_render', null)$$,
  '22023', null,
  'a null flag is refused — a kill switch never defaults ON'
);
reset role;
select ok(
  (select is_active from public.wp_brief_attachment_types where code = 'iso_render') = false,
  'the flip persisted (iso_render now inactive)'
);

-- ── 4) the draft head ────────────────────────────────────────────────────────
select lives_ok(
  $$insert into public.wp_briefs (id, work_package_id, scope_included, quantity, location,
                                  sheet_code, sheet_rev, updated_by)
    values ('dd370000-0377-4000-8000-000000000001',
            'cc370000-0377-4000-8000-000000000002',
            'ผูกเหล็กฐานราก F1 ทั้งหมด', '12 จุด', 'โซนหน้าอาคาร',
            'S-101', 'B', 'dd000000-0000-4000-8000-000000000377')$$,
  'a brief lands on a leaf WP'
);
select throws_ok(
  $$insert into public.wp_briefs (work_package_id)
    values ('cc370000-0377-4000-8000-000000000002')$$,
  '23505', null,
  'one draft head per WP (unique work_package_id)'
);
select throws_ok(
  $$insert into public.wp_briefs (work_package_id)
    values ('cc370000-0377-4000-8000-000000000001')$$,
  '23514', null,
  'a brief on a GROUP WP is rejected (leaf-only)'
);
select throws_ok(
  $$update public.wp_briefs
       set display_config = ('"' || repeat('x', 10001) || '"')::jsonb
     where id = 'dd370000-0377-4000-8000-000000000001'$$,
  '23514', null,
  'display_config is length-bounded like every other column'
);
select ok(
  not has_table_privilege('authenticated', 'public.wp_briefs', 'INSERT')
  and not has_table_privilege('authenticated', 'public.wp_briefs', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.wp_briefs', 'DELETE'),
  'authenticated cannot write wp_briefs directly (RPC-only)'
);

-- read model, probed per role
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000377"}';
select ok(
  (select count(*) from public.wp_briefs
    where work_package_id = 'cc370000-0377-4000-8000-000000000002') = 1,
  'a member site_admin reads the brief (positive control)'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000377"}';
select ok(
  (select count(*) from public.wp_briefs) = 0,
  'a NON-member project_manager reads nothing'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "cc000000-0000-4000-8000-000000000377"}';
select ok(
  (select count(*) from public.wp_briefs
    where work_package_id = 'cc370000-0377-4000-8000-000000000002') = 1,
  'plain procurement reads the brief (the work_packages read-model arm)'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "ee000000-0000-4000-8000-000000000377"}';
select ok(
  (select count(*) from public.wp_briefs
    where work_package_id = 'cc370000-0377-4000-8000-000000000002') = 1,
  'a NON-member project_director reads it too (can_see_project see-all arm — the authoring role)'
);
reset role;

-- ── 5) criteria + slots ──────────────────────────────────────────────────────
select lives_ok(
  $$
  with c as (
    insert into public.wp_brief_criteria (id, brief_id, body, sort_order)
    values ('ee370000-0377-4000-8000-000000000001',
            'dd370000-0377-4000-8000-000000000001', 'เหล็กครบทุกจุดตามแบบ', 1)
    returning id
  )
  insert into public.wp_brief_evidence_slots (id, brief_id, label, criterion_id, sort_order)
  select '12370000-0377-4000-8000-000000000001',
         'dd370000-0377-4000-8000-000000000001', 'มุมกว้างเห็นทั้งฐาน', id, 1 from c
  $$,
  'a criterion and its mapped slot land'
);
select throws_ok(
  $$insert into public.wp_brief_criteria (brief_id, body)
    values ('dd370000-0377-4000-8000-000000000001', '   ')$$,
  '23514', null,
  'a blank criterion body is rejected'
);
-- second brief on the second leaf, with one criterion of its own
insert into public.wp_briefs (id, work_package_id) values
  ('dd370000-0377-4000-8000-000000000002', 'cc370000-0377-4000-8000-000000000003');
insert into public.wp_brief_criteria (id, brief_id, body) values
  ('ee370000-0377-4000-8000-000000000002', 'dd370000-0377-4000-8000-000000000002',
   'เกณฑ์ของบรีฟสอง');
select throws_ok(
  $$insert into public.wp_brief_evidence_slots (brief_id, label, criterion_id)
    values ('dd370000-0377-4000-8000-000000000002', 'สลอตข้ามบรีฟ',
            'ee370000-0377-4000-8000-000000000001')$$,
  '23514', null,
  'a slot mapping another brief''s criterion is rejected at INSERT'
);
select throws_ok(
  $$update public.wp_brief_evidence_slots
       set criterion_id = 'ee370000-0377-4000-8000-000000000002'
     where id = '12370000-0377-4000-8000-000000000001'$$,
  '23514', null,
  '…and at UPDATE (the guard''s second arm)'
);
select throws_ok(
  $$update public.wp_brief_criteria
       set brief_id = 'dd370000-0377-4000-8000-000000000002'
     where id = 'ee370000-0377-4000-8000-000000000001'$$,
  '23514', null,
  'a criterion can never re-parent (the slot-guard bypass fresh-eyes probed)'
);
-- retiring a criterion unmaps its slots, never deletes them
delete from public.wp_brief_criteria where id = 'ee370000-0377-4000-8000-000000000001';
select ok(
  (select count(*) from public.wp_brief_evidence_slots
    where brief_id = 'dd370000-0377-4000-8000-000000000001'
      and criterion_id is null) = 1,
  'criterion delete sets the slot''s criterion_id NULL (slot survives)'
);

-- ── 6) immutable versions — the publish event ────────────────────────────────
select lives_ok(
  $$insert into public.wp_brief_versions (id, work_package_id, content, published_by)
    values ('ff370000-0377-4000-8000-000000000001',
            'cc370000-0377-4000-8000-000000000002',
            '{"scope_included": "ผูกเหล็กฐานราก F1"}'::jsonb,
            'dd000000-0000-4000-8000-000000000377')$$,
  'a version publishes with attribution and NO caller-supplied number'
);
select ok(
  (select version from public.wp_brief_versions
    where id = 'ff370000-0377-4000-8000-000000000001') = 1,
  'the first publish is numbered 1 in-DB'
);
select lives_ok(
  $$insert into public.wp_brief_versions (work_package_id, version, content, published_by)
    values ('cc370000-0377-4000-8000-000000000002', 99, '{}'::jsonb,
            'dd000000-0000-4000-8000-000000000377')$$,
  'a second publish lands even with a bogus caller number'
);
select ok(
  (select max(version) from public.wp_brief_versions
    where work_package_id = 'cc370000-0377-4000-8000-000000000002') = 2
  and not exists (select 1 from public.wp_brief_versions where version = 99),
  'the caller''s number is IGNORED — versions are derived max+1, gap-free'
);
select throws_ok(
  $$update public.wp_brief_versions set content = '{}'::jsonb
     where id = 'ff370000-0377-4000-8000-000000000001'$$,
  'P0001', 'wp_brief_versions is append-only',
  'a published version can never be updated'
);
select throws_ok(
  $$delete from public.wp_brief_versions
     where id = 'ff370000-0377-4000-8000-000000000001'$$,
  'P0001', 'wp_brief_versions is append-only',
  'a published version can never be deleted'
);
select throws_ok(
  $$truncate public.wp_brief_versions$$,
  'P0001', 'wp_brief_versions is append-only',
  'nor truncated (the audit_log precedent, proven not just has_trigger''d)'
);
select throws_ok(
  $$insert into public.wp_brief_versions (work_package_id, content, published_by)
    values ('cc370000-0377-4000-8000-000000000001', '{}'::jsonb,
            'dd000000-0000-4000-8000-000000000377')$$,
  '23514', null,
  'a version on a GROUP WP is rejected (leaf-only)'
);
select throws_ok(
  $$insert into public.wp_brief_versions (work_package_id, content)
    values ('cc370000-0377-4000-8000-000000000002', '{}'::jsonb)$$,
  '23502', null,
  'an unattributed publish is impossible (published_by NOT NULL)'
);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000377"}';
select ok(
  (select count(*) from public.wp_brief_versions) = 2,
  'a member site_admin reads the published versions'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000377"}';
select ok(
  (select count(*) from public.wp_brief_versions) = 0,
  'a NON-member project_manager reads no versions'
);
reset role;

-- ── 7) attachments — ADR 0015 tombstone shape + supersede guard ──────────────
select lives_ok(
  $$insert into public.wp_brief_attachments (id, brief_id, type_id, storage_path, sheet_code, sheet_rev, created_by)
    select '11370000-0377-4000-8000-000000000001',
           'dd370000-0377-4000-8000-000000000001', t.id,
           'wp-brief/dd370000/crop-1.png', 'S-101', 'B',
           'dd000000-0000-4000-8000-000000000377'
      from public.wp_brief_attachment_types t where t.code = 'sheet_crop'$$,
  'a content attachment lands'
);
select lives_ok(
  $$insert into public.wp_brief_attachments (brief_id, type_id, superseded_by, created_by)
    select 'dd370000-0377-4000-8000-000000000001', t.id,
           '11370000-0377-4000-8000-000000000001',
           'dd000000-0000-4000-8000-000000000377'
      from public.wp_brief_attachment_types t where t.code = 'sheet_crop'$$,
  'a tombstone (path NULL + superseded_by) lands'
);
select throws_ok(
  $$insert into public.wp_brief_attachments (brief_id, type_id, created_by)
    select 'dd370000-0377-4000-8000-000000000001', t.id,
           'dd000000-0000-4000-8000-000000000377'
      from public.wp_brief_attachment_types t where t.code = 'other'$$,
  '23514', null,
  'both-NULL (neither content nor tombstone) is rejected'
);
select throws_ok(
  $$insert into public.wp_brief_attachments (brief_id, type_id, storage_path, superseded_by, created_by)
    select 'dd370000-0377-4000-8000-000000000001', t.id,
           'wp-brief/dd370000/hybrid.png',
           '11370000-0377-4000-8000-000000000001',
           'dd000000-0000-4000-8000-000000000377'
      from public.wp_brief_attachment_types t where t.code = 'other'$$,
  '23514', null,
  'a hybrid row (content AND supersede) is rejected'
);
select throws_ok(
  $$insert into public.wp_brief_attachments (brief_id, type_id, superseded_by, created_by)
    select 'dd370000-0377-4000-8000-000000000001', t.id,
           '11370000-0377-4000-8000-000000000001',
           'dd000000-0000-4000-8000-000000000377'
      from public.wp_brief_attachment_types t where t.code = 'sheet_crop'$$,
  '23514', null,
  'a SECOND tombstone at the same target is rejected'
);
-- a fresh content row in brief 1, then brief 2 tries to retire it
insert into public.wp_brief_attachments (id, brief_id, type_id, storage_path, created_by)
select '11370000-0377-4000-8000-000000000002',
       'dd370000-0377-4000-8000-000000000001', t.id,
       'wp-brief/dd370000/crop-2.png',
       'dd000000-0000-4000-8000-000000000377'
  from public.wp_brief_attachment_types t where t.code = 'sheet_crop';
select throws_ok(
  $$insert into public.wp_brief_attachments (brief_id, type_id, superseded_by, created_by)
    select 'dd370000-0377-4000-8000-000000000002', t.id,
           '11370000-0377-4000-8000-000000000002',
           'dd000000-0000-4000-8000-000000000377'
      from public.wp_brief_attachment_types t where t.code = 'sheet_crop'$$,
  '23514', null,
  'a tombstone in ANOTHER brief cannot retire this brief''s attachment'
);
select throws_ok(
  $$update public.wp_brief_attachments
       set storage_path = 'wp-brief/dd370000/other.png'
     where id = '11370000-0377-4000-8000-000000000001'$$,
  'P0001', 'wp_brief_attachments is append-only',
  'an attachment row can never be updated'
);
select throws_ok(
  $$delete from public.wp_brief_attachments
     where id = '11370000-0377-4000-8000-000000000001'$$,
  'P0001', 'wp_brief_attachments is append-only',
  'nor deleted'
);
select throws_ok(
  $$truncate public.wp_brief_attachments$$,
  'P0001', 'wp_brief_attachments is append-only',
  'nor truncated'
);
select throws_ok(
  $$insert into public.wp_brief_attachments (brief_id, type_id, storage_path, created_by)
    values ('dd370000-0377-4000-8000-000000000001',
            '99999999-9999-4999-8999-999999999999',
            'wp-brief/dd370000/x.png',
            'dd000000-0000-4000-8000-000000000377')$$,
  '23503', null,
  'an unknown attachment type is rejected (FK to the registry)'
);

-- ── 8) delete_work_package integration (the fresh-eyes 🔴 regression) ────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "dd000000-0000-4000-8000-000000000377"}';
select throws_ok(
  $$select public.delete_work_package('cc370000-0377-4000-8000-000000000002')$$,
  'P0001', null,
  'a WP with published brief versions refuses with the FRIENDLY history message, not a raw 23503'
);
select lives_ok(
  $$select public.delete_work_package('cc370000-0377-4000-8000-000000000003')$$,
  'a WP with only a DRAFT brief still deletes (the draft cascades)'
);
reset role;
select ok(
  not exists (select 1 from public.wp_briefs
    where id = 'dd370000-0377-4000-8000-000000000002'),
  'the cascade removed the draft (and its children) with the WP'
);

select * from finish();

rollback;
