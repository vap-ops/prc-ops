-- ADR 0017 — Part 1 of 2: add 'profile_update' to public.audit_action.
--
-- The companion migration 20260607143001_create_update_my_display_name.sql
-- uses this enum value inside the SECURITY DEFINER RPC. ALTER TYPE ... ADD
-- VALUE cannot run in the same transaction as statements that reference the
-- new value, so the change is split into two migration files — the same
-- pattern used by ADR 0008 (six_new_user_roles) and ADR 0010 (visitor role).

alter type public.audit_action add value if not exists 'profile_update';
