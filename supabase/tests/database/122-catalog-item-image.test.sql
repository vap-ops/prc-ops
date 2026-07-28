begin;
select plan(13);

-- ============================================================================
-- Spec 175 U4 — catalog item image.
--   catalog-images private bucket + back-office INSERT policy on storage.objects.
--   catalog_items.image_path column. set_catalog_item_image(id, path) returns
--   void — SECURITY DEFINER, back-office only; null clears; unknown id → 22023.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333122', 'pm@cat4.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222122', 'site@cat4.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444122', 'pmgr@cat4.local', '{}'::jsonb);
update public.users set role='project_manager'     where id='33333333-3333-3333-3333-333333333122';
update public.users set role='site_admin'          where id='22222222-2222-2222-2222-222222222122';
update public.users set role='procurement_manager' where id='44444444-4444-4444-4444-444444444122';

insert into public.catalog_items (id, category, base_item, spec_attrs, unit) values
  ('d4d4d4d4-0000-0000-0000-000000000122', 'electrical', 'ทดสอบรูป', 'x', 'ชิ้น');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Infra.
select ok(
  exists (select 1 from storage.buckets where id='catalog-images'),
  'catalog-images bucket exists');
select ok(
  exists (select 1 from pg_policies
            where schemaname='storage' and tablename='objects'
              and policyname='catalog-images uploads by back-office'),
  'storage INSERT policy for catalog-images exists');
-- 2026-07-28 field bug: the policy shipped with a HARDCODED 4-role array and was
-- never widened when spec 261 / ADR 0070 added procurement_manager to
-- is_back_office — so the /catalog page, the setCatalogItemImage action and the
-- set_catalog_item_image RPC all admitted her while Storage 403'd the bytes.
-- Pin the DELEGATION (no re-hardcoding a list that can drift again) …
-- … AND the bucket scope in the same breath: pinning the delegation alone would
-- stay green if the bucket_id conjunct were dropped, which would hand the back
-- office INSERT into every bucket. (The exact positive SET of is_back_office is
-- pinned once, over the whole enum, in 231-sql-role-predicates.test.sql — one
-- hardcoded role list, not two.)
select ok(
  (select pg_get_expr(polwithcheck, polrelid) like '%is_back_office%'
      and pg_get_expr(polwithcheck, polrelid) like '%catalog-images%'
     from pg_policy
    where polrelid='storage.objects'::regclass
      and polname='catalog-images uploads by back-office'),
  'the policy delegates to is_back_office AND stays scoped to the catalog-images bucket');
select has_column('public', 'catalog_items', 'image_path', 'catalog_items.image_path exists');
select ok(
  to_regprocedure('public.set_catalog_item_image(uuid, text)') is not null,
  'set_catalog_item_image exists');
select is(
  (select prosecdef from pg_proc
     where oid='public.set_catalog_item_image(uuid, text)'::regprocedure),
  true, 'set_catalog_item_image is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.set_catalog_item_image(uuid, text)', 'EXECUTE'),
  false, 'anon cannot execute set_catalog_item_image');

set local role authenticated;

-- B. PM sets + clears the image path.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333122"}';
select lives_ok(
  $$ select public.set_catalog_item_image('d4d4d4d4-0000-0000-0000-000000000122',
       'd4d4d4d4-0000-0000-0000-000000000122/abc.jpeg') $$,
  'PM sets the image path');
select is(
  (select image_path from public.catalog_items where id='d4d4d4d4-0000-0000-0000-000000000122'),
  'd4d4d4d4-0000-0000-0000-000000000122/abc.jpeg', 'image_path recorded');

-- C. Unknown id + role gate.
select throws_ok(
  $$ select public.set_catalog_item_image('cccccccc-0000-0000-0000-000000000122', 'x/y.jpeg') $$,
  '22023', null, 'unknown id → 22023');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222122"}';
select throws_ok(
  $$ select public.set_catalog_item_image('d4d4d4d4-0000-0000-0000-000000000122', 'x/y.jpeg') $$,
  '42501', null, 'site_admin denied (42501)');

-- D. The storage INSERT policy BEHAVES — the layer that actually carried the bug.
-- procurement_manager owns the material catalog and must be able to upload bytes;
-- a field role must not.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444122"}';
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'catalog-images',
        'd4d4d4d4-0000-0000-0000-000000000122/pmgr.jpeg') $$,
  'procurement_manager may upload to catalog-images');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222122"}';
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'catalog-images',
        'd4d4d4d4-0000-0000-0000-000000000122/sa.jpeg') $$,
  '42501', null, 'site_admin denied by the catalog-images INSERT policy (fail-closed)');

reset role;

select * from finish();
rollback;
