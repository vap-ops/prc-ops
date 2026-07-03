-- Spec 258 U1d — fix: can_see_subcontract (070300) was created without an
-- explicit revoke/grant pair, so Postgres defaulted it to PUBLIC EXECUTE
-- (includes anon). Every other RLS helper in this codebase (can_see_project,
-- can_see_wp) explicitly revokes from public/anon and grants only to
-- authenticated — this was a straight omission. Caught by the pgTAP
-- completeness pin (39-anon-exec-definer-harden.test.sql-family assertion):
-- "no callable SECURITY DEFINER public function grants anon EXECUTE".

revoke all on function public.can_see_subcontract(uuid) from public, anon;
grant execute on function public.can_see_subcontract(uuid) to authenticated;
