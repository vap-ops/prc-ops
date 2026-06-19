begin;
select plan(18);

-- ============================================================================
-- Spec 146 U2 / ADR 0055 decisions 4/8 — equipment_project_allocations.
-- Pins: catalog/PK/RLS/zero-policy, the period CHECK, the zero authenticated
-- grant (money domain — no read/write), and create_equipment_project_allocation
-- (role gate pm/super/PROCUREMENT — site_admin AND visitor refused 42501,
-- procurement ALLOWED), P0001 guards (bad batch / bad project / end<start),
-- created_by pin, exactly one audit row, anon denied.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110246', 'pm@equipalloc.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220246', 'sa@equipalloc.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330246', 'vi@equipalloc.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440246', 'proc@equipalloc.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110246';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220246';
update public.users set role = 'procurement'     where id = '44444444-4444-4444-4444-444444440246';
-- third user stays visitor

-- FK targets, seeded as the table owner (RLS bypassed; the money batch table is
-- zero-grant so only the owner/definer can seed it here).
insert into public.equipment_owners (id, name, created_by) values
  ('b0000001-0000-4000-8000-000000000246', 'Sister Co Equipment',
   '11111111-1111-1111-1111-111111110246');
insert into public.equipment_rental_batches (id, owner_id, monthly_rate, starts_on, created_by) values
  ('e0000001-0000-4000-8000-000000000246', 'b0000001-0000-4000-8000-000000000246',
   50000, date '2026-07-01', '11111111-1111-1111-1111-111111110246');
insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000246', 'TAP-EQ-ALLOC', 'Equipment allocation fixture');

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_table('public', 'equipment_project_allocations',
  'equipment_project_allocations exists');
select col_is_pk('public', 'equipment_project_allocations', 'id',
  'equipment_project_allocations.id is the PK');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.equipment_project_allocations'::regclass),
  'RLS enabled on equipment_project_allocations');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'equipment_project_allocations'),
  0::bigint, 'equipment_project_allocations has no policies (zero grant — RPC/admin only)');

-- ============================================================================
-- B. CHECK invariant (run as table owner — RLS bypassed, the CHECK fires).
-- ============================================================================
select throws_ok(
  $$ insert into public.equipment_project_allocations
       (batch_id, project_id, starts_on, ends_on, created_by)
     values ('e0000001-0000-4000-8000-000000000246', 'cc000001-0000-4000-8000-000000000246',
             date '2026-07-01', date '2026-06-30', '11111111-1111-1111-1111-111111110246') $$,
  '23514', null, 'ends_on before starts_on is rejected');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- C. Zero grant (authenticated = site_admin): table unreadable/unwritable.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220246"}';

select throws_ok(
  $$ select project_id from public.equipment_project_allocations limit 1 $$,
  '42501', null, 'authenticated cannot read equipment_project_allocations (zero grant)');
select throws_ok(
  $$ insert into public.equipment_project_allocations
       (batch_id, project_id, starts_on, created_by)
     values ('e0000001-0000-4000-8000-000000000246', 'cc000001-0000-4000-8000-000000000246',
             date '2026-07-01', '22222222-2222-2222-2222-222222220246') $$,
  '42501', null, 'authenticated cannot INSERT equipment_project_allocations directly');

-- ============================================================================
-- D. RPC role gate: site_admin AND visitor refused (money).
-- ============================================================================
select throws_ok(
  $$ select public.create_equipment_project_allocation(
       'e0000001-0000-4000-8000-000000000246', 'cc000001-0000-4000-8000-000000000246', date '2026-07-01') $$,
  '42501', null, 'create_equipment_project_allocation refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330246"}';
select throws_ok(
  $$ select public.create_equipment_project_allocation(
       'e0000001-0000-4000-8000-000000000246', 'cc000001-0000-4000-8000-000000000246', date '2026-07-01') $$,
  '42501', null, 'create_equipment_project_allocation refuses visitor');

-- ============================================================================
-- E. Happy path + guards (project_manager).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110246"}';
select lives_ok(
  $$ select public.create_equipment_project_allocation(
       'e0000001-0000-4000-8000-000000000246', 'cc000001-0000-4000-8000-000000000246', date '2026-07-01') $$,
  'project_manager commits a batch to a project');
select throws_ok(
  $$ select public.create_equipment_project_allocation(
       'e0000099-0000-4000-8000-000000000099', 'cc000001-0000-4000-8000-000000000246', date '2026-07-01') $$,
  'P0001', null, 'refuses a non-existent batch');
select throws_ok(
  $$ select public.create_equipment_project_allocation(
       'e0000001-0000-4000-8000-000000000246', 'cc000099-0000-4000-8000-000000000099', date '2026-07-01') $$,
  'P0001', null, 'refuses a non-existent project');
select throws_ok(
  $$ select public.create_equipment_project_allocation(
       'e0000001-0000-4000-8000-000000000246', 'cc000001-0000-4000-8000-000000000246', date '2026-07-01', date '2026-06-30') $$,
  'P0001', null, 'refuses ends_on before starts_on');

-- ============================================================================
-- F. Procurement ALLOWED (equipment back office, ADR 0055 decision 6).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440246"}';
select lives_ok(
  $$ select public.create_equipment_project_allocation(
       'e0000001-0000-4000-8000-000000000246', 'cc000001-0000-4000-8000-000000000246', date '2026-08-01') $$,
  'procurement commits a batch to a project');

-- ============================================================================
-- G. Effects + audit (reset to owner to read past the zero-grant posture).
-- ============================================================================
reset role;
select is(
  (select count(*) from public.audit_log where action = 'equipment_allocation_create'),
  2::bigint, 'two equipment_allocation_create audit rows (pm + procurement)');
select is(
  (select count(*) from public.equipment_project_allocations
    where created_by = '11111111-1111-1111-1111-111111110246'),
  1::bigint, 'created_by pinned to the PM caller on the PM allocation');
select is(
  (select count(*) from public.equipment_project_allocations
    where created_by = '44444444-4444-4444-4444-444444440246'),
  1::bigint, 'created_by pinned to the procurement caller on its allocation');

-- ============================================================================
-- H. Anon denied entirely.
-- ============================================================================
set local role anon;
select throws_ok(
  $$ select id from public.equipment_project_allocations limit 1 $$,
  '42501', null, 'anon cannot read equipment_project_allocations');

reset role;
select * from finish();
rollback;
