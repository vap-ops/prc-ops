-- Spec 146 U3 — the check-out / check-in write path. SECURITY DEFINER, gated to the
-- equipment FIELD + back office (site_admin/pm/procurement/super — the
-- equipment_movements audience: the field physically takes and returns gear). The
-- field never sees the rate; the definer snapshots equipment_items.daily_rate
-- server-side (the log_labor_day / labor_logs.day_rate_snapshot posture). Both run
-- under the caller's authenticated session (auth.uid() + current_user_role() must
-- resolve) — never the admin client. Self-auditing (the append-only log IS the
-- trail, like labor_logs / movements): no audit_log row, no new audit_action.

-- ----------------------------------------------------------------------------
-- check_out_equipment: open a usage span (item -> work package) at the item's
-- current daily rate. One open checkout per item (an item can't be in two WPs at
-- once); the WP must be open and the item must be priced.
-- ----------------------------------------------------------------------------
create function public.check_out_equipment(p_item uuid, p_wp uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate     numeric(12,2);
  v_priced   boolean;
  v_wp_status public.work_package_status;
  v_id       uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'procurement', 'super_admin') then
    raise exception 'check_out_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_out_equipment: checkout date required' using errcode = 'P0001';
  end if;

  -- Serialize per item: the one-open-checkout check below is race-free only under
  -- this lock (the log_labor_day per-triple lock, here per-item).
  perform pg_advisory_xact_lock(hashtextextended(p_item::text, 0));

  -- SECURITY DEFINER bypasses RLS — probe the item + read its (admin-only) rate.
  select daily_rate, daily_rate is not null
    into v_rate, v_priced
    from public.equipment_items where id = p_item;
  if not found then
    raise exception 'check_out_equipment: equipment item not found' using errcode = 'P0001';
  end if;
  if not v_priced then
    raise exception 'check_out_equipment: item has no daily rate (price it first)'
      using errcode = 'P0001';
  end if;

  select status into v_wp_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'check_out_equipment: work package not found' using errcode = 'P0001';
  end if;
  if v_wp_status = 'complete' then
    raise exception 'check_out_equipment: work package is complete' using errcode = 'P0001';
  end if;

  -- One CURRENT (non-superseded) OPEN checkout per item: a returned item (whose
  -- open row was superseded by a closed check-in) is free to check out again.
  if exists (
    select 1 from public.equipment_usage_logs ul
     where ul.item_id = p_item
       and ul.checked_in_on is null
       and not exists (select 1 from public.equipment_usage_logs n where n.superseded_by = ul.id)
  ) then
    raise exception 'check_out_equipment: item is already checked out' using errcode = 'P0001';
  end if;

  insert into public.equipment_usage_logs
    (item_id, work_package_id, checked_out_on, daily_rate_snapshot, entered_by)
  values
    (p_item, p_wp, p_date, v_rate, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.check_out_equipment(uuid, uuid, date) from public;
grant execute on function public.check_out_equipment(uuid, uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- check_in_equipment: close an open checkout by INSERTING a closed successor that
-- supersedes the open row (append-only — the open row is never UPDATEd). Carries
-- the original's item / WP / checkout date / rate snapshot.
-- ----------------------------------------------------------------------------
create function public.check_in_equipment(p_log uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig public.equipment_usage_logs%rowtype;
  v_id   uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'procurement', 'super_admin') then
    raise exception 'check_in_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_in_equipment: check-in date required' using errcode = 'P0001';
  end if;

  select * into v_orig from public.equipment_usage_logs where id = p_log;
  if not found then
    raise exception 'check_in_equipment: checkout not found' using errcode = 'P0001';
  end if;
  if v_orig.checked_in_on is not null then
    raise exception 'check_in_equipment: checkout is already closed' using errcode = 'P0001';
  end if;

  -- Serialize per item, then re-check (race) that the open row is still current.
  perform pg_advisory_xact_lock(hashtextextended(v_orig.item_id::text, 0));
  if exists (select 1 from public.equipment_usage_logs n where n.superseded_by = p_log) then
    raise exception 'check_in_equipment: checkout already superseded' using errcode = 'P0001';
  end if;

  if p_date < v_orig.checked_out_on then
    raise exception 'check_in_equipment: check-in before check-out' using errcode = 'P0001';
  end if;

  insert into public.equipment_usage_logs
    (item_id, work_package_id, checked_out_on, checked_in_on,
     daily_rate_snapshot, entered_by, superseded_by)
  values
    (v_orig.item_id, v_orig.work_package_id, v_orig.checked_out_on, p_date,
     v_orig.daily_rate_snapshot, auth.uid(), p_log)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.check_in_equipment(uuid, date) from public;
grant execute on function public.check_in_equipment(uuid, date) to authenticated;
