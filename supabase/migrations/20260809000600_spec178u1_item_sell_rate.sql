-- Spec 178 U1 — store margin layer: per-item sell rate (the transfer price).
--
-- The on-site store is a transfer-pricing business unit: it SELLS stock to a work
-- package at a per-item SELL price, not at cost. Operator (AskUserQuestion 2026-06-22)
-- locked: a FLAT per-item rate (one global rate per catalog item, not a markup %,
-- not per-project). This unit lays the rate data + setter; the issue-time snapshot
-- (U2) and the wp_profit fold (U4) read it.
--
-- MONEY posture (margin-sensitive, like sell_rate_table / day_rate, spec 161 U1):
-- ZERO authenticated grant. The operator surface reads via the admin client behind
-- requireRole(super_admin); set_item_sell_rate (definer) is the sole writer. Setting
-- a rate is super_admin only (operator economics; anti-favoritism) — no
-- project_manager reference, so the ADR 0058 pgTAP 90/91 invariants don't apply.

-- The editable per-item sell-rate dial. One row per catalog item; baht per unit.
create table public.item_sell_rates (
  catalog_item_id uuid primary key references public.catalog_items(id),
  sell_rate       numeric(12, 2) not null,
  updated_by      uuid null references public.users(id),
  updated_at      timestamptz not null default now(),
  constraint item_sell_rate_nonnegative check (sell_rate >= 0)
);

alter table public.item_sell_rates enable row level security;
-- Zero grant: no anon/authenticated access at all. The operator reads via the admin
-- client (requireRole super_admin); set_item_sell_rate (definer) is the writer.
revoke all on public.item_sell_rates from anon, authenticated;

comment on table public.item_sell_rates is
  'Spec 178 U1 — editable per-catalog-item baht sell rate (the store transfer price). MONEY: zero authenticated grant; operator-tuned via set_item_sell_rate; read by the issue-sell snapshot (U2) + wp_profit fold (U4) + store P&L (U3).';

-- set_item_sell_rate — super_admin tunes an item's sell rate (upsert).
create function public.set_item_sell_rate(p_catalog_item_id uuid, p_sell_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric;
begin
  if public.current_user_role() is distinct from 'super_admin' then
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

-- A fresh CREATE still inherits Supabase's default EXECUTE grant to anon — revoke it.
revoke execute on function public.set_item_sell_rate(uuid, numeric) from public, anon;
grant execute on function public.set_item_sell_rate(uuid, numeric) to authenticated, service_role;

comment on function public.set_item_sell_rate(uuid, numeric) is
  'Spec 178 U1 — super_admin sets/updates a catalog item''s baht sell rate (upsert; non-negative). The store transfer price read by the issue-sell snapshot + wp_profit. Audited.';
