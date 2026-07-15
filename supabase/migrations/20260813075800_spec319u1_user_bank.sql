-- Spec 319 U1 — user_bank + user_bank_change_requests: a login(user_id)-keyed
-- bank home for the admin/office tier, which has no worker/contractor/approved-
-- registration record to anchor a bank on (verified live 2026-07-15: ~17 logins
-- incl. all 5 site_admins have none). Twins of staff_registration_bank +
-- staff_bank_change_requests (spec 317 U4), re-keyed on users(id); decided by the
-- staff-approval trio (matches identity_change_requests). Passbook reuses the
-- spec 315 U2 technician/<uid>/book_bank INSERT policy — no new storage RLS.
--
-- Posture: bank tables zero-grant (ADR 0079, bank PII walled from site_admins);
-- request row = audit trail, writes RPC-only, status enum reused
-- (contractor_change_status); reads = own row + the trio.

create table public.user_bank (
  user_id             uuid primary key references public.users(id),
  bank_name           text not null,
  bank_account_number text not null,
  bank_account_name   text not null,
  book_bank_path      text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid not null references public.users(id),
  constraint ub_bank_name_len    check (length(bank_name) <= 120),
  constraint ub_account_no_shape check (bank_account_number ~ '^[0-9]{6,20}$'),
  constraint ub_account_name_len check (length(bank_account_name) <= 120),
  constraint ub_book_bank_len    check (book_bank_path is null or length(book_bank_path) <= 500)
);
alter table public.user_bank enable row level security;
revoke all on table public.user_bank from anon, authenticated;
-- No authenticated policies: bank PII is DEFINER-only (ADR 0079). Reads go through
-- get_own_user_bank (own row) or the admin client (trio queue).

create table public.user_bank_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id),
  bank_name           text,
  bank_account_number text,
  bank_account_name   text,
  book_bank_path      text not null,
  status              public.contractor_change_status not null default 'pending',
  requested_by        uuid not null references public.users(id),
  decided_by          uuid references public.users(id),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  constraint ubcr_bank_name_len    check (bank_name is null or length(bank_name) <= 120),
  constraint ubcr_account_no_len   check (bank_account_number is null or length(bank_account_number) <= 50),
  constraint ubcr_account_name_len check (bank_account_name is null or length(bank_account_name) <= 120),
  constraint ubcr_book_bank_len    check (length(book_bank_path) <= 500),
  constraint ubcr_decided_shape    check ((status = 'pending') = (decided_by is null))
);
create index ubcr_user_status_idx on public.user_bank_change_requests (user_id, status);
create unique index ubcr_one_pending_idx on public.user_bank_change_requests (user_id)
  where status = 'pending';

alter table public.user_bank_change_requests enable row level security;
revoke all on table public.user_bank_change_requests from anon, authenticated;
grant select on public.user_bank_change_requests to authenticated;
create policy "user bank change requests readable by owner"
  on public.user_bank_change_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "user bank change requests readable by staff approvers"
  on public.user_bank_change_requests for select to authenticated
  using ((select public.current_user_role())
           in ('procurement_manager', 'project_director', 'super_admin'));

-- ----------------------------------------------------------------------------
-- get_own_user_bank — caller's own current bank (my-info prefill/display).
-- ----------------------------------------------------------------------------
create function public.get_own_user_bank()
returns table (bank_name text, bank_account_number text, bank_account_name text)
language sql
security definer
set search_path = public
as $$
  select bank_name, bank_account_number, bank_account_name
  from public.user_bank
  where user_id = auth.uid();
$$;
revoke all on function public.get_own_user_bank() from public, anon;
grant execute on function public.get_own_user_bank() to authenticated;

-- ----------------------------------------------------------------------------
-- submit_user_bank_change — self only; refuse if another bank home exists
-- (worker / contractor / approved staff registration); all-3 fields required +
-- account 6-20 digits; passbook required + own-folder pin + existence check;
-- one PENDING per user. Returns the request id.
-- ----------------------------------------------------------------------------
create function public.submit_user_bank_change(
  p_bank_name           text,
  p_bank_account_number text,
  p_bank_account_name   text,
  p_book_bank_path      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_bank_name, '')), '');
  v_no   text := nullif(regexp_replace(coalesce(p_bank_account_number, ''), '[\s-]', '', 'g'), '');
  v_own  text := nullif(btrim(coalesce(p_bank_account_name, '')), '');
  v_path text := nullif(btrim(coalesce(p_book_bank_path, '')), '');
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'submit_user_bank_change: not authenticated' using errcode = '42501';
  end if;
  -- Single bank home per login (worker / contractor / approved-staff own theirs;
  -- two homes would silently drift the real payout account).
  if public.current_user_worker_id() is not null then
    raise exception 'submit_user_bank_change: bound workers use the worker bank flow'
      using errcode = '42501';
  end if;
  if public.current_user_contractor_id() is not null then
    raise exception 'submit_user_bank_change: contractors use the contractor bank flow'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_registrations
             where user_id = v_uid and status = 'approved') then
    raise exception 'submit_user_bank_change: approved staff use the staff bank flow'
      using errcode = '42501';
  end if;
  -- The decide-side upsert writes NOT NULL columns — all three required; account
  -- number 6-20 digits (mirrors record_own_staff_bank).
  if v_name is null or v_no is null or v_own is null then
    raise exception 'submit_user_bank_change: bank name, account number and account name required'
      using errcode = 'P0001';
  end if;
  if v_no !~ '^[0-9]{6,20}$' then
    raise exception 'submit_user_bank_change: invalid account number' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'submit_user_bank_change: passbook photo required' using errcode = 'P0001';
  end if;
  -- Own technician/<uid>/book_bank folder (reuses the spec 315 U2 INSERT policy;
  -- identical pin to submit_staff_bank_change).
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 3
     or (storage.foldername(v_path))[1] is distinct from 'technician'
     or (storage.foldername(v_path))[2] is distinct from v_uid::text
     or (storage.foldername(v_path))[3] is distinct from 'book_bank' then
    raise exception 'submit_user_bank_change: storage path does not match owner/purpose'
      using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'contact-docs' and o.name = v_path) then
    raise exception 'submit_user_bank_change: passbook photo not uploaded'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.user_bank_change_requests
             where user_id = v_uid and status = 'pending') then
    raise exception 'submit_user_bank_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.user_bank_change_requests
    (user_id, bank_name, bank_account_number, bank_account_name, book_bank_path, requested_by)
  values (v_uid, v_name, v_no, v_own, v_path, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_user_bank_change(text, text, text, text) from public, anon;
grant execute on function public.submit_user_bank_change(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- decide_user_bank_change — the staff-approval trio approves or rejects.
-- Approve upserts user_bank. Late-bind recheck: a requester who acquired ANY
-- other bank home (worker / contractor / approved-registration) since submitting
-- is refused (approving would write a duplicate/wrong home) — the decide-side
-- mirror of submit's single-home guard (contractor anchors on
-- contractor_users.user_id, same as current_user_contractor_id()).
-- ----------------------------------------------------------------------------
create function public.decide_user_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.user_bank_change_requests%rowtype;
begin
  if coalesce(public.current_user_role()
                in ('procurement_manager', 'project_director', 'super_admin'), false) is not true then
    raise exception 'decide_user_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.user_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_user_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_user_bank_change: request already decided' using errcode = 'P0001';
  end if;
  if p_approve and (
       exists (select 1 from public.workers w where w.user_id = v_req.user_id)
    or exists (select 1 from public.contractor_users cu where cu.user_id = v_req.user_id)
    or exists (select 1 from public.staff_registrations r
               where r.user_id = v_req.user_id and r.status = 'approved')
  ) then
    raise exception 'decide_user_bank_change: requester now has another bank home'
      using errcode = 'P0001';
  end if;

  if p_approve then
    insert into public.user_bank
      (user_id, bank_name, bank_account_number, bank_account_name, book_bank_path, updated_by)
    values (v_req.user_id, v_req.bank_name, v_req.bank_account_number,
            v_req.bank_account_name, v_req.book_bank_path, v_req.requested_by)
    on conflict (user_id) do update
      set bank_name           = excluded.bank_name,
          bank_account_number = excluded.bank_account_number,
          bank_account_name   = excluded.bank_account_name,
          book_bank_path      = excluded.book_bank_path,
          updated_at          = now(),
          updated_by          = excluded.updated_by;
  end if;

  update public.user_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.decide_user_bank_change(uuid, boolean) from public, anon;
grant execute on function public.decide_user_bank_change(uuid, boolean) to authenticated;
