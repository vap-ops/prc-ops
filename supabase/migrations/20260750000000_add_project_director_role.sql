-- Spec 152 U1 / ADR 0058 — the `project_director` user role.
--
-- "Similar to super_admin" but the executive-director tier: a see-all
-- project_manager (PM permissions everywhere, visibility see-all instead of
-- membership-scoped), NOT a system operator (no user/role mgmt, no OperatorHub,
-- no notification internals — ADR 0058 §3).
--
-- ALTER TYPE ... ADD VALUE cannot be referenced in the txn that adds it, so the
-- value lands here (own migration); everything that USES it (can_see_project
-- see-all branch, RPC gates, RLS policies) lives in later migrations. Same split
-- as the contractor add (20260706000000) and the six-roles add (20260520143100).
-- Per CLAUDE.md, role enum changes need an ADR — ADR 0058.
--
-- Enum-label pin to update (grep-all-enum-pins lesson): the full user_role label
-- set is asserted in supabase/tests/database/01-users.test.sql (the only pin).

alter type public.user_role add value if not exists 'project_director';
