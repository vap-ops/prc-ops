-- ADR 0010: Visitor default role — Part 1 of 2
-- Adds the `visitor` value to public.user_role as the 10th enum value.
-- A visitor is an authenticated LINE user awaiting role assignment.
-- See ADR 0010 for context; ADR 0010 amends ADR 0007.
--
-- ALTER TYPE ADD VALUE cannot run in the same transaction as statements
-- that use the new value, so the column-default change is split into
-- Part 2 (20260522223814_change_user_default_role.sql).

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'visitor';
