-- Spec 194 — super_admin override on an approved supply plan. Operator: a
-- super_admin should be able to revert the status / edit an approved (frozen)
-- plan, with the plan labeled "overridden by [name]". The lifecycle is normally
-- one-way past approval (the PM submits → PD/super approves → frozen); this is the
-- operator escape hatch — super_admin only — and the override is recorded on the
-- plan so the override is always visible (not a silent edit).
--
-- reopen = take a submitted/approved plan back to 'draft' (editable; add/remove
-- line already allow draft), clearing the prior lifecycle stamps and recording
-- overridden_by / overridden_at. The marker PERSISTS through a later re-approval,
-- so the plan keeps showing it was force-reopened once.

alter table public.supply_plans
  add column overridden_by uuid references public.users(id),
  add column overridden_at timestamptz;

create function public.reopen_supply_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.supply_plan_status;
begin
  -- super_admin only — this bypasses the separation-of-duties lifecycle.
  if public.current_user_role() <> 'super_admin' then
    raise exception 'reopen_supply_plan: super_admin only' using errcode = '42501';
  end if;

  select status into v_status from public.supply_plans where id = p_plan_id;
  if not found then
    raise exception 'reopen_supply_plan: unknown plan' using errcode = '22023';
  end if;
  if v_status not in ('submitted', 'approved') then
    raise exception 'reopen_supply_plan: only a submitted/approved plan can be reopened'
      using errcode = '22023';
  end if;

  update public.supply_plans
     set status = 'draft',
         submitted_at = null,
         approved_by = null,
         approved_at = null,
         overridden_by = auth.uid(),
         overridden_at = now()
   where id = p_plan_id;
end;
$$;
revoke all on function public.reopen_supply_plan(uuid) from public, anon;
grant execute on function public.reopen_supply_plan(uuid) to authenticated;
