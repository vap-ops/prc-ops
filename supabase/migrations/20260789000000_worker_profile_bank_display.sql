-- Spec 170 / ADR 0062 U4c-1 — worker bank DISPLAY on the portal.
--
-- A DC sees their own payout account (read-only). The bank columns (U1) are
-- zero-grant PII, so the owner reads them through get_my_worker_profile (the
-- definer reader) — extended here to also return bank_name /
-- bank_account_number / bank_account_name. CREATE OR REPLACE cannot change a
-- function's return type (RETURNS TABLE shape), so DROP + CREATE; the spec-170
-- EXECUTE grant is re-applied.
--
-- This is display only. Self-service staged bank-change (anti-fraud → PM
-- approval, the ADR-0051 §6 flow) and documents are the heavier U4c remainder.

drop function public.get_my_worker_profile();

create function public.get_my_worker_profile()
returns table (
  name                       text,
  dc_arrangement             public.dc_arrangement,
  phone                      text,
  email                      text,
  tax_id                     text,
  emergency_contact_name     text,
  emergency_contact_relation text,
  emergency_contact_phone    text,
  date_of_birth              date,
  bank_name                  text,
  bank_account_number        text,
  bank_account_name          text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.name, w.dc_arrangement, w.phone, w.email, w.tax_id,
         w.emergency_contact_name, w.emergency_contact_relation,
         w.emergency_contact_phone, w.date_of_birth,
         w.bank_name, w.bank_account_number, w.bank_account_name
  from public.workers w
  where w.id = public.current_user_worker_id();
$$;
revoke all on function public.get_my_worker_profile() from public, anon;
grant execute on function public.get_my_worker_profile() to authenticated;
