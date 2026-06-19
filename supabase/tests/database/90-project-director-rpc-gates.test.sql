begin;
select plan(5);

-- ============================================================================
-- Spec 152 U2 / ADR 0058 — project_director RPC action gates.
--
-- U1 gave project_director see-all visibility; U2 adds it to every SECURITY
-- DEFINER RPC gate that already admits project_manager, so a director can
-- perform every PM action across all projects. Proven two ways:
--   1. Completeness (catalog): NO PM-gated RPC is left without project_director
--      (the single assertion that covers all 55 functions at once).
--   2. Behaviour: a project_director passes representative gates (projects /
--      work_packages / the 3-role notes gate); a visitor is still denied
--      (the gate didn't fall open to everyone).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1', 'director@pd2-test.local', '{}'::jsonb),
  ('f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2', 'visitor@pd2-test.local',  '{}'::jsonb);

update public.users set role='project_director' where id='f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';
-- 'f2f2…' stays visitor (default).

-- Fixtures for the behavioural calls (director has see-all, so no membership row).
insert into public.projects (id, code, name, project_lead_id) values
  ('faaaaaaa-1111-1111-1111-111111111111', 'PRC-PD2-FIX', 'โครงการยู2', null);
insert into public.work_packages (id, project_id, code, name) values
  ('fbbbbbbb-2222-2222-2222-222222222222',
   'faaaaaaa-1111-1111-1111-111111111111', 'WP-U2', 'งานยู2');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- 1. Completeness — every PM-gated RPC also admits project_director.
--    (can_see_project's membership branch lists project_manager but is not a
--    gate — director passes via the see-all branch, U1 — so it is excluded.)
-- ============================================================================
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname <> 'can_see_project'
      and pg_get_functiondef(p.oid) ilike '%''project_manager''%'
      and pg_get_functiondef(p.oid) not ilike '%''project_director''%'),
  0,
  'no PM-gated RPC is left without project_director');

set local role authenticated;

-- ============================================================================
-- 2-4. project_director passes representative gates.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1"}';

select lives_ok(
  $$ select public.create_project('PRC-PD2-NEW', 'โครงการใหม่ยู2') $$,
  'director may create_project (projects 2-role gate)');

select lives_ok(
  $$ select public.create_work_package(
       'faaaaaaa-1111-1111-1111-111111111111', 'WP-NEW', 'งานใหม่') $$,
  'director may create_work_package (see-all + WP gate)');

select lives_ok(
  $$ select public.set_work_package_notes(
       'fbbbbbbb-2222-2222-2222-222222222222', 'หมายเหตุ') $$,
  'director may set_work_package_notes (3-role site_admin gate)');

-- ============================================================================
-- 5. Negative control — a visitor is still blocked (gate did not fall open).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2"}';

select throws_ok(
  $$ select public.create_project('PRC-PD2-DENY', 'ห้าม') $$,
  '42501',
  null,
  'visitor is still denied create_project');

reset role;

select * from finish();
rollback;
