-- Spec 317 U5 — contractor bank-change passbook parity (operator decision
-- 2026-07-14: same anti-fraud bar for every payout target — workers gained the
-- required photo in spec 315 U2; office staff in 317 U4; contractors close the
-- set). The submit gains a REQUIRED passbook/company-account photo pinned to
-- the caller's own contractor/<id>/ folder with a storage-existence check;
-- approve additionally INSERTS the photo as the NEWEST contact_attachments
-- 'bank_book' doc (contact docs are newest-wins by created_at — no supersede
-- chain on that table), so the stored evidence matches the live contact_bank.
--
-- decide body otherwise VERBATIM from the live definition 2026-07-14
-- (pg_get_functiondef); submit re-signatured 3 -> 4 args, old form DROPPED
-- (soft deploy window, spec-315-U2 class — the portal form is the only caller).

alter table public.contractor_bank_change_requests
  add column bank_book_path text
  constraint cbcr_bank_book_path_len check (bank_book_path is null or length(bank_book_path) <= 500);

-- One pending per contractor, enforced atomically (parity with staff_bank_change_requests).
create unique index cbcr_one_pending_idx on public.contractor_bank_change_requests (contractor_id)
  where status = 'pending';

-- ----------------------------------------------------------------------------
-- submit_contractor_bank_change — 4-arg re-signature.
-- ----------------------------------------------------------------------------
drop function if exists public.submit_contractor_bank_change(text, text, text);

create function public.submit_contractor_bank_change(
  p_bank_name         text,
  p_bank_account_no   text,
  p_bank_account_name text,
  p_bank_book_path    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor uuid := public.current_user_contractor_id();
  v_path       text := nullif(btrim(coalesce(p_bank_book_path, '')), '');
  v_id         uuid;
begin
  if v_contractor is null then
    raise exception 'submit_contractor_bank_change: caller is not a bound contractor'
      using errcode = '42501';
  end if;
  if v_path is null then
    raise exception 'submit_contractor_bank_change: passbook photo required'
      using errcode = 'P0001';
  end if;
  -- Own-folder pin: contact docs live at contractor/<contractorId>/<file>
  -- (buildContactDocPath, spec 97 — a 2-segment folder shape).
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 2
     or (storage.foldername(v_path))[1] is distinct from 'contractor'
     or (storage.foldername(v_path))[2] is distinct from v_contractor::text then
    raise exception 'submit_contractor_bank_change: storage path does not match owner'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'contact-docs' and o.name = v_path
  ) then
    raise exception 'submit_contractor_bank_change: passbook photo not uploaded'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.contractor_bank_change_requests
    where contractor_id = v_contractor and status = 'pending'
  ) then
    raise exception 'submit_contractor_bank_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.contractor_bank_change_requests
    (contractor_id, bank_name, bank_account_no, bank_account_name, bank_book_path, requested_by)
  values (v_contractor,
          nullif(btrim(p_bank_name), ''),
          nullif(btrim(p_bank_account_no), ''),
          nullif(btrim(p_bank_account_name), ''),
          v_path,
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_contractor_bank_change(text, text, text, text) from public, anon;
grant execute on function public.submit_contractor_bank_change(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- decide_contractor_bank_change — same signature (ACL preserved); approve now
-- also records the photo as the newest bank_book attachment.
-- ----------------------------------------------------------------------------
create or replace function public.decide_contractor_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req public.contractor_bank_change_requests%rowtype;
begin
  if not public.is_manager(public.current_user_role()) then
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

    -- ADDED (spec 317 U5): record the approved passbook as the NEWEST bank_book
    -- doc (contact docs are newest-wins, no supersede chain). Skip legacy
    -- photo-less rows.
    if v_req.bank_book_path is not null then
      insert into public.contact_attachments
        (contractor_id, purpose, storage_path, uploaded_by)
      values (v_req.contractor_id, 'bank_book', v_req.bank_book_path, v_req.requested_by);
    end if;
  end if;

  update public.contractor_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$function$;
