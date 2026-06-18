-- Spec 146 U1 — the two money-write RPCs. SECURITY DEFINER, role-gated to the
-- equipment back office (pm/super/PROCUREMENT — ADR 0055 decision 6 money
-- audience). DELIBERATE divergence from set_worker_day_rate (pm/super only):
-- procurement IS an equipment back-office actor (it creates/edits the registry,
-- spec 141 U2), so it prices items and records batches too. Both functions run
-- under the caller's authenticated session (auth.uid() + current_user_role()
-- must resolve) — never the service-role admin client (no JWT => role NULL =>
-- gate refuses). Mirrors set_worker_day_rate / freeze_wp_labor_cost.

-- ----------------------------------------------------------------------------
-- set_equipment_daily_rate: set the per-item charge-out rate (MONEY). The
-- column UPDATE grant is deliberately NOT widened (spec 31-amendment lesson:
-- a column-write RPC, never a broad table grant, for a money column).
-- ----------------------------------------------------------------------------
create function public.set_equipment_daily_rate(p_id uuid, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement') then
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
  values ('equipment_rate_change', auth.uid(), public.current_user_role(),
          'equipment_items', p_id,
          jsonb_build_object('kind', 'rate_change',
                             'old_rate', v_old, 'new_rate', p_rate));
end;
$$;

revoke all on function public.set_equipment_daily_rate(uuid, numeric) from public;
grant execute on function public.set_equipment_daily_rate(uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- create_equipment_rental_batch: record an inbound rental deal header (MONEY).
-- Returns the new batch id so a future UI can chain. Writes the created_by pin
-- (only the definer can write this zero-grant table).
-- ----------------------------------------------------------------------------
create function public.create_equipment_rental_batch(
  p_owner_id     uuid,
  p_monthly_rate numeric,
  p_starts_on    date,
  p_ends_on      date default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement') then
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
  values ('equipment_batch_create', auth.uid(), public.current_user_role(),
          'equipment_rental_batches', v_id,
          jsonb_build_object('owner_id', p_owner_id, 'monthly_rate', p_monthly_rate,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$$;

revoke all on function public.create_equipment_rental_batch(uuid, numeric, date, date, text) from public;
grant execute on function public.create_equipment_rental_batch(uuid, numeric, date, date, text) to authenticated;
