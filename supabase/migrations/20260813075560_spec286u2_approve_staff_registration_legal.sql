-- Spec 286 U2 — admit `legal` (spec 284's office role) to staff onboarding.
--
-- The office self-onboard door (spec 286 U1) reuses the role-neutral staff
-- registration flow; the approver assigns the office role at approval. Every
-- internal office role is already assignable through approve_staff_registration
-- EXCEPT `legal` (added to the user_role enum in spec 284 U1). This migration
-- adds `legal` to the RPC's assignable-role allowlist so an approver can assign
-- it. `legal` is an OFFICE role: it is NOT added to the field branch
-- (`p_role in ('technician')`), so approval flips the role only — NO workers row.
--
-- ADDITIVE, non-destructive: a `create or replace` of the existing 5-arg function
-- sourced VERBATIM from the LIVE definition (pg_get_functiondef, confirmed equal
-- to migration 071700 — no out-of-band drift), changing ONLY the allowlist. The
-- signature is unchanged, so db:types is unaffected. `create or replace`
-- preserves the existing ACL; the revoke/grant below re-asserts the anon-lock
-- posture defensively (the 229 invariant).

create or replace function public.approve_staff_registration(
  p_id uuid,
  p_role user_role,
  p_project_id uuid default null::uuid,
  p_pay_type pay_type default 'monthly'::pay_type,
  p_employment_type employment_type default 'permanent'::employment_type
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
begin
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'approve_staff_registration: role not permitted'
      using errcode = '42501';
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
    raise exception 'approve_staff_registration: registration not found'
      using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'approve_staff_registration: registration is not pending'
      using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(v_reg.full_name, '')), '');
  if v_name is null then
    raise exception 'approve_staff_registration: full_name required before approval'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_registration_attachments a
     where a.registration_id = v_reg.id
       and a.purpose = 'id_card'
       and not exists (
         select 1 from public.staff_registration_attachments n
          where n.superseded_by = a.id
       )
  ) then
    raise exception 'approve_staff_registration: an id_card attachment is required before approval'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_consents c
     where c.registration_id = v_reg.id
       and c.kind = 'pdpa_data'
       and c.revoked_at is null
  ) then
    raise exception 'approve_staff_registration: a PDPA consent record is required before approval'
      using errcode = 'P0001';
  end if;

  update public.staff_registrations
     set status      = 'approved',
         reviewed_by = v_actor,
         reviewed_at = now(),
         updated_at  = now()
   where id = v_reg.id;

  select role into v_old_role from public.users where id = v_reg.user_id;
  update public.users set role = p_role, updated_at = now()
   where id = v_reg.user_id;
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'role_change', 'users', v_reg.user_id,
     jsonb_build_object('from', v_old_role, 'to', p_role));

  -- Per-role side-effect. FIELD role (technician) → INSERT the authoritative
  -- worker WITH self-reported PII copied on, now as a ช่าง (pay_type/employment_type;
  -- default monthly/permanent = a salaried technician, approver may override).
  -- Office roles (incl. legal) get role assignment only — no workers row.
  if p_role in ('technician') then
    insert into public.workers
      (name, pay_type, employment_type, user_id, employee_id, active, created_by, project_id,
       phone, date_of_birth,
       emergency_contact_name, emergency_contact_relation, emergency_contact_phone)
    values
      (v_name, p_pay_type, p_employment_type, v_reg.user_id, v_reg.employee_id, true, v_actor, p_project_id,
       v_reg.phone, v_reg.date_of_birth,
       v_reg.emergency_contact_name, v_reg.emergency_contact_relation, v_reg.emergency_contact_phone)
    returning id into v_worker_id;

    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (v_actor, v_actor_role, 'worker_change', 'workers', v_worker_id,
       jsonb_build_object('kind', 'create', 'source', 'staff_registration',
                          'registration_id', v_reg.id, 'employee_id', v_reg.employee_id,
                          'role', p_role));
  end if;

  return v_worker_id;
end;
$function$;

-- Re-assert the anon-lock posture (create-or-replace preserves ACL; this is the
-- defensive 229 invariant — never leave anon/public with EXECUTE).
revoke all on function public.approve_staff_registration(uuid, user_role, uuid, public.pay_type, public.employment_type) from public, anon;
grant execute on function public.approve_staff_registration(uuid, user_role, uuid, public.pay_type, public.employment_type) to authenticated;
