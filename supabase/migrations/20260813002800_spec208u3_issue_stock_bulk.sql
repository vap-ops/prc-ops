-- Spec 208 U3 — multi-line เบิก (bulk withdrawal) from the project store to ONE
-- work package, in one atomic call. The WP is at slip level (operator 2026-06-26:
-- withdrawals are made on the WP detail page → one slip is one WP). Each line
-- {catalog_item_id, qty, receiver_worker_id?, note?} runs the same per-line
-- validation + moving-average costing + on-hand decrement as the single
-- issue_stock; any bad line rolls the whole batch back.
--
-- No new GL semantics: each stock_issues insert fires the existing per-row
-- enqueue trigger (stock_issues_enqueue_gl_posting → Dr 1400 WP-WIP / Cr 1500
-- Inventory at moving-average cost), so the bulk path posts per line exactly like
-- the single issue.
--
-- Gate = issue_stock's: SITE_STAFF role set + can_see_project MEMBERSHIP. Issue is
-- a member-only OUT to a WP; procurement is NOT admitted (it curates receiving,
-- not withdrawal — data-model verdict, spec 208).

create or replace function public.issue_stock_bulk(
  p_project_id uuid,
  p_work_package_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role        public.user_role := public.current_user_role();
  v_line        jsonb;
  v_item        uuid;
  v_qty         numeric;
  v_receiver    uuid;
  v_note        text;
  v_unit        text;
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_sell        numeric;
  v_decrement   numeric;
  v_count       int := 0;
begin
  -- Role: SITE_STAFF_ROLES (issue is a member-only OUT; procurement is excluded).
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'issue_stock_bulk: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'issue_stock_bulk: not a project member' using errcode = '42501';
  end if;
  -- The WP must belong to this project (slip level — one slip, one WP).
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'issue_stock_bulk: work package not in this project' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'issue_stock_bulk: lines must be a non-empty json array' using errcode = '22023';
  end if;

  -- Atomic: validate + issue every line; any failure rolls back the whole call.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item     := (v_line ->> 'catalog_item_id')::uuid;
    v_qty      := (v_line ->> 'qty')::numeric;
    v_receiver := nullif(v_line ->> 'receiver_worker_id', '')::uuid;
    v_note     := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'issue_stock_bulk: qty must be > 0' using errcode = '22023';
    end if;
    -- Catalog item must exist and be active; snapshot its unit.
    select c.unit into v_unit
      from public.catalog_items c
     where c.id = v_item and c.is_active;
    if v_unit is null then
      raise exception 'issue_stock_bulk: unknown or inactive catalog item' using errcode = '22023';
    end if;
    -- A named receiver must be an ACTIVE worker on this project (or unassigned).
    if v_receiver is not null and not exists (
      select 1 from public.workers w
       where w.id = v_receiver and w.active
         and (w.project_id = p_project_id or w.project_id is null)
    ) then
      raise exception 'issue_stock_bulk: receiver is not an active worker on this project'
        using errcode = '22023';
    end if;

    -- Lock the on-hand row and check sufficiency (per line; interleaving safe).
    select qty_on_hand, total_value into v_qty_on_hand, v_value
      from public.stock_on_hand
     where project_id = p_project_id and catalog_item_id = v_item
     for update;
    if v_qty_on_hand is null or v_qty_on_hand < v_qty then
      raise exception 'issue_stock_bulk: insufficient stock on hand' using errcode = '22023';
    end if;

    -- Moving-average cost at issue; decrement qty + value; zero value on depletion
    -- so rounding dust never lingers (mirrors issue_stock exactly).
    v_avg := round(v_value / v_qty_on_hand, 2);
    v_decrement := v_qty * v_avg;
    v_sell := coalesce(
      (select sell_rate from public.item_sell_rates where catalog_item_id = v_item),
      v_avg);
    update public.stock_on_hand
       set qty_on_hand = v_qty_on_hand - v_qty,
           total_value = case when v_qty_on_hand - v_qty = 0 then 0 else v_value - v_decrement end,
           updated_at  = now()
     where project_id = p_project_id and catalog_item_id = v_item;

    insert into public.stock_issues
      (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
       receiver_worker_id)
    values
      (p_project_id, v_item, p_work_package_id, v_qty, v_unit, v_avg, v_sell, v_note, v_receiver);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.issue_stock_bulk(uuid, uuid, jsonb) from public, anon;
grant execute on function public.issue_stock_bulk(uuid, uuid, jsonb) to authenticated;

comment on function public.issue_stock_bulk(uuid, uuid, jsonb) is
  'Spec 208 U3 — multi-line เบิก: issue many catalog items from the project store to ONE work package in one atomic call. Same gate (SITE_STAFF + can_see_project membership; procurement excluded) + per-line validation + moving-average costing + on-hand decrement as issue_stock. Each line {catalog_item_id, qty, receiver_worker_id?, note?}; any bad line rolls back the whole batch. Each stock_issues insert posts GL per row via the existing trigger. Returns the count issued.';
