-- Spec 263 U1c (ADR 0071) — the AUTHORITATIVE approve/reject path for technician
-- self-registration. These two SECURITY DEFINER RPCs are the ONLY writers that
-- promote a self-entered applicant into an authoritative role + workers row;
-- unverified self-entry (U1b) never reaches workers until a human approves here.
--
-- Doctrine (ADR 0071 / spec 263):
--  * Approver set is a SMALL EXPLICIT role set — procurement_manager,
--    project_director, super_admin. NOT is_back_office() (too broad for promoting
--    people). `hr` is deliberately HELD OUT (stub role; a one-line add later).
--  * Approve is ATOMIC: a plpgsql function body is one transaction, so a failure
--    anywhere (floor, role flip, the workers INSERT tripping the employee_id
--    partial-unique, either audit write) rolls the WHOLE thing back — the status
--    flip and role change never persist without the worker row, and vice versa.
--  * The employee_id is CARRIED from the registration onto workers.employee_id,
--    never re-minted (ADR 0061 permanent person-level ID).
--  * The role flip is done INLINE, NOT via a nested public.set_user_role() call.
--    set_user_role's gate is `current_user_role() = 'super_admin'` ONLY (see
--    20260813019000) — a nested call would raise 42501 for a procurement_manager
--    or project_director approver, breaking approval for two of the three gate
--    roles. It also carries last-super/self-demotion guards irrelevant here. So
--    we replicate its exact `role_change` audit shape inline (audit_log:
--    action='role_change', target_table='users', target_id=user_id,
--    payload {from,to}) — matching house style without borrowing its gate.
--  * The floor (spec 263): a nameless / doc-less worker never gets created —
--    approve asserts full_name present AND a LIVE id_card attachment (anti-join
--    head, ADR 0009 read) before doing anything authoritative.
--  * Every SECURITY DEFINER gets its OWN `revoke all … from public, anon` +
--    `grant execute … to authenticated` pair (Postgres defaults new funcs to
--    PUBLIC EXECUTE incl. anon — the spec-258 anon-exec lesson).
--  * audit_log is append-only (INSERT granted, never UPDATE/DELETE) — both
--    functions only INSERT into it. `role_change` and `worker_change` are
--    EXISTING audit_action values (no enum growth).

-- ============================================================================
-- approve_technician_registration(p_id, p_project_id default null)
-- Gate → pending assert → floor assert → status flip → role flip (+role_change
-- audit) → workers INSERT (worker_type='own', employee_id carried, active,
-- project_id=p_project_id, name=full_name) (+worker_change audit). Returns the
-- new worker id. ATOMIC — any raise rolls back the entire transaction.
-- ============================================================================
create function public.approve_technician_registration(
  p_id         uuid,
  p_project_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_reg        public.technician_registrations%rowtype;
  v_old_role   public.user_role;
  v_worker_id  uuid;
  v_name       text;
begin
  -- 1. Gate: the small explicit approver set (null-safe — a null/anon role is
  --    rejected, never silently treated as a match).
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'approve_technician_registration: role not permitted'
      using errcode = '42501';
  end if;

  -- 2. Target must exist AND be pending. Reading it here also makes a
  --    double-approve impossible: a 2nd call sees status <> 'pending' and raises.
  select * into v_reg from public.technician_registrations where id = p_id;
  if not found then
    raise exception 'approve_technician_registration: registration not found'
      using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'approve_technician_registration: registration is not pending'
      using errcode = 'P0001';
  end if;

  -- 3. Floor (spec 263) — no nameless / doc-less worker. full_name present AND a
  --    LIVE id_card attachment (supersede head via anti-join, ADR 0009).
  v_name := nullif(btrim(coalesce(v_reg.full_name, '')), '');
  if v_name is null then
    raise exception 'approve_technician_registration: full_name required before approval'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.technician_registration_attachments a
     where a.registration_id = v_reg.id
       and a.purpose = 'id_card'
       and not exists (
         select 1 from public.technician_registration_attachments n
          where n.superseded_by = a.id
       )
  ) then
    raise exception 'approve_technician_registration: an id_card attachment is required before approval'
      using errcode = 'P0001';
  end if;

  -- 4. Approve the staging row.
  update public.technician_registrations
     set status      = 'approved',
         reviewed_by = v_actor,
         reviewed_at = now(),
         updated_at  = now()
   where id = v_reg.id;

  -- 5. Flip the applicant's role to technician INLINE (see header — never nest
  --    set_user_role) + the matching role_change audit row (house style).
  select role into v_old_role from public.users where id = v_reg.user_id;
  update public.users set role = 'technician', updated_at = now()
   where id = v_reg.user_id;
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'role_change', 'users', v_reg.user_id,
     jsonb_build_object('from', v_old_role, 'to', 'technician'));

  -- 6. Create the authoritative worker (the only path into workers). Names only
  --    the grounded columns: name (workers.name is NOT NULL) = full_name,
  --    worker_type='own' (ADR 0062), user_id link, employee_id CARRIED, active,
  --    created_by, project_id=p_project_id (NULL at registration per spec unless
  --    the caller passes one). No day_rate/level/bank/tax (out of scope). A
  --    duplicate carried employee_id trips workers_employee_id_unique here and
  --    rolls the whole approve back (atomicity).
  insert into public.workers
    (name, worker_type, user_id, employee_id, active, created_by, project_id)
  values
    (v_name, 'own', v_reg.user_id, v_reg.employee_id, true, v_actor, p_project_id)
  returning id into v_worker_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'worker_change', 'workers', v_worker_id,
     jsonb_build_object('kind', 'create', 'source', 'technician_registration',
                        'registration_id', v_reg.id, 'employee_id', v_reg.employee_id));

  return v_worker_id;
end;
$$;
revoke all on function public.approve_technician_registration(uuid, uuid) from public, anon;
grant execute on function public.approve_technician_registration(uuid, uuid) to authenticated;
comment on function public.approve_technician_registration(uuid, uuid) is
  'Spec 263 U1c — back-office (procurement_manager/project_director/super_admin) approval of a pending technician registration. ATOMIC: asserts the completeness floor (full_name + live id_card), flips status to approved, flips users.role to technician INLINE (never nests set_user_role — its gate is super_admin-only), and inserts the one authoritative workers(worker_type=own, employee_id carried, active) row + role_change & worker_change audit rows. Returns the new worker id.';

-- ============================================================================
-- reject_technician_registration(p_id, p_reason)
-- Same gate → pending assert → status='rejected' + reviewed_* + reject_reason.
-- NO role change, NO workers row. One worker_change audit row records the
-- rejection (existing audit_action value; no invented enum). Idempotent: only a
-- pending row may be rejected.
-- ============================================================================
create function public.reject_technician_registration(
  p_id     uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_reg        public.technician_registrations%rowtype;
begin
  -- 1. Gate: same explicit approver set, null-safe.
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'reject_technician_registration: role not permitted'
      using errcode = '42501';
  end if;

  -- 2. Target must exist AND be pending (idempotency — only a pending row may be
  --    rejected; a 2nd reject or a reject-after-approve raises).
  select * into v_reg from public.technician_registrations where id = p_id;
  if not found then
    raise exception 'reject_technician_registration: registration not found'
      using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'reject_technician_registration: registration is not pending'
      using errcode = 'P0001';
  end if;

  -- 3. Reject the staging row. No authoritative write — the burned employee_id
  --    stays on the staging row; no role change, no workers row.
  update public.technician_registrations
     set status        = 'rejected',
         reviewed_by   = v_actor,
         reviewed_at   = now(),
         reject_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_at    = now()
   where id = v_reg.id;

  -- 4. Audit the rejection (existing worker_change action; target the staging
  --    row — nothing authoritative was created).
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'worker_change', 'technician_registrations', v_reg.id,
     jsonb_build_object('kind', 'registration_reject',
                        'employee_id', v_reg.employee_id,
                        'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end;
$$;
revoke all on function public.reject_technician_registration(uuid, text) from public, anon;
grant execute on function public.reject_technician_registration(uuid, text) to authenticated;
comment on function public.reject_technician_registration(uuid, text) is
  'Spec 263 U1c — back-office (procurement_manager/project_director/super_admin) rejection of a pending technician registration. Sets status=rejected + reviewed_* + reject_reason; writes NOTHING authoritative (no role change, no workers row); the burned employee_id stays on the staging row. Idempotent — only a pending row may be rejected. Audited (worker_change / registration_reject).';
