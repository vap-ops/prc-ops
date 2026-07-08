-- ============================================================================
-- Spec 284 U3 / ADR 0080 dec 10 — Legal CONTRACTS on the money/document posture.
--
-- The Legal department's first money/document entity. Clones the subcontracts
-- shape (spec 251: counterparty, agreed_amount, sign_date, status, document_path)
-- + the contact_attachments append-only pattern (spec 97). Two tables:
--   contracts            — the deal header (mutable via update_/void_contract).
--   contract_attachments — signed documents, APPEND-ONLY + supersede (block
--                          trigger raises on UPDATE/DELETE for every role).
--
-- MONEY/DOCUMENT posture (binding — ADR 0055 dec 6 / spec 46, verified against
-- subcontracts / contact_attachments / dc_payments): both tables are
-- ZERO authenticated grant (RLS on, NO policies) — read only via the service-role
-- admin client behind requireRole(LEGAL_ROLES), never a site_admin-reachable
-- screen; written only by the SECURITY DEFINER RPCs below, each gated
-- LEGAL_ROLES (legal, super_admin) FAIL-CLOSED via `is distinct from` (a null-role
-- unbound caller raises 42501, never falls through — the rls-self-check-coalesce
-- trap), with anon/public EXECUTE revoked INLINE (brand-new fns → no separate lock
-- migration; the 229 anon-default-privilege invariant).
--
-- NO mixed-content counterparty_id (CLAUDE.md L22): the counterparty is a
-- denormalized `counterparty_name` (+ `counterparty_type`). A hard link, if ever
-- needed, is a typed nullable FK per kind — not in v1 (ADR 0080).
--
-- Additive only. Status is a Postgres enum (never free text). No GL/audit posting
-- this unit — contracts record the deal + documents; money movement stays in the
-- payment entities (subcontracts / dc_payments).
-- ============================================================================

-- ---- 1. Enums --------------------------------------------------------------
create type public.contract_counterparty_type as enum ('client', 'contractor', 'supplier', 'other');
create type public.contract_type              as enum ('client_agreement', 'subcontract', 'supply', 'nda', 'other');
create type public.contract_status            as enum ('draft', 'active', 'expired', 'terminated', 'void');

-- ---- 2. contracts — the deal header ----------------------------------------
create table public.contracts (
  id                uuid primary key default gen_random_uuid(),
  counterparty_type public.contract_counterparty_type not null,
  counterparty_name text not null,                       -- denormalized; NO mixed-content FK (CLAUDE.md L22)
  project_id        uuid references public.projects (id),
  contract_type     public.contract_type not null,
  title             text not null,
  agreed_amount     numeric(14, 2),                      -- nullable: an NDA has no value
  currency          text not null default 'THB',
  sign_date         date,
  effective_date    date,
  expiry_date       date,
  status            public.contract_status not null default 'draft',
  document_path     text,
  created_by        uuid references public.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contracts_counterparty_name_nonblank check (length(btrim(counterparty_name)) > 0),
  constraint contracts_counterparty_name_len      check (length(counterparty_name) <= 200),
  constraint contracts_title_nonblank             check (length(btrim(title)) > 0),
  constraint contracts_title_len                  check (length(title) <= 200),
  constraint contracts_amount_pos                 check (agreed_amount is null or agreed_amount > 0),
  constraint contracts_currency_shape             check (length(btrim(currency)) between 1 and 8),
  constraint contracts_document_path_len          check (document_path is null or length(btrim(document_path)) between 1 and 400)
);
create index contracts_project_idx on public.contracts (project_id) where project_id is not null;
create index contracts_status_idx  on public.contracts (status);

create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

alter table public.contracts enable row level security;
revoke all on public.contracts from anon, authenticated;   -- zero-grant; admin-client reads only

comment on table public.contracts is
  'Legal contract deal header (spec 284 / ADR 0080) — counterparty (denormalized name + type, NO mixed-content id), optional project, agreed value, lifecycle status enum, and a document. MONEY/DOCUMENT DOMAIN — zero authenticated grant (RLS on, no policies); read via the service-role admin client behind requireRole(LEGAL_ROLES); written only by create_/update_/void_contract. Never reaches a site_admin screen (spec 46).';

-- ---- 3. contract_attachments — append-only + supersede ---------------------
create table public.contract_attachments (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts (id),
  storage_path  text not null,
  uploaded_by   uuid references public.users (id),
  created_at    timestamptz not null default now(),
  superseded_by uuid references public.contract_attachments (id),   -- correction = a supersede row, never a mutate
  constraint contract_attachments_path_shape check (length(btrim(storage_path)) between 1 and 400)
);
create index contract_attachments_contract_idx   on public.contract_attachments (contract_id, created_at desc);
create index contract_attachments_superseded_idx on public.contract_attachments (superseded_by)
  where superseded_by is not null;

-- Append-only block trigger (contact_attachments / audit_log doctrine): INSERT
-- passes; UPDATE/DELETE/TRUNCATE raise P0001 for every role, incl. the definer.
create function public.contract_attachments_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'contract_attachments is append-only: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger contract_attachments_block_update_delete
  before update or delete on public.contract_attachments
  for each row execute function public.contract_attachments_block_write();
create trigger contract_attachments_block_truncate
  before truncate on public.contract_attachments
  for each statement execute function public.contract_attachments_block_write();

alter table public.contract_attachments enable row level security;
revoke all on public.contract_attachments from anon, authenticated;

comment on table public.contract_attachments is
  'Signed documents for a contract (spec 284). APPEND-ONLY + supersede (contact_attachments posture, block trigger). Zero authenticated grant; read via the admin client behind requireRole(LEGAL_ROLES); written only by add_contract_attachment.';

-- ---- 4. RPCs — SECURITY DEFINER, LEGAL_ROLES fail-closed, anon/public revoked
-- Gate shape: `v_role is distinct from 'legal' and v_role is distinct from
-- 'super_admin'` — a null (unbound) role satisfies both → raises. Called on the
-- USER session (auth.uid()/current_user_role() resolve); the service-role admin
-- client, having no JWT, would 42501 the gate — so writes never go through it.

-- Required fields first; the optional project + amount trail WITH defaults, so
-- the generated rpc arg types make them optional (a contract may be project-less,
-- e.g. an NDA, and amount-less). Postgres forbids a defaulted param before a
-- non-defaulted one, hence the order.
create function public.create_contract(
  p_counterparty_type public.contract_counterparty_type,
  p_counterparty_name text,
  p_contract_type     public.contract_type,
  p_title             text,
  p_project_id        uuid default null,
  p_agreed_amount     numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  public.user_role := public.current_user_role();
  v_name  text := nullif(btrim(coalesce(p_counterparty_name, '')), '');
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_id    uuid;
begin
  if v_role is distinct from 'legal' and v_role is distinct from 'super_admin' then
    raise exception 'create_contract: role not permitted' using errcode = '42501';
  end if;
  if p_counterparty_type is null then
    raise exception 'create_contract: counterparty_type required' using errcode = 'P0001';
  end if;
  if v_name is null or length(v_name) > 200 then
    raise exception 'create_contract: counterparty_name required (<=200)' using errcode = 'P0001';
  end if;
  if p_contract_type is null then
    raise exception 'create_contract: contract_type required' using errcode = 'P0001';
  end if;
  if v_title is null or length(v_title) > 200 then
    raise exception 'create_contract: title required (<=200)' using errcode = 'P0001';
  end if;
  if p_agreed_amount is not null and p_agreed_amount <= 0 then
    raise exception 'create_contract: agreed_amount must be > 0 when set' using errcode = 'P0001';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'create_contract: project not found' using errcode = 'P0001';
  end if;

  insert into public.contracts
    (counterparty_type, counterparty_name, project_id, contract_type, title, agreed_amount, created_by)
  values
    (p_counterparty_type, v_name, p_project_id, p_contract_type, v_title, p_agreed_amount, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function
  public.create_contract(public.contract_counterparty_type, text, public.contract_type, text, uuid, numeric)
  from public, anon;
grant execute on function
  public.create_contract(public.contract_counterparty_type, text, public.contract_type, text, uuid, numeric)
  to authenticated;

-- update_contract — coalesce semantics (an omitted field is preserved, matches
-- update_subcontract). status transitions run through here (except void).
create function public.update_contract(
  p_id                uuid,
  p_counterparty_name text default null,
  p_project_id        uuid default null,
  p_title             text default null,
  p_agreed_amount     numeric default null,
  p_sign_date         date default null,
  p_effective_date    date default null,
  p_expiry_date       date default null,
  p_status            public.contract_status default null,
  p_document_path     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  public.user_role := public.current_user_role();
  v_name  text := nullif(btrim(coalesce(p_counterparty_name, '')), '');
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_doc   text := nullif(btrim(coalesce(p_document_path, '')), '');
begin
  if v_role is distinct from 'legal' and v_role is distinct from 'super_admin' then
    raise exception 'update_contract: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contracts where id = p_id) then
    raise exception 'update_contract: contract not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 200 then
    raise exception 'update_contract: counterparty_name too long (<=200)' using errcode = 'P0001';
  end if;
  if v_title is not null and length(v_title) > 200 then
    raise exception 'update_contract: title too long (<=200)' using errcode = 'P0001';
  end if;
  if p_agreed_amount is not null and p_agreed_amount <= 0 then
    raise exception 'update_contract: agreed_amount must be > 0 when set' using errcode = 'P0001';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'update_contract: project not found' using errcode = 'P0001';
  end if;
  if v_doc is not null and length(v_doc) > 400 then
    raise exception 'update_contract: document_path too long (<=400)' using errcode = 'P0001';
  end if;

  update public.contracts
     set counterparty_name = coalesce(v_name, counterparty_name),
         project_id        = coalesce(p_project_id, project_id),
         title             = coalesce(v_title, title),
         agreed_amount     = coalesce(p_agreed_amount, agreed_amount),
         sign_date         = coalesce(p_sign_date, sign_date),
         effective_date    = coalesce(p_effective_date, effective_date),
         expiry_date       = coalesce(p_expiry_date, expiry_date),
         status            = coalesce(p_status, status),
         document_path     = coalesce(v_doc, document_path)
   where id = p_id;
end;
$$;
revoke all on function
  public.update_contract(uuid, text, uuid, text, numeric, date, date, date, public.contract_status, text)
  from public, anon;
grant execute on function
  public.update_contract(uuid, text, uuid, text, numeric, date, date, date, public.contract_status, text)
  to authenticated;

-- void_contract — soft close: sets status='void', NEVER deletes the row.
create function public.void_contract(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is distinct from 'legal' and v_role is distinct from 'super_admin' then
    raise exception 'void_contract: role not permitted' using errcode = '42501';
  end if;
  update public.contracts set status = 'void' where id = p_id;
  if not found then
    raise exception 'void_contract: contract not found' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.void_contract(uuid) from public, anon;
grant execute on function public.void_contract(uuid) to authenticated;

-- add_contract_attachment — append-only insert of a signed document.
create function public.add_contract_attachment(p_contract_id uuid, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_id   uuid;
begin
  if v_role is distinct from 'legal' and v_role is distinct from 'super_admin' then
    raise exception 'add_contract_attachment: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contracts where id = p_contract_id) then
    raise exception 'add_contract_attachment: contract not found' using errcode = 'P0001';
  end if;
  if v_path is null or length(v_path) > 400 then
    raise exception 'add_contract_attachment: storage_path required (<=400)' using errcode = 'P0001';
  end if;

  insert into public.contract_attachments (contract_id, storage_path, uploaded_by)
  values (p_contract_id, v_path, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_contract_attachment(uuid, text) from public, anon;
grant execute on function public.add_contract_attachment(uuid, text) to authenticated;
