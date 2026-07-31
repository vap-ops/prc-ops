-- Spec 385 U4 — tighten the SKU model at the DB level.
--
-- 1. Every instance carries its SKU. The spec's own condition ("tightens to NOT
--    NULL only when every instance row is catalog-born") holds vacuously —
--    equipment_items is at 0 rows and every remaining app writer sets the FK
--    (createEquipmentFromCatalog; the free-text createEquipment was deleted in
--    U2 and the importer's INSERT arm is refused in this same unit).
-- 2. The bulk one-row rule becomes a DB invariant. U2 enforced it in app code
--    on both sides of one predicate, but two concurrent adds could both read
--    existing=0 and insert twin bulk rows (U2 review find). NULL never hits the
--    index (rows are NOT NULL from this migration on), and unit rows are
--    excluded by the predicate.

alter table public.equipment_items
  alter column equipment_catalog_item_id set not null;

create unique index equipment_items_bulk_one_row_per_sku
  on public.equipment_items (equipment_catalog_item_id)
  where tracking = 'bulk';
