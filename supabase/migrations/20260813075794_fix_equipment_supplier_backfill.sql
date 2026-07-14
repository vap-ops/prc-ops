-- Fix 2026-07-14 — spec-275 dual-write gap. createEquipment/updateEquipment
-- kept writing equipment_items.owner_id WITHOUT supplier_id after the spec-275
-- vendor unification (owners are id-mirrored into suppliers), so real equipment
-- entered tonight (47 rows, 17:46–18:08 ICT) broke the 274 pgTAP invariant
-- ("supplier_id backfilled wherever owner_id is set") and with it every CI run.
-- The code fix dual-writes both columns; this backfill repairs the drifted rows
-- using the SAME rule as the original spec-275 migration (supplier = the
-- id-mirror of the owner). Idempotent; touches only rows whose mirror exists.

update public.equipment_items ei
   set supplier_id = ei.owner_id
 where ei.owner_id is not null
   and ei.supplier_id is null
   and exists (select 1 from public.suppliers s where s.id = ei.owner_id);
