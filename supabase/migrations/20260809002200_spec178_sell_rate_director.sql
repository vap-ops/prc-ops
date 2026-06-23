-- Spec 178 follow-up — admit project_director to set per-item sell rates (operator
-- 2026-06-23: "PD can also set"). project_director is the executive-director tier
-- (ADR 0058, see-all PM) and already SEES the store P&L (store_pnl super/director),
-- so it may also SET the transfer price. Gate widens super_admin → super_admin +
-- project_director; everything else (PM, procurement) stays denied (operator
-- economics / anti-favoritism). Body sourced from the LIVE proc; same signature →
-- CREATE OR REPLACE (grants + the anon-revoke preserved).

create or replace function public.set_item_sell_rate(p_catalog_item_id uuid, p_sell_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric;
begin
  if public.current_user_role() not in ('super_admin', 'project_director') then
    raise exception 'set_item_sell_rate: role not permitted' using errcode = '42501';
  end if;
  if p_sell_rate is null or p_sell_rate < 0 then
    raise exception 'set_item_sell_rate: rate must be non-negative' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_items where id = p_catalog_item_id) then
    raise exception 'set_item_sell_rate: unknown catalog item' using errcode = '22023';
  end if;

  select sell_rate into v_old from public.item_sell_rates
   where catalog_item_id = p_catalog_item_id;

  insert into public.item_sell_rates (catalog_item_id, sell_rate, updated_by, updated_at)
  values (p_catalog_item_id, p_sell_rate, auth.uid(), now())
  on conflict (catalog_item_id) do update
    set sell_rate = excluded.sell_rate, updated_by = excluded.updated_by, updated_at = now();

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'item_sell_rates',
          p_catalog_item_id,
          jsonb_build_object('entity', 'item_sell_rate', 'old', v_old, 'new', p_sell_rate));
end;
$$;

comment on function public.set_item_sell_rate(uuid, numeric) is
  'Spec 178 — super_admin / project_director set/update a catalog item''s baht sell rate (upsert; non-negative). The store transfer price. Audited.';
