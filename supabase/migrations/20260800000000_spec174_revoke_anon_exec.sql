-- Spec 174 follow-up — revoke anon EXECUTE on the recreated update_project_settings.
--
-- 20260798 DROP+CREATE'd the RPC (to add p_gmap_url). Supabase ships an
-- ALTER DEFAULT PRIVILEGES that auto-grants EXECUTE on new functions to
-- anon + authenticated + service_role, so the recreate silently restored anon's
-- EXECUTE (the `revoke … from public` in 20260798 does not touch the explicit
-- anon grant). The pre-spec-174 RPC had anon revoked (pgTAP 32 pins it); restore
-- that. authenticated + service_role keep EXECUTE.
revoke execute on function public.update_project_settings(
  uuid, text, project_status, text, text, date, numeric, date, uuid, project_type, text) from anon;
