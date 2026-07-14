-- Spec 317 U4 — staff_bank_change_requests: the office-staff mirror of the
-- worker bank-change flow (spec 315 U2 pattern verbatim). Office staff's payout
-- bank lives in the zero-grant staff_registration_bank (spec 296) and had NO
-- change path after approval. Now: an approved staffer with NO bound worker row
-- stages a change (passbook photo REQUIRED + storage-existence check, the
-- dangling-evidence guard); the staff-approval trio decides; approve UPSERTS
-- staff_registration_bank AND supersede-chains the registration's book_bank doc
-- so the stored evidence always matches the live payout bank. Bound workers are
-- refused here — their flow is worker_bank_change (workers.bank_* home).
--
-- Posture: request row = audit trail; writes RPC-only; status enum reused;
-- reads = own row + the trio (PM and site_admin see nothing — money, and the
-- trio is the decider, matching identity_change_requests).

create table public.staff_bank_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  registration_id     uuid not null references public.staff_registrations(id),
  bank_name           text,
  bank_account_number text,
  bank_account_name   text,
  book_bank_path      text not null,
  status              public.contractor_change_status not null default 'pending',
  requested_by        uuid not null references public.users(id),
  decided_by          uuid references public.users(id),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  constraint sbcr_bank_name_len    check (bank_name is null or length(bank_name) <= 120),
  constraint sbcr_account_no_len   check (bank_account_number is null or length(bank_account_number) <= 50),
  constraint sbcr_account_name_len check (bank_account_name is null or length(bank_account_name) <= 120),
  constraint sbcr_book_bank_len    check (length(book_bank_path) <= 500),
  constraint sbcr_decided_shape    check ((status = 'pending') = (decided_by is null))
);
create index sbcr_registration_status_idx on public.staff_bank_change_requests (registration_id, status);
-- One pending per registration, enforced atomically (the RPC check alone races).
create unique index sbcr_one_pending_idx on public.staff_bank_change_requests (registration_id)
  where status = 'pending';

alter table public.staff_bank_change_requests enable row level security;
revoke all on table public.staff_bank_change_requests from anon, authenticated;
grant select on public.staff_bank_change_requests to authenticated;
create policy "staff bank change requests readable by owner"
  on public.staff_bank_change_requests for select to authenticated
  using (registration_id in (
    select r.id from public.staff_registrations r where r.user_id = (select auth.uid())));
create policy "staff bank change requests readable by staff approvers"
  on public.staff_bank_change_requests for select to authenticated
  using ((select public.current_user_role())
           in ('procurement_manager', 'project_director', 'super_admin'));

-- ----------------------------------------------------------------------------
-- submit_staff_bank_change — own APPROVED registration ONLY (a still-pending
-- applicant edits bank via the registration form / record_own_staff_bank), NOT
-- a bound worker, all three bank fields required (account no normalized +
-- digit-checked, mirroring record_own_staff_bank — the decide-side upsert
-- targets NOT NULL columns), passbook photo required + own-folder pin +
-- existence check, one PENDING per registration.
-- ----------------------------------------------------------------------------
create function public.submit_staff_bank_change(
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
  v_reg  public.staff_registrations%rowtype;
  v_name text := nullif(btrim(coalesce(p_bank_name, '')), '');
  v_no   text := nullif(regexp_replace(coalesce(p_bank_account_number, ''), '[\s-]', '', 'g'), '');
  v_own  text := nullif(btrim(coalesce(p_bank_account_name, '')), '');
  v_path text := nullif(btrim(coalesce(p_book_bank_path, '')), '');
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'submit_staff_bank_change: not authenticated' using errcode = '42501';
  end if;
  -- A bound worker's payout home is workers.bank_* — their staged flow is
  -- submit_worker_bank_change; two parallel paths would drift the two homes.
  if public.current_user_worker_id() is not null then
    raise exception 'submit_staff_bank_change: bound workers use the worker bank flow'
      using errcode = '42501';
  end if;
  select * into v_reg from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'submit_staff_bank_change: no registration for this user'
      using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'approved' then
    raise exception 'submit_staff_bank_change: registration is not approved'
      using errcode = 'P0001';
  end if;
  -- The decide-side upsert writes NOT NULL columns — the floor mirrors
  -- record_own_staff_bank (all three required; account no = 6-20 digits).
  if v_name is null or v_no is null or v_own is null then
    raise exception 'submit_staff_bank_change: bank name, account number and account name required'
      using errcode = 'P0001';
  end if;
  if v_no !~ '^[0-9]{6,20}$' then
    raise exception 'submit_staff_bank_change: invalid account number' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'submit_staff_bank_change: passbook photo required'
      using errcode = 'P0001';
  end if;
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 3
     or (storage.foldername(v_path))[1] is distinct from 'technician'
     or (storage.foldername(v_path))[2] is distinct from v_uid::text
     or (storage.foldername(v_path))[3] is distinct from 'book_bank' then
    raise exception 'submit_staff_bank_change: storage path does not match owner/purpose'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'contact-docs' and o.name = v_path
  ) then
    raise exception 'submit_staff_bank_change: passbook photo not uploaded'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.staff_bank_change_requests
    where registration_id = v_reg.id and status = 'pending'
  ) then
    raise exception 'submit_staff_bank_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.staff_bank_change_requests
    (registration_id, bank_name, bank_account_number, bank_account_name, book_bank_path, requested_by)
  values (v_reg.id, v_name, v_no, v_own, v_path, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_staff_bank_change(text, text, text, text) from public, anon;
grant execute on function public.submit_staff_bank_change(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- decide_staff_bank_change — trio only. Approve upserts staff_registration_bank
-- and supersede-chains the registration's book_bank doc in the same txn.
-- ----------------------------------------------------------------------------
create function public.decide_staff_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req   public.staff_bank_change_requests%rowtype;
  v_prior uuid;
begin
  if coalesce(public.current_user_role()
                in ('procurement_manager', 'project_director', 'super_admin'), false) is not true then
    raise exception 'decide_staff_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.staff_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_staff_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_staff_bank_change: request already decided' using errcode = 'P0001';
  end if;
  -- Re-check at decide time: if the staffer became a BOUND worker since
  -- submitting (worker home = workers.bank_*), approving here would write the
  -- stale staff home and silently miss the real payout column.
  if p_approve and exists (
    select 1
    from public.staff_registrations r
    join public.workers w on w.user_id = r.user_id
    where r.id = v_req.registration_id
  ) then
    raise exception 'decide_staff_bank_change: requester is now a bound worker — use the worker bank flow'
      using errcode = 'P0001';
  end if;

  if p_approve then
    insert into public.staff_registration_bank
      (registration_id, bank_name, bank_account_number, bank_account_name, updated_by)
    values (v_req.registration_id, v_req.bank_name, v_req.bank_account_number,
            v_req.bank_account_name, v_req.requested_by)
    on conflict (registration_id) do update
      set bank_name           = excluded.bank_name,
          bank_account_number = excluded.bank_account_number,
          bank_account_name   = excluded.bank_account_name,
          updated_at          = now(),
          updated_by          = excluded.updated_by;

    select a.id into v_prior
      from public.staff_registration_attachments a
     where a.registration_id = v_req.registration_id
       and a.purpose = 'book_bank'
       and not exists (
         select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)
     limit 1;
    insert into public.staff_registration_attachments
      (registration_id, purpose, storage_path, uploaded_by, superseded_by)
    values (v_req.registration_id, 'book_bank', v_req.book_bank_path, v_req.requested_by, v_prior);
  end if;

  update public.staff_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.decide_staff_bank_change(uuid, boolean) from public, anon;
grant execute on function public.decide_staff_bank_change(uuid, boolean) to authenticated;
