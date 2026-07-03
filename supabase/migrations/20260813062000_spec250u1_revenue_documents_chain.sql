-- Spec 250 U1 — revenue documents chain: quotation → client PO → contract + งวดเบิก.
--
-- quotations:            ใบเสนอราคา PRC sends the client (status pipeline).
-- client_pos:            the client's answering PO (ใบสั่งจ้าง).
-- project_contracts:     ONE contract per project (operator decision) — value,
--                        retention %, dates, document.
-- contract_installments: the งวดเบิก rows a billing can claim against.
-- client_billings.installment_id: which งวด a claim draws (nullable, additive).
--
-- Every chain link is NULLABLE BOTH DIRECTIONS — the recurring real case is a
-- client who is slow on paper but already paying: receipts (spec 249) and
-- billings must never be blocked by a missing quotation/PO/contract. The chain
-- is documentation, not a workflow gate. Σ(installments) = contract_value is
-- deliberately NOT enforced (UI warns).
--
-- MONEY DOMAIN posture (matches client_billings): RLS on, ZERO authenticated
-- grant, admin-read behind the /accounting app gates, writes only via the
-- SECURITY DEFINER RPCs below — all gated is_manager() (null-safe, fail-closed),
-- all audited.

create type public.quotation_status as enum ('draft', 'sent', 'accepted', 'rejected');

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.quotations (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id),
  quotation_no   text not null,
  amount         numeric(14,2) not null,
  quote_date     date not null,
  status         public.quotation_status not null default 'draft',
  note           text null,
  document_path  text null,
  created_by     uuid not null references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint quotations_amount_pos check (amount > 0),
  constraint quotations_no_len     check (length(quotation_no) between 1 and 60),
  constraint quotations_note_len   check (note is null or length(note) <= 500),
  constraint quotations_project_no_uniq unique (project_id, quotation_no)
);
create index quotations_project_idx on public.quotations (project_id);

create table public.client_pos (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id),
  quotation_id   uuid null references public.quotations(id),
  po_no          text not null,
  amount         numeric(14,2) not null,
  po_date        date not null,
  note           text null,
  document_path  text null,
  created_by     uuid not null references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint client_pos_amount_pos check (amount > 0),
  constraint client_pos_no_len     check (length(po_no) between 1 and 60),
  constraint client_pos_note_len   check (note is null or length(note) <= 500),
  constraint client_pos_project_no_uniq unique (project_id, po_no)
);
create index client_pos_project_idx on public.client_pos (project_id);

create table public.project_contracts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) unique,
  quotation_id    uuid null references public.quotations(id),
  client_po_id    uuid null references public.client_pos(id),
  contract_no     text null,
  contract_value  numeric(14,2) not null,
  retention_rate  numeric(5,2) not null default 5,
  sign_date       date null,
  start_date      date null,
  end_date        date null,
  note            text null,
  document_path   text null,
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint project_contracts_value_pos check (contract_value > 0),
  constraint project_contracts_ret_rate  check (retention_rate >= 0 and retention_rate <= 100),
  constraint project_contracts_no_len    check (contract_no is null or length(contract_no) <= 60),
  constraint project_contracts_note_len  check (note is null or length(note) <= 500),
  constraint project_contracts_date_order check
    (end_date is null or start_date is null or end_date >= start_date)
);

create table public.contract_installments (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.project_contracts(id) on delete cascade,
  seq           smallint not null,
  label         text not null,
  amount        numeric(14,2) not null,
  planned_date  date null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint contract_installments_seq_pos    check (seq > 0),
  constraint contract_installments_amount_pos check (amount > 0),
  constraint contract_installments_label_len  check (length(label) between 1 and 200),
  constraint contract_installments_seq_uniq   unique (contract_id, seq)
);
create index contract_installments_contract_idx on public.contract_installments (contract_id);

alter table public.client_billings
  add column installment_id uuid null references public.contract_installments(id);
create index client_billings_installment_idx on public.client_billings (installment_id)
  where installment_id is not null;

create trigger quotations_set_updated_at
  before update on public.quotations
  for each row execute function public.set_updated_at();
create trigger client_pos_set_updated_at
  before update on public.client_pos
  for each row execute function public.set_updated_at();
create trigger project_contracts_set_updated_at
  before update on public.project_contracts
  for each row execute function public.set_updated_at();
create trigger contract_installments_set_updated_at
  before update on public.contract_installments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Same-project link guards (documentation chain, but never a cross-project one)
-- ----------------------------------------------------------------------------

create function public.client_pos_check_quotation_project()
returns trigger
language plpgsql
as $$
begin
  if new.quotation_id is not null then
    if not exists (select 1 from public.quotations q
                    where q.id = new.quotation_id and q.project_id = new.project_id) then
      raise exception 'client_pos: quotation belongs to another project' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger client_pos_quotation_project
  before insert or update of quotation_id, project_id on public.client_pos
  for each row execute function public.client_pos_check_quotation_project();

create function public.project_contracts_check_links_project()
returns trigger
language plpgsql
as $$
begin
  if new.quotation_id is not null then
    if not exists (select 1 from public.quotations q
                    where q.id = new.quotation_id and q.project_id = new.project_id) then
      raise exception 'project_contracts: quotation belongs to another project' using errcode = '22023';
    end if;
  end if;
  if new.client_po_id is not null then
    if not exists (select 1 from public.client_pos p
                    where p.id = new.client_po_id and p.project_id = new.project_id) then
      raise exception 'project_contracts: client PO belongs to another project' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger project_contracts_links_project
  before insert or update of quotation_id, client_po_id, project_id on public.project_contracts
  for each row execute function public.project_contracts_check_links_project();

create function public.client_billings_check_installment_project()
returns trigger
language plpgsql
as $$
begin
  if new.installment_id is not null then
    if not exists (
      select 1
        from public.contract_installments ci
        join public.project_contracts pc on pc.id = ci.contract_id
       where ci.id = new.installment_id and pc.project_id = new.project_id) then
      raise exception 'client_billings: installment belongs to another project' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger client_billings_installment_project
  before insert or update of installment_id on public.client_billings
  for each row execute function public.client_billings_check_installment_project();

-- ----------------------------------------------------------------------------
-- MONEY DOMAIN lockdown
-- ----------------------------------------------------------------------------

alter table public.quotations            enable row level security;
alter table public.client_pos            enable row level security;
alter table public.project_contracts     enable row level security;
alter table public.contract_installments enable row level security;
revoke all on public.quotations            from anon, authenticated;
revoke all on public.client_pos            from anon, authenticated;
revoke all on public.project_contracts     from anon, authenticated;
revoke all on public.contract_installments from anon, authenticated;

comment on table public.quotations is
  'ใบเสนอราคา sent to the client (spec 250). MONEY DOMAIN — zero authenticated grant; admin-read behind /accounting gates; written only by create_/update_quotation.';
comment on table public.client_pos is
  'Client purchase orders answering a quotation (spec 250). MONEY DOMAIN — zero grant; nullable quotation link (chain never blocks).';
comment on table public.project_contracts is
  'ONE contract per project (spec 250, operator decision): value + retention % + dates + document. MONEY DOMAIN — zero grant.';
comment on table public.contract_installments is
  'งวดเบิก rows of a contract (spec 250); client_billings.installment_id claims against them. MONEY DOMAIN — zero grant.';

-- ----------------------------------------------------------------------------
-- Write RPCs — SECURITY DEFINER, is_manager() gate (null-safe), audited
-- ----------------------------------------------------------------------------

create function public.create_quotation(
  p_project_id    uuid,
  p_quotation_no  text,
  p_amount        numeric,
  p_quote_date    date,
  p_note          text default null,
  p_document_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_quotation: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'create_quotation: project not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'create_quotation: amount must be > 0' using errcode = 'P0001';
  end if;

  insert into public.quotations (project_id, quotation_no, amount, quote_date, note, document_path, created_by)
  values (p_project_id, btrim(p_quotation_no), p_amount, p_quote_date,
          nullif(btrim(coalesce(p_note,'')),''), nullif(btrim(coalesce(p_document_path,'')),''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('quotation_create', auth.uid(), public.current_user_role(), 'quotations', v_id,
          jsonb_build_object('project_id', p_project_id, 'quotation_no', p_quotation_no, 'amount', p_amount));
  return v_id;
end;
$$;
revoke all on function public.create_quotation(uuid, text, numeric, date, text, text) from public, anon;
grant execute on function public.create_quotation(uuid, text, numeric, date, text, text) to authenticated;

create function public.update_quotation(
  p_id            uuid,
  p_status        public.quotation_status default null,
  p_quotation_no  text default null,
  p_amount        numeric default null,
  p_quote_date    date default null,
  p_note          text default null,
  p_document_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'update_quotation: role not permitted' using errcode = '42501';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'update_quotation: amount must be > 0' using errcode = 'P0001';
  end if;

  update public.quotations
     set status        = coalesce(p_status, status),
         quotation_no  = coalesce(nullif(btrim(coalesce(p_quotation_no,'')),''), quotation_no),
         amount        = coalesce(p_amount, amount),
         quote_date    = coalesce(p_quote_date, quote_date),
         note          = coalesce(nullif(btrim(coalesce(p_note,'')),''), note),
         document_path = coalesce(nullif(btrim(coalesce(p_document_path,'')),''), document_path)
   where id = p_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'update_quotation: quotation not found' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('quotation_update', auth.uid(), public.current_user_role(), 'quotations', p_id,
          jsonb_build_object('status', p_status, 'amount', p_amount));
  return p_id;
end;
$$;
revoke all on function public.update_quotation(uuid, public.quotation_status, text, numeric, date, text, text) from public, anon;
grant execute on function public.update_quotation(uuid, public.quotation_status, text, numeric, date, text, text) to authenticated;

create function public.create_client_po(
  p_project_id    uuid,
  p_po_no         text,
  p_amount        numeric,
  p_po_date       date,
  p_quotation_id  uuid default null,
  p_note          text default null,
  p_document_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_client_po: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'create_client_po: project not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'create_client_po: amount must be > 0' using errcode = 'P0001';
  end if;

  insert into public.client_pos (project_id, quotation_id, po_no, amount, po_date, note, document_path, created_by)
  values (p_project_id, p_quotation_id, btrim(p_po_no), p_amount, p_po_date,
          nullif(btrim(coalesce(p_note,'')),''), nullif(btrim(coalesce(p_document_path,'')),''), auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_po_create', auth.uid(), public.current_user_role(), 'client_pos', v_id,
          jsonb_build_object('project_id', p_project_id, 'po_no', p_po_no, 'amount', p_amount,
                             'quotation_id', p_quotation_id));
  return v_id;
end;
$$;
revoke all on function public.create_client_po(uuid, text, numeric, date, uuid, text, text) from public, anon;
grant execute on function public.create_client_po(uuid, text, numeric, date, uuid, text, text) to authenticated;

create function public.update_client_po(
  p_id            uuid,
  p_po_no         text default null,
  p_amount        numeric default null,
  p_po_date       date default null,
  p_quotation_id  uuid default null,
  p_note          text default null,
  p_document_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'update_client_po: role not permitted' using errcode = '42501';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'update_client_po: amount must be > 0' using errcode = 'P0001';
  end if;

  update public.client_pos
     set po_no         = coalesce(nullif(btrim(coalesce(p_po_no,'')),''), po_no),
         amount        = coalesce(p_amount, amount),
         po_date       = coalesce(p_po_date, po_date),
         quotation_id  = coalesce(p_quotation_id, quotation_id),
         note          = coalesce(nullif(btrim(coalesce(p_note,'')),''), note),
         document_path = coalesce(nullif(btrim(coalesce(p_document_path,'')),''), document_path)
   where id = p_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'update_client_po: client PO not found' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_po_update', auth.uid(), public.current_user_role(), 'client_pos', p_id,
          jsonb_build_object('amount', p_amount, 'quotation_id', p_quotation_id));
  return p_id;
end;
$$;
revoke all on function public.update_client_po(uuid, text, numeric, date, uuid, text, text) from public, anon;
grant execute on function public.update_client_po(uuid, text, numeric, date, uuid, text, text) to authenticated;

create function public.upsert_project_contract(
  p_project_id     uuid,
  p_contract_value numeric,
  p_retention_rate numeric default 5,
  p_quotation_id   uuid default null,
  p_client_po_id   uuid default null,
  p_contract_no    text default null,
  p_sign_date      date default null,
  p_start_date     date default null,
  p_end_date       date default null,
  p_note           text default null,
  p_document_path  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'upsert_project_contract: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'upsert_project_contract: project not found' using errcode = 'P0001';
  end if;
  if p_contract_value is null or p_contract_value <= 0 then
    raise exception 'upsert_project_contract: contract value must be > 0' using errcode = 'P0001';
  end if;
  if coalesce(p_retention_rate, 5) < 0 or coalesce(p_retention_rate, 5) > 100 then
    raise exception 'upsert_project_contract: retention rate out of range' using errcode = 'P0001';
  end if;

  insert into public.project_contracts
    (project_id, contract_value, retention_rate, quotation_id, client_po_id, contract_no,
     sign_date, start_date, end_date, note, document_path, created_by)
  values
    (p_project_id, p_contract_value, coalesce(p_retention_rate, 5), p_quotation_id, p_client_po_id,
     nullif(btrim(coalesce(p_contract_no,'')),''), p_sign_date, p_start_date, p_end_date,
     nullif(btrim(coalesce(p_note,'')),''), nullif(btrim(coalesce(p_document_path,'')),''), auth.uid())
  on conflict (project_id) do update
     set contract_value = excluded.contract_value,
         retention_rate = excluded.retention_rate,
         quotation_id   = coalesce(excluded.quotation_id,   public.project_contracts.quotation_id),
         client_po_id   = coalesce(excluded.client_po_id,   public.project_contracts.client_po_id),
         contract_no    = coalesce(excluded.contract_no,    public.project_contracts.contract_no),
         sign_date      = coalesce(excluded.sign_date,      public.project_contracts.sign_date),
         start_date     = coalesce(excluded.start_date,     public.project_contracts.start_date),
         end_date       = coalesce(excluded.end_date,       public.project_contracts.end_date),
         note           = coalesce(excluded.note,           public.project_contracts.note),
         document_path  = coalesce(excluded.document_path,  public.project_contracts.document_path)
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('project_contract_upsert', auth.uid(), public.current_user_role(), 'project_contracts', v_id,
          jsonb_build_object('project_id', p_project_id, 'contract_value', p_contract_value,
                             'retention_rate', coalesce(p_retention_rate, 5)));
  return v_id;
end;
$$;
revoke all on function public.upsert_project_contract(uuid, numeric, numeric, uuid, uuid, text, date, date, date, text, text) from public, anon;
grant execute on function public.upsert_project_contract(uuid, numeric, numeric, uuid, uuid, text, date, date, date, text, text) to authenticated;

create function public.add_contract_installment(
  p_contract_id  uuid,
  p_seq          integer,
  p_label        text,
  p_amount       numeric,
  p_planned_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'add_contract_installment: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.project_contracts where id = p_contract_id) then
    raise exception 'add_contract_installment: contract not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'add_contract_installment: amount must be > 0' using errcode = 'P0001';
  end if;

  insert into public.contract_installments (contract_id, seq, label, amount, planned_date)
  values (p_contract_id, p_seq, btrim(p_label), p_amount, p_planned_date)
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('contract_installment_add', auth.uid(), public.current_user_role(), 'contract_installments', v_id,
          jsonb_build_object('contract_id', p_contract_id, 'seq', p_seq, 'amount', p_amount));
  return v_id;
end;
$$;
revoke all on function public.add_contract_installment(uuid, integer, text, numeric, date) from public, anon;
grant execute on function public.add_contract_installment(uuid, integer, text, numeric, date) to authenticated;

create function public.update_contract_installment(
  p_id           uuid,
  p_seq          integer,
  p_label        text,
  p_amount       numeric,
  p_planned_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'update_contract_installment: role not permitted' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'update_contract_installment: amount must be > 0' using errcode = 'P0001';
  end if;

  update public.contract_installments
     set seq = p_seq, label = btrim(p_label), amount = p_amount, planned_date = p_planned_date
   where id = p_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'update_contract_installment: installment not found' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('contract_installment_update', auth.uid(), public.current_user_role(), 'contract_installments', p_id,
          jsonb_build_object('seq', p_seq, 'amount', p_amount));
  return p_id;
end;
$$;
revoke all on function public.update_contract_installment(uuid, integer, text, numeric, date) from public, anon;
grant execute on function public.update_contract_installment(uuid, integer, text, numeric, date) to authenticated;

create function public.remove_contract_installment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'remove_contract_installment: role not permitted' using errcode = '42501';
  end if;

  -- A งวด referenced by a billing is protected by the FK (23503 propagates).
  delete from public.contract_installments where id = p_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'remove_contract_installment: installment not found' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('contract_installment_remove', auth.uid(), public.current_user_role(), 'contract_installments', p_id,
          jsonb_build_object('id', p_id));
end;
$$;
revoke all on function public.remove_contract_installment(uuid) from public, anon;
grant execute on function public.remove_contract_installment(uuid) to authenticated;

create function public.set_client_billing_installment(
  p_billing_id     uuid,
  p_installment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_client_billing_installment: role not permitted' using errcode = '42501';
  end if;

  -- Cross-project mismatch raises 22023 in the client_billings trigger.
  update public.client_billings
     set installment_id = p_installment_id
   where id = p_billing_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'set_client_billing_installment: billing not found' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('client_billing_installment_set', auth.uid(), public.current_user_role(), 'client_billings', p_billing_id,
          jsonb_build_object('installment_id', p_installment_id));
  return p_billing_id;
end;
$$;
revoke all on function public.set_client_billing_installment(uuid, uuid) from public, anon;
grant execute on function public.set_client_billing_installment(uuid, uuid) to authenticated;
