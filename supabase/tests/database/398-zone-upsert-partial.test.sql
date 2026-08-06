begin;
select plan(19);

-- ============================================================================
-- Spec 392 — `upsert_project_zone` must not erase what the caller did not send.
--
-- The bug, found by fresh-eyes review of U2b (the drawing canvas) and confirmed
-- against the live function body: the UPDATE arm was an UNCONDITIONAL
-- overwrite —
--
--     set code = …, name = …, shape = p_shape, geometry = p_geometry,
--         parent_zone_id = p_parent_zone_id, sort_order = coalesce(p_sort_order, 0)
--
-- while `zone-sheet.tsx` (the U2a rename/re-code sheet) sends only
-- {zoneId, code, name} and the server action filled the rest with `rect` and a
-- default box. So RENAMING a zone reset its drawn shape and position to the
-- same default rect, nulled its parent, and zeroed its sort order.
--
-- It shipped in #958 and was harmless only because `project_zones` held 0 rows
-- everywhere. U2b is what arms it: the moment anyone draws, a typo fix erases
-- the drawing. This file is the regression pin.
--
-- After this migration a NULL means "leave this column alone". Non-null still
-- writes, so the canvas — which always sends geometry — is unaffected.
--
-- ⚖️ `parent_zone_id` is coalesced too, which means this RPC can no longer
-- UN-nest a zone. Nothing in the UI nests or un-nests today (`zone-sheet.tsx`
-- has no parent picker; nesting is RPC-only), so nothing shipped is lost, and
-- the alternative — leaving parent writable-to-null — is precisely the arm that
-- silently flattened the tree on every rename. An explicit un-nest needs its
-- own affordance and its own test.
--
-- ⚠️ Every count here is scoped to this file's own seeded rows. A bare global
-- count(*) over an app-written table is what ejected every lane's PR on
-- 2026-08-04 (#954).
-- ============================================================================

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0398-0398-0398-700000000398', 'pm@s398.local', '{}'::jsonb);
update public.users set role = 'project_manager'
  where id = '70000000-0398-0398-0398-700000000398';

insert into public.projects (id, code, name) values
  ('a1000000-0398-0398-0398-a10000000398', 'TAP-398A', 'โครงการทดสอบ 398');

insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0398-0398-0398-a10000000398', '70000000-0398-0398-0398-700000000398',
   '70000000-0398-0398-0398-700000000398');

insert into public.project_zone_maps (id, project_id, name, created_by) values
  ('b1000000-0398-0398-0398-b10000000398', 'a1000000-0398-0398-0398-a10000000398',
   'ผังโซน 398', '70000000-0398-0398-0398-700000000398');

-- A drawn zone: a polygon, nested under a parent, sorted late. Every one of
-- these four columns is something the rename sheet never sends.
insert into public.project_zones
  (id, map_id, project_id, code, name, shape, geometry, sort_order, created_by) values
  ('c0000000-0398-0398-0398-c00000000398', 'b1000000-0398-0398-0398-b10000000398',
   'a1000000-0398-0398-0398-a10000000398', 'P', 'อาคาร', 'rect',
   '{"x":0.0,"y":0.0,"w":0.9,"h":0.9}'::jsonb, 0,
   '70000000-0398-0398-0398-700000000398'),
  ('c1000000-0398-0398-0398-c10000000398', 'b1000000-0398-0398-0398-b10000000398',
   'a1000000-0398-0398-0398-a10000000398', 'A', 'พื้นลานด้านซ้าย', 'polygon',
   '{"points":[[0.1,0.1],[0.5,0.1],[0.5,0.4],[0.3,0.5],[0.1,0.4]]}'::jsonb, 7,
   '70000000-0398-0398-0398-700000000398'),
  -- A third, top-level zone exists only so the re-parent assertion in C can
  -- move a zone that had NO parent. Re-parenting one of the two above each
  -- other would make a two-node cycle — which U1 recorded as unguarded, so it
  -- would pass today and silently start failing the day a cycle guard lands.
  -- A test must not depend on a hazard staying unfixed.
  ('c2000000-0398-0398-0398-c20000000398', 'b1000000-0398-0398-0398-b10000000398',
   'a1000000-0398-0398-0398-a10000000398', 'C', 'บ่อบำบัด', 'ellipse',
   '{"x":0.6,"y":0.6,"w":0.2,"h":0.2}'::jsonb, 3,
   '70000000-0398-0398-0398-700000000398');
update public.project_zones
   set parent_zone_id = 'c0000000-0398-0398-0398-c00000000398'
 where id = 'c1000000-0398-0398-0398-c10000000398';

-- ============================================================================
-- A. The signature keeps its four optional columns nullable, so a partial
--    update is expressible at all.
-- ============================================================================
select is(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'upsert_project_zone'),
  1,
  'exactly one upsert_project_zone — the migration replaced, it did not overload');

select is(
  (select prosecdef from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'upsert_project_zone'),
  true,
  'it is still SECURITY DEFINER');

-- The house form: resolves PUBLIC through role inheritance, unlike a
-- role_routine_grants count, which has no PUBLIC arm and reads 0 either way.
select is(
  has_function_privilege('anon',
    'public.upsert_project_zone(uuid,uuid,text,text,zone_shape,jsonb,uuid,integer)',
    'EXECUTE'),
  false,
  'anon still cannot execute it');

-- ============================================================================
-- B. The regression itself: a rename that sends no shape and no geometry.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0398-0398-0398-700000000398"}';

select is(
  (select public.upsert_project_zone(
     'b1000000-0398-0398-0398-b10000000398',
     'c1000000-0398-0398-0398-c10000000398',
     'A', 'พื้นลานด้านซ้ายของอาคาร',
     null, null, null, null)),
  'c1000000-0398-0398-0398-c10000000398'::uuid,
  'a rename that omits shape, geometry, parent and sort order is accepted');

reset role;

select is(
  (select name from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  'พื้นลานด้านซ้ายของอาคาร',
  'the rename LANDED — this is the positive control, without which the four pins below would also pass on a no-op');

select is(
  (select shape::text from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  'polygon',
  'the drawn SHAPE survived the rename');

select is(
  (select geometry from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  '{"points":[[0.1,0.1],[0.5,0.1],[0.5,0.4],[0.3,0.5],[0.1,0.4]]}'::jsonb,
  'the drawn GEOMETRY survived the rename — five vertices, not a default box');

select is(
  (select parent_zone_id from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  'c0000000-0398-0398-0398-c00000000398'::uuid,
  'the NESTING survived the rename');

select is(
  (select sort_order from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  7,
  'the SORT ORDER survived the rename');

-- ============================================================================
-- C. Non-null still writes. Coalescing must not make the canvas read-only.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0398-0398-0398-700000000398"}';

select lives_ok(
  $$ select public.upsert_project_zone(
       'b1000000-0398-0398-0398-b10000000398',
       'c1000000-0398-0398-0398-c10000000398',
       'A', 'พื้นลานด้านซ้ายของอาคาร',
       'rect', '{"x":0.35,"y":0.35,"w":0.3,"h":0.2}'::jsonb, null, null) $$,
  'a drag still writes shape and geometry when it sends them');

reset role;

select is(
  (select geometry from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  '{"x":0.35,"y":0.35,"w":0.3,"h":0.2}'::jsonb,
  'the dragged geometry is what the row now holds');

-- ⭐ The shape must be asserted too, and on its own. Without this the geometry
-- pin above is carried by a CHECK in another file — `project_zones_geometry_ok`
-- would have refused `polygon` + a box and failed the lives_ok — rather than by
-- anything this file states.
select is(
  (select shape::text from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  'rect',
  'the shape was rewritten too, not merely left at polygon');

-- ⭐ `parent_zone_id` and `sort_order` need their WRITE half pinned, not only
-- their survive half. Deleting both from the UPDATE `set` list entirely — i.e.
-- making them permanently unwritable — passes every assertion above, because
-- section B only ever proves they SURVIVED. Coalescing must not have turned
-- these two columns read-only.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0398-0398-0398-700000000398"}';
select lives_ok(
  $$ select public.upsert_project_zone(
       'b1000000-0398-0398-0398-b10000000398',
       'c1000000-0398-0398-0398-c10000000398',
       'A', 'โซนเอ',
       null, null, 'c0000000-0398-0398-0398-c00000000398', 42) $$,
  'a non-null parent and sort order are still accepted on an update');
reset role;

select is(
  (select sort_order from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  42,
  'the new SORT ORDER was written — coalesce did not make the column read-only');

-- Zone A was already parented to P by the seed, so re-sending that pair proves
-- acceptance but not the WRITE. Un-parenting is impossible by design (the
-- deliberate trade above), so the write is proven by moving the third zone,
-- which starts with no parent at all, under one.
select is(
  (select parent_zone_id from public.project_zones
    where id = 'c2000000-0398-0398-0398-c20000000398'),
  null,
  'the third zone starts top level — the precondition the next assertion needs');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0398-0398-0398-700000000398"}';
select lives_ok(
  $$ select public.upsert_project_zone(
       'b1000000-0398-0398-0398-b10000000398',
       'c2000000-0398-0398-0398-c20000000398',
       'C', 'บ่อบำบัด',
       null, null, 'c0000000-0398-0398-0398-c00000000398', null) $$,
  'a zone with no parent can be given one');
reset role;

select is(
  (select parent_zone_id from public.project_zones
    where id = 'c2000000-0398-0398-0398-c20000000398'),
  'c0000000-0398-0398-0398-c00000000398'::uuid,
  'the new PARENT was written — coalesce did not make the column read-only');

-- ============================================================================
-- D. The DEFAULT on p_sort_order. Once NULL means "leave alone", a default of 0
--    would reintroduce the bug for any caller that simply omits the argument.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0398-0398-0398-700000000398"}';
select lives_ok(
  $$ select public.upsert_project_zone(
       'b1000000-0398-0398-0398-b10000000398',
       'c1000000-0398-0398-0398-c10000000398',
       'A', 'โซนเออีกครั้ง', null, null) $$,
  'the six-argument shorthand is callable now that shape and geometry are nullable');
reset role;

select is(
  (select sort_order from public.project_zones
    where id = 'c1000000-0398-0398-0398-c10000000398'),
  42,
  'OMITTING p_sort_order leaves it alone — the argument default is null, not 0');

select * from finish();
rollback;
