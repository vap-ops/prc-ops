-- ADR 0010: Visitor default role — Part 2 of 2
-- Changes the public.users.role column default from 'site_admin' to 'visitor'.
--
-- The default role is set as a column default on public.users.role
-- (see 20260505143544_create_users.sql line 7). The on_auth_user_created
-- trigger's handle_new_user() function inserts only `id` and relies on
-- the column default to fill in `role`. Changing the column default is
-- therefore sufficient — the trigger function does not need to change.
--
-- Existing rows are unaffected; defaults apply only to new inserts.

ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'visitor';
