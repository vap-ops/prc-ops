-- Spec 315 U2 — REQUIRED passbook photo on the worker bank-change request
-- (operator decision 2026-07-14: matches the spec-296 signup floor; the approver
-- verifies the typed account number against the photo instead of deciding blind).
--
-- 1. worker_bank_change_requests gains book_bank_path (nullable — legacy pending
--    rows stay decidable; every NEW submit requires it).
-- 2. submit_worker_bank_change re-signatured 3 args -> 4. The OLD signature is
--    DROPPED (a required photo cannot be retrofitted with a default); the deployed
--    form errors for the minutes between db:push and the Vercel deploy — accepted,
--    same class as spec 279 F2b's re-signature, low-traffic surface.
-- 3. decide_worker_bank_change: on approve, the request's photo supersede-inserts
--    into the worker's registration book_bank chain (workers.user_id →
--    staff_registrations.user_id) so the stored evidence always matches the live
--    payout bank. No registration / no photo -> skip. Reject writes nothing.
--    Body otherwise sourced VERBATIM from the live definition 2026-07-14
--    (pg_get_functiondef — includes the 075783 is_manager+procurement_manager gate).

alter table public.worker_bank_change_requests
  add column book_bank_path text
  constraint wbcr_book_bank_path_len check (book_bank_path is null or length(book_bank_path) <= 500);

-- ----------------------------------------------------------------------------
-- submit_worker_bank_change — 4-arg re-signature. Bound-worker only, own worker,
-- one PENDING at a time (all unchanged); passbook photo path REQUIRED and pinned
-- to the caller's own technician/<uid>/book_bank/ folder (the spec-296 owner+
-- purpose hardening, mirrored from add_staff_registration_doc).
-- ----------------------------------------------------------------------------
drop function if exists public.submit_worker_bank_change(text, text, text);

create function public.submit_worker_bank_change(
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
  v_worker uuid := public.current_user_worker_id();
  v_path   text := nullif(btrim(coalesce(p_book_bank_path, '')), '');
  v_id     uuid;
begin
  if v_worker is null then
    raise exception 'submit_worker_bank_change: caller is not a bound worker'
      using errcode = '42501';
  end if;
  if v_path is null then
    raise exception 'submit_worker_bank_change: passbook photo required'
      using errcode = 'P0001';
  end if;
  -- The path must be the caller's own book_bank folder (spec 296 hardening) so a
  -- request row can never point at another applicant's document.
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 3
     or (storage.foldername(v_path))[1] is distinct from 'technician'
     or (storage.foldername(v_path))[2] is distinct from auth.uid()::text
     or (storage.foldername(v_path))[3] is distinct from 'book_bank' then
    raise exception 'submit_worker_bank_change: storage path does not match owner/purpose'
      using errcode = '42501';
  end if;
  -- The object must actually exist (fresh-eyes 2026-07-14): a well-formed but
  -- never-uploaded path would otherwise ride an approve into the registration's
  -- book_bank chain as dangling evidence. Applicants have no storage DELETE
  -- policy, so existence at submit time holds thereafter.
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'contact-docs' and o.name = v_path
  ) then
    raise exception 'submit_worker_bank_change: passbook photo not uploaded'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.worker_bank_change_requests
    where worker_id = v_worker and status = 'pending'
  ) then
    raise exception 'submit_worker_bank_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.worker_bank_change_requests
    (worker_id, bank_name, bank_account_number, bank_account_name, book_bank_path, requested_by)
  values (v_worker,
          nullif(btrim(p_bank_name), ''),
          nullif(btrim(p_bank_account_number), ''),
          nullif(btrim(p_bank_account_name), ''),
          v_path,
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_worker_bank_change(text, text, text, text) from public, anon;
grant execute on function public.submit_worker_bank_change(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- decide_worker_bank_change — same signature (ACL preserved). Approve now also
-- flips the registration's book_bank evidence chain.
-- ----------------------------------------------------------------------------
create or replace function public.decide_worker_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req   public.worker_bank_change_requests%rowtype;
  v_reg   uuid;
  v_prior uuid;
begin
  if not (public.is_manager(public.current_user_role())
          or coalesce(public.current_user_role() = 'procurement_manager', false)) then
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

    -- ADDED (spec 315 U2): supersede the registration's book_bank document with
    -- the approved request's photo so evidence always matches the live payout
    -- bank. Skip when the worker has no registration (SA-added phoneless) or the
    -- request predates the photo requirement.
    if v_req.book_bank_path is not null then
      -- status filter: a bound worker could carry a rejected registration (e.g.
      -- claim_worker_invite binding); evidence chains only onto an APPROVED one.
      select r.id into v_reg
        from public.staff_registrations r
        join public.workers w on w.user_id = r.user_id
       where w.id = v_req.worker_id
         and r.status = 'approved';
      if v_reg is not null then
        select a.id into v_prior
          from public.staff_registration_attachments a
         where a.registration_id = v_reg
           and a.purpose = 'book_bank'
           and not exists (
             select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)
         limit 1;
        insert into public.staff_registration_attachments
          (registration_id, purpose, storage_path, uploaded_by, superseded_by)
        values (v_reg, 'book_bank', v_req.book_bank_path, v_req.requested_by, v_prior);
      end if;
    end if;
  end if;

  update public.worker_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$function$;
