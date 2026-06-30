-- Spec 238 — assemblies (ADR 0066 / S10-U3, decision D7). Add the 'assembly'
-- value to catalog_item_kind (the facet enum from spec 224 / S2).
--
-- This is its OWN migration ON PURPOSE: `ALTER TYPE ... ADD VALUE` cannot be used
-- in the same transaction as a table/function/CHECK that references the new label
-- (the value is not visible until the adding transaction commits; with
-- check_function_bodies on, creating a function that casts to the new label in the
-- same txn would fail). The BOM table + RPCs + the explode function that USE
-- 'assembly' land in the next migration (042000), which runs as its own committed
-- transaction. Idempotent via IF NOT EXISTS.

alter type public.catalog_item_kind add value if not exists 'assembly';
