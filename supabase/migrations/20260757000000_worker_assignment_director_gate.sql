-- Spec 160 U1 fix-forward — project_director rides along with project_manager.
-- ADR 0058 / spec 152: project_director is a see-all project_manager and MUST
-- appear next to project_manager in EVERY RPC gate and RLS policy (the global
-- invariants pinned by pgTAP 90 + 91). The original 20260756 migration gated
-- assign_worker_to_project and the worker_project_moves read policy on
-- pm/super only; add project_director to both. Behaviour for pm/super/site_admin/
-- visitor is unchanged — this only admits the director, who already sees all.

create or replace function public.assign_worker_to_project(
  p_worker uuid,
  p_project uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if public.current_user_role()
       not in ('project_manager', 'project_director', 'super_admin') then
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
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_worker, jsonb_build_object('kind', 'project_move',
                                       'project_id', p_project,
                                       'reason', v_reason));
end;
$$;

drop policy "worker_project_moves readable by staff" on public.worker_project_moves;

create policy "worker_project_moves readable by staff"
  on public.worker_project_moves for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'project_director',
             'procurement', 'super_admin'));
