-- Spec 406 U1 — two audit actions for the skill map.
--
-- Kept in its OWN migration because `ALTER TYPE … ADD VALUE` and any statement
-- that USES the new value cannot share a transaction; the next file creates the
-- functions that write them. (Same shape as spec 367's acquisition action.)
--
-- TWO values, not one, because they answer different questions and a collapsed
-- class cannot carry a label: `skill_map_change` is an edit to the RUBRIC (a
-- trade, a level, a skill, a material, a publish — org master data), while
-- `worker_trade_level_set` is a decision about a PERSON that will, once S4
-- lands, move their pay. Filing a promotion under the authoring action would
-- make "who changed this worker's level" unanswerable without parsing payloads.
--
-- Adding an enum value trips `03-audit-log-shape.test.sql`'s `enum_has_labels`
-- pin BY DESIGN — that array is updated in the same PR rather than weakened.

alter type public.audit_action add value if not exists 'skill_map_change';
alter type public.audit_action add value if not exists 'worker_trade_level_set';
