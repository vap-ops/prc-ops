-- Spec 74 — labor-day note (notes-everywhere rollout). An optional free-text
-- note on a daily labor entry ("worked overtime", "left early", what the crew
-- did). labor_logs is append-only (supersede), so the note is a per-row
-- SNAPSHOT set at log_labor_day and CARRIED FORWARD through corrections
-- (exactly like day_rate_snapshot / correction has always carried the rate);
-- a tombstone removal carries note = null.
--
-- note is presence data, not money — it gets the authenticated SELECT grant
-- (unlike day_rate_snapshot). App caps at 1000; CHECK<=2000 is the backstop.

alter table public.labor_logs
  add column note text,
  add constraint labor_logs_note_len
    check (note is null or length(note) <= 2000);

grant select (note) on public.labor_logs to authenticated;

-- Both write RPCs gain p_note. CREATE OR REPLACE cannot add a parameter, so
-- DROP then CREATE. Bodies are reproduced verbatim from 20260619000300 with
-- the note additions only.

drop function public.log_labor_day(uuid, uuid, date, public.day_fraction);

create function public.log_labor_day(
  p_wp uuid,
  p_worker uuid,
  p_date date,
  p_fraction public.day_fraction,
  p_note text default null
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
     contractor_id_snapshot, entered_by, self_logged, note)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.worker_type,
     v_worker.contractor_id, auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null,
     nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

drop function public.correct_labor_log(uuid, text, public.day_fraction, boolean);

create function public.correct_labor_log(
  p_log uuid,
  p_reason text,
  p_fraction public.day_fraction default null,
  p_tombstone boolean default false,
  p_note text default null
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

  select w.user_id into v_worker_user
    from public.workers w where w.id = v_orig.worker_id;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, worker_type_snapshot,
     contractor_id_snapshot, entered_by, self_logged,
     superseded_by, correction_reason, note)
  values
    (v_orig.work_package_id, v_orig.worker_id, v_orig.work_date,
     case when p_tombstone then null else p_fraction end,
     v_orig.day_rate_snapshot, v_orig.worker_name_snapshot,
     v_orig.worker_type_snapshot, v_orig.contractor_id_snapshot,
     auth.uid(),
     v_worker_user is not distinct from auth.uid() and v_worker_user is not null,
     p_log, v_reason,
     -- Note carries forward unless edited; a tombstone removal clears it.
     case
       when p_tombstone then null
       when p_note is null then v_orig.note
       else nullif(btrim(p_note), '')
     end)
  returning id into v_id;
  return v_id;
end;
$$;
