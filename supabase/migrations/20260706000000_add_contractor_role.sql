-- Spec 130 U1 / ADR 0051 — external partner tier: the `contractor` user role.
--
-- ALTER TYPE ... ADD VALUE cannot be referenced in the txn that adds it, so the
-- value lands here (own migration) and the claim RPC that writes
-- role='contractor' lives in the next migration (20260706000100). Same split as
-- the six-roles add (20260520143100). Per CLAUDE.md, role enum changes need an
-- ADR — ADR 0051.
--
-- Enum-label pin to update (grep-all-enum-pins lesson): the full user_role label
-- set is asserted in supabase/tests/database/01-users.test.sql (the only pin).

alter type public.user_role add value if not exists 'contractor';
