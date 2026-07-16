-- Spec 321 (contractor-nullif follow-up) — update_own_contractor_profile:
-- blank = keep (fixes the latent S2 silent data-loss). The prior body wrote
-- nullif(btrim(p_x), '') into every column, so a blank/omitted arg CLEARED the
-- stored value — a partial edit (change only the phone) wiped email +
-- contact_person + mailing_address. This is the same class fixed for the worker
-- RPC in U3a; the contractor RPC was the last self-edit RPC still on
-- nullif-clear. Switch to coalesce-keep: a blank/null arg PRESERVES the stored
-- value; only an explicit new value overwrites. This mirrors the sibling
-- update_own_worker_profile / update_own_staff_contact. Signature, security, and
-- column scope are unchanged — a body-only CREATE OR REPLACE sourced verbatim
-- from the LIVE function.

create or replace function public.update_own_contractor_profile(
  p_phone text default null,
  p_email text default null,
  p_contact_person text default null,
  p_mailing_address text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contractor uuid := public.current_user_contractor_id();
begin
  if v_contractor is null then
    raise exception 'update_own_contractor_profile: caller is not a bound contractor'
      using errcode = '42501';
  end if;
  update public.contractors
     set phone           = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
         email           = coalesce(nullif(btrim(coalesce(p_email, '')), ''), email),
         contact_person  = coalesce(nullif(btrim(coalesce(p_contact_person, '')), ''), contact_person),
         mailing_address = coalesce(nullif(btrim(coalesce(p_mailing_address, '')), ''), mailing_address)
   where id = v_contractor;
end;
$function$;
