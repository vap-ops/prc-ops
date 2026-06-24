-- Spec 196 Tier 4 — let the accounting role run month-end close.
--
-- The period engine already exists (ADR 0057): open_accounting_period +
-- set_accounting_period_status, with the posting path refusing a closed month
-- (resolve_posting_period → P0002). Both RPCs were gated to
-- ('project_manager', 'super_admin', 'project_director'); the accounting role
-- owns month-end close, so it JOINS that gate. Everything else is the LIVE body
-- verbatim — the spec-152 project_director arm, the spec-149 audit-log writes,
-- and (critically) the super-only arm: closed → open/locked still requires
-- super_admin, so accounting may open → closing → closed but never reopen or
-- lock a filed period. CREATE OR REPLACE preserves the existing EXECUTE grants.
--
-- Bodies sourced from LIVE (pg_get_functiondef) — NOT from an earlier migration,
-- which would drop the project_director arm added by 20260751000000.

create or replace function public.open_accounting_period(p_month date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_id    uuid;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'project_director', 'accounting') then
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
  if v_role not in
       ('project_manager', 'super_admin', 'project_director', 'accounting') then
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
