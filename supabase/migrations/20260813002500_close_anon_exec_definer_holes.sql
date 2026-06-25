-- Security (anon-exec definer sweep, follow-up to 20260813002300/002400) — close the
-- 8 remaining SECURITY DEFINER WRITE rpcs that an unauthenticated PostgREST call could
-- execute. Same defect class the wp_economics setters had: (1) no `revoke ... from
-- anon` (Supabase's ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon on every new
-- public function; `revoke from public` alone does NOT drop the explicit anon grant),
-- AND (2) a null-unsafe gate `if current_user_role() not in (...)` — current_user_role()
-- is NULL for anon (auth.uid() NULL → no users row), `NULL not in (...)` = NULL, the
-- `if` treats it as false, the raise never fires, the body falls through to the write
-- (auth.uid()/actor_id land NULL). Verified live 2026-06-26: all 8 had anon EXECUTE.
--
-- Fix mirrors 20260813002400 for each: capture v_role := current_user_role() once, gate
-- `v_role is null or v_role not in (...)`, reuse v_role in the audit actor_role, then
-- `revoke all ... from public, anon` + keep `grant execute ... to authenticated`. Bodies
-- are otherwise reproduced verbatim from the live definitions (pg_get_functiondef);
-- CREATE OR REPLACE keeps each signature, so this is additive/forward-only.

-- 1 ────────────────────────────────────────────────────────────────────────────────
create or replace function public.set_equipment_daily_rate(p_id uuid, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_old  numeric;
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'set_equipment_daily_rate: role not permitted' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'set_equipment_daily_rate: invalid rate' using errcode = 'P0001';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly.
  select daily_rate into v_old from public.equipment_items where id = p_id;
  if not found then
    raise exception 'set_equipment_daily_rate: equipment item not found' using errcode = 'P0001';
  end if;

  update public.equipment_items set daily_rate = p_rate where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_rate_change', auth.uid(), v_role,
          'equipment_items', p_id,
          jsonb_build_object('kind', 'rate_change',
                             'old_rate', v_old, 'new_rate', p_rate));
end;
$$;
revoke all on function public.set_equipment_daily_rate(uuid, numeric) from public, anon;
grant execute on function public.set_equipment_daily_rate(uuid, numeric) to authenticated;

-- 2 ────────────────────────────────────────────────────────────────────────────────
create or replace function public.create_equipment_rental_batch(
  p_owner_id uuid, p_monthly_rate numeric, p_starts_on date,
  p_ends_on date default null::date, p_note text default null::text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id   uuid;
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_equipment_rental_batch: role not permitted' using errcode = '42501';
  end if;

  perform 1 from public.equipment_owners where id = p_owner_id;
  if not found then
    raise exception 'create_equipment_rental_batch: owner not found' using errcode = 'P0001';
  end if;
  if p_monthly_rate is null or p_monthly_rate < 0 then
    raise exception 'create_equipment_rental_batch: invalid monthly rate' using errcode = 'P0001';
  end if;
  if p_starts_on is null then
    raise exception 'create_equipment_rental_batch: start date required' using errcode = 'P0001';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'create_equipment_rental_batch: end before start' using errcode = 'P0001';
  end if;

  insert into public.equipment_rental_batches
    (owner_id, monthly_rate, starts_on, ends_on, note, created_by)
  values (p_owner_id, p_monthly_rate, p_starts_on, p_ends_on, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_batch_create', auth.uid(), v_role,
          'equipment_rental_batches', v_id,
          jsonb_build_object('owner_id', p_owner_id, 'monthly_rate', p_monthly_rate,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$$;
revoke all on function public.create_equipment_rental_batch(uuid, numeric, date, date, text) from public, anon;
grant execute on function public.create_equipment_rental_batch(uuid, numeric, date, date, text) to authenticated;

-- 3 ────────────────────────────────────────────────────────────────────────────────
create or replace function public.create_equipment_project_allocation(
  p_batch_id uuid, p_project_id uuid, p_starts_on date,
  p_ends_on date default null::date, p_note text default null::text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id   uuid;
begin
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_equipment_project_allocation: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe FK targets explicitly.
  perform 1 from public.equipment_rental_batches where id = p_batch_id;
  if not found then
    raise exception 'create_equipment_project_allocation: batch not found' using errcode = 'P0001';
  end if;
  perform 1 from public.projects where id = p_project_id;
  if not found then
    raise exception 'create_equipment_project_allocation: project not found' using errcode = 'P0001';
  end if;
  if p_starts_on is null then
    raise exception 'create_equipment_project_allocation: start date required' using errcode = 'P0001';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'create_equipment_project_allocation: end before start' using errcode = 'P0001';
  end if;

  insert into public.equipment_project_allocations
    (batch_id, project_id, starts_on, ends_on, note, created_by)
  values (p_batch_id, p_project_id, p_starts_on, p_ends_on, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_allocation_create', auth.uid(), v_role,
          'equipment_project_allocations', v_id,
          jsonb_build_object('batch_id', p_batch_id, 'project_id', p_project_id,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$$;
revoke all on function public.create_equipment_project_allocation(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.create_equipment_project_allocation(uuid, uuid, date, date, text) to authenticated;

-- 4 ────────────────────────────────────────────────────────────────────────────────
create or replace function public.check_out_equipment(p_item uuid, p_wp uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      public.user_role := public.current_user_role();
  v_rate      numeric(12,2);
  v_priced    boolean;
  v_status    public.equipment_status;   -- F2: the item's physical availability
  v_wp_status public.work_package_status;
  v_id        uuid;
begin
  if v_role is null
       or v_role not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'super_admin') then
    raise exception 'check_out_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_out_equipment: checkout date required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item::text, 0));

  select daily_rate, daily_rate is not null, status
    into v_rate, v_priced, v_status
    from public.equipment_items where id = p_item;
  if not found then
    raise exception 'check_out_equipment: equipment item not found' using errcode = 'P0001';
  end if;
  if not v_priced then
    raise exception 'check_out_equipment: item has no daily rate (price it first)'
      using errcode = 'P0001';
  end if;
  -- F2: only gear physically on hand can be billed to a WP. maintenance / returned
  -- (to owner) / lost are blocked. 'in_use' passes HERE on purpose — a genuine
  -- in_use has an open span and is caught by the one-open-checkout guard below
  -- with the precise "already checked out" message; a manually-set in_use with no
  -- open span is legitimately checkout-able.
  if v_status not in ('available', 'on_site', 'in_use') then
    raise exception 'check_out_equipment: equipment not on site (maintenance/returned/lost)'
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

  -- F3: best-effort status overlay — the item is now in use. NOT authoritative:
  -- any later equipment_movements row re-derives status via its trigger and
  -- clobbers this; the open usage log remains the source of truth for "is it out".
  update public.equipment_items set status = 'in_use' where id = p_item;

  return v_id;
end;
$$;
revoke all on function public.check_out_equipment(uuid, uuid, date) from public, anon;
grant execute on function public.check_out_equipment(uuid, uuid, date) to authenticated;

-- 5 ────────────────────────────────────────────────────────────────────────────────
create or replace function public.check_in_equipment(p_log uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_orig public.equipment_usage_logs%rowtype;
  v_id   uuid;
begin
  if v_role is null
       or v_role not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'super_admin') then
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

  -- F3: clear the in_use overlay — restore the status the item's LATEST movement
  -- implies (deployed→on_site, returned→returned, …; no movement → available),
  -- reusing the equipment_movement_derive_status mapping. Unconditional re-derive:
  -- idempotent and coherent whatever the current status (a movement may have
  -- clobbered in_use mid-checkout). Keeps the registry honest after a return.
  update public.equipment_items ei
     set status = coalesce((
       select (case m.kind
                 when 'received'    then 'available'
                 when 'deployed'    then 'on_site'
                 when 'returned'    then 'returned'
                 when 'maintenance' then 'maintenance'
                 when 'lost'        then 'lost'
               end)::public.equipment_status
         from public.equipment_movements m
        where m.item_id = v_orig.item_id
        order by m.occurred_at desc
        limit 1
     ), 'available'::public.equipment_status)
   where ei.id = v_orig.item_id;

  return v_id;
end;
$$;
revoke all on function public.check_in_equipment(uuid, date) from public, anon;
grant execute on function public.check_in_equipment(uuid, date) to authenticated;

-- 6 ────────────────────────────────────────────────────────────────────────────────
create or replace function public.freeze_wp_labor_cost(p_wp uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    public.user_role := public.current_user_role();
  v_own     numeric(12,2);
  v_dc      numeric(12,2);
  v_old_own numeric(12,2);
  v_old_dc  numeric(12,2);
begin
  -- Rate is money: pm/super only (site_admin refused, like set_worker_day_rate).
  if v_role is null
       or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'freeze_wp_labor_cost: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly (v1 access
  -- is role-level per ADR 0013, so existence is the only guard available).
  perform 1 from public.work_packages where id = p_wp;
  if not found then
    raise exception 'freeze_wp_labor_cost: work package not found' using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded, non-tombstone) labor logs. This MUST
  -- match src/lib/labor/cost.ts aggregateLaborCost (own/dc subtotals shown
  -- in the PM cost view are computed the same way live).
  select
    coalesce(sum(case when ll.worker_type_snapshot = 'own'
      then (case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot
      else 0 end), 0),
    coalesce(sum(case when ll.worker_type_snapshot = 'dc'
      then (case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot
      else 0 end), 0)
  into v_own, v_dc
  from public.labor_logs ll
  where ll.work_package_id = p_wp
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  -- Prior snapshot (NULL on first freeze) for the audit payload.
  select own_cost, dc_cost into v_old_own, v_old_dc
    from public.wp_labor_costs where work_package_id = p_wp;

  insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, computed_at, frozen_by)
  values (p_wp, v_own, v_dc, now(), auth.uid())
  on conflict (work_package_id) do update
    set own_cost    = excluded.own_cost,
        dc_cost     = excluded.dc_cost,
        computed_at = excluded.computed_at,
        frozen_by   = excluded.frozen_by;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('labor_cost_freeze', auth.uid(), v_role,
          'wp_labor_costs', p_wp,
          jsonb_build_object('own_cost', v_own, 'dc_cost', v_dc,
                             'old_own_cost', v_old_own, 'old_dc_cost', v_old_dc));
end;
$$;
revoke all on function public.freeze_wp_labor_cost(uuid) from public, anon;
grant execute on function public.freeze_wp_labor_cost(uuid) to authenticated;

-- 7 ────────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_project_ht(p_project uuid, p_worker uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_type   public.worker_type;
  v_active boolean;
begin
  if v_role is null
       or v_role not in ('project_manager', 'project_director', 'super_admin') then
    raise exception 'assign_project_ht: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'assign_project_ht: project not found' using errcode = 'P0001';
  end if;
  select worker_type, active into v_type, v_active
    from public.workers where id = p_worker;
  if not found then
    raise exception 'assign_project_ht: worker not found' using errcode = 'P0001';
  end if;
  -- The HT is a PROMOTED DC (ADR 0060 §1) and must be active.
  if v_type <> 'dc' or not v_active then
    raise exception 'assign_project_ht: HT must be an active DC' using errcode = 'P0001';
  end if;

  update public.projects set ht_worker_id = p_worker where id = p_project;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), v_role, 'projects', p_project,
          jsonb_build_object('field', 'ht_worker_id', 'worker_id', p_worker));
end;
$$;
revoke all on function public.assign_project_ht(uuid, uuid) from public, anon;
grant execute on function public.assign_project_ht(uuid, uuid) to authenticated;

-- 8 ────────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_worker_to_project(
  p_worker uuid, p_project uuid default null::uuid, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_exists boolean;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_role is null
       or v_role not in ('project_manager', 'project_director', 'super_admin', 'procurement') then
    raise exception 'assign_worker_to_project: role not permitted' using errcode = '42501';
  end if;
  select true into v_exists from public.workers where id = p_worker;
  if not found then
    raise exception 'assign_worker_to_project: worker not found' using errcode = 'P0001';
  end if;

  update public.workers set project_id = p_project where id = p_worker;

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (p_worker, p_project, auth.uid(), v_reason);

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers',
          p_worker, jsonb_build_object('kind', 'project_move',
                                       'project_id', p_project,
                                       'reason', v_reason));
end;
$$;
revoke all on function public.assign_worker_to_project(uuid, uuid, text) from public, anon;
grant execute on function public.assign_worker_to_project(uuid, uuid, text) to authenticated;
