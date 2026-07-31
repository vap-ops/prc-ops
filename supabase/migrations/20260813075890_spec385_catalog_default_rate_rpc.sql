-- Spec 385 U3b — the ทะเบียน's default-rate write path.
--
-- `equipment_catalog_items.default_daily_rate` carries NO authenticated grant in
-- any direction (U1's money wall, ADR 0055 decision 6 mirrored), so without this
-- DEFINER RPC the seeded defaults are immutable from the app — the U2 review's
-- "39 inert rates" finding. Twin of `set_equipment_daily_rate` (20260813071000)
-- at the SKU grain, with two deliberate differences:
--   * the gate DELEGATES to is_back_office() instead of restating the role
--     array (the storage-RLS rot lesson, #823) — same five roles today;
--   * the audit payload kind is 'default_rate_change' and target_table is
--     'equipment_catalog_items', which the 381 item-history reader filters OUT
--     by design (it selects target_table = 'equipment_items' only), so catalog
--     events never appear in a unit's history.

create or replace function public.set_equipment_catalog_default_rate(p_id uuid, p_rate numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_old  numeric;
begin
  -- is_back_office coalesces a NULL role to false (the rls-self-check-coalesce
  -- trap), so an unbound caller falls to the refusal arm.
  if not public.is_back_office(v_role) then
    raise exception 'set_equipment_catalog_default_rate: role not permitted' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'set_equipment_catalog_default_rate: invalid rate' using errcode = 'P0001';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly.
  select default_daily_rate into v_old from public.equipment_catalog_items where id = p_id;
  if not found then
    raise exception 'set_equipment_catalog_default_rate: catalog item not found' using errcode = 'P0001';
  end if;

  update public.equipment_catalog_items set default_daily_rate = p_rate where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('equipment_rate_change', auth.uid(), v_role,
          'equipment_catalog_items', p_id,
          jsonb_build_object('kind', 'default_rate_change',
                             'old_rate', v_old, 'new_rate', p_rate));
end;
$$;

-- Functions default to EXECUTE for PUBLIC — wall it, then open the one door.
revoke all on function public.set_equipment_catalog_default_rate(uuid, numeric) from public, anon;
grant execute on function public.set_equipment_catalog_default_rate(uuid, numeric) to authenticated;
