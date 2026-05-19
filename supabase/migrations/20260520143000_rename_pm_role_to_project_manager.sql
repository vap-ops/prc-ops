-- ADR 0008: Role enum expansion — Part 1 of 2
-- Renames the existing `pm` enum value to `project_manager` for clarity
-- and consistency with CLAUDE.md role naming.
--
-- This rename does NOT affect existing rows. PostgreSQL stores enum values
-- internally as integers; only the label changes. All `WHERE role = 'pm'`
-- queries in application code must be updated to use 'project_manager'.

ALTER TYPE public.user_role RENAME VALUE 'pm' TO 'project_manager';