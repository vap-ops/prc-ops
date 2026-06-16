-- Spec 131 U2b — let a bound DC self-edit their OWN emergency contact + DOB from
-- the portal.
--
-- Why an RPC, not an own-row UPDATE policy on contractors: RLS gates ROWS,
-- column grants gate COLUMNS — neither restricts "this caller may update only
-- THESE columns on their own row." authenticated already holds a broad UPDATE
-- column grant on contractors (name/status/tax_id/…, spec 83 + 131), so a
-- blanket own-row UPDATE policy would let a DC change their own status
-- (un-blacklist!) or tax_id. This SECURITY DEFINER RPC writes ONLY the four
-- emergency/DOB columns for current_user_contractor_id() — column scope by
-- construction. Emergency contact is not money, so it applies directly (no
-- staging — unlike bank, spec 130 U4).

create function public.update_own_emergency_contact(
  p_name     text,
  p_relation text,
  p_phone    text,
  p_dob      date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor uuid := public.current_user_contractor_id();
begin
  if v_contractor is null then
    raise exception 'update_own_emergency_contact: caller is not a bound contractor'
      using errcode = '42501';
  end if;
  update public.contractors
     set emergency_contact_name     = nullif(btrim(p_name), ''),
         emergency_contact_relation = nullif(btrim(p_relation), ''),
         emergency_contact_phone    = nullif(btrim(p_phone), ''),
         date_of_birth              = p_dob
   where id = v_contractor;
end;
$$;
revoke all on function public.update_own_emergency_contact(text, text, text, date) from public, anon;
grant execute on function public.update_own_emergency_contact(text, text, text, date) to authenticated;
