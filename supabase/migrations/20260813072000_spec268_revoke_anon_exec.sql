-- Spec 268 follow-up — strip anon EXECUTE from the re-created
-- create_equipment_rental_batch.
--
-- 071900's DROP/CREATE re-triggered Supabase's schema default privileges,
-- which grant EXECUTE on new public functions to anon/authenticated/
-- service_role as EXPLICIT role grants — so 071900's `revoke ... from public`
-- did not touch anon's fresh grant, reopening the exact hole migration
-- 20260813002500 (anon-exec definer harden) closed. pgTAP file 100 caught it
-- ("anon cannot execute create_equipment_rental_batch" red). Same lesson as
-- that sweep: after any DROP/CREATE of a definer, revoke anon EXPLICITLY.

revoke all on function public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period) from anon;
