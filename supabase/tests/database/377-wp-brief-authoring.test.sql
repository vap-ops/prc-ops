-- Spec 377 U2a — PD brief authoring RPCs: draft upsert, criteria/slot CRUD,
-- publish (the version row is the publish event — ADR 0086 §4), and
-- clone-from-previous-project (name-matched, draft-only, non-clobbering).
-- Every RPC mirrors the live `set_work_package_deliverable` shape:
-- is_manager() + can_see_wp()/can_see_project(), 42501 collapsing "not
-- found" and "not a member" (existence never leaked), 22023 reserved for
-- genuine validation errors. RPC-only writes throughout.
--
-- Migrations 075876 + 075877 (hardening: the source-project gate on clone —
-- a live-probed cross-project RLS-bypass oracle in 075876 — the torn-read
-- fix on publish, the sheet-citation strip on clone, the null-sort_order
-- 22023, and the criteria/slot ordering tiebreak).
begin;

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;

select plan(60);

-- ── fixtures ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-4000-8000-000000000378', 'sa@378.local',   '{}'::jsonb),
  ('bb000000-0000-4000-8000-000000000378', 'pd@378.local',   '{}'::jsonb),
  ('cc000000-0000-4000-8000-000000000378', 'pm@378.local',   '{}'::jsonb),
  ('dd000000-0000-4000-8000-000000000378', 'pmsrc@378.local', '{}'::jsonb),
  ('ee000000-0000-4000-8000-000000000378', 'pmdst@378.local', '{}'::jsonb);
update public.users set role = 'site_admin'       where id = 'aa000000-0000-4000-8000-000000000378';
update public.users set role = 'project_director' where id = 'bb000000-0000-4000-8000-000000000378';
-- cc/dd/ee are project_MANAGER, not project_director — can_see_project's
-- see-all arm covers project_director unconditionally (spec-371 lesson: that
-- role can NEVER be a valid "not a member" negative control). project_manager
-- is membership-gated, so these three genuinely test the membership branch.
update public.users set role = 'project_manager'  where id = 'cc000000-0000-4000-8000-000000000378';
update public.users set role = 'project_manager'  where id = 'dd000000-0000-4000-8000-000000000378';
update public.users set role = 'project_manager'  where id = 'ee000000-0000-4000-8000-000000000378';

insert into public.projects (id, code, name, project_lead_id) values
  ('aa370000-0378-4000-8000-000000000001', 'PRC-378-SRC', 'โครงการต้นทาง', null),
  ('aa370000-0378-4000-8000-000000000002', 'PRC-378-DST', 'โครงการปลายทาง', null);
-- pd (bb..) is a member of DST only (project_director sees all regardless).
-- cc = member of NEITHER. dd = member of SOURCE ONLY. ee = member of TARGET
-- ONLY — the two negative controls the 075877 source-gate fix needs: dd
-- proves the TARGET gate still fires on its own; ee proves the NEW SOURCE
-- gate fires (and fires BEFORE the target check ever runs) — this is the
-- regression test for the live-probed cross-project read the fresh-eyes
-- review caught in 075876.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa370000-0378-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000378',
   'bb000000-0000-4000-8000-000000000378'),
  ('aa370000-0378-4000-8000-000000000001', 'dd000000-0000-4000-8000-000000000378',
   'bb000000-0000-4000-8000-000000000378'),
  ('aa370000-0378-4000-8000-000000000002', 'ee000000-0000-4000-8000-000000000378',
   'bb000000-0000-4000-8000-000000000378');

-- SOURCE project: one group + two leaves, one leaf carries a brief w/ 2 criteria
-- + 2 slots (one slot mapped, one bare) — the clone must remap the mapping.
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('cc370000-0378-4000-8000-000000000a01', 'aa370000-0378-4000-8000-000000000001', 'G1', 'กลุ่มต้นทาง', true);
insert into public.work_packages (id, project_id, code, name, parent_id) values
  ('cc370000-0378-4000-8000-000000000101', 'aa370000-0378-4000-8000-000000000001',
   'W01-01', 'ผูกเหล็กฐานราก F1', 'cc370000-0378-4000-8000-000000000a01'),
  ('cc370000-0378-4000-8000-000000000102', 'aa370000-0378-4000-8000-000000000001',
   'W01-02', 'งานไม่มีบรีฟ', 'cc370000-0378-4000-8000-000000000a01');

-- DESTINATION project: one group + THREE leaves — one shares the source's WP
-- name (the clone target), one has a DIFFERENT name (no match, untouched),
-- one ALREADY has its own draft (must be skipped, never clobbered).
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('cc370000-0378-4000-8000-000000000a02', 'aa370000-0378-4000-8000-000000000002', 'G1', 'กลุ่มปลายทาง', true);
insert into public.work_packages (id, project_id, code, name, parent_id) values
  ('cc370000-0378-4000-8000-000000000201', 'aa370000-0378-4000-8000-000000000002',
   'W01-01', 'ผูกเหล็กฐานราก F1', 'cc370000-0378-4000-8000-000000000a02'),
  ('cc370000-0378-4000-8000-000000000202', 'aa370000-0378-4000-8000-000000000002',
   'W01-02', 'งานคนละอย่าง', 'cc370000-0378-4000-8000-000000000a02'),
  ('cc370000-0378-4000-8000-000000000203', 'aa370000-0378-4000-8000-000000000002',
   'W01-03', 'ผูกเหล็กฐานราก F1', 'cc370000-0378-4000-8000-000000000a02');

-- ── 1) RPCs exist + PUBLIC/anon locked out ──────────────────────────────────
select has_function('public', 'save_wp_brief_draft',           'save_wp_brief_draft exists');
select has_function('public', 'add_wp_brief_criterion',        'add_wp_brief_criterion exists');
select has_function('public', 'update_wp_brief_criterion',     'update_wp_brief_criterion exists');
select has_function('public', 'delete_wp_brief_criterion',     'delete_wp_brief_criterion exists');
select has_function('public', 'add_wp_brief_evidence_slot',    'add_wp_brief_evidence_slot exists');
select has_function('public', 'update_wp_brief_evidence_slot', 'update_wp_brief_evidence_slot exists');
select has_function('public', 'delete_wp_brief_evidence_slot', 'delete_wp_brief_evidence_slot exists');
select has_function('public', 'publish_wp_brief',               'publish_wp_brief exists');
select has_function('public', 'clone_wp_briefs_from_project',   'clone_wp_briefs_from_project exists');
select ok(
  not has_function_privilege('anon', 'public.save_wp_brief_draft(uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.add_wp_brief_criterion(uuid,text,int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_wp_brief_criterion(uuid,text,int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_wp_brief_criterion(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.add_wp_brief_evidence_slot(uuid,text,uuid,int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_wp_brief_evidence_slot(uuid,text,uuid,int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_wp_brief_evidence_slot(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.publish_wp_brief(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.clone_wp_briefs_from_project(uuid,uuid)', 'EXECUTE'),
  'anon cannot execute ANY of the 9 authoring RPCs (default PUBLIC EXECUTE revoked on every one)'
);
-- role-gate fires BEFORE any existence/scope check on every RPC, so a
-- garbage uuid is enough to prove the non-manager refusal for the 8 not
-- otherwise exercised by a real flow above.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.add_wp_brief_criterion('99999999-9999-4999-8999-999999999999', 'x', null)$$,
  '42501', null, 'site_admin cannot add_wp_brief_criterion'
);
select throws_ok(
  $$select public.update_wp_brief_criterion('99999999-9999-4999-8999-999999999999', 'x', 1)$$,
  '42501', null, 'site_admin cannot update_wp_brief_criterion'
);
select throws_ok(
  $$select public.delete_wp_brief_criterion('99999999-9999-4999-8999-999999999999')$$,
  '42501', null, 'site_admin cannot delete_wp_brief_criterion'
);
select throws_ok(
  $$select public.add_wp_brief_evidence_slot('99999999-9999-4999-8999-999999999999', 'x', null, null)$$,
  '42501', null, 'site_admin cannot add_wp_brief_evidence_slot'
);
select throws_ok(
  $$select public.update_wp_brief_evidence_slot('99999999-9999-4999-8999-999999999999', 'x', null, 1)$$,
  '42501', null, 'site_admin cannot update_wp_brief_evidence_slot'
);
select throws_ok(
  $$select public.delete_wp_brief_evidence_slot('99999999-9999-4999-8999-999999999999')$$,
  '42501', null, 'site_admin cannot delete_wp_brief_evidence_slot'
);
select throws_ok(
  $$select public.publish_wp_brief('99999999-9999-4999-8999-999999999999')$$,
  '42501', null, 'site_admin cannot publish_wp_brief'
);
select throws_ok(
  $$select public.clone_wp_briefs_from_project('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111')$$,
  '42501', null, 'site_admin cannot clone_wp_briefs_from_project'
);
reset role;
-- coalesce-to-false class: an unbound session (no JWT sub at all) must be
-- refused, not silently treated as some default role.
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$select public.save_wp_brief_draft('99999999-9999-4999-8999-999999999999', 'x', null, null, null, null, null, null)$$,
  '42501', null, 'an unbound session (null role) is refused, never defaults open'
);
reset role;

-- ── 2) save_wp_brief_draft — gate + upsert ──────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.save_wp_brief_draft('cc370000-0378-4000-8000-000000000101', 'x', null, null, null, null, null, null)$$,
  '42501', null,
  'site_admin (non-manager) cannot author a draft'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "cc000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.save_wp_brief_draft('cc370000-0378-4000-8000-000000000101', 'x', null, null, null, null, null, null)$$,
  '42501', null,
  'a project_manager who is not a project member is refused — can_see_wp collapses "not found" and "not a member" into one code, existence never leaked'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.save_wp_brief_draft('99999999-9999-4999-8999-999999999999', 'x', null, null, null, null, null, null)$$,
  '42501', null,
  'a bogus WP id gets the SAME code as "not a member" (indistinguishable to the caller)'
);
select throws_ok(
  $$select public.save_wp_brief_draft('cc370000-0378-4000-8000-000000000a01', 'x', null, null, null, null, null, null)$$,
  '23514', null,
  'a brief on a GROUP WP is rejected (the shared leaf-only guard fires through the RPC)'
);
select lives_ok(
  $$select public.save_wp_brief_draft('cc370000-0378-4000-8000-000000000101',
      'ผูกเหล็กฐานราก F1 ทั้งหมด', 'ไม่รวมงานฉาบ', '12 จุด', 'โซนหน้าอาคาร',
      'S-101', 'B', '{"sections":["scope","criteria"]}'::jsonb)$$,
  'a PD member authors a draft'
);
select ok(
  (select scope_included from public.wp_briefs
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') = 'ผูกเหล็กฐานราก F1 ทั้งหมด',
  'the draft persisted the given scope'
);
select lives_ok(
  $$select public.save_wp_brief_draft('cc370000-0378-4000-8000-000000000101',
      'ผูกเหล็กฐานราก F1 ทั้งหมด (แก้ไข)', null, null, null, null, null,
      '{"sections":["scope","criteria"]}'::jsonb)$$,
  'saving again UPSERTS — no duplicate draft (display_config kept non-null here so the later publish assertion has something to snapshot; scope_excluded etc still prove full-replace below)'
);
select ok(
  (select count(*) from public.wp_briefs
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') = 1,
  'exactly one draft row after two saves'
);
select ok(
  (select scope_excluded from public.wp_briefs
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') is null,
  'the second save REPLACED scope_excluded with the new (null) value — full replace, not merge'
);
reset role;

-- ── 3) criteria + slots CRUD ─────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000378"}';
select lives_ok(
  $$select public.add_wp_brief_criterion(
      (select id from public.wp_briefs where work_package_id = 'cc370000-0378-4000-8000-000000000101'),
      'เหล็กครบทุกจุดตามแบบ', null)$$,
  'a criterion is added, sort_order auto-assigned'
);
select lives_ok(
  $$select public.add_wp_brief_criterion(
      (select id from public.wp_briefs where work_package_id = 'cc370000-0378-4000-8000-000000000101'),
      'ระยะห่างเหล็กถูกต้อง', null)$$,
  'a second criterion auto-appends after the first'
);
select ok(
  (select array_agg(sort_order order by sort_order) from public.wp_brief_criteria
    where brief_id = (select id from public.wp_briefs where work_package_id = 'cc370000-0378-4000-8000-000000000101'))
    = array[1, 2],
  'auto sort_order is sequential (1, 2)'
);
select throws_ok(
  $$select public.add_wp_brief_criterion('99999999-9999-4999-8999-999999999999', 'x', null)$$,
  '42501', null,
  'adding a criterion to an unknown brief is refused'
);
select lives_ok(
  $$select public.update_wp_brief_criterion(
      (select id from public.wp_brief_criteria where body = 'เหล็กครบทุกจุดตามแบบ'),
      'เหล็กครบทุกจุดตามแบบ (ปรับปรุง)', 1)$$,
  'a criterion updates'
);
select throws_ok(
  $$select public.update_wp_brief_criterion(
      (select id from public.wp_brief_criteria where body like 'เหล็กครบ%'), 'x', null)$$,
  '22023', null,
  'a NULL sort_order is an explicit 22023, not a raw 23502 (075877 fix)'
);
select lives_ok(
  $$select public.add_wp_brief_evidence_slot(
      (select id from public.wp_briefs where work_package_id = 'cc370000-0378-4000-8000-000000000101'),
      'มุมกว้างเห็นทั้งฐาน',
      (select id from public.wp_brief_criteria where body like 'เหล็กครบ%'), null)$$,
  'an evidence slot maps to its own brief''s criterion'
);
select lives_ok(
  $$select public.add_wp_brief_evidence_slot(
      (select id from public.wp_briefs where work_package_id = 'cc370000-0378-4000-8000-000000000101'),
      'ภาพระยะใกล้', null, null)$$,
  'a bare (unmapped) evidence slot is allowed'
);
select ok(
  (select count(*) from public.wp_brief_evidence_slots
    where brief_id = (select id from public.wp_briefs where work_package_id = 'cc370000-0378-4000-8000-000000000101')) = 2,
  'two slots exist'
);
select lives_ok(
  $$select public.delete_wp_brief_criterion(
      (select id from public.wp_brief_criteria where body like 'ระยะห่าง%'))$$,
  'the second criterion (never mapped by a slot) deletes cleanly'
);
select throws_ok(
  $$select public.delete_wp_brief_criterion('99999999-9999-4999-8999-999999999999')$$,
  '42501', null,
  'deleting an unknown criterion is refused'
);
reset role;

-- ── 4) publish — the version row IS the event, numbered in-DB ───────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.publish_wp_brief('cc370000-0378-4000-8000-000000000102')$$,
  '22023', null,
  'publishing a WP with no draft at all is refused'
);
select lives_ok(
  $$select public.publish_wp_brief('cc370000-0378-4000-8000-000000000101')$$,
  'the drafted WP publishes'
);
reset role;
select ok(
  (select count(*) from public.wp_brief_versions
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') = 1,
  'exactly one version row landed'
);
select ok(
  (select published_by from public.wp_brief_versions
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') = 'bb000000-0000-4000-8000-000000000378',
  'the version is attributed to the publishing PD'
);
select ok(
  (select content -> 'criteria' from public.wp_brief_versions
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') is not null
  and jsonb_array_length(
    (select content -> 'criteria' from public.wp_brief_versions
      where work_package_id = 'cc370000-0378-4000-8000-000000000101')) = 1,
  'the snapshot carries the surviving criterion (1, after the delete above)'
);
select ok(
  jsonb_array_length(
    (select content -> 'evidence_slots' from public.wp_brief_versions
      where work_package_id = 'cc370000-0378-4000-8000-000000000101')) = 2,
  'the snapshot carries both evidence slots'
);
select ok(
  (select content -> 'display_config' -> 'sections' from public.wp_brief_versions
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') = '["scope","criteria"]'::jsonb,
  'the snapshot carries display_config'
);
select ok(
  (select content -> 'attachment_ids' from public.wp_brief_versions
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') = '[]'::jsonb,
  'the snapshot carries an attachment_ids key (empty — none attached yet; 075877 forward-compat with U4)'
);
-- editing the draft AFTER publish must never retro-alter the published snapshot
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000378"}';
select public.save_wp_brief_draft('cc370000-0378-4000-8000-000000000101',
  'แก้ไขหลังเผยแพร่', null, null, null, null, null, null);
reset role;
select ok(
  (select content ->> 'scope_included' from public.wp_brief_versions
    where work_package_id = 'cc370000-0378-4000-8000-000000000101') = 'ผูกเหล็กฐานราก F1 ทั้งหมด (แก้ไข)',
  'the PUBLISHED snapshot is frozen — a post-publish draft edit never leaks in'
);

-- ── 5) clone-from-previous-project ───────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "cc000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.clone_wp_briefs_from_project(
      'aa370000-0378-4000-8000-000000000001', 'aa370000-0378-4000-8000-000000000002')$$,
  '42501', null,
  'a project_manager with access to NEITHER project is refused'
);
reset role;
-- 075877 regression: the live-probed cross-project read. ee is a member of
-- the TARGET only — before the fix, clone checked only the target, so ee
-- could have cloned (and thereby read) confidential SOURCE briefs despite
-- can_see_project(source) being false. Must now refuse before copying
-- anything.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "ee000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.clone_wp_briefs_from_project(
      'aa370000-0378-4000-8000-000000000001', 'aa370000-0378-4000-8000-000000000002')$$,
  '42501', null,
  'a project_manager who is a member of the TARGET but NOT the source is refused (the 075876 exfiltration hole, closed)'
);
reset role;
-- and the mirror: dd is a member of the SOURCE only — the target gate must
-- still independently fire (proves the fix didn't just move the hole).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "dd000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.clone_wp_briefs_from_project(
      'aa370000-0378-4000-8000-000000000001', 'aa370000-0378-4000-8000-000000000002')$$,
  '42501', null,
  'a project_manager who is a member of the SOURCE but NOT the target is refused (the target gate still independently fires)'
);
reset role;
select ok(
  not exists (select 1 from public.wp_briefs
    where work_package_id in ('cc370000-0378-4000-8000-000000000201', 'cc370000-0378-4000-8000-000000000203')),
  'neither refused attempt copied ANY row into the target (throws_ok aborts the whole statement)'
);
-- give a target draft to the THIRD dst leaf so its clone is provably skipped
insert into public.wp_briefs (work_package_id, scope_included) values
  ('cc370000-0378-4000-8000-000000000203', 'ของเดิมที่มีอยู่แล้ว ห้ามทับ');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000378"}';
select throws_ok(
  $$select public.clone_wp_briefs_from_project(
      'aa370000-0378-4000-8000-000000000001', 'aa370000-0378-4000-8000-000000000001')$$,
  '22023', null,
  'source and destination must differ'
);
select is(
  (select public.clone_wp_briefs_from_project(
      'aa370000-0378-4000-8000-000000000001', 'aa370000-0378-4000-8000-000000000002'))::int,
  1,
  'exactly one WP cloned — one name match, one non-match, one pre-existing-skip'
);
reset role;
select ok(
  (select scope_included from public.wp_briefs
    where work_package_id = 'cc370000-0378-4000-8000-000000000201') = 'แก้ไขหลังเผยแพร่',
  'the matched target WP received the source''s CURRENT draft content'
);
select ok(
  (select sheet_code from public.wp_briefs
    where work_package_id = 'cc370000-0378-4000-8000-000000000201') is null
  and (select sheet_rev from public.wp_briefs
    where work_package_id = 'cc370000-0378-4000-8000-000000000201') is null,
  'sheet_code/sheet_rev are NOT carried across projects (they would cite the wrong drawing register)'
);
select ok(
  not exists (select 1 from public.wp_briefs
    where work_package_id = 'cc370000-0378-4000-8000-000000000202'),
  'the differently-named target leaf received nothing'
);
select ok(
  (select scope_included from public.wp_briefs
    where work_package_id = 'cc370000-0378-4000-8000-000000000203') = 'ของเดิมที่มีอยู่แล้ว ห้ามทับ',
  'the leaf that already had a draft was NOT clobbered'
);
select ok(
  (select count(*) from public.wp_brief_criteria
    where brief_id = (select id from public.wp_briefs
      where work_package_id = 'cc370000-0378-4000-8000-000000000201')) = 1,
  'the cloned brief carries the source''s surviving criterion'
);
select ok(
  exists (
    select 1 from public.wp_brief_evidence_slots s
    join public.wp_brief_criteria c on c.id = s.criterion_id
    where s.brief_id = (select id from public.wp_briefs
      where work_package_id = 'cc370000-0378-4000-8000-000000000201')
      and c.brief_id = s.brief_id
  ),
  'the cloned slot''s criterion_id was REMAPPED to the NEW brief''s own criterion (not the source''s)'
);

select * from finish();

rollback;
