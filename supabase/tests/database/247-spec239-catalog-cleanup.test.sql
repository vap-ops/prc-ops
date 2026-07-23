begin;
select plan(10);

-- ============================================================================
-- Spec 239 — ทะเบียนวัสดุ category cleanup (ADR 0066 C1). U1 = the additive
-- re-grain migration (20260813043000). This test pins the STABLE invariants of
-- the end state against the live DB (the migration is additive + verified live;
-- specific item re-homes are verified once at apply time, NOT pinned here — the
-- operator may freely re-home items/categories afterwards, by design). Robust
-- regression guards: the two new columns, the new fasteners category, the
-- no-NULL-category invisibility guard, the is_primary↔canonical integrity, and
-- the safety invariant that no product_code was introduced.
-- ============================================================================

-- A. Two additive columns on catalog_items
select has_column('public', 'catalog_items', 'search_terms', 'catalog_items gained search_terms');
select has_column('public', 'catalog_items', 'lead_time_days', 'catalog_items gained lead_time_days');
select ok(
  exists (select 1 from pg_constraint
            where conrelid = 'public.catalog_items'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%lead_time_days%'),
  'lead_time_days has a CHECK (>= 0)');

-- B. The steel split produced a new fasteners category (code 14)
select is((select count(*)::int from public.catalog_categories where code = '14'), 1,
  'category code 14 (fasteners) exists');
select is((select name from public.catalog_categories where code = '14'), 'อุปกรณ์ยึด / น็อต สกรู',
  'category 14 is named the fasteners category');

-- C. The invisibility guard: no active item may have a NULL category
select is(
  (select count(*)::int from public.catalog_items where is_active and category_id is null), 0,
  'no active catalog item has a NULL category_id (invisibility guard)');

-- D. is_primary membership integrity (exactly one per item, mirroring canonical)
-- Spec 344 fold-and-retire DELETES a merged loser's memberships by design —
-- scope to un-merged items (the 27 retired duplicates legitimately hold none).
select is(
  (select count(*)::int from public.catalog_item_categories where is_primary),
  (select count(*)::int from public.catalog_items where merged_into is null),
  'exactly one is_primary catalog_item_categories row per item');
select is(
  (select count(*)::int from public.catalog_item_categories cic
     join public.catalog_items ci on ci.id = cic.catalog_item_id
    where cic.is_primary and cic.category_id is distinct from ci.category_id), 0,
  'every is_primary row mirrors its item canonical category_id');
select is(
  (select count(*)::int from public.catalog_item_categories cic
     join public.catalog_items ci on ci.id = cic.catalog_item_id
    where cic.is_primary and cic.subcategory_id is distinct from ci.subcategory_id), 0,
  'every is_primary row mirrors its item canonical subcategory_id');

-- E. Safety invariant: the re-home introduced no product_code (none exist → nothing shifts)
select is(
  (select count(*)::int from public.catalog_items where product_code is not null), 0,
  'no catalog item has a product_code (re-home renumbers nothing — additive, not break-glass)');

select * from finish();
rollback;
