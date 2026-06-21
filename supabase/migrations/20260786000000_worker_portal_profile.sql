-- Spec 170 / ADR 0062 U4b — DC worker portal profile (person-relevant fields).
--
-- A DC is a worker, so their self-service portal profile lives on the worker.
-- Operator (2026-06-21) chose person-relevant fields only: add email + emergency
-- contact (name/relation/phone) + date_of_birth (phone + tax_id already on the
-- worker from U1); the firm-shaped contractor fields (contact_person,
-- mailing_address, specialty) are NOT carried.
--
-- PII POSTURE (matches U1 phone/tax_id): these columns get NO authenticated
-- grant — the owner reads them through get_my_worker_profile() (a definer RPC,
-- the day_rate/get_my_dc_payments pattern), staff via the admin client. The
-- owner self-edits the six fields through update_own_worker_profile(), which is
-- column-scoped by construction (name/day_rate/tax_id stay out of reach — tax_id
-- is PM-entered from the ID card, mirroring the contractor profile).

alter table public.workers
  add column email                      text null,
  add column emergency_contact_name     text null,
  add column emergency_contact_relation text null,
  add column emergency_contact_phone    text null,
  add column date_of_birth              date null,
  add constraint workers_email_cap check (email is null or length(email) <= 200),
  add constraint workers_ec_name_cap
    check (emergency_contact_name is null or length(emergency_contact_name) <= 120),
  add constraint workers_ec_relation_cap
    check (emergency_contact_relation is null or length(emergency_contact_relation) <= 60),
  add constraint workers_ec_phone_cap
    check (emergency_contact_phone is null or length(emergency_contact_phone) <= 50);

-- ----------------------------------------------------------------------------
-- get_my_worker_profile() — the bound worker reads their OWN profile (incl. the
-- zero-grant PII columns) without granting them to authenticated. SECURITY
-- DEFINER + a hard current_user_worker_id() filter: an unbound/staff caller
-- (NULL worker) gets zero rows. day_rate / bank are NOT returned (money — bank
-- is U4c). The PM roster reads the worker via the admin client — untouched.
-- ----------------------------------------------------------------------------
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
  date_of_birth              date
)
language sql
stable
security definer
set search_path = public
as $$
  select w.name, w.dc_arrangement, w.phone, w.email, w.tax_id,
         w.emergency_contact_name, w.emergency_contact_relation,
         w.emergency_contact_phone, w.date_of_birth
  from public.workers w
  where w.id = public.current_user_worker_id();
$$;
revoke all on function public.get_my_worker_profile() from public, anon;
grant execute on function public.get_my_worker_profile() to authenticated;

-- ----------------------------------------------------------------------------
-- update_own_worker_profile(...) — the bound worker self-edits the six editable
-- profile fields. Why an RPC, not an own-row UPDATE policy: RLS gates ROWS,
-- column grants gate COLUMNS — neither restricts "this caller may update only
-- THESE columns on their own row." This SECURITY DEFINER RPC writes ONLY the six
-- fields for current_user_worker_id() — column scope by construction (the
-- update_own_contractor_profile pattern). Not money → applies directly.
-- ----------------------------------------------------------------------------
create function public.update_own_worker_profile(
  p_phone              text default null,
  p_email              text default null,
  p_emergency_name     text default null,
  p_emergency_relation text default null,
  p_emergency_phone    text default null,
  p_dob                date default null
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
         emergency_contact_phone    = nullif(btrim(p_emergency_phone), ''),
         date_of_birth              = p_dob
   where id = v_worker;
end;
$$;
revoke all on function public.update_own_worker_profile(text, text, text, text, text, date)
  from public, anon;
grant execute on function public.update_own_worker_profile(text, text, text, text, text, date)
  to authenticated;
