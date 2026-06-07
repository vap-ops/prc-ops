-- ADR 0019 (amends ADR 0007). Restores privilege-layer defense for public.users.
-- Legit writers are unaffected: the auth callback writes via the service-role admin
-- client (retains privileges); public.update_my_display_name is SECURITY DEFINER
-- (runs as owner, not the caller's role). service_role is intentionally NOT revoked.
-- NOTE: after this, the super_admin "full access" RLS policy's UPDATE branch has no
-- privilege backing for session clients — a future in-app role-admin UI must use the
-- admin client or re-grant scoped UPDATE.
revoke update on public.users from authenticated, anon;
