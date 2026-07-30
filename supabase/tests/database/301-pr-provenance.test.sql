begin;
select plan(7);

-- ============================================================================
-- Spec 301 U2a — PR provenance: requested_from_work_package_id.
-- ADR 0065 (store-only) keeps work_package_id NULL on every new ขอซื้อ — the
-- raising WP was discarded entirely. This nullable FK records the ORIGIN only
-- (display + off-category flag); it is NOT the delivery/custody binding.
-- authenticated INSERTs purchase_requests through a COLUMN-LEVEL grant list,
-- so the new column needs its own grant (the spec-275/#435 42501 trap).
-- ============================================================================

select has_column(
  'public', 'purchase_requests', 'requested_from_work_package_id',
  'provenance column exists'
);

select col_type_is(
  'public', 'purchase_requests', 'requested_from_work_package_id', 'uuid',
  'provenance column is a uuid'
);

select col_is_null(
  'public', 'purchase_requests', 'requested_from_work_package_id',
  'provenance is nullable (WP-less creates stay legal)'
);

select fk_ok(
  'public', 'purchase_requests', 'requested_from_work_package_id',
  'public', 'work_packages', 'id'
);

select ok(
  exists(
    select 1 from information_schema.column_privileges
     where table_schema = 'public'
       and table_name   = 'purchase_requests'
       and column_name  = 'requested_from_work_package_id'
       and grantee      = 'authenticated'
       and privilege_type = 'INSERT'
  ),
  'authenticated holds the column-level INSERT grant (form insert must not 42501)'
);

-- Review finding (U2 fresh-eyes): the raw FK must never 23503 a WP delete —
-- provenance semantics = drop the pointer, keep the PR (+receipt/GL), so this
-- column is ON DELETE SET NULL rather than NO ACTION/RESTRICT.
-- ⚠️ SUPERSEDED 2026-07-30 (mig 20260813075875, 94-delete-work-package.test.sql
-- §C.2): delete_work_package's OWN guard now blocks a WP that is still
-- REFERENCED by a live PR's provenance — a deliberate app-level check stricter
-- than the FK's referential action, closing a silent-orphan gap the SET NULL
-- alone left open. The FK assertion below is still true and still the reason
-- a raw DELETE (service-role / break-glass) never 23503s — it just no longer
-- means the RPC lets provenance through.
select ok(
  (select confdeltype = 'n' from pg_constraint
    where conrelid = 'public.purchase_requests'::regclass
      and conname = 'purchase_requests_requested_from_work_package_id_fkey'),
  'provenance FK is ON DELETE SET NULL (a raw delete never 23503s on provenance)'
);

select ok(
  exists(
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename  = 'purchase_requests'
       and indexdef ilike '%requested_from_work_package_id%'
  ),
  'provenance column is indexed (parent-delete FK check + future WP-detail reads)'
);

select * from finish();
rollback;
