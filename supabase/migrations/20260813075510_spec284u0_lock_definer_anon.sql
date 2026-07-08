-- ============================================================================
-- Spec 284 U0 — lock: revoke anon EXECUTE on the department DEFINER RPCs.
--
-- Supabase's default privileges grant EXECUTE to `anon` DIRECTLY on new functions
-- in the public schema, so the `revoke ... from public` in 075500 did NOT remove
-- anon's grant (public ≠ a direct anon grant). The zero-unsafe-gates invariant
-- (pgTAP 229: "no callable SECURITY DEFINER public function grants anon EXECUTE")
-- requires an explicit anon revoke. Own migration because 075500 is already
-- applied to the shared DB (editing it would silently no-op + drift). Mirrors
-- spec 273's 073700/073800 lock migrations.
-- ============================================================================
revoke execute on function public.create_department(text, text, text, int) from public, anon;
revoke execute on function public.set_department_head(uuid, uuid)            from public, anon;
revoke execute on function public.set_user_department(uuid, uuid)            from public, anon;
