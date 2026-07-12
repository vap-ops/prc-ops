begin;
select plan(5);

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

select * from finish();
rollback;
