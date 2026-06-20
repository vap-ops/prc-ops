-- Spec 161 U2b / ADR 0060 §1 — HT (Head Technician) assignment. A project has
-- exactly one HT, a promoted active DC who exclusively owns its WPs. One column
-- on projects IS the one-per-project rule; the PM assigns via the RPC. Not money
-- (a role designation) — readable, so the new column joins the projects
-- per-column SELECT grant (maintenance rule, 20260626000200). The HT's economic
-- powers (real P&L, max coin cut) are later units (U3/U5).

alter table public.projects add column ht_worker_id uuid null references public.workers(id);

-- A new non-money projects column must be granted explicitly or the app can't
-- read it (the projects grant is per-column, not table-wide).
grant select (ht_worker_id) on public.projects to authenticated;

-- assign_project_ht — the PM promotes an active DC to the project's HT (ADR 0060
-- §1). pm + director + super (references project_manager → project_director is
-- included, ADR 0058 invariant). Last-wins (one HT per project).
create function public.assign_project_ht(p_project uuid, p_worker uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type   public.worker_type;
  v_active boolean;
begin
  if public.current_user_role()
       not in ('project_manager', 'project_director', 'super_admin') then
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
  values ('update', auth.uid(), public.current_user_role(), 'projects', p_project,
          jsonb_build_object('field', 'ht_worker_id', 'worker_id', p_worker));
end;
$$;
