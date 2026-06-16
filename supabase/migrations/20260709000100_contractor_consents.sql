-- Spec 131 U1 — emergency contact + DOB on contractors, and the consent record.
--
-- Emergency contact / DOB are PII but NOT money — they ride the existing
-- contractors authenticated SELECT grant + RLS (incl. the spec-130 own-row read,
-- so a DC sees their own). Added to the column-scoped staff write grants.
-- DC self-edit of these is a spec-131 U2 concern (an own-row UPDATE policy);
-- this unit lets staff (PM/SA) enter them.
--
-- Consent is a first-class, dated, REVOCABLE record (PDPA): who/when/scope +
-- the signed doc. The check RESULT is out of scope here (a PM-only note, U2);
-- the check is run manually off-system.

alter table public.contractors
  add column emergency_contact_name     text,
  add column emergency_contact_relation text,
  add column emergency_contact_phone    text,
  add column date_of_birth              date,
  add constraint contractors_ec_name_len     check (emergency_contact_name is null or length(emergency_contact_name) <= 120),
  add constraint contractors_ec_relation_len check (emergency_contact_relation is null or length(emergency_contact_relation) <= 60),
  add constraint contractors_ec_phone_len    check (emergency_contact_phone is null or length(emergency_contact_phone) <= 30);

-- Extend the column-scoped staff write grants (additive to spec-83's grants).
grant insert (emergency_contact_name, emergency_contact_relation, emergency_contact_phone, date_of_birth)
  on public.contractors to authenticated;
grant update (emergency_contact_name, emergency_contact_relation, emergency_contact_phone, date_of_birth)
  on public.contractors to authenticated;

-- ----------------------------------------------------------------------------
-- contractor_consents — dated, scoped, revocable consent records.
-- ----------------------------------------------------------------------------
create type public.contractor_consent_kind as enum ('pdpa_data', 'background_check');

create table public.contractor_consents (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id),
  kind          public.contractor_consent_kind not null,
  consented_at  timestamptz not null default now(),
  recorded_by   uuid not null references public.users(id),
  document_id   uuid null,            -- → the uploaded signed consent (U2 storage)
  revoked_at    timestamptz null,
  created_at    timestamptz not null default now()
);
create index contractor_consents_contractor_idx on public.contractor_consents (contractor_id, kind);

alter table public.contractor_consents enable row level security;
revoke all on public.contractor_consents from anon, authenticated;
grant select on public.contractor_consents to authenticated;
-- Bound contractor reads own; staff (sa/pm/super) read all. Eval-once-wrapped.
-- Writes are RPC-only.
create policy "contractor_consents readable by bound contractor"
  on public.contractor_consents for select to authenticated
  using (contractor_id = (select public.current_user_contractor_id()));
create policy "contractor_consents readable by staff"
  on public.contractor_consents for select to authenticated
  using ((select public.current_user_role()) in ('site_admin', 'project_manager', 'super_admin'));

-- record: the bound contractor records OWN consent (portal), or staff records on
-- their behalf. Returns the consent id.
create function public.record_contractor_consent(
  p_contractor  uuid,
  p_kind        public.contractor_consent_kind,
  p_document_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_is_self  boolean := public.current_user_contractor_id() = p_contractor;
  v_is_staff boolean := public.current_user_role() in ('site_admin', 'project_manager', 'super_admin');
begin
  if not (v_is_self or v_is_staff) then
    raise exception 'record_contractor_consent: not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor) then
    raise exception 'record_contractor_consent: contractor not found' using errcode = 'P0001';
  end if;
  insert into public.contractor_consents (contractor_id, kind, recorded_by, document_id)
  values (p_contractor, p_kind, auth.uid(), p_document_id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_contractor_consent(uuid, public.contractor_consent_kind, uuid)
  from public, anon;
grant execute on function public.record_contractor_consent(uuid, public.contractor_consent_kind, uuid)
  to authenticated;

-- revoke (PDPA withdrawal): the bound contractor revokes own, or pm/super.
create function public.revoke_contractor_consent(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.contractor_consents%rowtype;
  v_is_self  boolean;
  v_is_staff boolean := public.current_user_role() in ('project_manager', 'super_admin');
begin
  select * into v_req from public.contractor_consents where id = p_id for update;
  if not found then
    raise exception 'revoke_contractor_consent: not found' using errcode = 'P0001';
  end if;
  v_is_self := public.current_user_contractor_id() = v_req.contractor_id;
  if not (v_is_self or v_is_staff) then
    raise exception 'revoke_contractor_consent: not permitted' using errcode = '42501';
  end if;
  update public.contractor_consents set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;
revoke all on function public.revoke_contractor_consent(uuid) from public, anon;
grant execute on function public.revoke_contractor_consent(uuid) to authenticated;
