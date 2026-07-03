-- Spec 258 U1b — subcontract crew register (ลูกทีมผู้รับเหมาช่วง). Operator ask:
-- "We also need their team members' ID card under each contract" (alongside the
-- WP-owner's own ID card + bank, which already exist: contact_attachments +
-- contact_bank, both keyed by contractor_id).
--
-- A subcontractor firm's crew is a THIRD person category — not `workers` (the
-- firm pays its own crew, ADR 0062 untouched: no day_rate/payroll/Nova/labor
-- logs here) and not `contact_attachments` (that table's load-bearing
-- invariant is "site_admin can never see it", spec 97 — it holds the FIRM's
-- PII/bank, a PM-administrative concern). Crew documents exist FOR the site
-- gate — site_admin is exactly who needs them.
--
-- Two tables:
--   subcontract_crew_members     — per-contract register (not a durable person
--                                  entity — operator decision; re-entered on
--                                  the firm's next contract).
--   subcontract_crew_attachments — append-only doc scans (id_card/work_permit),
--                                  mirrors contact_attachments mechanics.
--
-- RLS — DELIBERATE INVERSION of the spec-97 posture: site_admin gets READ
-- (project-scoped via can_see_project, same axis as other project-scoped
-- reads), because the whole point is field gate-checking. Real RLS
-- policy + authenticated grant (NOT the zero-grant money-domain shape — this
-- table carries no money). Writes: PM_ROLES only (is_manager()), via
-- SECURITY DEFINER RPCs. No delete ever (active=false = left the crew).

-- ----------------------------------------------------------------------------
-- 1. Enum.
create type public.crew_doc_purpose as enum ('id_card', 'work_permit');

-- ----------------------------------------------------------------------------
-- 2. subcontract_crew_members — per-contract register.
create table public.subcontract_crew_members (
  id                   uuid primary key default gen_random_uuid(),
  subcontract_id       uuid not null references public.subcontracts(id),
  name                 text not null,
  national_id_number   text null,
  nationality          text null,
  work_permit_number   text null,
  work_permit_expiry   date null,
  phone                text null,
  active               boolean not null default true,
  created_by           uuid not null references public.users(id),
  created_at           timestamptz not null default now(),
  constraint subcontract_crew_members_name_nonblank check (length(btrim(name)) > 0),
  constraint subcontract_crew_members_name_len       check (length(name) <= 120),
  constraint subcontract_crew_members_national_id_len check (national_id_number is null or length(national_id_number) <= 50),
  constraint subcontract_crew_members_nationality_len check (nationality is null or length(nationality) <= 80),
  constraint subcontract_crew_members_permit_no_len   check (work_permit_number is null or length(work_permit_number) <= 50),
  constraint subcontract_crew_members_phone_len       check (phone is null or length(phone) <= 50)
);
create index subcontract_crew_members_subcontract_idx
  on public.subcontract_crew_members (subcontract_id, active, name);

alter table public.subcontract_crew_members enable row level security;

-- Real authenticated grant (this table carries no money — unlike subcontracts/
-- subcontract_payments' zero-grant posture). site_admin + PM_ROLES, project-
-- scoped via can_see_project (same axis as other project-scoped reads).
grant select on public.subcontract_crew_members to authenticated;

create policy "subcontract_crew_members readable by pm and site_admin (project-scoped)"
  on public.subcontract_crew_members
  for select
  to authenticated
  using (
    (select public.current_user_role()) in
      ('site_admin', 'project_manager', 'super_admin', 'project_director')
    and exists (
      select 1 from public.subcontracts s
       where s.id = subcontract_crew_members.subcontract_id
         and public.can_see_project(s.project_id)
    )
  );

comment on table public.subcontract_crew_members is
  'Per-contract subcontractor crew register (spec 258) — NOT a durable person entity (operator decision). site_admin READ is a deliberate inversion of the spec-97 pin (field gate-checking is the point). Writes only via add_/update_crew_member RPCs (PM_ROLES). No delete ever — active=false marks departure.';

-- ----------------------------------------------------------------------------
-- 3. subcontract_crew_attachments — append-only doc scans (mirrors
-- contact_attachments mechanics).
create table public.subcontract_crew_attachments (
  id             uuid primary key default gen_random_uuid(),
  crew_member_id uuid not null references public.subcontract_crew_members(id),
  purpose        public.crew_doc_purpose not null,
  storage_path   text not null,
  uploaded_by    uuid not null references public.users(id),
  created_at     timestamptz not null default now(),
  constraint subcontract_crew_attachments_path_shape check (
    length(btrim(storage_path)) > 0 and length(storage_path) <= 400
  )
);
create index subcontract_crew_attachments_crew_member_idx
  on public.subcontract_crew_attachments (crew_member_id, purpose, created_at desc);

alter table public.subcontract_crew_attachments enable row level security;
grant select on public.subcontract_crew_attachments to authenticated;

create policy "subcontract_crew_attachments readable by pm and site_admin (project-scoped)"
  on public.subcontract_crew_attachments
  for select
  to authenticated
  using (
    (select public.current_user_role()) in
      ('site_admin', 'project_manager', 'super_admin', 'project_director')
    and exists (
      select 1 from public.subcontract_crew_members m
        join public.subcontracts s on s.id = m.subcontract_id
       where m.id = subcontract_crew_attachments.crew_member_id
         and public.can_see_project(s.project_id)
    )
  );

-- Append-only guard (contact_attachments / dc_payments posture): blocks even
-- SECURITY DEFINER / service-role mutation. The latest row per purpose wins
-- on display; there is no supersede chain here (a re-upload is just a new row).
create function public.subcontract_crew_attachments_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'subcontract_crew_attachments is append-only: no % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger subcontract_crew_attachments_block_update_delete
  before update or delete on public.subcontract_crew_attachments
  for each row execute function public.subcontract_crew_attachments_block_mutation();
create trigger subcontract_crew_attachments_block_truncate
  before truncate on public.subcontract_crew_attachments
  for each statement execute function public.subcontract_crew_attachments_block_mutation();

comment on table public.subcontract_crew_attachments is
  'Crew document scans (id_card/work_permit, spec 258) — APPEND-ONLY (latest per purpose wins). Same site_admin-READ inversion as subcontract_crew_members. Written only by add_crew_document (PM_ROLES).';

-- ----------------------------------------------------------------------------
-- 4. RPCs — SECURITY DEFINER, gated by is_manager() (null-safe fail-closed,
-- the 20260813051000 wrapper: project_manager/super_admin/project_director).
-- site_admin gets zero write path here — read only (operator decision 3).

create function public.add_crew_member(
  p_subcontract         uuid,
  p_name                text,
  p_national_id_number  text default null,
  p_nationality         text default null,
  p_work_permit_number  text default null,
  p_work_permit_expiry  date default null,
  p_phone               text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'add_crew_member: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subcontracts where id = p_subcontract) then
    raise exception 'add_crew_member: subcontract not found' using errcode = 'P0001';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'add_crew_member: invalid name' using errcode = 'P0001';
  end if;

  insert into public.subcontract_crew_members
    (subcontract_id, name, national_id_number, nationality, work_permit_number,
     work_permit_expiry, phone, created_by)
  values
    (p_subcontract, v_name,
     nullif(btrim(coalesce(p_national_id_number, '')), ''),
     nullif(btrim(coalesce(p_nationality, '')), ''),
     nullif(btrim(coalesce(p_work_permit_number, '')), ''),
     p_work_permit_expiry,
     nullif(btrim(coalesce(p_phone, '')), ''),
     auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_crew_member_add', auth.uid(), public.current_user_role(),
          'subcontract_crew_members', v_id,
          jsonb_build_object('subcontract_id', p_subcontract, 'name', v_name));
  return v_id;
end;
$$;
revoke all on function
  public.add_crew_member(uuid, text, text, text, text, date, text)
  from public, anon;
grant execute on function
  public.add_crew_member(uuid, text, text, text, text, date, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- update_crew_member — coalesce semantics (update_worker precedent): omitted
-- field preserved.
create function public.update_crew_member(
  p_id                  uuid,
  p_name                text default null,
  p_national_id_number  text default null,
  p_nationality         text default null,
  p_work_permit_number  text default null,
  p_work_permit_expiry  date default null,
  p_phone               text default null,
  p_active              boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'update_crew_member: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subcontract_crew_members where id = p_id) then
    raise exception 'update_crew_member: crew member not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_crew_member: invalid name' using errcode = 'P0001';
  end if;

  update public.subcontract_crew_members
     set name               = coalesce(v_name, name),
         national_id_number = coalesce(nullif(btrim(coalesce(p_national_id_number, '')), ''), national_id_number),
         nationality        = coalesce(nullif(btrim(coalesce(p_nationality, '')), ''), nationality),
         work_permit_number = coalesce(nullif(btrim(coalesce(p_work_permit_number, '')), ''), work_permit_number),
         work_permit_expiry = coalesce(p_work_permit_expiry, work_permit_expiry),
         phone              = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
         active             = coalesce(p_active, active)
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_crew_member_update', auth.uid(), public.current_user_role(),
          'subcontract_crew_members', p_id,
          jsonb_build_object('name', v_name, 'active', p_active));
end;
$$;
revoke all on function
  public.update_crew_member(uuid, text, text, text, text, date, text, boolean)
  from public, anon;
grant execute on function
  public.update_crew_member(uuid, text, text, text, text, date, text, boolean)
  to authenticated;

-- ----------------------------------------------------------------------------
-- add_crew_document — append-only insert.
create function public.add_crew_document(
  p_crew_member  uuid,
  p_purpose      public.crew_doc_purpose,
  p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'add_crew_document: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subcontract_crew_members where id = p_crew_member) then
    raise exception 'add_crew_document: crew member not found' using errcode = 'P0001';
  end if;
  if p_purpose is null then
    raise exception 'add_crew_document: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_crew_document: storage_path required' using errcode = 'P0001';
  end if;

  insert into public.subcontract_crew_attachments
    (crew_member_id, purpose, storage_path, uploaded_by)
  values (p_crew_member, p_purpose, v_path, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('subcontract_crew_document_add', auth.uid(), public.current_user_role(),
          'subcontract_crew_attachments', v_id,
          jsonb_build_object('crew_member_id', p_crew_member, 'purpose', p_purpose));
  return v_id;
end;
$$;
revoke all on function
  public.add_crew_document(uuid, public.crew_doc_purpose, text)
  from public, anon;
grant execute on function
  public.add_crew_document(uuid, public.crew_doc_purpose, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Storage — private bucket + path-bound upload policy (mirrors the
-- contact-docs bucket, 20260629000100). NO select policy — reads go through a
-- service-role-minted signed URL (U2, ADR 0015 exposure model), matching the
-- contact-docs precedent exactly. Path: {purpose}/{crewMemberId}/{attachmentId}.{ext}
-- -> foldername = [purpose, crewMemberId].
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subcontract-crew-docs',
  'subcontract-crew-docs',
  false,
  26214400,   -- 25 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "subcontract crew doc uploads by pm"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'subcontract-crew-docs'
    and public.is_manager(public.current_user_role())
    and array_length(storage.foldername(objects.name), 1) = 2
    and (storage.foldername(objects.name))[1] in ('id_card', 'work_permit')
  );
