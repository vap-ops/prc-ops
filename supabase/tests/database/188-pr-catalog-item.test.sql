begin;
select plan(8);

-- Spec 179 U1 — a purchase request may link a catalog item (spec 175 master).
-- The column is a NULLABLE FK to catalog_items, no default (legacy rows null =
-- off-catalog). The link is set ONCE at create: INSERT-granted to authenticated
-- on the column-scoped table, but NOT UPDATE-granted (mirrors reason_code,
-- spec 176 U4). SELECT stays table-level, so it covers the new column. This
-- pins the grant trap: a new column on a column-scoped INSERT table is NOT
-- covered by the existing grant and must be granted explicitly.

-- ============================================================================
-- A. Column — nullable uuid, no default.
-- ============================================================================
select has_column('public', 'purchase_requests', 'catalog_item_id',
  'catalog_item_id column exists');
select col_type_is('public', 'purchase_requests', 'catalog_item_id', 'uuid',
  'catalog_item_id is uuid');
select col_is_null('public', 'purchase_requests', 'catalog_item_id',
  'catalog_item_id is nullable (off-catalog requests carry null)');
select col_hasnt_default('public', 'purchase_requests', 'catalog_item_id',
  'catalog_item_id has no DB default (no dishonest backfill)');

-- ============================================================================
-- B. FK to the catalog master.
-- ============================================================================
select fk_ok(
  'public', 'purchase_requests', 'catalog_item_id',
  'public', 'catalog_items', 'id',
  'catalog_item_id FK references catalog_items.id');

-- ============================================================================
-- C. Column-scoped grants — INSERT + SELECT, but no UPDATE (set once at create).
-- ============================================================================
select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'catalog_item_id', 'INSERT'),
  true, 'authenticated can INSERT catalog_item_id (new column added to the column-scoped grant)');
select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'catalog_item_id', 'SELECT'),
  true, 'authenticated can SELECT catalog_item_id (table-level SELECT covers it)');
select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'catalog_item_id', 'UPDATE'),
  false, 'authenticated cannot UPDATE catalog_item_id (link set once at create)');

select * from finish();
rollback;
