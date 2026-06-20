-- Spec 146 U3 — ADR 0058 fix: add project_director alongside project_manager in the
-- two equipment-usage RPC gates + the read policy. project_director is a see-all
-- project_manager (ADR 0058): every gate/policy that names project_manager must also
-- name project_director, enforced by pgTAP 90 (RPC gates) and 91 (RLS policies). The
-- 20260767000100 / 20260767000000 originals named project_manager only — a slip this
-- migration corrects forward (the originals are already applied; never edited).
-- wp_equipment_sell / wp_profit are super_admin/project_director-only (no PM ref), so
-- they are untouched. CREATE OR REPLACE preserves the function grants.

-- ----------------------------------------------------------------------------
create or replace function public.check_out_equipment(p_item uuid, p_wp uuid, p_date date)
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
       not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'super_admin') then
    raise exception 'check_out_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_out_equipment: checkout date required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item::text, 0));

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

-- ----------------------------------------------------------------------------
create or replace function public.check_in_equipment(p_log uuid, p_date date)
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
       not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'super_admin') then
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

-- ----------------------------------------------------------------------------
-- Postgres has no CREATE OR REPLACE POLICY — DROP + CREATE to add project_director.
drop policy "equipment_usage_logs readable by staff" on public.equipment_usage_logs;
create policy "equipment_usage_logs readable by staff"
  on public.equipment_usage_logs for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'project_director', 'procurement', 'super_admin'));
