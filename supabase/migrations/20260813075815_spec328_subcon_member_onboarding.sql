-- Spec 328 U1 — subcontractor-member onboarding schema.
--
-- 1. staff_registrations.invited_contractor_id — the F2b-symmetric advisory
--    invite ref carried by the per-firm QR (?contractor=). Advisory ONLY:
--    existence-coerced at start, and the BINDING firm at approval is always the
--    approver-confirmed p_contractor_id (spec 282 hidden-bind lesson).
-- 2. start_staff_registration 5 -> 6 args (p_invited_contractor_id, defaulted).
--    Old arity DROPPED; anon re-revoked on the new signature (229/279 class).
-- 3. approve_staff_registration 5 -> 6 args (p_contractor_id, defaulted):
--    contractor arm = role FORCED technician + contractor must exist + the
--    spec-296 bank floors (book_bank attachment + staff_registration_bank row)
--    are SKIPPED (id_card + PDPA floors STAY) + minted worker carries
--    contractor_id, pay_type FORCED 'daily', day_rate 0, cost_confirmed_at NULL,
--    no bank columns. PRC arm (p_contractor_id NULL) is byte-identical to the
--    live pre-328 behavior. Bodies sourced from the LIVE database 2026-07-19,
--    not from prior migration files.

alter table public.staff_registrations
  add column invited_contractor_id uuid references public.contractors(id) on delete set null;

comment on column public.staff_registrations.invited_contractor_id is
  'Spec 328: advisory subcontractor-firm ref from the per-firm onboarding QR. Existence-coerced at start; display/pre-select only — the approver''s p_contractor_id is the binding value.';

-- ---------------------------------------------------------------------------
-- start_staff_registration: re-signature (drop old arity first).
-- ---------------------------------------------------------------------------
drop function if exists public.start_staff_registration(text, text, text, uuid, uuid);

create or replace function public.start_staff_registration(
  p_full_name text,
  p_phone text,
  p_declared_role_hint text default null::text,
  p_invited_by uuid default null::uuid,
  p_invited_project_id uuid default null::uuid,
  p_invited_contractor_id uuid default null::uuid
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_yy   int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq  int;
  v_emp  text;
  v_invited_by uuid;
  v_invited_project uuid;
  v_invited_contractor uuid;
begin
  if v_uid is null then
    raise exception 'start_staff_registration: not authenticated' using errcode = '42501';
  end if;
  if public.current_user_role() is distinct from 'visitor' then
    raise exception 'start_staff_registration: only a visitor may register' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_registrations where user_id = v_uid) then
    raise exception 'start_staff_registration: a registration already exists for this user'
      using errcode = 'P0001';
  end if;

  -- Existence-coerce the advisory invite refs (see header). A non-existent id
  -- (forged / mis-scanned / a since-deleted user or project) becomes NULL.
  v_invited_by := (select u.id from public.users u where u.id = p_invited_by);
  v_invited_project := (select p.id from public.projects p where p.id = p_invited_project_id);
  v_invited_contractor := (select c.id from public.contractors c where c.id = p_invited_contractor_id);

  -- Row-locked gapless mint. First START of a year inserts (yy, 2) and hands out
  -- 1; each later START bumps next_val by one and hands out (next_val - 1). The
  -- ON CONFLICT DO UPDATE takes a row lock, serialising concurrent STARTs.
  insert into public.employee_id_counters (year, next_val)
    values (v_yy, 2)
  on conflict (year) do update
    set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;

  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.staff_registrations
    (user_id, employee_id, full_name, phone, declared_role_hint, invited_by, invited_project_id, invited_contractor_id)
  values (
    v_uid,
    v_emp,
    nullif(btrim(coalesce(p_full_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_declared_role_hint, '')), ''),
    v_invited_by,
    v_invited_project,
    v_invited_contractor
  );

  return v_emp;
end;
$function$;

revoke execute on function public.start_staff_registration(text, text, text, uuid, uuid, uuid) from public;
revoke execute on function public.start_staff_registration(text, text, text, uuid, uuid, uuid) from anon;
grant execute on function public.start_staff_registration(text, text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.start_staff_registration(text, text, text, uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- approve_staff_registration: re-signature (drop old arity first).
-- ---------------------------------------------------------------------------
drop function if exists public.approve_staff_registration(uuid, public.user_role, uuid, public.pay_type, public.employment_type);

create or replace function public.approve_staff_registration(
  p_id uuid,
  p_role public.user_role,
  p_project_id uuid default null::uuid,
  p_pay_type public.pay_type default 'monthly'::pay_type,
  p_employment_type public.employment_type default 'permanent'::employment_type,
  p_contractor_id uuid default null::uuid
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

  -- Spec-296 bank floors (book_bank photo + declared bank fields) apply to the
  -- PRC-paid arm ONLY. Spec 328: a subcontractor member is paid by their firm —
  -- PRC never collects their bank data, so the contractor arm SKIPS both floors.
  if p_contractor_id is null then
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
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = v_reg.id;

  select role into v_old_role from public.users where id = v_reg.user_id;
  update public.users set role = p_role, updated_at = now() where id = v_reg.user_id;
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_actor_role, 'role_change', 'users', v_reg.user_id,
    jsonb_build_object('from', v_old_role, 'to', p_role));

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

revoke execute on function public.approve_staff_registration(uuid, public.user_role, uuid, public.pay_type, public.employment_type, uuid) from public;
revoke execute on function public.approve_staff_registration(uuid, public.user_role, uuid, public.pay_type, public.employment_type, uuid) from anon;
grant execute on function public.approve_staff_registration(uuid, public.user_role, uuid, public.pay_type, public.employment_type, uuid) to authenticated;
grant execute on function public.approve_staff_registration(uuid, public.user_role, uuid, public.pay_type, public.employment_type, uuid) to service_role;
