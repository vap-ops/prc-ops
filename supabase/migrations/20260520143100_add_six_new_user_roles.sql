-- ADR 0008: Role enum expansion — Part 2 of 2
-- Adds six new role values to public.user_role.
--
-- v2 roles:    project_coordinator, procurement
-- v2/v3 role:  technician
-- v3 roles:    hr, subcon_manager, accounting
--
-- These roles have no v1 features. Users assigned to them will land on
-- `/coming-soon` after LINE auth (route not yet implemented; tracked separately).
--
-- ALTER TYPE ADD VALUE cannot run inside a transaction block on some
-- PostgreSQL versions, which is why this is split from the rename in
-- the previous migration.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'project_coordinator';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'procurement';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'technician';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'hr';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'subcon_manager';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'accounting';