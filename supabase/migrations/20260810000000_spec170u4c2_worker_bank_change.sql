-- Spec 170 U4c-2 / ADR 0062 / ADR 0051 §6 — the worker analogue of the DC
-- bank-change anti-fraud gate (spec 130 U4, contractors). A bound DC WORKER
-- submits a bank-detail change from the portal; it lands PENDING and a PM
-- approves before it becomes the live payout bank. A worker silently changing
-- their bank before a payroll run is the fraud vector the approval step closes.
--
-- OPEN-6 RESOLVED (operator, 2026-06-23): a PARALLEL worker_bank_change_requests
-- table — NOT polymorphic on contractor_bank_change_requests. The apply target
-- genuinely forks: a worker change writes workers.bank_* INLINE (no contact_bank
-- row), with worker column names — so a shared decide RPC would branch anyway;
-- and a separate table fully isolates the shipped, pgTAP-pinned (file 39)
-- contractor anti-fraud gate from regression. The status enum
-- (contractor_change_status) is reused — the lifecycle is identical.
--
-- The request row IS the audit trail (requested_by / decided_by / status +
-- proposed values + timestamps) — mirrors set_worker_day_rate / the contractor
-- request, which write no audit_log row either. No new audit_action value.
--
-- MONEY/PII POSTURE: bank caps match the workers columns (20260778 — name/acct-
-- name 120, acct-no 50) so an approved value always fits. Writes are RPC-only
-- (no insert/update grant); the zero-grant workers.bank_* columns are written by
-- the SECURITY DEFINER decide RPC, never by an authenticated UPDATE.

create table public.worker_bank_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  worker_id           uuid not null references public.workers(id),
  bank_name           text,
  bank_account_number text,
  bank_account_name   text,
  status              public.contractor_change_status not null default 'pending',
  requested_by        uuid not null references public.users(id),
  decided_by          uuid references public.users(id),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  constraint wbcr_bank_name_len    check (bank_name is null or length(bank_name) <= 120),
  constraint wbcr_account_no_len   check (bank_account_number is null or length(bank_account_number) <= 50),
  constraint wbcr_account_name_len check (bank_account_name is null or length(bank_account_name) <= 120),
  constraint wbcr_decided_shape    check ((status = 'pending') = (decided_by is null))
);
create index wbcr_worker_status_idx on public.worker_bank_change_requests (worker_id, status);

alter table public.worker_bank_change_requests enable row level security;
revoke all on public.worker_bank_change_requests from anon, authenticated;
grant select on public.worker_bank_change_requests to authenticated;
-- The submitting worker reads their own requests; pm/super/director read all (the
-- approval queue). site_admin matches neither → zero rows (money stays hidden).
-- Writes are RPC-only (no insert/update grant). Eval-once-wrapped (file 40).
create policy "worker bank change requests readable by bound worker"
  on public.worker_bank_change_requests for select to authenticated
  using (worker_id = (select public.current_user_worker_id()));
create policy "worker bank change requests readable by staff"
  on public.worker_bank_change_requests for select to authenticated
  using ((select public.current_user_role()) in ('project_manager', 'super_admin', 'project_director'));

-- ----------------------------------------------------------------------------
-- submit_worker_bank_change — bound-worker only, own worker, one PENDING at a
-- time. Returns the request id.
-- ----------------------------------------------------------------------------
create function public.submit_worker_bank_change(
  p_bank_name           text,
  p_bank_account_number text,
  p_bank_account_name   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker uuid := public.current_user_worker_id();
  v_id uuid;
begin
  if v_worker is null then
    raise exception 'submit_worker_bank_change: caller is not a bound worker'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.worker_bank_change_requests
    where worker_id = v_worker and status = 'pending'
  ) then
    raise exception 'submit_worker_bank_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.worker_bank_change_requests
    (worker_id, bank_name, bank_account_number, bank_account_name, requested_by)
  values (v_worker,
          nullif(btrim(p_bank_name), ''),
          nullif(btrim(p_bank_account_number), ''),
          nullif(btrim(p_bank_account_name), ''),
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_worker_bank_change(text, text, text) from public, anon;
grant execute on function public.submit_worker_bank_change(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- decide_worker_bank_change — pm/super/director approve or reject. On approve,
-- the proposed bank becomes the worker's live bank_* columns (the workers analogue
-- of the contact_bank upsert). Refuses a non-pending request (idempotency).
-- ----------------------------------------------------------------------------
create function public.decide_worker_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.worker_bank_change_requests%rowtype;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'decide_worker_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.worker_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_worker_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_worker_bank_change: request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    -- Apply to the worker's own bank columns (inline — workers carry no
    -- contact_bank row; ADR 0062 U1 put bank_* on the worker).
    update public.workers
       set bank_name           = v_req.bank_name,
           bank_account_number = v_req.bank_account_number,
           bank_account_name   = v_req.bank_account_name
     where id = v_req.worker_id;
  end if;

  update public.worker_bank_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.decide_worker_bank_change(uuid, boolean) from public, anon;
grant execute on function public.decide_worker_bank_change(uuid, boolean) to authenticated;
