begin;
select plan(45);

-- ============================================================================
-- Spec 238 — Assemblies (ADR 0066 / S10-U3, decision D7). A catalog_item with
-- kind='assembly' (enum value added in migration 041000) + an OPTIONAL bill of
-- materials catalog_assembly_components(assembly_id, component_item_id, qty_per,
-- waste_factor). D5: explode is COMPUTED-ON-READ via explode_assembly(id, qty)
-- (no persisted explosion rows), single-level for v1. Posture = ADR 0066 D8:
-- grant SELECT to authenticated, no direct write/delete grant, writes via
-- null-safe SECURITY DEFINER RPCs gated pm/super/procurement/director.
--
-- Fixtures reference EXISTING catalog_items (the live catalog) to avoid the
-- insert-shape coupling: as table owner we flag the first active item as the
-- assembly; two other active items are its components. All rolled back.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333238', 'pm@asm238.local',   '{}'::jsonb),
  ('77777777-7777-7777-7777-777777777238', 'proc@asm238.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444238', 'vis@asm238.local',  '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333238';
update public.users set role='procurement'     where id='77777777-7777-7777-7777-777777777238';
-- visitor keeps default; sub 55…5238 is NEVER inserted → null role.

-- Flag the first active catalog item as the assembly (owner-side, pre set-role).
update public.catalog_items set kind='assembly'
 where id = (select id from public.catalog_items where is_active order by created_at, id limit 1);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. enum label -------------------------------------------------------------
select ok(
  exists (select 1 from pg_enum where enumtypid='public.catalog_item_kind'::regtype and enumlabel='assembly'),
  'catalog_item_kind enum gained the assembly label');

-- B. table structure --------------------------------------------------------
select has_table('public', 'catalog_assembly_components', 'catalog_assembly_components table exists');
select has_column('public', 'catalog_assembly_components', 'id', 'has id');
select has_column('public', 'catalog_assembly_components', 'assembly_id', 'has assembly_id');
select has_column('public', 'catalog_assembly_components', 'component_item_id', 'has component_item_id');
select has_column('public', 'catalog_assembly_components', 'qty_per', 'has qty_per');
select has_column('public', 'catalog_assembly_components', 'waste_factor', 'has waste_factor');
select has_column('public', 'catalog_assembly_components', 'created_by', 'has created_by');
select has_column('public', 'catalog_assembly_components', 'created_at', 'has created_at');
select ok((select relrowsecurity from pg_class where oid='public.catalog_assembly_components'::regclass),
  'RLS enabled on catalog_assembly_components');
select ok(has_table_privilege('authenticated', 'public.catalog_assembly_components', 'select'),
  'authenticated may SELECT catalog_assembly_components');
select ok(not has_table_privilege('anon', 'public.catalog_assembly_components', 'select'),
  'anon may NOT SELECT catalog_assembly_components');
select ok(not has_table_privilege('authenticated', 'public.catalog_assembly_components', 'delete'),
  'authenticated may NOT DELETE catalog_assembly_components (RPC-sole-writer)');
select fk_ok('public', 'catalog_assembly_components', 'assembly_id', 'public', 'catalog_items', 'id');
select fk_ok('public', 'catalog_assembly_components', 'component_item_id', 'public', 'catalog_items', 'id');

-- C. RPC posture ------------------------------------------------------------
select is((select prosecdef from pg_proc
  where oid='public.add_assembly_component(uuid,uuid,numeric,numeric)'::regprocedure),
  true, 'add_assembly_component is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.add_assembly_component(uuid,uuid,numeric,numeric)', 'execute'),
  'anon may NOT execute add_assembly_component');
select ok(has_function_privilege('authenticated',
  'public.add_assembly_component(uuid,uuid,numeric,numeric)', 'execute'),
  'authenticated may execute add_assembly_component');

select is((select prosecdef from pg_proc
  where oid='public.update_assembly_component(uuid,numeric,numeric)'::regprocedure),
  true, 'update_assembly_component is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.update_assembly_component(uuid,numeric,numeric)', 'execute'),
  'anon may NOT execute update_assembly_component');
select ok(has_function_privilege('authenticated',
  'public.update_assembly_component(uuid,numeric,numeric)', 'execute'),
  'authenticated may execute update_assembly_component');

select is((select prosecdef from pg_proc
  where oid='public.remove_assembly_component(uuid)'::regprocedure),
  true, 'remove_assembly_component is SECURITY DEFINER');
select ok(not has_function_privilege('anon',
  'public.remove_assembly_component(uuid)', 'execute'),
  'anon may NOT execute remove_assembly_component');
select ok(has_function_privilege('authenticated',
  'public.remove_assembly_component(uuid)', 'execute'),
  'authenticated may execute remove_assembly_component');

-- D. explode function -------------------------------------------------------
select has_function('public', 'explode_assembly', ARRAY['uuid', 'numeric'],
  'explode_assembly(uuid, numeric) exists');
select ok(has_function_privilege('authenticated',
  'public.explode_assembly(uuid,numeric)', 'execute'),
  'authenticated may execute explode_assembly');

-- E. behaviour as a back-office PM ------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333238"}';

-- add a component (qty_per 3, waste 0.1) to the assembly
select lives_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1),
       3, 0.1) $$,
  'add_assembly_component adds a BOM line');

-- explode: effective_qty = qty_per * (1+waste) * p_qty = 3 * 1.1 * 2 = 6.6
select is(
  (select effective_qty from public.explode_assembly(
     (select id from public.catalog_items where kind='assembly' limit 1), 2)),
  6.6::numeric, 'explode effective_qty = qty_per*(1+waste)*qty (3*1.1*2=6.6)');
select is(
  (select qty_per from public.explode_assembly(
     (select id from public.catalog_items where kind='assembly' limit 1), 2)),
  3::numeric, 'explode returns the stored qty_per');

-- duplicate (assembly, component) → 23505
select throws_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1),
       1, 0) $$,
  '23505', null, 'a duplicate (assembly, component) is rejected (23505)');

-- parent that is NOT an assembly → 22023
select throws_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1),
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1 offset 1),
       1, 0) $$,
  '22023', null, 'attaching a BOM to a non-assembly parent is rejected (22023)');

-- self-reference → 22023
select throws_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       (select id from public.catalog_items where kind='assembly' limit 1),
       1, 0) $$,
  '22023', null, 'a self-referencing component is rejected (22023)');

-- unknown component → 22023
select throws_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       '00000000-0000-0000-0000-0000000000c2'::uuid, 1, 0) $$,
  '22023', null, 'an unknown component item is rejected (22023)');

-- unknown assembly → 22023
select throws_ok(
  $$ select public.add_assembly_component(
       '00000000-0000-0000-0000-0000000000c3'::uuid,
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1),
       1, 0) $$,
  '22023', null, 'an unknown assembly is rejected (22023)');

-- qty_per <= 0 → 22023
select throws_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1 offset 1),
       0, 0) $$,
  '22023', null, 'a non-positive qty_per is rejected (22023)');

-- negative waste → 22023
select throws_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1 offset 1),
       1, -0.1) $$,
  '22023', null, 'a negative waste_factor is rejected (22023)');

-- update the component's qty_per → 5
select lives_ok(
  $$ select public.update_assembly_component(
       (select id from public.catalog_assembly_components
          where assembly_id=(select id from public.catalog_items where kind='assembly' limit 1) limit 1),
       5, 0) $$,
  'update_assembly_component edits qty_per/waste');
select is(
  (select qty_per from public.catalog_assembly_components
     where assembly_id=(select id from public.catalog_items where kind='assembly' limit 1) limit 1),
  5::numeric, 'the component qty_per was updated to 5');
select throws_ok(
  $$ select public.update_assembly_component('00000000-0000-0000-0000-0000000000c4'::uuid, 1, 0) $$,
  '22023', null, 'updating an unknown component id is rejected (22023)');

-- remove the component
select lives_ok(
  $$ select public.remove_assembly_component(
       (select id from public.catalog_assembly_components
          where assembly_id=(select id from public.catalog_items where kind='assembly' limit 1) limit 1)) $$,
  'remove_assembly_component deletes the BOM line');
select is(
  (select count(*)::int from public.catalog_assembly_components
     where assembly_id=(select id from public.catalog_items where kind='assembly' limit 1)),
  0, 'the removed component is gone');
select throws_ok(
  $$ select public.remove_assembly_component('00000000-0000-0000-0000-0000000000c5'::uuid) $$,
  '22023', null, 'removing an unknown component id is rejected (22023)');

-- F. role gates -------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555238"}';
select throws_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1),
       1, 0) $$,
  '42501', null, 'a null/unbound role cannot add a component (null-safe gate)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444238"}';
select throws_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1),
       1, 0) $$,
  '42501', null, 'a disallowed role (visitor) cannot add a component');
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777238"}';
select lives_ok(
  $$ select public.add_assembly_component(
       (select id from public.catalog_items where kind='assembly' limit 1),
       (select id from public.catalog_items where kind<>'assembly' and is_active order by created_at, id limit 1),
       1, 0) $$,
  'procurement may add a component (4-role set incl. procurement)');

reset role;
select * from finish();
rollback;
