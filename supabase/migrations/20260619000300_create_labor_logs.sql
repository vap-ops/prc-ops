-- Spec 46 — labor_logs: one row per worker per day per work package,
-- append-only with the photo_logs supersede pattern (ADR 0004/0009/
-- 0015): a correction INSERTS a new row whose superseded_by points at
-- the row it replaces; a removal is a tombstone row (day_fraction
-- NULL + superseded_by set). Current state = anti-join + tombstone
-- filter. DC workers' logged days are payroll — hence the audit-grade
-- immutability.
--
-- MONEY POSTURE: day_rate_snapshot (captured from workers at entry
-- time so later rate changes never rewrite history) has NO
-- authenticated grant — service-role-only, like workers.day_rate.
--
-- UNIQUENESS (spec 46 C2): "one current entry per (wp, worker, date)"
-- cannot be a unique index under the supersede pattern ("not
-- superseded" is an anti-join). It is enforced in log_labor_day under
-- a per-triple advisory lock; pgTAP pins the behavior.

create type public.day_fraction as enum ('full', 'half');

create table public.labor_logs (
  id                    uuid primary key default gen_random_uuid(),
  work_package_id       uuid not null references public.work_packages(id),
  worker_id             uuid not null references public.workers(id),
  work_date             date not null,
  day_fraction          public.day_fraction null,
  day_rate_snapshot     numeric(10,2) not null,
  worker_name_snapshot  text not null,
  worker_type_snapshot  public.worker_type not null,
  contractor_id_snapshot uuid null,
  entered_by            uuid not null references public.users(id),
  self_logged           boolean not null default false,
  superseded_by         uuid null references public.labor_logs(id),
  correction_reason     text null,
  created_at            timestamptz not null default now(),
  -- NULL fraction is the tombstone shape and only corrections may carry it.
  constraint labor_logs_tombstone_is_correction
    check (day_fraction is not null or superseded_by is not null),
  -- A reason iff the row supersedes something.
  constraint labor_logs_reason_iff_correction
    check ((superseded_by is null) = (correction_reason is null))
);

create index labor_logs_wp_date_idx on public.labor_logs (work_package_id, work_date);
create index labor_logs_worker_date_idx on public.labor_logs (worker_id, work_date);

alter table public.labor_logs enable row level security;
revoke all on public.labor_logs from anon, authenticated;

-- Column-scoped read: everything EXCEPT day_rate_snapshot. No write
-- grants — the RPCs below are the only write path.
grant select (id, work_package_id, worker_id, work_date, day_fraction,
              worker_name_snapshot, worker_type_snapshot,
              contractor_id_snapshot, entered_by, self_logged,
              superseded_by, correction_reason, created_at)
  on public.labor_logs to authenticated;

create policy "labor logs readable by field and pm"
  on public.labor_logs
  for select
  to authenticated
  using (public.current_user_role()
           in ('site_admin', 'project_manager', 'super_admin'));

-- Append-only, audit_log triple-layer: revoked privileges (above), no
-- UPDATE/DELETE policies, and belt-and-suspenders triggers.
create function public.labor_logs_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'labor_logs is append-only (supersede, never mutate)'
    using errcode = 'P0001';
end;
$$;

create trigger labor_logs_no_update_delete
  before update or delete on public.labor_logs
  for each row execute function public.labor_logs_block_mutation();

create trigger labor_logs_no_truncate
  before truncate on public.labor_logs
  for each statement execute function public.labor_logs_block_mutation();

-- ----------------------------------------------------------------------------
-- Write path. Entry roles per spec 46 C4: site_admin, project_manager,
-- super_admin (technicians report verbally; back office enters).
-- ----------------------------------------------------------------------------

create function public.log_labor_day(
  p_wp uuid,
  p_worker uuid,
  p_date date,
  p_fraction public.day_fraction
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_wp_status public.work_package_status;
  v_id uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'log_labor_day: role not permitted' using errcode = '42501';
  end if;
  if p_fraction is null then
    raise exception 'log_labor_day: day fraction required' using errcode = 'P0001';
  end if;

  -- Serialize per (wp, worker, date): the uniqueness check below is
  -- race-free only under this lock (C2).
  perform pg_advisory_xact_lock(
    hashtextextended(p_wp::text || '|' || p_worker::text || '|' || p_date::text, 0));

  select status into v_wp_status
    from public.work_packages where id = p_wp;
  if not found then
    raise exception 'log_labor_day: work package not found' using errcode = 'P0001';
  end if;
  if v_wp_status = 'complete' then
    raise exception 'log_labor_day: work package is complete'
      using errcode = 'P0001';
  end if;

  select * into v_worker from public.workers where id = p_worker;
  if not found then
    raise exception 'log_labor_day: worker not found' using errcode = 'P0001';
  end if;
  if not v_worker.active then
    raise exception 'log_labor_day: worker is inactive' using errcode = 'P0001';
  end if;

  -- One CURRENT (non-superseded, non-tombstone) entry per triple.
  if exists (
    select 1 from public.labor_logs ll
     where ll.work_package_id = p_wp
       and ll.worker_id = p_worker
       and ll.work_date = p_date
       and ll.day_fraction is not null
       and not exists (select 1 from public.labor_logs newer
                        where newer.superseded_by = ll.id)
  ) then
    raise exception 'log_labor_day: entry already exists for this worker and day'
      using errcode = 'P0001';
  end if;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, worker_type_snapshot,
     contractor_id_snapshot, entered_by, self_logged)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.worker_type,
     v_worker.contractor_id, auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.correct_labor_log(
  p_log uuid,
  p_reason text,
  p_fraction public.day_fraction default null,
  p_tombstone boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig public.labor_logs%rowtype;
  v_worker_user uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'correct_labor_log: role not permitted' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'correct_labor_log: reason required (max 300 chars)'
      using errcode = 'P0001';
  end if;
  if not p_tombstone and p_fraction is null then
    raise exception 'correct_labor_log: new fraction required unless removing'
      using errcode = 'P0001';
  end if;

  select * into v_orig from public.labor_logs where id = p_log;
  if not found then
    raise exception 'correct_labor_log: log not found' using errcode = 'P0001';
  end if;
  if v_orig.day_fraction is null then
    raise exception 'correct_labor_log: cannot correct a removal'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_orig.work_package_id::text || '|'
                     || v_orig.worker_id::text || '|'
                     || v_orig.work_date::text, 0));

  if exists (select 1 from public.labor_logs newer
              where newer.superseded_by = p_log) then
    raise exception 'correct_labor_log: log already superseded'
      using errcode = 'P0001';
  end if;

  -- Snapshots carry over: the day keeps the rate it was worked under.
  select w.user_id into v_worker_user
    from public.workers w where w.id = v_orig.worker_id;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, worker_type_snapshot,
     contractor_id_snapshot, entered_by, self_logged,
     superseded_by, correction_reason)
  values
    (v_orig.work_package_id, v_orig.worker_id, v_orig.work_date,
     case when p_tombstone then null else p_fraction end,
     v_orig.day_rate_snapshot, v_orig.worker_name_snapshot,
     v_orig.worker_type_snapshot, v_orig.contractor_id_snapshot,
     auth.uid(),
     v_worker_user is not distinct from auth.uid() and v_worker_user is not null,
     p_log, v_reason)
  returning id into v_id;
  return v_id;
end;
$$;
