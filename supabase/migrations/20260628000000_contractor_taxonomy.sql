-- Spec 83 — Contacts v2 Unit 1: contractor taxonomy + enrichment + DC backfill.
-- A "DC party" is ALREADY a contractors row (workers.contractor_id → contractors;
-- labor_logs.contractor_id_snapshot groups payroll by it). DC is therefore a
-- CLASSIFICATION of contractors, not a new table and not a worker_type split.
-- Additive only: every existing FK (work_packages.contractor_id,
-- workers.contractor_id + its CHECKs, labor_logs snapshot) stays byte-intact.

-- Enums. CREATE TYPE is txn-safe; a future ALTER TYPE ... ADD VALUE must be its
-- own migration (cannot be used in the same txn it is created — ADR-0008 lesson).
create type public.contact_status as enum ('active', 'probation', 'blacklisted');
create type public.contractor_category as enum ('contractor', 'dc');
create type public.contractor_subtype as enum
  ('regular', 'dc_company', 'dc_regular', 'dc_temporary');

alter table public.contractors
  add column contractor_category public.contractor_category not null default 'contractor',
  add column contractor_subtype  public.contractor_subtype,
  add column status              public.contact_status not null default 'active',
  add column contact_person  text,
  add column email           text,
  add column mailing_address text,
  add column tax_id          text,
  add column specialty       text;

alter table public.contractors
  add constraint contractors_subtype_matches_category check (
    contractor_subtype is null
    or (contractor_category = 'contractor' and contractor_subtype = 'regular')
    or (contractor_category = 'dc'
        and contractor_subtype in ('dc_company', 'dc_regular', 'dc_temporary'))
  ),
  add constraint contractors_contact_person_len
    check (contact_person is null or length(contact_person) <= 120),
  add constraint contractors_email_len
    check (email is null or length(email) <= 200),
  add constraint contractors_mailing_address_len
    check (mailing_address is null or length(mailing_address) <= 500),
  add constraint contractors_tax_id_len
    check (tax_id is null or length(tax_id) <= 50),
  add constraint contractors_specialty_len
    check (specialty is null or length(specialty) <= 200);

-- Column-scoped grants (masters_notes precedent). Rides the EXISTING contractors
-- INSERT/UPDATE policies (already eval-once-wrapped by 20260625000600); no policy
-- is dropped/created here, so pgTAP file 40 is untouched.
grant insert
  (contractor_category, contractor_subtype, status,
   contact_person, email, mailing_address, tax_id, specialty)
  on public.contractors to authenticated;
grant update
  (contractor_category, contractor_subtype, status,
   contact_person, email, mailing_address, tax_id, specialty)
  on public.contractors to authenticated;

-- DC reclassification ("DC wins", operator decision): any contractor referenced
-- by a DC worker is a DC party. Subtype left NULL for operator triage on /contacts.
update public.contractors c
   set contractor_category = 'dc'
 where exists (
   select 1 from public.workers w
    where w.contractor_id = c.id and w.worker_type = 'dc'
 );

comment on column public.contractors.contractor_category is
  'ผู้รับเหมา (contractor) vs DC crew (dc) — the /contacts tab discriminator. A DC party IS a contractors row (workers.contractor_id); DC is a classification, not a separate table (spec 83). Orthogonal to workers.worker_type.';
comment on column public.contractors.status is
  'active/probation/blacklisted lifecycle gate. blacklisted = hidden from assignment pickers, NEVER deleted (masters no-delete); payroll/history stay unfiltered. probation = assignable watch-flag.';
