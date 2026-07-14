-- Spec 317 U3 — identity_change_requests: the APPROVED tier for legal name /
-- national ID / DOB (operator decisions 2026-07-14: DOB approval-gated; decided
-- by the staff-approval trio, "who admits you approves your changes").
--
-- Keyed on the LOGIN (user_id), not an audience record: identity belongs to the
-- human. A technician is simultaneously a users row + a workers row + a
-- staff_registrations row — one approve applies to ALL linked records in one
-- txn, so they can never drift apart. Apply set: users.full_name +
-- workers.{name,tax_id,date_of_birth} (user_id-bound) +
-- staff_registrations.{full_name,date_of_birth} (own APPROVED row; a pending
-- registration is still self-editable via update_own_staff_registration).
-- Contractor party names are deliberately NOT applied — a contractors row is a
-- firm/crew PARTY managed on /contacts, not personal identity.
--
-- Posture mirrors worker_bank_change_requests (spec 170 U4c-2): request row =
-- audit trail; writes RPC-only; status enum reused (contractor_change_status);
-- reads = own row + the approver trio (site_admin matches neither arm → zero
-- rows; national ID is PII).

create table public.identity_change_requests (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id),
  proposed_full_name   text,
  proposed_national_id text,
  proposed_dob         date,
  status               public.contractor_change_status not null default 'pending',
  decided_by           uuid references public.users(id),
  decided_at           timestamptz,
  created_at           timestamptz not null default now(),
  constraint icr_full_name_len  check (proposed_full_name is null or length(proposed_full_name) <= 120),
  constraint icr_national_id_shape check (proposed_national_id is null or proposed_national_id ~ '^\d{13}$'),
  constraint icr_at_least_one   check (
    proposed_full_name is not null or proposed_national_id is not null or proposed_dob is not null),
  constraint icr_decided_shape  check ((status = 'pending') = (decided_by is null))
);
create index icr_user_status_idx on public.identity_change_requests (user_id, status);

alter table public.identity_change_requests enable row level security;
revoke all on table public.identity_change_requests from anon, authenticated;
grant select on public.identity_change_requests to authenticated;
create policy "identity change requests readable by owner"
  on public.identity_change_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "identity change requests readable by staff approvers"
  on public.identity_change_requests for select to authenticated
  using ((select public.current_user_role())
           in ('procurement_manager', 'project_director', 'super_admin'));

-- ----------------------------------------------------------------------------
-- submit_identity_change — self only, at least one proposal, Thai-ID checksum,
-- one PENDING per login. Returns the request id.
-- ----------------------------------------------------------------------------
create function public.submit_identity_change(
  p_full_name   text,
  p_national_id text,
  p_dob         date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_nid  text := nullif(regexp_replace(coalesce(p_national_id, ''), '[^0-9]', '', 'g'), '');
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'submit_identity_change: not authenticated' using errcode = '42501';
  end if;
  if v_name is null and v_nid is null and p_dob is null then
    raise exception 'submit_identity_change: nothing proposed' using errcode = 'P0001';
  end if;
  if v_nid is not null and not public.is_valid_thai_national_id(v_nid) then
    raise exception 'submit_identity_change: invalid national id' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.identity_change_requests
    where user_id = v_uid and status = 'pending'
  ) then
    raise exception 'submit_identity_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.identity_change_requests
    (user_id, proposed_full_name, proposed_national_id, proposed_dob)
  values (v_uid, v_name, v_nid, p_dob)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_identity_change(text, text, date) from public, anon;
grant execute on function public.submit_identity_change(text, text, date) to authenticated;

-- ----------------------------------------------------------------------------
-- decide_identity_change — the staff-approval trio approves or rejects. Approve
-- applies every proposed field to every linked record IN THIS TXN.
-- ----------------------------------------------------------------------------
create function public.decide_identity_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.identity_change_requests%rowtype;
begin
  if coalesce(public.current_user_role()
                in ('procurement_manager', 'project_director', 'super_admin'), false) is not true then
    raise exception 'decide_identity_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.identity_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_identity_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_identity_change: request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    update public.users
       set full_name = coalesce(v_req.proposed_full_name, full_name)
     where id = v_req.user_id;

    update public.workers
       set name          = coalesce(v_req.proposed_full_name, name),
           tax_id        = coalesce(v_req.proposed_national_id, tax_id),
           date_of_birth = coalesce(v_req.proposed_dob, date_of_birth)
     where user_id = v_req.user_id;

    update public.staff_registrations
       set full_name     = coalesce(v_req.proposed_full_name, full_name),
           date_of_birth = coalesce(v_req.proposed_dob, date_of_birth),
           updated_at    = now()
     where user_id = v_req.user_id
       and status = 'approved';
  end if;

  update public.identity_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.decide_identity_change(uuid, boolean) from public, anon;
grant execute on function public.decide_identity_change(uuid, boolean) to authenticated;
