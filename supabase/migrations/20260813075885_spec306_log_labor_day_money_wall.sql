-- Spec 306 — close the OTHER half of the labour money wall.
--
-- `derive_muster_labor` (the muster's automatic writer) refuses a worker unless
-- ALL of: active · contractor_id is null · cost_confirmed_at is not null ·
-- coalesce(day_rate, 0) > 0. `log_labor_day` — the MANUAL writer behind the WP
-- capture zone and /sa/plan's mark-present — checked only `active`. Both write
-- the same table through the same append-only ledger, so the manual door was a
-- complete bypass of three money gates:
--
--   1. contractor_id (spec 328 §2.4): a subcontractor firm's crew are paid BY
--      THE FIRM out of the work package's contract price. A daily-wage row for
--      one of them is a SECOND payment for the same labour. Spec 328 U3 filtered
--      the PICKER only; nothing stopped the RPC.
--   2. cost_confirmed_at: an unconfirmed worker has no agreed rate. Booking a
--      wage before the rate is agreed prices the day at whatever happens to be
--      in the column.
--   3. day_rate > 0: `day_rate_snapshot` is captured AT INSERT into an
--      append-only ledger, so a row written at rate 0 is a permanently ฿0 wage.
--      No later rate correction repairs it — it needs a per-row
--      `correct_labor_log` tombstone.
--
-- Direction is deliberate: all three FAIL CLOSED. A refusal is visible to the
-- site admin in the moment; a ฿0 or double-paid row is silent and survives.
--
-- Scope note, stated precisely: this guards the WRITE only. `labor_logs` is
-- append-only, so rows already booked are untouched by this migration — at the
-- time of writing the table is 0 rows all-time, so there is nothing to retract
-- and no backfill. Do not read this guard as self-healing for history.
--
-- Body sourced from the LIVE definition (pg_get_functiondef), not from an
-- earlier migration file — the only three additions are the arms below.

create or replace function public.log_labor_day(
  p_wp uuid,
  p_worker uuid,
  p_date date,
  p_fraction day_fraction,
  p_note text default null::text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker public.workers%rowtype;
  v_wp_status public.work_package_status;
  v_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'log_labor_day: role not permitted' using errcode = '42501';
  end if;
  if p_fraction is null then
    raise exception 'log_labor_day: day fraction required' using errcode = 'P0001';
  end if;
  -- U3 (spec 271 §3): the labor actual_start anchor must not be stageable
  -- ahead of time.
  if p_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'log_labor_day: work_date cannot be in the future' using errcode = 'P0001';
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

  -- Spec 328 §2.4 money wall — parity with derive_muster_labor.
  -- A contractor-tied worker is pay-exempt: the firm pays them out of the WP
  -- contract price, so PRC never owes them a daily wage.
  if v_worker.contractor_id is not null then
    raise exception 'log_labor_day: worker is paid by a subcontractor firm'
      using errcode = 'P0001';
  end if;

  -- Cost gate — parity with derive_muster_labor. Distinct messages so the
  -- action layer can tell the site admin WHICH step is missing: confirming the
  -- worker's level+rate is a procurement action, not something they can fix.
  if v_worker.cost_confirmed_at is null then
    raise exception 'log_labor_day: worker cost is not confirmed'
      using errcode = 'P0001';
  end if;
  if coalesce(v_worker.day_rate, 0) <= 0 then
    raise exception 'log_labor_day: worker day rate is not set'
      using errcode = 'P0001';
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
     day_rate_snapshot, worker_name_snapshot, pay_type_snapshot,
     wht_pct_snapshot,
     entered_by, self_logged, note)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.pay_type,
     (select wht_pct from public.labor_wht_config where id = true),
     auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null,
     nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

-- Re-assert the posture a CREATE OR REPLACE inherits, so the grant set is
-- stated in the same file as the body (36-rpc-execute-lockdown pins it).
revoke all on function public.log_labor_day(uuid, uuid, date, day_fraction, text)
  from public, anon;
grant execute on function public.log_labor_day(uuid, uuid, date, day_fraction, text)
  to authenticated, service_role;
