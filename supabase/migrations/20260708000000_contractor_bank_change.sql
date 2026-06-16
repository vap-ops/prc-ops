-- Spec 130 U4 / ADR 0051 §6 — the anti-fraud gate. A DC submits a bank-detail
-- change from the portal; it lands PENDING and a PM approves before it becomes
-- the live contact_bank record (which feeds payroll / KBank / PEAK). A
-- contractor silently changing their payout bank before a run is the fraud
-- vector the approval step closes.
--
-- The request row IS the audit trail (requested_by / decided_by / status /
-- proposed values + timestamps) — mirrors set_contact_bank, which writes no
-- audit_log row either (the contact_bank.updated_by is its trail). No new
-- audit_action value.

create type public.contractor_change_status as enum ('pending', 'approved', 'rejected');

create table public.contractor_bank_change_requests (
  id                uuid primary key default gen_random_uuid(),
  contractor_id     uuid not null references public.contractors(id),
  bank_name         text,
  bank_account_no   text,
  bank_account_name text,
  status            public.contractor_change_status not null default 'pending',
  requested_by      uuid not null references public.users(id),
  decided_by        uuid references public.users(id),
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint cbcr_bank_name_len    check (bank_name is null or length(bank_name) <= 200),
  constraint cbcr_account_no_len   check (bank_account_no is null or length(bank_account_no) <= 50),
  constraint cbcr_account_name_len check (bank_account_name is null or length(bank_account_name) <= 200),
  constraint cbcr_decided_shape    check ((status = 'pending') = (decided_by is null))
);
create index cbcr_contractor_status_idx on public.contractor_bank_change_requests (contractor_id, status);

alter table public.contractor_bank_change_requests enable row level security;
revoke all on public.contractor_bank_change_requests from anon, authenticated;
grant select on public.contractor_bank_change_requests to authenticated;
-- The submitting contractor reads their own requests; pm/super read all (the
-- approval queue). site_admin matches neither → zero rows (money stays hidden).
-- Writes are RPC-only (no insert/update grant). Eval-once-wrapped (file 40).
create policy "bank change requests readable by bound contractor"
  on public.contractor_bank_change_requests for select to authenticated
  using (contractor_id = (select public.current_user_contractor_id()));
create policy "bank change requests readable by staff"
  on public.contractor_bank_change_requests for select to authenticated
  using ((select public.current_user_role()) in ('project_manager', 'super_admin'));

-- ----------------------------------------------------------------------------
-- submit_contractor_bank_change — contractor-only, own contractor, one PENDING
-- at a time. Returns the request id.
-- ----------------------------------------------------------------------------
create function public.submit_contractor_bank_change(
  p_bank_name         text,
  p_bank_account_no   text,
  p_bank_account_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor uuid := public.current_user_contractor_id();
  v_id uuid;
begin
  if v_contractor is null then
    raise exception 'submit_contractor_bank_change: caller is not a bound contractor'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.contractor_bank_change_requests
    where contractor_id = v_contractor and status = 'pending'
  ) then
    raise exception 'submit_contractor_bank_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.contractor_bank_change_requests
    (contractor_id, bank_name, bank_account_no, bank_account_name, requested_by)
  values (v_contractor,
          nullif(btrim(p_bank_name), ''),
          nullif(btrim(p_bank_account_no), ''),
          nullif(btrim(p_bank_account_name), ''),
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_contractor_bank_change(text, text, text) from public, anon;
grant execute on function public.submit_contractor_bank_change(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- decide_contractor_bank_change — pm/super approve or reject. On approve, the
-- proposed bank becomes the live contact_bank (same upsert as set_contact_bank).
-- Refuses a non-pending request (idempotency).
-- ----------------------------------------------------------------------------
create function public.decide_contractor_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.contractor_bank_change_requests%rowtype;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'decide_contractor_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.contractor_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_contractor_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_contractor_bank_change: request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    -- Apply to the live bank record (contractor branch of set_contact_bank).
    update public.contact_bank
       set bank_name = v_req.bank_name, bank_account_no = v_req.bank_account_no,
           bank_account_name = v_req.bank_account_name, updated_by = auth.uid(), updated_at = now()
     where contractor_id = v_req.contractor_id;
    if not found then
      insert into public.contact_bank
        (contractor_id, bank_name, bank_account_no, bank_account_name, updated_by)
      values (v_req.contractor_id, v_req.bank_name, v_req.bank_account_no,
              v_req.bank_account_name, auth.uid());
    end if;
  end if;

  update public.contractor_bank_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.decide_contractor_bank_change(uuid, boolean) from public, anon;
grant execute on function public.decide_contractor_bank_change(uuid, boolean) to authenticated;
