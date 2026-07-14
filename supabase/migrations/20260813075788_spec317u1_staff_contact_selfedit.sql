-- Spec 317 U1 — universal profile self-service, instant tier (design approved
-- 2026-07-14; operator decisions: DOB -> approved tier, staff approver =
-- STAFF_APPROVAL_ROLES, enterprise two-tier instant/approved).
--
-- 1. NEW update_own_staff_contact — the office-staff hole: their identity record
--    (staff_registrations) could only be self-edited while PENDING, so an
--    approved staffer could change nothing. This RPC opens the CONTACT fields
--    (phone + emergency trio) on a pending OR approved own registration.
--    Name / DOB / declared_role_hint stay out of reach — identity tier, they go
--    through the spec 317 U3 approval flow. Coalesce-keep semantics (blank =
--    keep), mirroring update_own_staff_registration on the same table.
-- 2. update_own_worker_profile re-signatured 6 -> 5 args: p_dob DROPPED — DOB
--    moves to the approved tier. Old signature dropped (the deployed form errors
--    for the minutes between db:push and the Vercel deploy — accepted, same
--    class as spec 315 U2 / 279 F2b; body otherwise the LIVE definition
--    verbatim, pg_get_functiondef 2026-07-14).

create function public.update_own_staff_contact(
  p_phone                      text default null,
  p_emergency_contact_name    text default null,
  p_emergency_contact_relation text default null,
  p_emergency_contact_phone   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.staff_registrations%rowtype;
begin
  if v_uid is null then
    raise exception 'update_own_staff_contact: not authenticated' using errcode = '42501';
  end if;
  select * into v_row from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'update_own_staff_contact: no registration for this user'
      using errcode = 'P0001';
  end if;
  if v_row.status not in ('pending', 'approved') then
    raise exception 'update_own_staff_contact: registration is not editable'
      using errcode = 'P0001';
  end if;

  update public.staff_registrations
     set phone                      = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
         emergency_contact_name     = coalesce(nullif(btrim(coalesce(p_emergency_contact_name, '')), ''), emergency_contact_name),
         emergency_contact_relation = coalesce(nullif(btrim(coalesce(p_emergency_contact_relation, '')), ''), emergency_contact_relation),
         emergency_contact_phone    = coalesce(nullif(btrim(coalesce(p_emergency_contact_phone, '')), ''), emergency_contact_phone),
         updated_at                 = now()
   where id = v_row.id;
end;
$$;
revoke all on function public.update_own_staff_contact(text, text, text, text) from public, anon;
grant execute on function public.update_own_staff_contact(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- update_own_worker_profile — DOB out of the instant tier.
-- ----------------------------------------------------------------------------
drop function if exists public.update_own_worker_profile(text, text, text, text, text, date);

create function public.update_own_worker_profile(
  p_phone              text default null,
  p_email              text default null,
  p_emergency_name     text default null,
  p_emergency_relation text default null,
  p_emergency_phone    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker uuid := public.current_user_worker_id();
begin
  if v_worker is null then
    raise exception 'update_own_worker_profile: caller is not a bound worker'
      using errcode = '42501';
  end if;
  update public.workers
     set phone                      = nullif(btrim(p_phone), ''),
         email                      = nullif(btrim(p_email), ''),
         emergency_contact_name     = nullif(btrim(p_emergency_name), ''),
         emergency_contact_relation = nullif(btrim(p_emergency_relation), ''),
         emergency_contact_phone    = nullif(btrim(p_emergency_phone), '')
   where id = v_worker;
end;
$$;
revoke all on function public.update_own_worker_profile(text, text, text, text, text) from public, anon;
grant execute on function public.update_own_worker_profile(text, text, text, text, text) to authenticated;
