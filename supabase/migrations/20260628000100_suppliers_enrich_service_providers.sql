-- Spec 84 — Contacts v2 Unit 2: suppliers enrichment + service_providers table.
-- Additive only. suppliers FK (purchase_requests.supplier_id) unchanged;
-- service_providers is greenfield (no inbound FK).

-- suppliers (ผู้ขาย) enrichment ----------------------------------------------
alter table public.suppliers
  add column contact_person  text,
  add column email           text,
  add column mailing_address text,
  add column tax_id          text,
  add column payment_terms   text;

alter table public.suppliers
  add constraint suppliers_contact_person_len
    check (contact_person is null or length(contact_person) <= 120),
  add constraint suppliers_email_len
    check (email is null or length(email) <= 200),
  add constraint suppliers_mailing_address_len
    check (mailing_address is null or length(mailing_address) <= 500),
  add constraint suppliers_tax_id_len
    check (tax_id is null or length(tax_id) <= 50),
  add constraint suppliers_payment_terms_len
    check (payment_terms is null or length(payment_terms) <= 200);

grant insert (contact_person, email, mailing_address, tax_id, payment_terms)
  on public.suppliers to authenticated;
grant update (contact_person, email, mailing_address, tax_id, payment_terms)
  on public.suppliers to authenticated;

-- service_providers (ผู้ให้บริการ → รถขนส่ง) — NEW master --------------------
create type public.service_subtype as enum ('transport');

create table public.service_providers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  service_subtype public.service_subtype not null default 'transport',
  status          public.contact_status not null default 'active',
  phone           text,
  contact_person  text,
  email           text,
  mailing_address text,
  vehicle_type    text,
  plate_no        text,
  note            text,
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  constraint service_providers_name_nonblank check (length(trim(name)) > 0),
  constraint service_providers_contact_person_len check (contact_person is null or length(contact_person) <= 120),
  constraint service_providers_email_len           check (email is null or length(email) <= 200),
  constraint service_providers_mailing_address_len check (mailing_address is null or length(mailing_address) <= 500),
  constraint service_providers_vehicle_type_len    check (vehicle_type is null or length(vehicle_type) <= 100),
  constraint service_providers_plate_no_len        check (plate_no is null or length(plate_no) <= 50),
  constraint service_providers_note_len            check (note is null or length(note) <= 2000)
);

alter table public.service_providers enable row level security;
revoke all on public.service_providers from anon, authenticated;

grant select on public.service_providers to authenticated;
grant insert
  (id, name, service_subtype, status, phone, contact_person, email,
   mailing_address, vehicle_type, plate_no, note, created_by)
  on public.service_providers to authenticated;
grant update
  (name, service_subtype, status, phone, contact_person, email,
   mailing_address, vehicle_type, plate_no, note)
  on public.service_providers to authenticated;
-- NO delete grant/policy (masters posture); NO appsheet_writer grant (ADR 0034).

-- Policies authored eval-once-WRAPPED from day one (pgTAP file 40 scans all
-- public policies; a bare current_user_role()/auth.uid() would fail it).
create policy "service_providers readable by staff"
  on public.service_providers for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'super_admin'));

create policy "service_providers insert by pm or super_admin"
  on public.service_providers for insert to authenticated
  with check ((select public.current_user_role()) in ('project_manager', 'super_admin')
              and created_by = (select auth.uid()));

create policy "service_providers update by pm or super_admin"
  on public.service_providers for update to authenticated
  using ((select public.current_user_role()) in ('project_manager', 'super_admin'))
  with check ((select public.current_user_role()) in ('project_manager', 'super_admin'));

comment on table public.service_providers is
  'Service-provider master (ผู้ให้บริการ; v1 subtype รถขนส่ง/transport). Mutable, PM/super-managed, no delete (masters pattern, spec 84). status reuses contact_status. No appsheet_writer.';
