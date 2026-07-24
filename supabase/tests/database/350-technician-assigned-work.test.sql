begin;
select plan(17);

-- ============================================================================
-- Spec 350 U1 — get_my_assigned_work(): a bound worker (technician) reads the
-- work packages of their MOST-RECENT muster team, each with the fields to render
-- status + parent-งาน progress. Self-scoped via workers.user_id = auth.uid()
-- (DEFINER — the muster tables are can_see_project-scoped, which a technician
-- fails). Read-only. Money-free. group_child_statuses carries the relevant งาน's
-- children (group row → its own; leaf row → its parent's) for the TS % rollup.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('74000000-0350-0350-0350-000000000001', 'techA@s350.local', '{}'::jsonb),
  ('74000000-0350-0350-0350-000000000002', 'techB@s350.local', '{}'::jsonb),
  ('72000000-0350-0350-0350-000000000003', 'unbound@s350.local', '{}'::jsonb),
  ('70000000-0350-0350-0350-000000000009', 'super@s350.local', '{}'::jsonb);
update public.users set role = 'technician'  where id = '74000000-0350-0350-0350-000000000001';
update public.users set role = 'technician'  where id = '74000000-0350-0350-0350-000000000002';
update public.users set role = 'super_admin' where id = '70000000-0350-0350-0350-000000000009';
-- 72.. stays visitor (unbound — no workers row).

-- Workers: A bound to techA, B bound to techB, plus a lead for the teams.
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, user_id) values
  ('e1000000-0350-0350-0350-000000000001', 'ช่าง เอ', 'daily', 'temporary', 400, true,
   '70000000-0350-0350-0350-000000000009', '74000000-0350-0350-0350-000000000001'),
  ('e2000000-0350-0350-0350-000000000002', 'ช่าง บี', 'daily', 'temporary', 400, true,
   '70000000-0350-0350-0350-000000000009', '74000000-0350-0350-0350-000000000002'),
  ('e9000000-0350-0350-0350-000000000009', 'หัวหน้า', 'daily', 'temporary', 400, true,
   '70000000-0350-0350-0350-000000000009', null);

insert into public.projects (id, code, name) values
  ('a1000000-0350-0350-0350-000000000001', 'TAP-350', 'โครงการทดสอบงานที่ได้รับมอบหมาย');

-- A GROUPED project: main WPs are the งาน groups; every leaf carries a parent.
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('91000000-0350-0350-0350-000000000001', 'a1000000-0350-0350-0350-000000000001', 'S350-G1', 'งานกลุ่มหนึ่ง', true),
  ('92000000-0350-0350-0350-000000000002', 'a1000000-0350-0350-0350-000000000001', 'S350-G2', 'งานกลุ่มสอง', true),
  ('93000000-0350-0350-0350-000000000003', 'a1000000-0350-0350-0350-000000000001', 'S350-G3', 'งานกลุ่มสาม', true),
  ('9b000000-0350-0350-0350-00000000000b', 'a1000000-0350-0350-0350-000000000001', 'S350-GB', 'งานกลุ่มบี', true),
  ('90000000-0350-0350-0350-000000000000', 'a1000000-0350-0350-0350-000000000001', 'S350-G0', 'งานกลุ่มว่าง (ไม่มีลูก)', true);
-- G1 children: 2 complete + 1 in_progress → 67%. G2 children: 1 not_started + 1 complete → 50%.
insert into public.work_packages (id, project_id, code, name, parent_id, status) values
  ('c1000000-0350-0350-0350-000000000001', 'a1000000-0350-0350-0350-000000000001', 'S350-C1', 'ย่อย C1', '91000000-0350-0350-0350-000000000001', 'complete'),
  ('c2000000-0350-0350-0350-000000000002', 'a1000000-0350-0350-0350-000000000001', 'S350-C2', 'ย่อย C2', '91000000-0350-0350-0350-000000000001', 'complete'),
  ('c3000000-0350-0350-0350-000000000003', 'a1000000-0350-0350-0350-000000000001', 'S350-C3', 'ย่อย C3', '91000000-0350-0350-0350-000000000001', 'in_progress'),
  ('b1000000-0350-0350-0350-000000000001', 'a1000000-0350-0350-0350-000000000001', 'S350-L1', 'ย่อย L1', '92000000-0350-0350-0350-000000000002', 'not_started'),
  ('b2000000-0350-0350-0350-000000000002', 'a1000000-0350-0350-0350-000000000001', 'S350-L2', 'ย่อย L2', '92000000-0350-0350-0350-000000000002', 'complete'),
  ('c4000000-0350-0350-0350-000000000004', 'a1000000-0350-0350-0350-000000000001', 'S350-C4', 'ย่อย C4', '93000000-0350-0350-0350-000000000003', 'complete'),
  ('cb000000-0350-0350-0350-00000000000b', 'a1000000-0350-0350-0350-000000000001', 'S350-CB', 'ย่อย CB', '9b000000-0350-0350-0350-00000000000b', 'complete');

-- Muster teams (direct — testing the READ, not the scan RPCs). A on T1 (07-20)
-- assigned {G1, L1-override}; later A on T2 (07-22) assigned {G3}; B on TB (07-21) {GB}.
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('71000000-0350-0350-0350-0000000000a1', 'a1000000-0350-0350-0350-000000000001', '2026-07-20', 'e9000000-0350-0350-0350-000000000009', '70000000-0350-0350-0350-000000000009'),
  ('72000000-0350-0350-0350-0000000000a2', 'a1000000-0350-0350-0350-000000000001', '2026-07-22', 'e9000000-0350-0350-0350-000000000009', '70000000-0350-0350-0350-000000000009'),
  ('7b000000-0350-0350-0350-0000000000ab', 'a1000000-0350-0350-0350-000000000001', '2026-07-21', 'e9000000-0350-0350-0350-000000000009', '70000000-0350-0350-0350-000000000009');
insert into public.muster_team_wps (team_id, work_package_id) values
  ('71000000-0350-0350-0350-0000000000a1', '91000000-0350-0350-0350-000000000001'),
  ('71000000-0350-0350-0350-0000000000a1', 'b1000000-0350-0350-0350-000000000001'),
  ('71000000-0350-0350-0350-0000000000a1', '90000000-0350-0350-0350-000000000000'),
  ('72000000-0350-0350-0350-0000000000a2', '93000000-0350-0350-0350-000000000003'),
  ('7b000000-0350-0350-0350-0000000000ab', '9b000000-0350-0350-0350-00000000000b');
insert into public.muster_attendance (team_id, worker_id, work_date, in_method, scanned_by) values
  ('71000000-0350-0350-0350-0000000000a1', 'e1000000-0350-0350-0350-000000000001', '2026-07-20', 'manual', '70000000-0350-0350-0350-000000000009'),
  ('7b000000-0350-0350-0350-0000000000ab', 'e2000000-0350-0350-0350-000000000002', '2026-07-21', 'manual', '70000000-0350-0350-0350-000000000009');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + grants.
-- ============================================================================
select has_function('public', 'get_my_assigned_work', 'get_my_assigned_work exists');
select ok(not has_function_privilege('anon', 'public.get_my_assigned_work()', 'execute'),
  'anon cannot execute get_my_assigned_work');
select ok(has_function_privilege('authenticated', 'public.get_my_assigned_work()', 'execute'),
  'authenticated can execute get_my_assigned_work');
select ok(not has_function_privilege('public', 'public.get_my_assigned_work()', 'execute'),
  'PUBLIC (default) cannot execute — revoke all from public held (anon-leak guard)');

-- ============================================================================
-- B. Technician A reads their latest team (T1, 07-20) — 2 WPs, status + progress.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "74000000-0350-0350-0350-000000000001"}';
select is((select count(*)::int from public.get_my_assigned_work()),
  3, 'tech A sees all assigned WPs of their latest team (G1, L1, G0)');
select is((select work_date::text from public.get_my_assigned_work() limit 1),
  '2026-07-20', 'work_date = the team''s date');
select is((select is_group from public.get_my_assigned_work() where code = 'S350-G1'),
  true, 'the G1 row is a group');
select is(
  (select array_agg(s order by s::text)
     from public.get_my_assigned_work() g, unnest(g.group_child_statuses) s
    where g.code = 'S350-G1'),
  array['complete','complete','in_progress']::public.work_package_status[],
  'G1 (group) carries its 3 children''s statuses');
select is((select parent_code from public.get_my_assigned_work() where code = 'S350-L1'),
  'S350-G2', 'L1 (leaf override) parent_code = its งาน G2');
select is((select parent_name from public.get_my_assigned_work() where code = 'S350-L1'),
  'งานกลุ่มสอง', 'L1 parent_name = G2 name');
select is(
  (select array_agg(s order by s::text)
     from public.get_my_assigned_work() g, unnest(g.group_child_statuses) s
    where g.code = 'S350-L1'),
  array['complete','not_started']::public.work_package_status[],
  'L1 (leaf) carries its parent G2''s children statuses (for the parent %)');
select is(
  (select group_child_statuses from public.get_my_assigned_work() where code = 'S350-G0'),
  '{}'::public.work_package_status[],
  'a childless งาน coalesces group_child_statuses to an empty array');
reset role;

-- ============================================================================
-- C. Adding a later team (T2, 07-22) flips "most recent" — only its WP shows.
-- ============================================================================
insert into public.muster_attendance (team_id, worker_id, work_date, in_method, scanned_by) values
  ('72000000-0350-0350-0350-0000000000a2', 'e1000000-0350-0350-0350-000000000001', '2026-07-22', 'manual', '70000000-0350-0350-0350-000000000009');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "74000000-0350-0350-0350-000000000001"}';
select is((select count(*)::int from public.get_my_assigned_work()),
  1, 'the later team (07-22) replaces — only its 1 WP');
select is((select code from public.get_my_assigned_work() limit 1),
  'S350-G3', 'the single WP is the latest team''s');
select is((select work_date::text from public.get_my_assigned_work() limit 1),
  '2026-07-22', 'work_date = the later team''s date');
select is((select count(*)::int from public.get_my_assigned_work() where code = 'S350-GB'),
  0, 'A never sees another worker''s (B''s) team WP — self-scoped, no leak');
reset role;

-- ============================================================================
-- D. An unbound caller (no workers row) sees nothing.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0350-0350-0350-000000000003"}';
select is((select count(*)::int from public.get_my_assigned_work()),
  0, 'an unbound caller reads zero rows');
reset role;

select * from finish();
rollback;
