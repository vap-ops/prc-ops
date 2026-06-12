-- Spec 46 — workers master: individual people whose daily presence is
-- logged per work package. Two kinds: the company's own technicians
-- ('own', optionally linked to an app user for self-log detection) and
-- DC outsourced workers ('dc', always tied to a contractor — their
-- logged days are payroll, not just cost allocation).
--
-- MONEY POSTURE (spec 46 C3): every app user shares the `authenticated`
-- DB role, so field/PM separation cannot come from RLS or column grants
-- between app roles. day_rate therefore gets NO authenticated grant at
-- all — the only reader is the service-role client inside
-- requireRole(pm/super)-gated server code, and all writes go through
-- the SECURITY DEFINER RPCs below (zero write grants). A field client
-- cannot read a rate even with a hand-crafted query.
--
-- No DELETE ever (suppliers posture): a worker with logged days stays
-- referencable forever; retirement = active=false.

create type public.worker_type as enum ('own', 'dc');

create table public.workers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  worker_type   public.worker_type not null,
  contractor_id uuid null references public.contractors(id),
  user_id       uuid null references public.users(id),
  day_rate      numeric(10,2) not null default 0,
  active        boolean not null default true,
  created_by    uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  constraint workers_name_nonblank check (length(trim(name)) > 0),
  constraint workers_name_cap check (length(name) <= 120),
  constraint workers_day_rate_nonnegative check (day_rate >= 0),
  constraint workers_dc_has_contractor
    check (worker_type <> 'dc' or contractor_id is not null),
  constraint workers_own_has_no_contractor
    check (worker_type <> 'own' or contractor_id is null)
);

alter table public.workers enable row level security;
revoke all on public.workers from anon, authenticated;

-- Column-scoped read: everything EXCEPT day_rate. No write grants —
-- the RPCs below are the only write path.
grant select (id, name, worker_type, contractor_id, user_id, active,
              created_by, created_at)
  on public.workers to authenticated;

create policy "workers readable by staff"
  on public.workers
  for select
  to authenticated
  using (public.current_user_role()
           in ('site_admin', 'project_manager', 'procurement', 'super_admin'));

-- ----------------------------------------------------------------------------
-- Write path: SECURITY DEFINER RPCs, pm/super only (rates are money;
-- site_admin manages presence, never the roster).
-- ----------------------------------------------------------------------------

create function public.create_worker(
  p_name text,
  p_type public.worker_type,
  p_day_rate numeric,
  p_contractor uuid default null,
  p_user uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'create_worker: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'create_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_day_rate is null or p_day_rate < 0 then
    raise exception 'create_worker: invalid day rate' using errcode = 'P0001';
  end if;

  insert into public.workers (name, worker_type, contractor_id, user_id,
                              day_rate, created_by)
  values (v_name, p_type, p_contractor, p_user, p_day_rate, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          v_id, jsonb_build_object('kind', 'create', 'name', v_name,
                                   'worker_type', p_type,
                                   'day_rate', p_day_rate));
  return v_id;
end;
$$;

create function public.update_worker(
  p_id uuid,
  p_name text default null,
  p_active boolean default null,
  p_contractor uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'update_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_row from public.workers where id = p_id;
  if not found then
    raise exception 'update_worker: worker not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_contractor is not null and v_row.worker_type <> 'dc' then
    raise exception 'update_worker: contractor only applies to dc workers'
      using errcode = 'P0001';
  end if;

  -- Coalesce semantics (record_purchase precedent): omitted = preserved.
  update public.workers
     set name          = coalesce(v_name, name),
         active        = coalesce(p_active, active),
         contractor_id = coalesce(p_contractor, contractor_id)
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'update', 'name', v_name,
                                   'active', p_active,
                                   'contractor_id', p_contractor));
end;
$$;

create function public.set_worker_day_rate(p_id uuid, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'set_worker_day_rate: role not permitted' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'set_worker_day_rate: invalid rate' using errcode = 'P0001';
  end if;
  select day_rate into v_old from public.workers where id = p_id;
  if not found then
    raise exception 'set_worker_day_rate: worker not found' using errcode = 'P0001';
  end if;

  update public.workers set day_rate = p_rate where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'rate_change',
                                   'old_rate', v_old, 'new_rate', p_rate));
end;
$$;
