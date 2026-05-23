-- ADR 0011: Resolve users RLS infinite recursion via current_user_role() helper.
-- See docs/decisions/0011-rls-role-helper.md.
--
-- Background: the "super_admin full access on users" policy in
-- 20260505143544_create_users.sql self-joined public.users inside its
-- USING/WITH CHECK clauses. Reading public.users triggered the policy, which
-- queried public.users, which re-triggered the policy → Postgres raises
-- "infinite recursion detected in policy for relation users".
--
-- Discovered during the LINE-auth spike live test on 2026-05-23 (see
-- docs/feature-specs/01-line-auth-FINDINGS.md, "Real bug discovered").
--
-- Fix: introduce a SECURITY DEFINER helper that reads the caller's own role
-- bypassing RLS, and rewrite the policy to call it. The function is safe by
-- construction (no parameters; returns only the caller's own role; search_path
-- pinned; STABLE; granted only to authenticated). See ADR 0011 for the full
-- safety derivation.

create function public.current_user_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

grant execute on function public.current_user_role() to authenticated;

-- Drop the recursive policy and recreate it on top of the helper. The previous
-- policy self-joined public.users; the new one calls current_user_role(),
-- which bypasses RLS via SECURITY DEFINER and therefore cannot re-trigger this
-- policy.
drop policy "super_admin full access on users" on public.users;

create policy "super_admin full access on users"
  on public.users for all
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

-- The "users read self" policy (auth.uid() = id) is intentionally left
-- untouched — it never queried users, so it never recursed.
