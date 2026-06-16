-- Spec 132 U1 — let a bound DC self-edit their OWN contactability fields from the
-- portal: phone, email, contact_person, mailing_address.
--
-- Why an RPC, not an own-row UPDATE policy on contractors: RLS gates ROWS, column
-- grants gate COLUMNS — neither restricts "this caller may update only THESE
-- columns on their own row." authenticated already holds a broad UPDATE column
-- grant on contractors (name/status/tax_id/…, spec 83 + 131), so a blanket own-row
-- UPDATE policy would let a DC change their own status (un-blacklist!), name, or
-- tax_id. This SECURITY DEFINER RPC writes ONLY the four contactability columns for
-- current_user_contractor_id() — column scope by construction (the spec-131-U2b
-- update_own_emergency_contact pattern). Contactability is not money, so it applies
-- directly (no staging — unlike bank, spec 130 U4; unlike tax_id, which stays
-- PM-entered from the uploaded ID card, spec 132).

create function public.update_own_contractor_profile(
  p_phone           text default null,
  p_email           text default null,
  p_contact_person  text default null,
  p_mailing_address text default null
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
    raise exception 'update_own_contractor_profile: caller is not a bound contractor'
      using errcode = '42501';
  end if;
  update public.contractors
     set phone           = nullif(btrim(p_phone), ''),
         email           = nullif(btrim(p_email), ''),
         contact_person  = nullif(btrim(p_contact_person), ''),
         mailing_address = nullif(btrim(p_mailing_address), '')
   where id = v_contractor;
end;
$$;
revoke all on function public.update_own_contractor_profile(text, text, text, text)
  from public, anon;
grant execute on function public.update_own_contractor_profile(text, text, text, text)
  to authenticated;
