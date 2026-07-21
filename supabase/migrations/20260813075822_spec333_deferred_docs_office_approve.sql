-- Spec 333 U1 — deferred-docs office approve (เข้าระบบก่อน ส่งเอกสารภายหลัง).
--
-- Operator directive 2026-07-21: office hires (legal dept) get app access at
-- approval; the DOCUMENT floors (id_card + book_bank attachments, declared bank
-- row) are collected afterwards. full_name + PDPA floors are deliberately KEPT
-- (consent precedes processing — spec 298 discipline). For an office role the
-- approve RPC assigns users.role only (no workers row, no bank copy), so the
-- deferred floors are HR-record completeness, not structural dependencies.
--
-- 1. staff_registrations.documents_deferred_at — the queryable "docs owed" flag
--    (reviewed_by already records who deferred).
-- 2. approve_staff_registration 6 -> 7 args (p_defer_documents boolean default
--    false; old arity DROPPED, 328-U1 precedent). Bodies sourced from LIVE
--    2026-07-21; PRC/contractor arms byte-identical when p_defer_documents=false.
--    defer + technician -> P0001 (the field arm mints the workers row + bank
--    copy; the contractor arm is technician-only, so it is excluded too).
-- 3. add_staff_registration_doc: approved carve widened — book_bank accepted on
--    approved rows when documents_deferred_at is set (spec-315 id_card carve
--    unchanged).
-- 4. record_own_staff_bank: accepted on approved rows when
--    documents_deferred_at is set (else pending-only, unchanged).
-- record_staff_consent is deliberately NOT touched (consent is never deferred).
--
-- Pre-migration ACL capture (2026-07-21, all three functions):
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- (no anon/public EXECUTE) — replicated verbatim on the new signature.

alter table public.staff_registrations
  add column documents_deferred_at timestamptz;

comment on column public.staff_registrations.documents_deferred_at is
  'Spec 333: set when the approval deferred the document floors (office arm) — '
  'the applicant owes id_card/book_bank/bank details post-approval; null once '
  'nothing is owed conceptually (the owed set is derived from attachments/bank '
  'rows, this stamp marks the deferred approval itself).';

drop function public.approve_staff_registration(uuid, user_role, uuid, pay_type, employment_type, uuid);

create function public.approve_staff_registration(
  p_id uuid,
  p_role user_role,
  p_project_id uuid default null::uuid,
  p_pay_type pay_type default 'monthly'::pay_type,
  p_employment_type employment_type default 'permanent'::employment_type,
  p_contractor_id uuid default null::uuid,
  p_defer_documents boolean default false
)
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

  -- Spec 333: deferral exists for roles whose approval assigns users.role only.
  -- The field role mints the authoritative workers row (PRC arm copies the
  -- declared bank onto it) — its floors are structural, never deferrable. The
  -- contractor arm is technician-only, so this guard excludes it as well.
  if coalesce(p_defer_documents, false) and p_role = 'technician' then
    raise exception 'approve_staff_registration: deferred documents are not available for the technician role'
      using errcode = 'P0001';
  end if;

  -- Spec 328: the contractor arm is technician-only (a firm-tied office role is
  -- a contradiction), and the approver-confirmed firm must EXIST — validated
  -- hard, never coerced (unlike the advisory invite refs at start).
  if p_contractor_id is not null then
    if p_role is distinct from 'technician' then
      raise exception 'approve_staff_registration: a subcontractor member can only be approved as technician'
        using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.contractors c where c.id = p_contractor_id) then
      raise exception 'approve_staff_registration: unknown contractor' using errcode = 'P0001';
    end if;
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
  -- Spec 333: the id_card DOCUMENT floor defers; full_name (above) and PDPA
  -- (below) are kept — identity and consent precede any approval.
  if not coalesce(p_defer_documents, false) then
    if not exists (
      select 1 from public.staff_registration_attachments a
       where a.registration_id = v_reg.id and a.purpose = 'id_card'
         and not exists (select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)) then
      raise exception 'approve_staff_registration: an id_card attachment is required before approval' using errcode = 'P0001';
    end if;
  end if;
  if not exists (
    select 1 from public.staff_consents c
     where c.registration_id = v_reg.id and c.kind = 'pdpa_data' and c.revoked_at is null) then
    raise exception 'approve_staff_registration: a PDPA consent record is required before approval' using errcode = 'P0001';
  end if;

  -- Spec-296 bank floors (book_bank photo + declared bank fields) apply to the
  -- PRC-paid arm ONLY. Spec 328: a subcontractor member is paid by their firm —
  -- PRC never collects their bank data, so the contractor arm SKIPS both floors.
  -- Spec 333: a deferred office approval also skips them (collected afterwards).
  if p_contractor_id is null and not coalesce(p_defer_documents, false) then
    if not exists (
      select 1 from public.staff_registration_attachments a
       where a.registration_id = v_reg.id and a.purpose = 'book_bank'
         and not exists (select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)) then
      raise exception 'approve_staff_registration: a book_bank attachment is required before approval' using errcode = 'P0001';
    end if;
    select * into v_bank from public.staff_registration_bank where registration_id = v_reg.id;
    if not found
       or coalesce(btrim(v_bank.bank_name), '') = ''
       or coalesce(btrim(v_bank.bank_account_number), '') = ''
       or coalesce(btrim(v_bank.bank_account_name), '') = '' then
      raise exception 'approve_staff_registration: bank details are required before approval' using errcode = 'P0001';
    end if;
  end if;

  update public.staff_registrations
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now(),
         documents_deferred_at = case when coalesce(p_defer_documents, false) then now() end
   where id = v_reg.id;

  select role into v_old_role from public.users where id = v_reg.user_id;
  update public.users set role = p_role, updated_at = now() where id = v_reg.user_id;
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_actor_role, 'role_change', 'users', v_reg.user_id,
    jsonb_build_object('from', v_old_role, 'to', p_role)
      || case when coalesce(p_defer_documents, false)
              then jsonb_build_object('documents_deferred', true)
              else '{}'::jsonb end);

  -- FIELD role (technician) -> INSERT the authoritative worker.
  --   PRC arm: declared bank copied on (ADR 0079: the approver confirms).
  --   Contractor arm (spec 328): NO bank; contractor_id set; pay_type FORCED
  --   'daily' at day_rate 0 (pay-exempt — the firm is paid per WP, not per
  --   head); cost_confirmed_at stays NULL permanently (money-governance gate).
  -- Office roles get the role assignment only.
  if p_role in ('technician') then
    if p_contractor_id is not null then
      insert into public.workers
        (name, pay_type, employment_type, user_id, employee_id, active, created_by, project_id,
         phone, date_of_birth,
         emergency_contact_name, emergency_contact_relation, emergency_contact_phone,
         contractor_id, day_rate)
      values
        (v_name, 'daily', p_employment_type, v_reg.user_id, v_reg.employee_id, true, v_actor, p_project_id,
         v_reg.phone, v_reg.date_of_birth,
         v_reg.emergency_contact_name, v_reg.emergency_contact_relation, v_reg.emergency_contact_phone,
         p_contractor_id, 0)
      returning id into v_worker_id;

      insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
      values (v_actor, v_actor_role, 'worker_change', 'workers', v_worker_id,
        jsonb_build_object('kind', 'create', 'source', 'staff_registration',
                           'registration_id', v_reg.id, 'employee_id', v_reg.employee_id, 'role', p_role,
                           'contractor_id', p_contractor_id));
    else
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
  end if;

  return v_worker_id;
end;
$function$;

-- Replicate the captured ACL on the new signature (no anon/public EXECUTE).
revoke all on function public.approve_staff_registration(uuid, user_role, uuid, pay_type, employment_type, uuid, boolean) from public, anon;
grant execute on function public.approve_staff_registration(uuid, user_role, uuid, pay_type, employment_type, uuid, boolean) to authenticated, service_role;

-- Same-signature body update: widen the spec-315 approved carve — a deferred
-- approval also accepts the owed book_bank photo.
create or replace function public.add_staff_registration_doc(p_purpose staff_doc_purpose, p_storage_path text)
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
  -- CHANGED (spec 315 U1): an APPROVED registration accepts an id_card renewal
  -- (self-serve supersede). CHANGED (spec 333): an approved DEFERRED-DOCS
  -- registration also accepts the owed book_bank photo. All other non-pending
  -- writes stay refused.
  if v_row.status is distinct from 'pending'
     and not (v_row.status = 'approved'
              and (p_purpose = 'id_card'
                   or (p_purpose = 'book_bank' and v_row.documents_deferred_at is not null))) then
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

-- Same-signature body update: a deferred approval accepts the owed bank fields.
create or replace function public.record_own_staff_bank(p_bank_name text, p_account_number text, p_account_name text)
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
  -- CHANGED (spec 333): pending-only, EXCEPT an approved deferred-docs
  -- registration completing its owed bank details.
  if v_reg.status is distinct from 'pending'
     and not (v_reg.status = 'approved' and v_reg.documents_deferred_at is not null) then
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
