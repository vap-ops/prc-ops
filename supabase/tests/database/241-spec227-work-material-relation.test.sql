begin;
select plan(52);

-- ============================================================================
-- Spec 227 — Relation R: work_category_material_categories bridge (ADR 0066 / S6,
-- decision D5). Defect D5: the work axis (work_categories, spec 226) and the
-- material axis (catalog_categories, spec 221) are both modeled but NOTHING
-- connects them — so a scoped picker can't know which material-categories a
-- work-category typically buys. This additive M2M bridge declares, on the GLOBAL
-- library, "this work-category buys materials from these material-categories
-- (optionally narrowed by kind_filter)". Seeded from the reconciled BuildAll BOQ
-- (PRC-2026-004) at the W-TOP grain (work_categories.code length 3, W01..W09):
-- 8 of 9 top categories map (19 pairs); W07 ป้าย (signage) is intentionally
-- UNSEEDED — no material category fits — and exercises the empty-Relation-R
-- show-all fallback the pickers (228/229) depend on. Posture follows ADR 0066 D8 /
-- spec 221 U2: grant SELECT to authenticated, NO direct write grant, writes via
-- null-safe SECURITY DEFINER RPCs gated pm/super/procurement/director (4 roles —
-- the catalog/material side INCLUDES procurement, unlike the WP-side work-library).
-- NULL kind_filter handled in the unique index via coalesce((kind_filter)::text,'').
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333227', 'pm@wcmc227.local',     '{}'::jsonb),
  ('77777777-7777-7777-7777-777777777227', 'proc@wcmc227.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444227', 'visitor@wcmc227.local','{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333227';
update public.users set role='procurement'     where id='77777777-7777-7777-7777-777777777227';
-- the visitor user keeps the default 'visitor' role from the auth.users trigger.
-- 5555…227 is deliberately NOT inserted → its jwt sub resolves to a NULL role.

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure --------------------------------------------------------------- (19)
select has_table('public', 'work_category_material_categories', 'bridge table exists');
select has_column('public', 'work_category_material_categories', 'id', 'has id');
select has_column('public', 'work_category_material_categories', 'work_category_id', 'has work_category_id');
select has_column('public', 'work_category_material_categories', 'category_id', 'has category_id');
select has_column('public', 'work_category_material_categories', 'kind_filter', 'has kind_filter');
select has_column('public', 'work_category_material_categories', 'created_by', 'has created_by');
select has_column('public', 'work_category_material_categories', 'created_at', 'has created_at');
select ok(
  (select relrowsecurity from pg_class where oid='public.work_category_material_categories'::regclass),
  'RLS enabled on the bridge');
select ok(
  has_table_privilege('authenticated', 'public.work_category_material_categories', 'select'),
  'authenticated may SELECT the bridge');
select ok(
  not has_table_privilege('anon', 'public.work_category_material_categories', 'select'),
  'anon may NOT SELECT the bridge');
select ok(
  not has_table_privilege('authenticated', 'public.work_category_material_categories', 'insert'),
  'authenticated may NOT INSERT directly (RPC-sole-writer)');
select ok(
  not has_table_privilege('authenticated', 'public.work_category_material_categories', 'update'),
  'authenticated may NOT UPDATE directly');
select ok(
  not has_table_privilege('authenticated', 'public.work_category_material_categories', 'delete'),
  'authenticated may NOT DELETE directly');
select fk_ok('public', 'work_category_material_categories', 'work_category_id', 'public', 'work_categories', 'id');
select fk_ok('public', 'work_category_material_categories', 'category_id', 'public', 'catalog_categories', 'id');
select col_is_null('public', 'work_category_material_categories', 'kind_filter',
  'kind_filter is NULLABLE (NULL = no kind filter)');
select is(
  (select c.confdeltype from pg_constraint c
     where c.conrelid='public.work_category_material_categories'::regclass
       and c.confrelid='public.work_categories'::regclass and c.contype='f'),
  'c', 'work_category_id FK is ON DELETE CASCADE');
select is(
  (select c.confdeltype from pg_constraint c
     where c.conrelid='public.work_category_material_categories'::regclass
       and c.confrelid='public.catalog_categories'::regclass and c.contype='f'),
  'c', 'category_id FK is ON DELETE CASCADE');
select col_type_is('public', 'work_category_material_categories', 'kind_filter', 'catalog_item_kind',
  'kind_filter is a catalog_item_kind enum');

-- B. Seed (BOQ-derived, W-top grain) ----------------------------------------- (11)
select is(
  (select count(*)::int from public.work_category_material_categories), 19,
  'seeded 19 work->material pairs');
select is(
  (select count(distinct work_category_id)::int from public.work_category_material_categories), 8,
  'seed spans 8 of 9 top work-categories (W07 signage intentionally unmapped)');
select is(
  (select count(*)::int from public.work_category_material_categories m
     join public.work_categories wc on wc.id=m.work_category_id where wc.code='W07'),
  0, 'W07 ป้าย has zero relation rows (empty-Relation-R fallback anchor)');
select is(
  (select count(*)::int from public.work_category_material_categories
     where kind_filter is not null), 0,
  'all seed rows carry NULL kind_filter (no kind narrowing in v1)');
select ok(
  exists (select 1 from public.work_category_material_categories m
            join public.work_categories wc on wc.id=m.work_category_id
            join public.catalog_categories cc on cc.id=m.category_id
           where wc.code='W02' and cc.code='01'),
  'anchor: W02 โครงสร้าง -> 01 เหล็ก');
select ok(
  exists (select 1 from public.work_category_material_categories m
            join public.work_categories wc on wc.id=m.work_category_id
            join public.catalog_categories cc on cc.id=m.category_id
           where wc.code='W02' and cc.code='08'),
  'anchor: W02 โครงสร้าง -> 08 สี (rust paint)');
select ok(
  exists (select 1 from public.work_category_material_categories m
            join public.work_categories wc on wc.id=m.work_category_id
            join public.catalog_categories cc on cc.id=m.category_id
           where wc.code='W04' and cc.code='12'),
  'anchor: W04 ประปา -> 12 ถังบำบัด/ถังน้ำ');
select ok(
  exists (select 1 from public.work_category_material_categories m
            join public.work_categories wc on wc.id=m.work_category_id
            join public.catalog_categories cc on cc.id=m.category_id
           where wc.code='W03' and cc.code='07'),
  'anchor: W03 สถาปัตยกรรม -> 07 ประตู/งานหนีไฟ (doors + windows/glazing)');
select ok(
  exists (select 1 from public.work_category_material_categories m
            join public.work_categories wc on wc.id=m.work_category_id
            join public.catalog_categories cc on cc.id=m.category_id
           where wc.code='W08' and cc.code='06'),
  'anchor: W08 ภายนอก -> 06 ไฟฟ้า (parking lighting)');
-- Resolver contract (the function the pickers consume): mapped vs empty.
select is(
  (select count(*)::int from public.work_category_material_categories m
     join public.work_categories wc on wc.id=m.work_category_id where wc.code='W02'),
  2, 'resolver: a seeded work-category (W02) returns its mapped rows');
select is(
  (select count(*)::int from public.work_category_material_categories m
     join public.work_categories wc on wc.id=m.work_category_id where wc.code='W07'),
  0, 'resolver: an unmapped work-category (W07) returns an empty set');

-- C. Uniqueness incl. NULL-kind handling (direct owner inserts) --------------- (5)
select throws_ok(
  $$ insert into public.work_category_material_categories (work_category_id, category_id, kind_filter)
     values ((select id from public.work_categories where code='W02'),
             (select id from public.catalog_categories where code='01'), null) $$,
  '23505', null, 'a duplicate seed pair (NULL kind) is rejected (23505)');
select lives_ok(
  $$ insert into public.work_category_material_categories (work_category_id, category_id, kind_filter)
     values ((select id from public.work_categories where code='W05'),
             (select id from public.catalog_categories where code='01'), 'material') $$,
  'a typed-kind row (W05,01,material) inserts — distinct from the NULL-kind grain');
select throws_ok(
  $$ insert into public.work_category_material_categories (work_category_id, category_id, kind_filter)
     values ((select id from public.work_categories where code='W05'),
             (select id from public.catalog_categories where code='01'), 'material') $$,
  '23505', null, 'a duplicate typed-kind row is rejected (23505)');
select lives_ok(
  $$ insert into public.work_category_material_categories (work_category_id, category_id, kind_filter)
     values ((select id from public.work_categories where code='W05'),
             (select id from public.catalog_categories where code='01'), null) $$,
  'a NULL-kind row coexists with the typed-kind row (coalesce-text NULL handling)');
select throws_ok(
  $$ insert into public.work_category_material_categories (work_category_id, category_id, kind_filter)
     values ((select id from public.work_categories where code='W05'),
             (select id from public.catalog_categories where code='01'), null) $$,
  '23505', null, 'a duplicate NULL-kind row is rejected (23505)');

-- E. RPC posture — SECURITY DEFINER + anon revoked + authenticated execute ---- (6)
select is(
  (select prosecdef from pg_proc
     where oid='public.add_work_category_material_category(uuid,uuid,catalog_item_kind)'::regprocedure),
  true, 'add_work_category_material_category is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon',
    'public.add_work_category_material_category(uuid,uuid,catalog_item_kind)', 'execute'),
  'anon may NOT execute add_work_category_material_category');
select ok(
  has_function_privilege('authenticated',
    'public.add_work_category_material_category(uuid,uuid,catalog_item_kind)', 'execute'),
  'authenticated may execute add_work_category_material_category');
select is(
  (select prosecdef from pg_proc
     where oid='public.remove_work_category_material_category(uuid,uuid,catalog_item_kind)'::regprocedure),
  true, 'remove_work_category_material_category is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon',
    'public.remove_work_category_material_category(uuid,uuid,catalog_item_kind)', 'execute'),
  'anon may NOT execute remove_work_category_material_category');
select ok(
  has_function_privilege('authenticated',
    'public.remove_work_category_material_category(uuid,uuid,catalog_item_kind)', 'execute'),
  'authenticated may execute remove_work_category_material_category');

-- F. Behaviour as a back-office PM -------------------------------------------- (9)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333227"}';

select lives_ok(
  $$ select public.add_work_category_material_category(
       (select id from public.work_categories where code='W05'),
       (select id from public.catalog_categories where code='02')) $$,
  'PM adds a new relation (W05 -> 02)');
select throws_ok(
  $$ select public.add_work_category_material_category(
       (select id from public.work_categories where code='W05'),
       (select id from public.catalog_categories where code='02')) $$,
  '23505', null, 'adding the same relation again is rejected (23505)');
select throws_ok(
  $$ select public.add_work_category_material_category(
       null::uuid, (select id from public.catalog_categories where code='02')) $$,
  '22023', null, 'a null work-category id is rejected (22023)');
select throws_ok(
  $$ select public.add_work_category_material_category(
       (select id from public.work_categories where code='W05'), null::uuid) $$,
  '22023', null, 'a null category id is rejected (22023)');
select throws_ok(
  $$ select public.add_work_category_material_category(
       '00000000-0000-0000-0000-000000000091'::uuid,
       (select id from public.catalog_categories where code='02')) $$,
  '22023', null, 'an unknown work-category id is rejected (22023)');
select throws_ok(
  $$ select public.add_work_category_material_category(
       (select id from public.work_categories where code='W05'),
       '00000000-0000-0000-0000-000000000092'::uuid) $$,
  '22023', null, 'an unknown category id is rejected (22023)');
select lives_ok(
  $$ select public.remove_work_category_material_category(
       (select id from public.work_categories where code='W05'),
       (select id from public.catalog_categories where code='02')) $$,
  'PM removes the relation (W05 -> 02)');
select throws_ok(
  $$ select public.remove_work_category_material_category(
       (select id from public.work_categories where code='W05'),
       (select id from public.catalog_categories where code='02')) $$,
  '22023', null, 'removing an already-gone relation is rejected (22023)');
-- procurement is admitted on the material side (4-role gate, unlike S5's 3-role).
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777777227"}';
select lives_ok(
  $$ select public.add_work_category_material_category(
       (select id from public.work_categories where code='W06'),
       (select id from public.catalog_categories where code='02')) $$,
  'procurement may add a relation (4-role gate includes procurement)');

-- G. Role gate — null-safe deny ---------------------------------------------- (2)
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555227"}';
select throws_ok(
  $$ select public.add_work_category_material_category(
       (select id from public.work_categories where code='W06'),
       (select id from public.catalog_categories where code='03')) $$,
  '42501', null, 'a null/unbound role cannot add a relation (null-safe gate)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444227"}';
select throws_ok(
  $$ select public.add_work_category_material_category(
       (select id from public.work_categories where code='W06'),
       (select id from public.catalog_categories where code='03')) $$,
  '42501', null, 'a disallowed role (visitor) cannot add a relation');

reset role;
select * from finish();
rollback;
