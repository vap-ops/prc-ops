-- Spec 165 U2 / ADR 0016 — reorder งวด by swapping two rows' sort_order.
--
-- swap_deliverable_order(p_a, p_b) — SECURITY DEFINER, role-gated PM/super/
-- director, membership-gated via can_see_project. Both งวด must belong to the
-- SAME project (else 22023); an unknown/invisible id yields 42501. The UI passes
-- a งวด and its immediate neighbour (▲ = previous, ▼ = next); this swaps their
-- sort_order so the manager list re-sorts. No audit (benign ordering metadata).

create function public.swap_deliverable_order(
  p_a uuid,
  p_b uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a_project uuid;
  v_b_project uuid;
  v_a_sort    integer;
  v_b_sort    integer;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'swap_deliverable_order: role not permitted' using errcode = '42501';
  end if;

  select project_id, sort_order into v_a_project, v_a_sort
    from public.deliverables where id = p_a;
  select project_id, sort_order into v_b_project, v_b_sort
    from public.deliverables where id = p_b;

  if v_a_project is null or v_b_project is null or not public.can_see_project(v_a_project) then
    raise exception 'swap_deliverable_order: not a member of this project' using errcode = '42501';
  end if;
  if v_a_project <> v_b_project then
    raise exception 'swap_deliverable_order: deliverables are in different projects'
      using errcode = '22023';
  end if;

  update public.deliverables
     set sort_order = case id when p_a then v_b_sort when p_b then v_a_sort end
   where id in (p_a, p_b);
  return true;
end;
$$;

revoke all on function public.swap_deliverable_order(uuid, uuid) from public, anon;
grant execute on function public.swap_deliverable_order(uuid, uuid) to authenticated;

comment on function public.swap_deliverable_order(uuid, uuid) is
  'Spec 165 — swap two งวด''s sort_order to reorder (PM/super/director, membership-gated). Same-project only (22023 else). No audit.';
