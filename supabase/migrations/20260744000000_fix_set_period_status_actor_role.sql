-- Spec 149 fix — set_accounting_period_status (20260739000200) audited actor_role
-- from a `text` variable into the `user_role` enum column → 42804 (no implicit
-- text→enum cast), so every status transition aborted at the audit insert. Caught
-- by db:test (pgTAP 80). Fix: insert public.current_user_role() directly (the
-- enum), as every other RPC does. Body otherwise identical to 20260739000200.

create or replace function public.set_accounting_period_status(
  p_month  date,
  p_status public.accounting_period_status
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month    date := date_trunc('month', p_month)::date;
  v_role     text := public.current_user_role();
  v_is_super boolean := v_role = 'super_admin';
  v_old      public.accounting_period_status;
  v_id       uuid;
begin
  if v_role not in ('project_manager', 'super_admin') then
    raise exception 'set_accounting_period_status: role not permitted' using errcode = '42501';
  end if;

  select id, status into v_id, v_old
    from public.accounting_periods where period_month = v_month;
  if v_id is null then
    raise exception 'set_accounting_period_status: period not found (open it first)'
      using errcode = 'P0001';
  end if;

  if v_old = p_status then
    raise exception 'set_accounting_period_status: already in that status' using errcode = 'P0001';
  end if;

  if not (
       (v_old = 'open'    and p_status = 'closing')
    or (v_old = 'closing' and p_status in ('open', 'closed'))
    or (v_old = 'closed'  and p_status in ('open', 'locked'))
  ) then
    raise exception 'set_accounting_period_status: illegal transition % -> %', v_old, p_status
      using errcode = 'P0001';
  end if;

  if v_old = 'closed' and p_status in ('open', 'locked') and not v_is_super then
    raise exception 'set_accounting_period_status: only super_admin may lock or reopen a closed period'
      using errcode = '42501';
  end if;

  update public.accounting_periods
     set status    = p_status,
         closed_at = case when p_status in ('closed', 'locked') then now()
                          when p_status = 'open' then null
                          else closed_at end,
         closed_by = case when p_status in ('closed', 'locked') then auth.uid()
                          when p_status = 'open' then null
                          else closed_by end
   where id = v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('accounting_period_status_change', auth.uid(), public.current_user_role(),
          'accounting_periods', v_id,
          jsonb_build_object('period_month', v_month,
                             'old_status', v_old, 'new_status', p_status));
  return true;
end;
$$;
