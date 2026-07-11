-- Spec 296 U1b — book-bank capture: zero-grant bank table + owner RPCs + approval
-- floor + workers copy + storage RLS + add_staff_registration_doc hardening.
-- (Enum value 'book_bank' added in 075690, already committed.)

-- ============================================================================
-- 1. Zero-grant bank table (mirror contact_bank: service_role only; RLS on; NO
--    authenticated policy => deny-by-default. Reads/writes only via the DEFINER
--    RPCs below (run as owner) or the service-role admin client (U3 approver read).
--    Bank PII must NOT ride on staff_registrations: its can_see_staff_registration
--    RLS arm lets in-project site_admins read the row, and RLS cannot hide columns.
-- ============================================================================
create table public.staff_registration_bank (
  registration_id      uuid primary key references public.staff_registrations(id) on delete cascade,
  bank_name            text not null,
  bank_account_number  text not null,
  bank_account_name    text not null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);
alter table public.staff_registration_bank enable row level security;
revoke all on public.staff_registration_bank from anon, authenticated;
grant select, insert, update, delete on public.staff_registration_bank to service_role;

-- ============================================================================
-- 2. Owner write RPC — own + PENDING guard; validate non-empty + normalize the
--    account number to digits (^\d{6,20}$); store the normalized value; upsert 1:1.
-- ============================================================================
create or replace function public.record_own_staff_bank(
  p_bank_name text, p_account_number text, p_account_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_reg       public.staff_registrations%rowtype;
  v_name      text := btrim(coalesce(p_bank_name, ''));
  v_acct_name text := btrim(coalesce(p_account_name, ''));
  v_acct      text := regexp_replace(coalesce(p_account_number, ''), '[[:space:]-]', '', 'g');
begin
  if v_uid is null then
    raise exception 'record_own_staff_bank: not authenticated' using errcode = '42501';
  end if;
  select * into v_reg from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'record_own_staff_bank: no registration for this user' using errcode = '42501';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'record_own_staff_bank: registration is no longer pending' using errcode = 'P0001';
  end if;
  if v_name = '' or v_acct_name = '' or v_acct = '' then
    raise exception 'record_own_staff_bank: bank name, account number and account name are required' using errcode = 'P0001';
  end if;
  if v_acct !~ '^[0-9]{6,20}$' then
    raise exception 'record_own_staff_bank: account number must be 6-20 digits' using errcode = 'P0001';
  end if;
  insert into public.staff_registration_bank
    (registration_id, bank_name, bank_account_number, bank_account_name, updated_at, updated_by)
  values (v_reg.id, v_name, v_acct, v_acct_name, now(), v_uid)
  on conflict (registration_id) do update
     set bank_name = excluded.bank_name,
         bank_account_number = excluded.bank_account_number,
         bank_account_name = excluded.bank_account_name,
         updated_at = now(),
         updated_by = v_uid;
end;
$function$;
revoke all on function public.record_own_staff_bank(text, text, text) from public, anon;
grant execute on function public.record_own_staff_bank(text, text, text) to authenticated;

-- ============================================================================
-- 3. Owner read RPC — feeds the form prefill + hasBankFields on reload.
-- ============================================================================
create or replace function public.get_own_staff_bank()
returns table(bank_name text, bank_account_number text, bank_account_name text)
language sql
security definer
set search_path to 'public'
as $function$
  select b.bank_name, b.bank_account_number, b.bank_account_name
  from public.staff_registration_bank b
  join public.staff_registrations r on r.id = b.registration_id
  where r.user_id = auth.uid();
$function$;
revoke all on function public.get_own_staff_bank() from public, anon;
grant execute on function public.get_own_staff_bank() to authenticated;

-- ============================================================================
-- 4. Harden add_staff_registration_doc: bind the storage path to the owner + purpose
--    (the book_bank floor now leans on a genuine book_bank attachment). Live body
--    reproduced verbatim (verified 2026-07-11) + the path/purpose check.
-- ============================================================================
create or replace function public.add_staff_registration_doc(
  p_purpose staff_doc_purpose, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_row   public.staff_registrations%rowtype;
  v_path  text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_prior uuid;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'add_staff_registration_doc: not authenticated' using errcode = '42501';
  end if;
  if p_purpose is null then
    raise exception 'add_staff_registration_doc: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_staff_registration_doc: storage_path required' using errcode = 'P0001';
  end if;
  -- ADDED (spec 296): the path must be the caller's own folder + match the purpose,
  -- so a purpose row cannot point at a mismatched image (book_bank floor integrity).
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 3
     or (storage.foldername(v_path))[2] is distinct from v_uid::text
     or (storage.foldername(v_path))[3] is distinct from p_purpose::text then
    raise exception 'add_staff_registration_doc: storage path does not match owner/purpose'
      using errcode = '42501';
  end if;
  select * into v_row from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'add_staff_registration_doc: no registration for this user' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'add_staff_registration_doc: registration is no longer pending' using errcode = 'P0001';
  end if;
  select a.id into v_prior
    from public.staff_registration_attachments a
   where a.registration_id = v_row.id
     and a.purpose = p_purpose
     and not exists (
       select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)
   limit 1;
  insert into public.staff_registration_attachments
    (registration_id, purpose, storage_path, uploaded_by, superseded_by)
  values (v_row.id, p_purpose, v_path, v_uid, v_prior)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.add_staff_registration_doc(staff_doc_purpose, text) from public, anon;
grant execute on function public.add_staff_registration_doc(staff_doc_purpose, text) to authenticated;

-- ============================================================================
-- 5. Storage RLS — add 'book_bank' to both staff-doc policy allowlists.
--    Recreated verbatim (verified 2026-07-11) + the extra array member.
-- ============================================================================
drop policy "staff doc uploads by applicant" on storage.objects;
create policy "staff doc uploads by applicant" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[1] = 'technician'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
    and (storage.foldername(name))[3] = any (array['id_card', 'profile_photo', 'book_bank']));

drop policy "staff doc reads by applicant" on storage.objects;
create policy "staff doc reads by applicant" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[1] = 'technician'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
    and (storage.foldername(name))[3] = any (array['id_card', 'profile_photo', 'book_bank']));

-- ============================================================================
-- 6. approve_staff_registration — add book_bank + bank-row floor (unconditional,
--    before the role branch) + copy declared bank -> workers in the technician
--    branch. Live 5-arg body reproduced verbatim (verified 2026-07-11); same
--    signature => CREATE OR REPLACE preserves the ACL (no re-grant / re-revoke).
-- ============================================================================
create or replace function public.approve_staff_registration(
  p_id uuid, p_role user_role, p_project_id uuid default null,
  p_pay_type pay_type default 'monthly', p_employment_type employment_type default 'permanent')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_reg        public.staff_registrations%rowtype;
  v_old_role   public.user_role;
  v_worker_id  uuid;
  v_name       text;
  v_bank       public.staff_registration_bank%rowtype;
begin
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'approve_staff_registration: role not permitted' using errcode = '42501';
  end if;

  if p_role is null
     or p_role not in (
       'technician', 'procurement', 'procurement_manager', 'accounting', 'hr',
       'project_coordinator', 'site_admin', 'project_manager', 'project_director',
       'site_owner', 'subcon_manager', 'auditor', 'legal'
     ) then
    raise exception 'approve_staff_registration: role % is not assignable through staff onboarding', coalesce(p_role::text, 'null')
      using errcode = '42501';
  end if;

  select * into v_reg from public.staff_registrations where id = p_id;
  if not found then
    raise exception 'approve_staff_registration: registration not found' using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'approve_staff_registration: registration is not pending' using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(v_reg.full_name, '')), '');
  if v_name is null then
    raise exception 'approve_staff_registration: full_name required before approval' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_registration_attachments a
     where a.registration_id = v_reg.id and a.purpose = 'id_card'
       and not exists (select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)) then
    raise exception 'approve_staff_registration: an id_card attachment is required before approval' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_consents c
     where c.registration_id = v_reg.id and c.kind = 'pdpa_data' and c.revoked_at is null) then
    raise exception 'approve_staff_registration: a PDPA consent record is required before approval' using errcode = 'P0001';
  end if;
  -- ADDED (spec 296): book_bank photo floor (live attachment, anti-join head).
  if not exists (
    select 1 from public.staff_registration_attachments a
     where a.registration_id = v_reg.id and a.purpose = 'book_bank'
       and not exists (select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)) then
    raise exception 'approve_staff_registration: a book_bank attachment is required before approval' using errcode = 'P0001';
  end if;
  -- ADDED (spec 296): declared bank fields floor (all three non-empty).
  select * into v_bank from public.staff_registration_bank where registration_id = v_reg.id;
  if not found
     or coalesce(btrim(v_bank.bank_name), '') = ''
     or coalesce(btrim(v_bank.bank_account_number), '') = ''
     or coalesce(btrim(v_bank.bank_account_name), '') = '' then
    raise exception 'approve_staff_registration: bank details are required before approval' using errcode = 'P0001';
  end if;

  update public.staff_registrations
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = v_reg.id;

  select role into v_old_role from public.users where id = v_reg.user_id;
  update public.users set role = p_role, updated_at = now() where id = v_reg.user_id;
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_actor_role, 'role_change', 'users', v_reg.user_id,
    jsonb_build_object('from', v_old_role, 'to', p_role));

  -- FIELD role (technician) -> INSERT the authoritative worker, now WITH the
  -- declared bank payee copied on (ADR 0079: the approver confirms). Office roles
  -- get the role assignment only; their bank row stays on the registration.
  if p_role in ('technician') then
    -- ADDED (spec 296) defense-in-depth: re-assert shape before it lands on the money col.
    if v_bank.bank_account_number !~ '^[0-9]{6,20}$' then
      raise exception 'approve_staff_registration: stored bank account number is malformed' using errcode = 'P0001';
    end if;
    insert into public.workers
      (name, pay_type, employment_type, user_id, employee_id, active, created_by, project_id,
       phone, date_of_birth,
       emergency_contact_name, emergency_contact_relation, emergency_contact_phone,
       bank_name, bank_account_number, bank_account_name)
    values
      (v_name, p_pay_type, p_employment_type, v_reg.user_id, v_reg.employee_id, true, v_actor, p_project_id,
       v_reg.phone, v_reg.date_of_birth,
       v_reg.emergency_contact_name, v_reg.emergency_contact_relation, v_reg.emergency_contact_phone,
       v_bank.bank_name, v_bank.bank_account_number, v_bank.bank_account_name)
    returning id into v_worker_id;

    insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
    values (v_actor, v_actor_role, 'worker_change', 'workers', v_worker_id,
      jsonb_build_object('kind', 'create', 'source', 'staff_registration',
                         'registration_id', v_reg.id, 'employee_id', v_reg.employee_id, 'role', p_role));
  end if;

  return v_worker_id;
end;
$function$;
