-- rls-audit-2026-07 Pass B / M-B1 — null-safe role-set wrapper helpers (F1 root fix).
-- Highest-leverage: is_back_office / is_manager / is_site_staff are `select p_role
-- in (...)`, which returns NULL (not false) for a NULL role. Gates written
-- `if not public.is_back_office(current_user_role())` therefore evaluate
-- `not NULL` = NULL → the RAISE is skipped → the gate OPENS for a roleless JWT
-- (an authenticated principal whose sub has no public.users row — e.g. an
-- offboarded user with a live token). ~41 wrapper-form definer gates depend on
-- these, including post_journal_entry, reverse_journal_entry, record_dc_payment,
-- create/certify_client_billing, release_retention, record_wht_certificate,
-- upsert_gl_account, decide_contractor/worker_bank_change, set_worker_day_rate,
-- create/update_worker, create_project.
--
-- Fix: coalesce the membership test to false. Real roles behave identically
-- (in-list → true, out-of-list → false); NULL now yields false → gates fail
-- closed. Bodies are otherwise verbatim from LIVE (pg_get_functiondef,
-- 2026-07-02). CREATE OR REPLACE preserves grants; no signature change, so no
-- pin churn and no db:types drift.

create or replace function public.is_back_office(p_role user_role)
  returns boolean
  language sql
  immutable
as $function$
  select coalesce(p_role in ('project_manager', 'super_admin', 'procurement', 'project_director'), false)
$function$;

create or replace function public.is_manager(p_role user_role)
  returns boolean
  language sql
  immutable
as $function$
  select coalesce(p_role in ('project_manager', 'super_admin', 'project_director'), false)
$function$;

create or replace function public.is_site_staff(p_role user_role)
  returns boolean
  language sql
  immutable
as $function$
  select coalesce(p_role in ('site_admin', 'project_manager', 'super_admin', 'project_director'), false)
$function$;
