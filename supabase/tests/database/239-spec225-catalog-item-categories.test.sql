begin;
select plan(47);

-- ============================================================================
-- Spec 225 — Secondary material membership (ADR 0066 / S4, decision D2). An
-- additive junction catalog_item_categories(catalog_item_id, category_id,
-- subcategory_id, is_primary) lets one catalog item appear under MORE THAN one
-- material grouping (defect C2) WITHOUT touching the canonical home (which still
-- drives the 6-digit product_code). The junction REUSES the spec-219/221 composite
-- FK (subcategory_id, category_id) -> catalog_subcategories(id, category_id) — it
-- does NOT invent a new key — plus a simple FK category_id -> catalog_categories(id)
-- for the category-grain (null-subcategory) membership. Exactly one is_primary=true
-- row per item (partial unique), backfilled to MIRROR the canonical category_id/
-- subcategory_id so canonical-home and primary-membership can never disagree.
-- Writes go only through the null-safe SECURITY DEFINER RPCs add_/remove_.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333225', 'pm@cat225.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444225', 'visitor@cat225.local', '{}'::jsonb);
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333225';
-- the visitor user keeps the default 'visitor' role; sub 5555… has NO users row
-- (→ current_user_role() is null → exercises the null-safe gate).

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure ---------------------------------------------------------------
select has_table('public', 'catalog_item_categories', 'catalog_item_categories table exists');
select has_column('public', 'catalog_item_categories', 'catalog_item_id', 'has catalog_item_id');
select has_column('public', 'catalog_item_categories', 'category_id', 'has category_id');
select has_column('public', 'catalog_item_categories', 'subcategory_id', 'has subcategory_id');
select has_column('public', 'catalog_item_categories', 'is_primary', 'has is_primary');
select col_not_null('public', 'catalog_item_categories', 'catalog_item_id', 'catalog_item_id NOT NULL');
select col_not_null('public', 'catalog_item_categories', 'category_id', 'category_id NOT NULL');
select col_not_null('public', 'catalog_item_categories', 'is_primary', 'is_primary NOT NULL');

-- B. FK constraints — REUSE the composite FK, do NOT invent a new key ---------
-- The composite (subcategory_id, category_id) -> catalog_subcategories(id, category_id)
-- is byte-for-byte the spec-219/221 shape carried by catalog_items.
select is(
  (select count(*)::int from pg_constraint
     where conrelid='public.catalog_item_categories'::regclass and contype='f'
       and pg_get_constraintdef(oid) =
         'FOREIGN KEY (subcategory_id, category_id) REFERENCES catalog_subcategories(id, category_id)'),
  1, 'reuses the spec-219/221 composite FK (subcategory_id, category_id) -> catalog_subcategories(id, category_id)');
select is(
  (select count(*)::int from pg_constraint
     where conrelid='public.catalog_item_categories'::regclass and contype='f'
       and pg_get_constraintdef(oid) =
         'FOREIGN KEY (category_id) REFERENCES catalog_categories(id)'),
  1, 'simple FK category_id -> catalog_categories(id) guards the null-subcategory grain');
select is(
  (select count(*)::int from pg_constraint
     where conrelid='public.catalog_item_categories'::regclass and contype='f'
       and pg_get_constraintdef(oid) =
         'FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE CASCADE'),
  1, 'catalog_item_id FK cascades on item delete');

-- C. Indexes — exactly-one-primary + duplicate-membership block --------------
select is(
  (select count(*)::int from pg_indexes
     where schemaname='public' and tablename='catalog_item_categories'
       and indexdef ilike '%unique%' and indexdef ilike '%(catalog_item_id)%'
       and indexdef ilike '%where is_primary%'),
  1, 'partial unique index (catalog_item_id) where is_primary — one primary per item');
select isnt(
  (select count(*)::int from pg_indexes
     where schemaname='public' and tablename='catalog_item_categories'
       and indexdef ilike '%unique%' and indexdef ilike '%coalesce%'),
  0, 'a duplicate-membership unique index exists (coalesce sentinel on subcategory_id)');

-- D. RLS + grants — select-only to authenticated, no write/delete, anon denied
select is(
  (select relrowsecurity from pg_class where oid='public.catalog_item_categories'::regclass),
  true, 'RLS enabled');
select is(has_table_privilege('authenticated', 'public.catalog_item_categories', 'SELECT'),
  true, 'authenticated may SELECT');
select is(has_table_privilege('authenticated', 'public.catalog_item_categories', 'INSERT'),
  false, 'authenticated may NOT INSERT directly');
select is(has_table_privilege('authenticated', 'public.catalog_item_categories', 'UPDATE'),
  false, 'authenticated may NOT UPDATE directly');
select is(has_table_privilege('authenticated', 'public.catalog_item_categories', 'DELETE'),
  false, 'authenticated may NOT DELETE directly');
select is(has_table_privilege('anon', 'public.catalog_item_categories', 'SELECT'),
  false, 'anon may NOT SELECT');

-- E. Backfill — one is_primary row per existing item, mirroring canonical -----
-- (asserted BEFORE any fixture insert, against the migrated population.)
-- Spec 344 fold-and-retire DELETES a merged loser's memberships by design, so
-- the invariant holds for every UN-MERGED item (retired duplicates excluded).
select is(
  (select count(*)::int from public.catalog_item_categories where is_primary),
  (select count(*)::int from public.catalog_items where merged_into is null),
  'exactly one is_primary membership per existing catalog item (backfill)');
select is(
  (select count(*)::int
     from public.catalog_item_categories cic
     join public.catalog_items ci on ci.id = cic.catalog_item_id
    where cic.is_primary
      and (cic.category_id is distinct from ci.category_id
        or cic.subcategory_id is distinct from ci.subcategory_id)),
  0, 'every primary membership MIRRORS its item canonical (category_id, subcategory_id)');
select is(
  (select coalesce(max(c), 0)::int from (
     select count(*) c from public.catalog_item_categories
      where is_primary group by catalog_item_id) x),
  1, 'no item has more than one primary membership');

-- F. Composite FK rejects a mismatched (subcategory_id, category_id) pair -----
-- The seeded subcategory (code 01) lives under steel_fixing's category; pairing it
-- with a DIFFERENT category violates the composite FK (23503). subcategory_id NULL
-- skips the check (MATCH SIMPLE), so the category-grain membership is unaffected.
select throws_ok(
  format($f$ insert into public.catalog_item_categories
              (catalog_item_id, category_id, subcategory_id, is_primary)
            values (%L, %L, %L, false) $f$,
         (select id from public.catalog_items limit 1),
         (select id from public.catalog_categories
            where id <> (select category_id from public.catalog_subcategories where code='01' limit 1)
            limit 1),
         (select id from public.catalog_subcategories where code='01' limit 1)),
  '23503', null, 'composite FK rejects a (subcategory, category) pair that does not match');

-- G. RPC posture — both writers are DEFINER, anon-revoked, authenticated-exec --
select is(
  (select prosecdef from pg_proc where oid='public.add_catalog_item_category(uuid, uuid, uuid)'::regprocedure),
  true, 'add_catalog_item_category is SECURITY DEFINER');
select is(
  (select prosecdef from pg_proc where oid='public.remove_catalog_item_category(uuid, uuid, uuid)'::regprocedure),
  true, 'remove_catalog_item_category is SECURITY DEFINER');
select is(has_function_privilege('anon', 'public.add_catalog_item_category(uuid, uuid, uuid)', 'EXECUTE'),
  false, 'anon cannot execute add_catalog_item_category');
select is(has_function_privilege('anon', 'public.remove_catalog_item_category(uuid, uuid, uuid)', 'EXECUTE'),
  false, 'anon cannot execute remove_catalog_item_category');
select is(has_function_privilege('authenticated', 'public.add_catalog_item_category(uuid, uuid, uuid)', 'EXECUTE'),
  true, 'authenticated can execute add_catalog_item_category');
select is(has_function_privilege('authenticated', 'public.remove_catalog_item_category(uuid, uuid, uuid)', 'EXECUTE'),
  true, 'authenticated can execute remove_catalog_item_category');

-- H. Behaviour — as a back-office PM ------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333225"}';

-- fixtures: two user categories + an item homed in cat A.
select isnt((select public.create_catalog_category('95', 'หมวด S4 A', 0::smallint)), null, 'create cat A (95)');
select isnt((select public.create_catalog_category('96', 'หมวด S4 B', 0::smallint)), null, 'create cat B (96)');
select lives_ok(
  $$ select public.create_catalog_item(
       p_base_item := 's4 item', p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='95')) $$,
  'create item homed in cat A');

-- create_catalog_item must ITSELF write the canonical is_primary membership (S4
-- follow-up — previously it wrote none, leaving the new item orphaned and breaking
-- the "exactly one primary per item" invariant for items created after the backfill).
select is(
  (select count(*)::int from public.catalog_item_categories
     where catalog_item_id=(select id from public.catalog_items where base_item='s4 item')
       and is_primary),
  1, 'create_catalog_item writes exactly one is_primary membership');
select is(
  (select category_id from public.catalog_item_categories
     where catalog_item_id=(select id from public.catalog_items where base_item='s4 item')
       and is_primary),
  (select id from public.catalog_categories where code='95'),
  'the primary membership mirrors the item canonical category');

-- add a SECONDARY membership in cat B.
select lives_ok(
  $$ select public.add_catalog_item_category(
       (select id from public.catalog_items where base_item='s4 item'),
       (select id from public.catalog_categories where code='96'), null) $$,
  'add a secondary membership in cat B');
select is(
  (select is_primary from public.catalog_item_categories
     where catalog_item_id=(select id from public.catalog_items where base_item='s4 item')
       and category_id=(select id from public.catalog_categories where code='96')),
  false, 'the added membership is secondary (is_primary=false)');

-- duplicate membership -> 23505.
select throws_ok(
  $$ select public.add_catalog_item_category(
       (select id from public.catalog_items where base_item='s4 item'),
       (select id from public.catalog_categories where code='96'), null) $$,
  '23505', null, 'a duplicate membership raises 23505');

-- mismatched (subcategory, category) pair -> 22023 (the RPC guards before the FK).
select throws_ok(
  $$ select public.add_catalog_item_category(
       (select id from public.catalog_items where base_item='s4 item'),
       (select id from public.catalog_categories where code='96'),
       (select id from public.catalog_subcategories where code='01' limit 1)) $$,
  '22023', null, 'a subcategory not under the given category raises 22023');

-- remove the secondary membership -> gone.
select lives_ok(
  $$ select public.remove_catalog_item_category(
       (select id from public.catalog_items where base_item='s4 item'),
       (select id from public.catalog_categories where code='96'), null) $$,
  'remove the secondary membership');
select is(
  (select count(*)::int from public.catalog_item_categories
     where catalog_item_id=(select id from public.catalog_items where base_item='s4 item')
       and category_id=(select id from public.catalog_categories where code='96')),
  0, 'the secondary membership is removed');

-- may NOT unlink the primary -> 22023.
select throws_ok(
  $$ select public.remove_catalog_item_category(
       (select id from public.catalog_items where base_item='s4 item'),
       (select id from public.catalog_categories where code='95'), null) $$,
  '22023', null, 'unlinking the primary membership raises 22023');

-- removing an unknown membership -> 22023.
select throws_ok(
  $$ select public.remove_catalog_item_category(
       (select id from public.catalog_items where base_item='s4 item'),
       (select id from public.catalog_categories where code='96'), null) $$,
  '22023', null, 'removing a non-existent membership raises 22023');

-- update_catalog_item must re-sync the canonical primary membership when the item's
-- home moves (same invariant: the primary must mirror the canonical home). 's4 item'
-- now has only its primary in cat A (95); move the canonical home to cat B (96).
select lives_ok(
  $$ select public.update_catalog_item(
       p_id := (select id from public.catalog_items where base_item='s4 item'),
       p_base_item := 's4 item', p_unit := 'ชิ้น',
       p_category_id := (select id from public.catalog_categories where code='96')) $$,
  'move the item canonical home from cat A to cat B');
select is(
  (select count(*)::int from public.catalog_item_categories
     where catalog_item_id=(select id from public.catalog_items where base_item='s4 item')
       and is_primary),
  1, 'still exactly one is_primary membership after the home moves');
select is(
  (select category_id from public.catalog_item_categories
     where catalog_item_id=(select id from public.catalog_items where base_item='s4 item')
       and is_primary),
  (select id from public.catalog_categories where code='96'),
  'the primary membership follows the new canonical home');

-- I. Role gate (null-safe per ADR 0066 D8) -----------------------------------
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555225"}';
select throws_ok(
  $$ select public.add_catalog_item_category(
       (select id from public.catalog_items where base_item='s4 item'),
       (select id from public.catalog_categories where code='96'), null) $$,
  '42501', null, 'a null/unbound role is denied (null-safe gate)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444225"}';
select throws_ok(
  $$ select public.add_catalog_item_category(
       (select id from public.catalog_items where base_item='s4 item'),
       (select id from public.catalog_categories where code='96'), null) $$,
  '42501', null, 'a disallowed role (visitor) is denied');

reset role;
select * from finish();
rollback;
