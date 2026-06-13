-- Spec 85 — Contacts v2 Unit 3: bank info, money-isolated. A dedicated table
-- with ZERO authenticated access (RLS on, no policies, no grants) — only the
-- service-role admin client (read, behind requireRole pm/super) and the
-- SECURITY DEFINER write RPC touch it. Stronger + simpler than money columns on
-- the three masters (which carry a table-level SELECT grant — spec-46 C3 — that
-- would expose a bank column unless every non-bank column were re-granted per
-- table; a 3x maintenance footgun). site_admin can never see bank info.

create table public.contact_bank (
  id                  uuid primary key default gen_random_uuid(),
  contractor_id       uuid references public.contractors(id),
  supplier_id         uuid references public.suppliers(id),
  service_provider_id uuid references public.service_providers(id),
  bank_name           text,
  bank_account_no     text,
  bank_account_name   text,
  updated_by          uuid not null references public.users(id),
  updated_at          timestamptz not null default now(),
  -- Typed FKs (not a polymorphic id+type) with exactly-one set.
  constraint contact_bank_exactly_one_target check (
    (contractor_id is not null)::int
    + (supplier_id is not null)::int
    + (service_provider_id is not null)::int = 1
  ),
  constraint contact_bank_bank_name_len    check (bank_name is null or length(bank_name) <= 200),
  constraint contact_bank_account_no_len   check (bank_account_no is null or length(bank_account_no) <= 50),
  constraint contact_bank_account_name_len check (bank_account_name is null or length(bank_account_name) <= 200)
);

-- One bank row per contact (partial unique per target).
create unique index contact_bank_contractor_uniq
  on public.contact_bank (contractor_id) where contractor_id is not null;
create unique index contact_bank_supplier_uniq
  on public.contact_bank (supplier_id) where supplier_id is not null;
create unique index contact_bank_service_provider_uniq
  on public.contact_bank (service_provider_id) where service_provider_id is not null;

alter table public.contact_bank enable row level security;
revoke all on public.contact_bank from anon, authenticated;
-- NO grants, NO policies: authenticated has zero access. Service-role (admin)
-- and the SECURITY DEFINER RPC below are the only paths. MONEY isolation.

create function public.set_contact_bank(
  p_contractor_id       uuid default null,
  p_supplier_id         uuid default null,
  p_service_provider_id uuid default null,
  p_bank_name           text default null,
  p_bank_account_no     text default null,
  p_bank_account_name   text default null
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
  v_name text := nullif(btrim(p_bank_name), '');
  v_no   text := nullif(btrim(p_bank_account_no), '');
  v_acct text := nullif(btrim(p_bank_account_name), '');
  v_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'set_contact_bank: role not permitted' using errcode = '42501';
  end if;
  if v_targets <> 1 then
    raise exception 'set_contact_bank: exactly one target required' using errcode = 'P0001';
  end if;

  if p_contractor_id is not null then
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where contractor_id = p_contractor_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (contractor_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_contractor_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  elsif p_supplier_id is not null then
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where supplier_id = p_supplier_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (supplier_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_supplier_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  else
    update public.contact_bank
       set bank_name = v_name, bank_account_no = v_no, bank_account_name = v_acct,
           updated_by = auth.uid(), updated_at = now()
     where service_provider_id = p_service_provider_id
     returning id into v_id;
    if not found then
      insert into public.contact_bank (service_provider_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (p_service_provider_id, v_name, v_no, v_acct, auth.uid()) returning id into v_id;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.set_contact_bank(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.set_contact_bank(uuid, uuid, uuid, text, text, text) to authenticated;

comment on table public.contact_bank is
  'MONEY — bank details for paid contacts (contractors/suppliers/service_providers). Zero authenticated access (RLS on, no policies/grants); read via service-role admin behind requireRole(pm/super), write via set_contact_bank RPC. site_admin can never see it (spec 85).';
