-- Spec 367 §10.4 — a dedicated audit action for equipment acquisition changes.
--
-- Its OWN value, deliberately, rather than reusing `equipment_rate_change`:
-- `equipment_item_history` maps that action to the kind `rate_change`, which the
-- UI renders as "เปลี่ยนค่าเช่า". Filing a purchase cost under it would produce a
-- true row carrying a FALSE sentence — the collapsed-class defect this repo has
-- been bitten by (a status value that means two things cannot carry a metric,
-- and an action value that means two things cannot carry a label).
--
-- Kept in its OWN migration because `ALTER TYPE … ADD VALUE` and any statement
-- that USES the new value cannot share a transaction; the next file creates the
-- function that writes it.
--
-- Adding an enum value trips `03-audit-log-shape.test.sql`'s `enum_has_labels`
-- pin BY DESIGN — that array is updated in the same PR rather than weakened.

alter type public.audit_action add value if not exists 'equipment_acquisition_change';
