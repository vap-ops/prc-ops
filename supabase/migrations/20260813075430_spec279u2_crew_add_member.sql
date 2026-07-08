-- ============================================================================
-- Spec 279 U2 / ADR 0079 — crew-lead adds a member → staging → PM confirms.
-- Additive. The crew-lead captures operational facts into a staging row; a
-- disinterested PM/PD/super promotes it into a real worker + sets the money-
-- adjacent attributes (anti-self-dealing, ADR 0060 §5). An approved worker is
-- rostered + payable at the crew default but NOT cost-loggable until super_admin
-- confirms the level (the cost-engine choke point).
-- ============================================================================

create type public.crew_registration_status as enum ('pending', 'approved', 'rejected');

-- ---- workers: the cost-loggable discriminator ------------------------------
alter table public.workers
  add column cost_confirmed_at timestamptz,
  add column cost_confirmed_by uuid references public.users (id);
-- cost_confirmed_at is non-money (drives the "รอยืนยัน" chip); _by is back-office
-- identity, admin-read only (never granted).
grant select (cost_confirmed_at) on public.workers to authenticated;

-- ---- crew_registrations (staging; decoupled from auth.uid() for phoneless) --
create table public.crew_registrations (
  id                  uuid primary key default gen_random_uuid(),
  crew_id             uuid not null references public.crews (id),
  employee_id         text not null unique,
  full_name           text not null check (btrim(full_name) <> '' and length(full_name) <= 120),
  phone               text,
  national_id         text not null,
  date_of_birth       date not null,
  status              public.crew_registration_status not null default 'pending',
  onboarded_by_worker uuid references public.workers (id),
  reviewed_by         uuid references public.users (id),
  reviewed_at         timestamptz,
  reject_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index crew_registrations_crew_pending_idx on public.crew_registrations (crew_id) where status = 'pending';
-- one in-flight registration per national_id (dedup among pending rows).
create unique index crew_registrations_national_pending_uq on public.crew_registrations (national_id) where status = 'pending';
alter table public.crew_registrations enable row level security;
-- Service-role / owner only: no authenticated policy (the definer RPCs are the
-- only path; the lead/PM read surfaces are DEFINER RPCs in U4). PII stays sealed.
revoke all on public.crew_registrations from anon, authenticated;

-- ---- Thai national-ID mod-11 checksum (pure validator) ---------------------
create function public.is_valid_thai_national_id(p_id text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_sum int := 0;
  i int;
begin
  if p_id is null or p_id !~ '^[0-9]{13}$' then
    return false;
  end if;
  for i in 1..12 loop
    v_sum := v_sum + (substr(p_id, i, 1))::int * (14 - i);
  end loop;
  return ((11 - (v_sum % 11)) % 10) = (substr(p_id, 13, 1))::int;
end;
$$;

-- ---- crew_lead_add_member (own-crew; NO money params) ----------------------
create function public.crew_lead_add_member(
  p_crew uuid, p_name text, p_phone text, p_national_id text, p_dob date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker uuid := public.current_user_worker_id();
  v_lead   uuid;
  v_kind   text;
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_yy     int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq    int;
  v_emp    text;
  v_reg    uuid;
begin
  if v_worker is null then
    raise exception 'crew_lead_add_member: caller is not a bound worker' using errcode = '42501';
  end if;
  select lead_worker_id, kind into v_lead, v_kind from public.crews where id = p_crew and active;
  if not found then
    raise exception 'crew_lead_add_member: crew not found' using errcode = 'P0002';
  end if;
  if not coalesce(v_lead = v_worker, false) then
    raise exception 'crew_lead_add_member: not the lead of this crew' using errcode = '42501';
  end if;
  if v_kind = 'subcon' then
    raise exception 'crew_lead_add_member: subcon crew members belong in subcontract_crew_members' using errcode = 'P0001';
  end if;
  if v_name is null then
    raise exception 'crew_lead_add_member: name required' using errcode = 'P0001';
  end if;
  if not public.is_valid_thai_national_id(p_national_id) then
    raise exception 'crew_lead_add_member: invalid Thai national-ID' using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > (((now() at time zone 'Asia/Bangkok')::date) - interval '18 years') then
    raise exception 'crew_lead_add_member: worker must be at least 18' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workers w where w.tax_id = p_national_id) then
    raise exception 'crew_lead_add_member: this national-ID is already on a worker' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.crew_registrations r where r.national_id = p_national_id and r.status = 'pending') then
    raise exception 'crew_lead_add_member: this national-ID is already pending' using errcode = 'P0001';
  end if;

  -- Row-locked gapless PRC-YY-NNNN mint (same source as staff onboarding).
  insert into public.employee_id_counters (year, next_val) values (v_yy, 2)
  on conflict (year) do update set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;
  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.crew_registrations (crew_id, employee_id, full_name, phone, national_id, date_of_birth, onboarded_by_worker)
  values (p_crew, v_emp, v_name, nullif(btrim(coalesce(p_phone, '')), ''), p_national_id, p_dob, v_worker)
  returning id into v_reg;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), public.current_user_role(), 'crew_registrations', v_reg,
          jsonb_build_object('op', 'add_member', 'crew_id', p_crew, 'employee_id', v_emp));
  return v_reg;
end;
$$;
revoke all on function public.crew_lead_add_member(uuid, text, text, text, date) from public;
revoke execute on function public.crew_lead_add_member(uuid, text, text, text, date) from anon;
grant execute on function public.crew_lead_add_member(uuid, text, text, text, date) to authenticated;

-- ---- approve_crew_registration (STAFF_APPROVAL_ROLES; INLINED promote) ------
create function public.approve_crew_registration(
  p_id uuid,
  p_pay_type public.pay_type,
  p_day_rate numeric default null,
  p_employment_type public.employment_type default 'permanent'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_reg     public.crew_registrations%rowtype;
  v_project uuid;
  v_default numeric;
  v_rate    numeric;
  v_worker  uuid;
begin
  if v_role is null or v_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'approve_crew_registration: role not permitted' using errcode = '42501';
  end if;
  select * into v_reg from public.crew_registrations where id = p_id;
  if not found then
    raise exception 'approve_crew_registration: registration not found' using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'approve_crew_registration: registration is not pending' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workers w where w.tax_id = v_reg.national_id) then
    raise exception 'approve_crew_registration: national-ID already on a worker' using errcode = 'P0001';
  end if;

  select project_id, default_day_rate into v_project, v_default from public.crews where id = v_reg.crew_id;
  v_rate := coalesce(p_day_rate, v_default);
  if v_rate is null or v_rate < 0 then
    raise exception 'approve_crew_registration: no day rate (pass p_day_rate or set the crew default)' using errcode = 'P0001';
  end if;

  -- INLINE the worker insert (NOT create_worker — a nested DEFINER re-resolves the
  -- original caller; also we need user_id NULL + employee_id copied). Phoneless: no user_id.
  insert into public.workers (name, pay_type, employment_type, user_id, employee_id, day_rate,
                              active, created_by, project_id, phone, tax_id, date_of_birth)
  values (v_reg.full_name, p_pay_type, p_employment_type, null, v_reg.employee_id, v_rate,
          true, v_actor, v_project, v_reg.phone, v_reg.national_id, v_reg.date_of_birth)
  returning id into v_worker;

  -- INLINE crew membership + project move (NOT assign_worker_to_project — its gate
  -- excludes procurement_manager and it re-resolves the caller under DEFINER).
  insert into public.crew_members (crew_id, worker_id, added_by) values (v_reg.crew_id, v_worker, v_actor);
  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (v_worker, v_project, v_actor, 'crew onboarding');

  update public.crew_registrations
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = v_reg.id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', v_actor, v_role, 'workers', v_worker,
          jsonb_build_object('kind', 'create', 'source', 'crew_registration', 'registration_id', v_reg.id,
                             'employee_id', v_reg.employee_id, 'crew_id', v_reg.crew_id,
                             'pay_type', p_pay_type, 'day_rate', v_rate));
  return v_worker;
end;
$$;
revoke all on function public.approve_crew_registration(uuid, public.pay_type, numeric, public.employment_type) from public;
revoke execute on function public.approve_crew_registration(uuid, public.pay_type, numeric, public.employment_type) from anon;
grant execute on function public.approve_crew_registration(uuid, public.pay_type, numeric, public.employment_type) to authenticated;

-- ---- reject_crew_registration ----------------------------------------------
create function public.reject_crew_registration(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_role is null or v_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'reject_crew_registration: role not permitted' using errcode = '42501';
  end if;
  update public.crew_registrations
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         reject_reason = v_reason, updated_at = now()
   where id = p_id and status = 'pending';
  if not found then
    raise exception 'reject_crew_registration: registration not found or not pending' using errcode = 'P0001';
  end if;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crew_registrations', p_id,
          jsonb_build_object('op', 'reject', 'reason', v_reason));
end;
$$;
revoke all on function public.reject_crew_registration(uuid, text) from public;
revoke execute on function public.reject_crew_registration(uuid, text) from anon;
grant execute on function public.reject_crew_registration(uuid, text) to authenticated;

-- ---- confirm_worker_cost (super_admin sets level → stamps cost_confirmed_at) --
create function public.confirm_worker_cost(p_worker uuid, p_level public.worker_level)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is distinct from 'super_admin' then
    raise exception 'confirm_worker_cost: only super_admin may confirm cost' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'confirm_worker_cost: worker not found' using errcode = 'P0001';
  end if;
  update public.workers set level = p_level where id = p_worker;
  -- Cost-loggable once level + rate + pay-class + tenure are all set.
  update public.workers
     set cost_confirmed_at = now(), cost_confirmed_by = auth.uid()
   where id = p_worker
     and level is not null and day_rate is not null
     and pay_type is not null and employment_type is not null;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', p_worker,
          jsonb_build_object('kind', 'cost_confirm', 'level', p_level));
end;
$$;
revoke all on function public.confirm_worker_cost(uuid, public.worker_level) from public;
revoke execute on function public.confirm_worker_cost(uuid, public.worker_level) from anon;
grant execute on function public.confirm_worker_cost(uuid, public.worker_level) to authenticated;

comment on table public.crew_registrations is
  'Spec 279 U2 / ADR 0079 — staging for a crew-lead-added member (decoupled from auth.uid() so a phoneless worker can be onboarded by proxy). crew_lead_add_member writes it; approve/reject_crew_registration close it. Service-role/owner only.';
