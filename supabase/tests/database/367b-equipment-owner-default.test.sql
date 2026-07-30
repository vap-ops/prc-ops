begin;
select plan(9);

-- ============================================================================
-- Operator ask 2026-07-30 — "owner defaults to PRI (Preston International Co.,
-- Ltd.) as selection", alongside the registry reset (mig …_075882_).
--
-- The default owner is DATA, not a code constant: spec 367 §3 is about the whole
-- fleet changing hands, so a company name compiled into the bundle is wrong by
-- design. `equipment_owners.is_default` carries it.
--
-- What this file guards, in the order the traps actually bite:
--
--   1. The flag is READABLE by `authenticated`. equipment_owners is
--      COLUMN-GRANTED (SELECT lists five columns by name) — a new column without
--      a grant is not null, it makes PostgREST refuse the whole read (spec 367 U1
--      §C, the `worker_level_rates` precedent). The add form would break outright.
--   2. AT MOST ONE row may carry it, enforced by a partial unique index rather
--      than by convention — two flagged rows would make the form's default depend
--      on row order.
--   3. The default owner MUST be id-mirrored into `suppliers`. `createEquipment`
--      writes `supplier_id = owner_id` (spec 275, the GL-party edge) and that
--      column FKs to `suppliers`, so an owner with no mirror row 23503s on the
--      FIRST hand-added item — which is exactly what the operator is about to do
--      after the reset. This is the assertion that would have caught it.
--
-- Deliberately NOT asserted: the owner's NAME, and any count of
-- `equipment_items`. Both are operator-editable live data (the 119-item-catalog
-- lesson: an exact-equality pin on a value a human may legitimately rename turns
-- a rename into a merge-queue ejection for every lane).
-- ============================================================================

-- ============================================================================
-- A. The flag exists, is total, and is readable through the column grant.
-- ============================================================================
select has_column('public', 'equipment_owners', 'is_default',
  'equipment_owners.is_default exists');
select col_not_null('public', 'equipment_owners', 'is_default',
  'is_default is NOT NULL — "unflagged" is false, never unknown');
select is(has_column_privilege('authenticated', 'public.equipment_owners', 'is_default', 'SELECT'),
  true, 'authenticated may read is_default (column-granted table)');

-- The write side stays closed: switching the default is a curated act and this
-- unit ships no affordance for it. Pinned in the NEGATIVE direction so a future
-- blanket `grant update on equipment_owners` reds here instead of quietly
-- handing every back-office user a fleet-wide default switch.
select is(has_column_privilege('authenticated', 'public.equipment_owners', 'is_default', 'UPDATE'),
  false, 'authenticated may NOT write is_default (no UI, no grant)');

-- ============================================================================
-- B. At most one default — enforced, not conventional.
-- ============================================================================
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'equipment_owners'
      and indexname = 'equipment_owners_one_default_idx'),
  1,
  'the partial unique index on is_default exists'
);

select is(
  (select count(*)::int from public.equipment_owners where is_default),
  1,
  'exactly one owner is flagged as the default today'
);

-- Behavioural, not just structural: flagging a SECOND owner must fail. Without
-- this the index could be created non-unique or over the wrong predicate and the
-- structural check above would still pass.
select throws_ok(
  $$ insert into public.equipment_owners (name, created_by, is_default)
     select 'ทดสอบเจ้าของซ้ำ', created_by, true from public.equipment_owners limit 1 $$,
  '23505',
  null,
  'a second default owner is refused by the unique index'
);

-- ============================================================================
-- C. The supplier mirror — the FK that decides whether the first hand-added
--    item saves or 23503s.
-- ============================================================================
select is(
  (select count(*)::int
     from public.equipment_owners o
     join public.suppliers s on s.id = o.id
    where o.is_default),
  1,
  'the default owner is id-mirrored into suppliers (equipment_items.supplier_id FK)'
);

-- Every owner, not only the default: `createEquipment` mirrors owner→supplier for
-- whichever owner is picked, so a gap on ANY row is a live save failure.
select is(
  (select count(*)::int
     from public.equipment_owners o
    where not exists (select 1 from public.suppliers s where s.id = o.id)),
  0,
  'no equipment owner is missing its suppliers mirror row'
);

select * from finish();
rollback;
