-- Spec 97 — Contacts v2 Unit 7: contact documents (ID card + bank book).
-- Mirrors contact_bank (spec 85): a dedicated table with ZERO authenticated
-- access (RLS on, no policies/grants) — written only by the SECURITY DEFINER
-- add_contact_document RPC, read only by the service-role admin client (behind
-- requireRole pm/super). ID card = PII, bank book = bank-adjacent → PM-only.
--
-- APPEND-ONLY (purchase_request_attachments doctrine): no UPDATE/DELETE
-- grants/policies + a block trigger; the latest row per purpose wins on display.
-- The matching private storage bucket + path-bound policy is the next migration.

-- 1. Enum.
create type public.contact_doc_purpose as enum ('id_card', 'bank_book');

-- 2. Table — typed FKs (not polymorphic) with exactly-one set, like contact_bank.
create table public.contact_attachments (
  id                  uuid primary key default gen_random_uuid(),
  contractor_id       uuid references public.contractors(id),
  supplier_id         uuid references public.suppliers(id),
  service_provider_id uuid references public.service_providers(id),
  purpose             public.contact_doc_purpose not null,
  storage_path        text not null,
  uploaded_by         uuid not null references public.users(id),
  created_at          timestamptz not null default now(),
  constraint contact_attachments_exactly_one_target check (
    (contractor_id is not null)::int
    + (supplier_id is not null)::int
    + (service_provider_id is not null)::int = 1
  ),
  constraint contact_attachments_path_shape check (
    length(btrim(storage_path)) > 0 and length(storage_path) <= 400
  )
);

-- Latest-per-purpose lookups per target (created_at desc).
create index contact_attachments_contractor_idx
  on public.contact_attachments (contractor_id, purpose, created_at desc)
  where contractor_id is not null;
create index contact_attachments_supplier_idx
  on public.contact_attachments (supplier_id, purpose, created_at desc)
  where supplier_id is not null;
create index contact_attachments_service_provider_idx
  on public.contact_attachments (service_provider_id, purpose, created_at desc)
  where service_provider_id is not null;

-- 3. Append-only block trigger (audit_log / pr-attachments doctrine). Inserts
-- pass; update/delete/truncate raise P0001 for every role (incl. the definer).
create function public.contact_attachments_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'contact_attachments is append-only: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger contact_attachments_block_update_delete
  before update or delete on public.contact_attachments
  for each row execute function public.contact_attachments_block_write();

create trigger contact_attachments_block_truncate
  before truncate on public.contact_attachments
  for each statement execute function public.contact_attachments_block_write();

-- 4. RLS + grants — revoke-all-first; ZERO authenticated access (like
-- contact_bank). Service-role admin reads; the RPC below writes.
alter table public.contact_attachments enable row level security;
revoke all on public.contact_attachments from anon, authenticated;

-- 5. Write RPC — SECURITY DEFINER, PM/super only, called on the USER session
-- (current_user_role()/auth.uid() resolve; service-role has no JWT → would
-- 42501 the gate — spec 68/85 lesson). Stores the server-built storage_path.
create function public.add_contact_document(
  p_contractor_id       uuid default null,
  p_supplier_id         uuid default null,
  p_service_provider_id uuid default null,
  p_purpose             public.contact_doc_purpose default null,
  p_storage_path        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_targets int := (p_contractor_id is not null)::int
                 + (p_supplier_id is not null)::int
                 + (p_service_provider_id is not null)::int;
  v_path text := nullif(btrim(p_storage_path), '');
  v_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'add_contact_document: role not permitted' using errcode = '42501';
  end if;
  if v_targets <> 1 then
    raise exception 'add_contact_document: exactly one target required' using errcode = 'P0001';
  end if;
  if p_purpose is null then
    raise exception 'add_contact_document: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_contact_document: storage_path required' using errcode = 'P0001';
  end if;

  insert into public.contact_attachments
    (contractor_id, supplier_id, service_provider_id, purpose, storage_path, uploaded_by)
  values
    (p_contractor_id, p_supplier_id, p_service_provider_id, p_purpose, v_path, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function
  public.add_contact_document(uuid, uuid, uuid, public.contact_doc_purpose, text)
  from public, anon;
grant execute on function
  public.add_contact_document(uuid, uuid, uuid, public.contact_doc_purpose, text)
  to authenticated;

comment on table public.contact_attachments is
  'Contact documents (ID card / bank book) for paid contacts. PII + bank-adjacent: zero authenticated access (RLS on, no policies/grants); read via service-role admin behind requireRole(pm/super), write via add_contact_document RPC. Append-only (block trigger; latest per purpose wins). site_admin can never see it (spec 97).';
