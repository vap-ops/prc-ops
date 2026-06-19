-- Spec 146 U2 — create_equipment_project_allocation: the sole write path for the
-- zero-grant equipment_project_allocations table. SECURITY DEFINER, role-gated to
-- the equipment back office (pm/super/procurement — the same audience as the U1
-- money RPCs, ADR 0055 decision 6). Runs under the caller's authenticated
-- session (auth.uid() + current_user_role() must resolve) — never the
-- service-role admin client. Mirrors create_equipment_rental_batch. Returns the
-- new allocation id so a future UI can chain.

create function public.create_equipment_project_allocation(
  p_batch_id   uuid,
  p_project_id uuid,
  p_starts_on  date,
  p_ends_on    date default null,
  p_note       text default null
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
  values ('equipment_allocation_create', auth.uid(), public.current_user_role(),
          'equipment_project_allocations', v_id,
          jsonb_build_object('batch_id', p_batch_id, 'project_id', p_project_id,
                             'starts_on', p_starts_on, 'ends_on', p_ends_on));

  return v_id;
end;
$$;

revoke all on function public.create_equipment_project_allocation(uuid, uuid, date, date, text) from public;
grant execute on function public.create_equipment_project_allocation(uuid, uuid, date, date, text) to authenticated;
