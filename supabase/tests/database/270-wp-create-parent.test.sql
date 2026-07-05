begin;
select plan(14);

-- ============================================================================
-- Spec 270 U4 — create_work_package gains a trailing p_parent_id (default null).
--   The U6 forward guard (mig 072500) rejects a parentless งานย่อย INSERT in a
--   project that already has งาน rows — so the creation RPC must be able to
--   carry the parent through. Validation of the parent itself (same-project,
--   is_group, depth) stays in wp_hierarchy_guard; the RPC only passes it.
--   Old 4-arg overload is DROPPED (single canonical signature).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Catalog: one overload, the 5-arg signature, definer, grants.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_work_package'),
  1, 'exactly one create_work_package overload (old 4-arg dropped)');

select has_function('public', 'create_work_package',
  array['uuid','text','text','text','uuid'],
  'create_work_package(uuid, text, text, text, uuid) exists');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_work_package'),
  true, 'create_work_package is SECURITY DEFINER');

select is(
  has_function_privilege('anon',
    'public.create_work_package(uuid, text, text, text, uuid)', 'execute'),
  false, 'anon cannot execute create_work_package');

select is(
  has_function_privilege('authenticated',
    'public.create_work_package(uuid, text, text, text, uuid)', 'execute'),
  true, 'authenticated can execute create_work_package');

-- ---------------------------------------------------------------------------
-- Fixtures: a manager + a site_admin; P1 legacy (no groups), P2 adopted
-- (has a งาน) + one leaf in P2 to try as an (illegal) parent.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110272', 'super@cwp-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220272', 'sa@cwp-test.local', '{}'::jsonb);
update public.users set role='super_admin' where id='11111111-1111-1111-1111-111111110272';
update public.users set role='site_admin'  where id='22222222-2222-2222-2222-222222220272';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10272-0272-0272-0272-a1a1a1a10272', 'PRC-272-P1', 'โครงการเก่าแบบแบน',
   '11111111-1111-1111-1111-111111110272'),
  ('a2a20272-0272-0272-0272-a2a2a2a20272', 'PRC-272-P2', 'โครงการจัดกลุ่มแล้ว',
   '11111111-1111-1111-1111-111111110272');

insert into public.work_packages (id, project_id, code, name, is_group) values
  ('91910272-0272-0272-0272-919191910272', 'a2a20272-0272-0272-0272-a2a2a2a20272',
   'WP-01', 'งานกลุ่ม', true);
insert into public.work_packages (id, project_id, code, name, parent_id) values
  ('c1c10272-0272-0272-0272-c1c1c1c10272', 'a2a20272-0272-0272-0272-a2a2a2a20272',
   'WP-01-01', 'งานย่อยเดิม', '91910272-0272-0272-0272-919191910272');

-- The runner rewrites assertion selects into _tap_buf; the role-switched
-- sections below need these grants (same as 69-create-work-package).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ---------------------------------------------------------------------------
-- B. Role gate unchanged (site_admin rejected).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220272"}';
select throws_ok($$
  select public.create_work_package('a1a10272-0272-0272-0272-a1a1a1a10272'::uuid,
    'WP-X1', 'งานทดสอบ') $$,
  '42501', null, 'site_admin is rejected (role gate unchanged)');

-- ---------------------------------------------------------------------------
-- C. Legacy flat project: parentless creation still works (default null).
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110272"}';
select lives_ok($$
  select public.create_work_package('a1a10272-0272-0272-0272-a1a1a1a10272'::uuid,
    'WP-L1', 'งานในโครงการเก่า') $$,
  'legacy project: parentless create still works');
select is(
  (select parent_id from public.work_packages
    where project_id = 'a1a10272-0272-0272-0272-a1a1a1a10272' and code = 'WP-L1'),
  null::uuid, 'legacy create lands parentless');

-- ---------------------------------------------------------------------------
-- D. Adopted project: parentless rejected; with-parent works; parent validated.
-- ---------------------------------------------------------------------------
select throws_ok($$
  select public.create_work_package('a2a20272-0272-0272-0272-a2a2a2a20272'::uuid,
    'WP-A1', 'งานย่อยไร้กลุ่ม') $$,
  '23514', null, 'adopted project: parentless create rejected (U6 forward guard)');

select lives_ok($$
  select public.create_work_package('a2a20272-0272-0272-0272-a2a2a2a20272'::uuid,
    'WP-01-02', 'งานย่อยใหม่ใต้กลุ่ม', null,
    '91910272-0272-0272-0272-919191910272'::uuid) $$,
  'adopted project: create with a งาน parent succeeds');
select is(
  (select parent_id from public.work_packages
    where project_id = 'a2a20272-0272-0272-0272-a2a2a2a20272' and code = 'WP-01-02'),
  '91910272-0272-0272-0272-919191910272'::uuid, 'new งานย่อย carries the picked parent');
select is(
  (select is_group from public.work_packages
    where project_id = 'a2a20272-0272-0272-0272-a2a2a2a20272' and code = 'WP-01-02'),
  false, 'new งานย่อย is a leaf');

select throws_ok($$
  select public.create_work_package('a2a20272-0272-0272-0272-a2a2a2a20272'::uuid,
    'WP-A2', 'ใต้งานย่อย', null, 'c1c10272-0272-0272-0272-c1c1c1c10272'::uuid) $$,
  '23514', null, 'a งานย่อย cannot be the parent (guard validates)');

select throws_ok($$
  select public.create_work_package('a1a10272-0272-0272-0272-a1a1a1a10272'::uuid,
    'WP-A3', 'พ่อต่างโครงการ', null, '91910272-0272-0272-0272-919191910272'::uuid) $$,
  '23514', null, 'a cross-project parent is rejected (guard validates)');

select * from finish();
rollback;
