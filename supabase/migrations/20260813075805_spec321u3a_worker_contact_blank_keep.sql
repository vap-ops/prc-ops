-- Spec 321 U3a — update_own_worker_profile: blank = keep (fixes S2 silent
-- data-loss). The prior body wrote nullif(btrim(p_x), '') into every column, so
-- a blank/omitted arg CLEARED the stored value — a partial edit (change only the
-- phone) wiped email + emergency contact. Switch to coalesce-keep: a blank/null
-- arg PRESERVES the stored value; only an explicit new value overwrites. This
-- mirrors the sibling update_own_staff_contact (spec 317). Signature, security,
-- and column scope are unchanged — this is a body-only CREATE OR REPLACE sourced
-- verbatim from the LIVE function.

create or replace function public.update_own_worker_profile(
  p_phone text default null,
  p_email text default null,
  p_emergency_name text default null,
  p_emergency_relation text default null,
  p_emergency_phone text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker uuid := public.current_user_worker_id();
begin
  if v_worker is null then
    raise exception 'update_own_worker_profile: caller is not a bound worker'
      using errcode = '42501';
  end if;
  update public.workers
     set phone                      = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
         email                      = coalesce(nullif(btrim(coalesce(p_email, '')), ''), email),
         emergency_contact_name     = coalesce(nullif(btrim(coalesce(p_emergency_name, '')), ''), emergency_contact_name),
         emergency_contact_relation = coalesce(nullif(btrim(coalesce(p_emergency_relation, '')), ''), emergency_contact_relation),
         emergency_contact_phone    = coalesce(nullif(btrim(coalesce(p_emergency_phone, '')), ''), emergency_contact_phone)
   where id = v_worker;
end;
$function$;
