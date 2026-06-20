-- Spec 161 U6a / ADR 0060 §4 — the Nova shop: per-item coin pricing (abstract
-- points, NO baht peg — decision b) + the redemption path (spending coins). The
-- shop is the coin SINK. The saver's bonus + vesting/confiscation (the trust layer)
-- are U6b. Redemption is operator-driven for now (worker self-redeem is later,
-- gift-first ADR 0061). Self-auditing: the coin ledger + shop_redemptions row ARE
-- the trail (like post_coins) — no audit_log, no audit-action enum-add.

-- 1. The catalog. A point price list (not baht, not margin-sensitive) → readable by
--    authenticated (a future worker shop reads it); writes are RPC-only.
create table public.shop_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text null,
  price_coins numeric(20, 4) not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid not null references public.users(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid null references public.users(id),
  updated_at  timestamptz not null default now(),
  constraint shop_items_name_nonblank check (length(trim(name)) > 0),
  constraint shop_items_name_cap check (length(name) <= 120),
  constraint shop_items_desc_cap check (description is null or length(description) <= 500),
  constraint shop_items_price_positive check (price_coins > 0)
);

create index shop_items_active_idx on public.shop_items (active, sort_order);

alter table public.shop_items enable row level security;
revoke all on public.shop_items from anon, authenticated;
-- Catalog read for any signed-in user; no write grant (the RPCs are the writers).
grant select on public.shop_items to authenticated;
create policy "shop_items readable by authenticated"
  on public.shop_items for select to authenticated using (true);

comment on table public.shop_items is
  'Nova shop catalog (spec 161 U6a / ADR 0060 §4). price_coins = abstract points, NO baht peg (decision b). Readable by authenticated; written only via upsert_shop_item / set_shop_item_active (super_admin).';

-- 2. The redemption record (append-only spend trail). Snapshots the price + links the
--    negative posting. Self-auditing; super-read (the coin_postings posture).
create table public.shop_redemptions (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id),
  item_id     uuid not null references public.shop_items(id),
  price_coins numeric(20, 4) not null,
  posting_id  uuid not null references public.coin_postings(id),
  redeemed_by uuid not null references public.users(id),
  redeemed_at timestamptz not null default now()
);

create index shop_redemptions_worker_idx on public.shop_redemptions (worker_id, redeemed_at desc);

alter table public.shop_redemptions enable row level security;
revoke all on public.shop_redemptions from anon, authenticated;
-- SELECT only, operator-gated (like coin_postings). No write grant — redeem_shop_item
-- (definer) is the only writer; a correction is a new (negative) posting, never an edit.
grant select on public.shop_redemptions to authenticated;
create policy "shop_redemptions readable by operator"
  on public.shop_redemptions for select to authenticated
  using ((select public.current_user_role()) = 'super_admin');

comment on table public.shop_redemptions is
  'Append-only Nova shop redemption trail (spec 161 U6a). One row per spend, snapshotting price + linking the negative coin_posting. RPC-only writes (redeem_shop_item); operator-read; self-auditing.';

-- 3. upsert_shop_item — create (p_id null) or update an item. super_admin only.
create function public.upsert_shop_item(
  p_name text,
  p_price_coins numeric,
  p_description text default null,
  p_sort_order integer default 0,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'upsert_shop_item: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'upsert_shop_item: name required (max 120)' using errcode = 'P0001';
  end if;
  if p_price_coins is null or p_price_coins <= 0 then
    raise exception 'upsert_shop_item: price must be > 0' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.shop_items (name, description, price_coins, sort_order, created_by)
    values (v_name, p_description, p_price_coins, coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
  else
    update public.shop_items
       set name = v_name, description = p_description, price_coins = p_price_coins,
           sort_order = coalesce(p_sort_order, 0), updated_by = auth.uid(), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'upsert_shop_item: item not found' using errcode = 'P0001';
    end if;
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'shop_items', v_id,
          jsonb_build_object('name', v_name, 'price_coins', p_price_coins));
  return v_id;
end;
$$;

revoke all on function public.upsert_shop_item(text, numeric, text, integer, uuid) from public;
grant execute on function public.upsert_shop_item(text, numeric, text, integer, uuid) to authenticated;

-- 4. set_shop_item_active — toggle availability. super_admin only.
create function public.set_shop_item_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'set_shop_item_active: role not permitted' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'set_shop_item_active: active is required' using errcode = 'P0001';
  end if;
  update public.shop_items set active = p_active, updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  get diagnostics v_found = row_count;
  if not v_found then
    raise exception 'set_shop_item_active: item not found' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'shop_items', p_id,
          jsonb_build_object('active', p_active));
end;
$$;

revoke all on function public.set_shop_item_active(uuid, boolean) from public;
grant execute on function public.set_shop_item_active(uuid, boolean) to authenticated;

-- 5. redeem_shop_item — spend coins on an active item. super_admin only (operator-
--    driven for now). Posts a negative shop_redemption via post_coins (the existing
--    path) + records the redemption. U6b narrows "balance" to spendable (vested).
create function public.redeem_shop_item(p_worker uuid, p_item uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price   numeric;
  v_active  boolean;
  v_name    text;
  v_balance numeric;
  v_posting uuid;
  v_id      uuid;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'redeem_shop_item: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'redeem_shop_item: worker not found' using errcode = 'P0001';
  end if;

  select price_coins, active, name into v_price, v_active, v_name
    from public.shop_items where id = p_item;
  if not found then
    raise exception 'redeem_shop_item: item not found' using errcode = 'P0001';
  end if;
  if not v_active then
    raise exception 'redeem_shop_item: item is not available' using errcode = 'P0001';
  end if;

  v_balance := public.coin_balance(p_worker);
  if v_balance < v_price then
    raise exception 'redeem_shop_item: insufficient balance' using errcode = 'P0001';
  end if;

  -- The spend: a negative posting (post_coins allows non-zero negatives). super → super.
  v_posting := public.post_coins(p_worker, 'shop_redemption', -v_price,
    'Shop redemption: ' || v_name);

  insert into public.shop_redemptions (worker_id, item_id, price_coins, posting_id, redeemed_by)
  values (p_worker, p_item, v_price, v_posting, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.redeem_shop_item(uuid, uuid) from public;
grant execute on function public.redeem_shop_item(uuid, uuid) to authenticated;
