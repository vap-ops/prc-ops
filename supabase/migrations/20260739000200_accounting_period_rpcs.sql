-- Spec 149 U2 / ADR 0057 decision 7 — accounting-period lifecycle RPCs:
--   open_accounting_period      — create (idempotent) a month, status 'open'.
--   set_accounting_period_status — drive the legal transition table; lock/reopen
--                                  of a closed period is super_admin-only.
--   resolve_posting_period      — the seam U3's poster calls: find/auto-open the
--                                  period for a date, or P0002 if it's closed.
-- All SECURITY DEFINER on the AUTHENTICATED session (auth.uid() / current_user_
-- role() must resolve; never the service-role admin client).

-- ----------------------------------------------------------------------------
create function public.open_accounting_period(p_month date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_id    uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'open_accounting_period: role not permitted' using errcode = '42501';
  end if;

  insert into public.accounting_periods (period_month, status)
  values (v_month, 'open')
  on conflict (period_month) do nothing
  returning id into v_id;

  -- Already existed: idempotent no-op, no audit (nothing changed).
  if v_id is null then
    select id into v_id from public.accounting_periods where period_month = v_month;
    return v_id;
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('accounting_period_open', auth.uid(), public.current_user_role(),
          'accounting_periods', v_id, jsonb_build_object('period_month', v_month));
  return v_id;
end;
$$;
revoke all on function public.open_accounting_period(date) from public, anon;
grant execute on function public.open_accounting_period(date) to authenticated;

-- ----------------------------------------------------------------------------
create function public.set_accounting_period_status(
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

  -- Legal transition table (mirrors canTransitionPeriod, src/lib/accounting/period.ts).
  if not (
       (v_old = 'open'    and p_status = 'closing')
    or (v_old = 'closing' and p_status in ('open', 'closed'))
    or (v_old = 'closed'  and p_status in ('open', 'locked'))
  ) then
    raise exception 'set_accounting_period_status: illegal transition % -> %', v_old, p_status
      using errcode = 'P0001';
  end if;

  -- Super-only: locking a closed period (filing) or reopening it.
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
  values ('accounting_period_status_change', auth.uid(), v_role,
          'accounting_periods', v_id,
          jsonb_build_object('period_month', v_month,
                             'old_status', v_old, 'new_status', p_status));
  return true;
end;
$$;
revoke all on function public.set_accounting_period_status(date, public.accounting_period_status)
  from public, anon;
grant execute on function public.set_accounting_period_status(date, public.accounting_period_status)
  to authenticated;

-- ----------------------------------------------------------------------------
-- The poster seam (U3). Internal plumbing: admitted to the back-office staff set
-- that touches financial sources (mirror enqueue_peak_sync) — the U3 poster runs
-- on the source-event session, so a site_admin site-purchase still resolves a
-- period. Auto-opens a missing month so posting never fails merely because a
-- month was not pre-created — only because it was deliberately closed (P0002).
create function public.resolve_posting_period(p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month  date := date_trunc('month', p_date)::date;
  v_id     uuid;
  v_status public.accounting_period_status;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'procurement', 'super_admin') then
    raise exception 'resolve_posting_period: role not permitted' using errcode = '42501';
  end if;

  select id, status into v_id, v_status
    from public.accounting_periods where period_month = v_month;

  if v_id is not null then
    if v_status in ('closed', 'locked') then
      raise exception 'resolve_posting_period: period % is closed', v_month using errcode = 'P0002';
    end if;
    return v_id;
  end if;

  insert into public.accounting_periods (period_month, status)
  values (v_month, 'open')
  on conflict (period_month) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.accounting_periods where period_month = v_month;
  end if;
  return v_id;
end;
$$;
revoke all on function public.resolve_posting_period(date) from public, anon;
grant execute on function public.resolve_posting_period(date) to authenticated;
