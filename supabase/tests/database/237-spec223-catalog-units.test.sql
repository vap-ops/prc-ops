begin;
select plan(42);

-- ============================================================================
-- Spec 223 — Units SSOT (ADR 0066 / S1). The unit-picker vocabulary moves from a
-- TS constant (src/lib/purchasing/units.ts COMMON_UNITS) into a managed firm-wide
-- table public.catalog_units, carrying a unit_class facet. Reads = grant select to
-- authenticated (firm-wide vocabulary, like catalog_categories); writes go ONLY
-- through SECURITY DEFINER RPCs create/update_catalog_unit + set_catalog_unit_active
-- (null-safe role gate → 42501; dup code → 23505; bad arg → 22023). Seeded from the
-- 25 COMMON_UNITS, each classed. No DELETE (deactivate-not-delete via is_active).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333223', 'pm@unit223.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444223', 'visitor@unit223.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333223';
-- the visitor user keeps the default 'visitor' role from the auth.users trigger.

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure --------------------------------------------------------------
select has_table('public', 'catalog_units', 'catalog_units table exists');
select has_column('public', 'catalog_units', 'code', 'has code');
select has_column('public', 'catalog_units', 'display_name', 'has display_name');
select has_column('public', 'catalog_units', 'abbr_short', 'has abbr_short');
select has_column('public', 'catalog_units', 'unit_class', 'has unit_class');
select has_column('public', 'catalog_units', 'sort_order', 'has sort_order');
select has_column('public', 'catalog_units', 'is_active', 'has is_active');
select has_column('public', 'catalog_units', 'created_by', 'has created_by');
select has_column('public', 'catalog_units', 'created_at', 'has created_at');
select has_column('public', 'catalog_units', 'updated_at', 'has updated_at');
select ok(
  (select relrowsecurity from pg_class where oid='public.catalog_units'::regclass),
  'RLS enabled on catalog_units');
select ok(
  has_table_privilege('authenticated', 'public.catalog_units', 'select'),
  'authenticated may SELECT catalog_units');
select ok(
  not has_table_privilege('anon', 'public.catalog_units', 'select'),
  'anon may NOT SELECT catalog_units');
select ok(
  not has_table_privilege('authenticated', 'public.catalog_units', 'delete'),
  'authenticated may NOT DELETE catalog_units (deactivate-not-delete)');

-- B. unit_class enum --------------------------------------------------------
select has_type('public', 'unit_class', 'unit_class enum type exists');

-- C. Seed (25 COMMON_UNITS, classed; code = the stored Thai string) ----------
select is(
  (select count(*)::int from public.catalog_units), 25, 'seeded the 25 COMMON_UNITS');
select is(
  (select unit_class::text from public.catalog_units where code='เมตร'),
  'length', 'เมตร classed as length');
select is(
  (select unit_class::text from public.catalog_units where code='ตารางเมตร'),
  'area', 'ตารางเมตร classed as area');
select is(
  (select unit_class::text from public.catalog_units where code='เที่ยว'),
  'trips', 'เที่ยว classed as trips');
select is(
  (select unit_class::text from public.catalog_units where code='กิโลกรัม'),
  'weight', 'กิโลกรัม classed as weight');
select is(
  (select unit_class::text from public.catalog_units where code='ถุง'),
  'count', 'ถุง classed as count');
select is(
  (select unit_class::text from public.catalog_units where code='ลิตร'),
  'volume', 'ลิตร classed as volume');

-- D. RPC posture — security definer + anon revoked + authenticated execute ---
select is(
  (select prosecdef from pg_proc
     where oid='public.create_catalog_unit(text,text,text,public.unit_class,integer)'::regprocedure),
  true, 'create_catalog_unit is SECURITY DEFINER');
select is(
  (select prosecdef from pg_proc
     where oid='public.update_catalog_unit(text,text,text,public.unit_class,integer)'::regprocedure),
  true, 'update_catalog_unit is SECURITY DEFINER');
select is(
  (select prosecdef from pg_proc
     where oid='public.set_catalog_unit_active(text,boolean)'::regprocedure),
  true, 'set_catalog_unit_active is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon',
    'public.create_catalog_unit(text,text,text,public.unit_class,integer)', 'execute'),
  'anon may NOT execute create_catalog_unit');
select ok(
  not has_function_privilege('anon',
    'public.update_catalog_unit(text,text,text,public.unit_class,integer)', 'execute'),
  'anon may NOT execute update_catalog_unit');
select ok(
  not has_function_privilege('anon',
    'public.set_catalog_unit_active(text,boolean)', 'execute'),
  'anon may NOT execute set_catalog_unit_active');
select ok(
  has_function_privilege('authenticated',
    'public.create_catalog_unit(text,text,text,public.unit_class,integer)', 'execute'),
  'authenticated may execute create_catalog_unit');
select ok(
  has_function_privilege('authenticated',
    'public.update_catalog_unit(text,text,text,public.unit_class,integer)', 'execute'),
  'authenticated may execute update_catalog_unit');
select ok(
  has_function_privilege('authenticated',
    'public.set_catalog_unit_active(text,boolean)', 'execute'),
  'authenticated may execute set_catalog_unit_active');

-- E. Behaviour as a back-office user (project_manager) -----------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333223"}';

select lives_ok(
  $$ select public.create_catalog_unit('TESTUNIT', 'หน่วยทดสอบ', null::text, 'count'::public.unit_class, 0) $$,
  'create_catalog_unit adds a new unit');
select throws_ok(
  $$ select public.create_catalog_unit('TESTUNIT', 'ซ้ำ', null::text, 'count'::public.unit_class, 0) $$,
  '23505', null, 'a duplicate unit code is rejected (23505)');
select throws_ok(
  $$ select public.create_catalog_unit('TESTUNIT2', '   ', null::text, 'count'::public.unit_class, 0) $$,
  '22023', null, 'a blank display_name is rejected (22023)');
select throws_ok(
  $$ select public.create_catalog_unit('   ', 'ชื่อ', null::text, 'count'::public.unit_class, 0) $$,
  '22023', null, 'a blank code is rejected (22023)');
select lives_ok(
  $$ select public.update_catalog_unit('TESTUNIT', 'หน่วยแก้ไข', 'ทบ', 'weight'::public.unit_class, 5) $$,
  'update_catalog_unit renames + reclasses the unit');
select is(
  (select display_name from public.catalog_units where code='TESTUNIT'),
  'หน่วยแก้ไข', 'the update applied the new display_name');
select throws_ok(
  $$ select public.update_catalog_unit('NOPE', 'x', null::text, 'count'::public.unit_class, 0) $$,
  '22023', null, 'updating an unknown code is rejected (22023)');
select lives_ok(
  $$ select public.set_catalog_unit_active('TESTUNIT', false) $$,
  'set_catalog_unit_active deactivates the unit');
select is(
  (select is_active from public.catalog_units where code='TESTUNIT'),
  false, 'the unit is now inactive (deactivate-not-delete)');

-- F. Role gate denial (null-safe: unknown sub → null role → 42501) -----------
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555223"}';
select throws_ok(
  $$ select public.create_catalog_unit('DENYNULL', 'x', null::text, 'count'::public.unit_class, 0) $$,
  '42501', null, 'a null/unbound role cannot create a unit (null-safe gate)');

set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444223"}';
select throws_ok(
  $$ select public.create_catalog_unit('DENYVIS', 'x', null::text, 'count'::public.unit_class, 0) $$,
  '42501', null, 'a disallowed role (visitor) cannot create a unit');

reset role;
select * from finish();
rollback;
