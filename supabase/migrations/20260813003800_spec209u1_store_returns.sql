-- Spec 209 U1 / ADR 0065 — WP→store RETURN as a first-class movement.
--
-- Distinct from the mistake-undo (reverse_stock_issue, spec 177 U11 — a full void
-- of a WRONG entry). A return is a real physical movement: material goes from a WP
-- back to the store (offcuts, leftovers), PARTIAL and REPEATABLE up to the issued
-- qty, re-entered at the ISSUE cost (operator decision 2026-06-27). It is the
-- partial inverse of a stock_issues row.
--
-- GL: Dr 1500 Inventory / Cr 1400 WP-WIP at qty*issue.unit_cost — the exact inverse
-- of the issue's cost posting (post_stock_issue_to_gl, Dr 1400 / Cr 1500). wp_profit
-- (sell-basis) nets returns out of the WP's store-transfer material term.
--
-- Additive: new table + RPC + poster + enqueue trigger; CREATE OR REPLACE of
-- drain_gl_posting (adds one case) and wp_profit (nets returns). Money → the db
-- push is the operator sign-off.

-- ----------------------------------------------------------------------------
-- 1. stock_returns — append-only WP→store returns (partial, repeatable per issue).
-- ----------------------------------------------------------------------------
create table public.stock_returns (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  -- The issue this material is being returned FROM (typed FK, not polymorphic).
  issue_id        uuid not null references public.stock_issues(id),
  work_package_id uuid not null references public.work_packages(id) on delete cascade,
  qty             numeric(12, 2) not null,
  unit            text not null,
  -- Snapshot of the issue's moving-avg cost — the return re-enters at the ISSUE cost.
  unit_cost       numeric(12, 2) not null,
  total_cost      numeric(16, 2) generated always as (qty * unit_cost) stored,
  note            text,
  returned_by     uuid references public.users(id) default auth.uid(),
  returned_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint stock_returns_qty_positive check (qty > 0),
  constraint stock_returns_unit_cost_nonneg check (unit_cost >= 0)
);

create index stock_returns_issue_idx on public.stock_returns (issue_id);
create index stock_returns_wp_idx on public.stock_returns (work_package_id);
create index stock_returns_project_item_idx on public.stock_returns (project_id, catalog_item_id);

alter table public.stock_returns enable row level security;
revoke all on public.stock_returns from anon, authenticated;
grant select on public.stock_returns to authenticated;
create policy "stock_returns readable by project viewers or procurement"
  on public.stock_returns for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );

comment on table public.stock_returns is
  'Spec 209 U1 — append-only WP→store returns (partial, repeatable per stock_issues row, re-entered at the issue cost). Written only via return_stock_to_store. GL Dr 1500 / Cr 1400 at qty*unit_cost.';

-- ----------------------------------------------------------------------------
-- 2. return_stock_to_store — record a partial WP→store return.
-- ----------------------------------------------------------------------------
create function public.return_stock_to_store(p_issue_id uuid, p_qty numeric, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       public.user_role := public.current_user_role();
  v_project    uuid;
  v_item       uuid;
  v_wp         uuid;
  v_unit       text;
  v_issue_qty  numeric;
  v_unit_cost  numeric(12, 2);
  v_returned   numeric;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_id         uuid;
begin
  -- Role: SITE_STAFF tier (a return is the same physical-custody action as เบิก;
  -- procurement is excluded, mirroring issue_stock).
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'return_stock_to_store: role not permitted' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'return_stock_to_store: qty must be positive' using errcode = '22023';
  end if;

  select si.project_id, si.catalog_item_id, si.work_package_id, si.unit, si.qty, si.unit_cost
    into v_project, v_item, v_wp, v_unit, v_issue_qty, v_unit_cost
    from public.stock_issues si where si.id = p_issue_id;
  if v_project is null then
    raise exception 'return_stock_to_store: unknown issue' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'return_stock_to_store: not a project member' using errcode = '42501';
  end if;

  -- A reversed (voided) issue never charged the WP — there is nothing to return;
  -- correct it via the mistake-undo instead.
  if exists (select 1 from public.stock_reversals r where r.issue_id = p_issue_id) then
    raise exception 'return_stock_to_store: issue was reversed' using errcode = '22023';
  end if;

  -- Cannot return more than was issued (net of prior returns).
  select coalesce(sum(r.qty), 0) into v_returned
    from public.stock_returns r where r.issue_id = p_issue_id;
  if p_qty > v_issue_qty - v_returned then
    raise exception 'return_stock_to_store: cannot return more than was issued' using errcode = '22023';
  end if;

  insert into public.stock_returns
    (project_id, catalog_item_id, issue_id, work_package_id, qty, unit, unit_cost, note, returned_by)
  values
    (v_project, v_item, p_issue_id, v_wp, p_qty, v_unit, v_unit_cost, v_note, auth.uid())
  returning id into v_id;

  -- Re-enter the store at the issue cost (the insert's enqueue trigger books
  -- Dr 1500 / Cr 1400 on drain).
  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (v_project, v_item, p_qty, p_qty * v_unit_cost)
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  return v_id;
end;
$$;

revoke all on function public.return_stock_to_store(uuid, numeric, text) from public, anon;
grant execute on function public.return_stock_to_store(uuid, numeric, text) to authenticated;

comment on function public.return_stock_to_store(uuid, numeric, text) is
  'Spec 209 U1 — record a partial WP→store return of an issued line (SITE_STAFF + member; qty ≤ issued − returned; not on a reversed issue). Re-enters the store at the issue cost; enqueues Dr 1500 / Cr 1400. Returns the stock_returns id.';

-- ----------------------------------------------------------------------------
-- 3. post_stock_return_to_gl — Dr 1500 Inventory / Cr 1400 WP-WIP at the return
--    cost (the inverse of post_stock_issue_to_gl). Reverse-and-repost guard so a
--    drain retry cannot double-post.
-- ----------------------------------------------------------------------------
create function public.post_stock_return_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_wp      uuid;
  v_cost    numeric(16,2);
  v_actor   uuid;
  v_at      date;
  v_old     uuid;
  v_lines   jsonb;
begin
  select project_id, work_package_id, total_cost, returned_by,
         coalesce(returned_at::date, current_date)
    into v_project, v_wp, v_cost, v_actor, v_at
    from public.stock_returns where id = p_source_id;
  if not found then
    raise exception 'post_stock_return_to_gl: return not found' using errcode = 'P0001';
  end if;

  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'stock_returns'
     and e.source_id    = p_source_id
     and e.source_event = 'stock_return'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: stock return re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1500', 'debit', v_cost, 'project_id', v_project),
    jsonb_build_object('account_code', '1400', 'credit', v_cost,
                       'project_id', v_project, 'work_package_id', v_wp));

  return public.post_journal_internal(
    v_at, 'stock_returns', p_source_id, 'stock_return', 'คืนเข้าสโตร์จากงาน', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_stock_return_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_stock_return_to_gl(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Enqueue trigger (append-only → AFTER INSERT; the generic definer enqueue).
-- ----------------------------------------------------------------------------
create trigger stock_returns_enqueue_gl_posting
  after insert on public.stock_returns
  for each row
  execute function public.enqueue_gl_posting_tg('stock_return', 'id');

-- ----------------------------------------------------------------------------
-- 5. Route stock_returns in the drainer (CREATE OR REPLACE — body == the LIVE
--    20260809001900 §5 plus the one new case; grants preserved).
-- ----------------------------------------------------------------------------
create or replace function public.drain_gl_posting(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job   public.gl_posting_outbox;
  v_entry uuid;
  v_done  integer := 0;
begin
  for v_job in
    select * from public.gl_posting_outbox
     where status = 'pending'
     order by created_at
     limit greatest(p_limit, 0)
  loop
    begin
      case v_job.source_table
        when 'purchase_requests'        then v_entry := public.post_purchase_to_gl(v_job.source_id);
        when 'dc_payments'              then v_entry := public.post_dc_payment_to_gl(v_job.source_id);
        when 'wp_labor_costs'           then v_entry := public.post_labor_freeze_to_gl(v_job.source_id);
        when 'equipment_rental_batches' then v_entry := public.post_rental_batch_to_gl(v_job.source_id);
        when 'client_billings'          then v_entry := public.post_client_billing_to_gl(v_job.source_id);
        when 'retention_receivables'    then v_entry := public.post_retention_release_to_gl(v_job.source_id);
        when 'wht_certificates'         then v_entry := public.post_wht_certificate_to_gl(v_job.source_id);
        when 'stock_receipts'           then v_entry := public.post_stock_receipt_to_gl(v_job.source_id);
        when 'stock_issues'             then v_entry := public.post_stock_issue_to_gl(v_job.source_id);
        -- Spec 209 U1 — WP→store return.
        when 'stock_returns'            then v_entry := public.post_stock_return_to_gl(v_job.source_id);
        else
          update public.gl_posting_outbox
             set status = 'skipped', last_error = 'unknown source_table'
           where id = v_job.id;
          continue;
      end case;

      update public.gl_posting_outbox
         set status = 'posted', journal_entry_id = v_entry, posted_at = now()
       where id = v_job.id;
      v_done := v_done + 1;
    exception when others then
      update public.gl_posting_outbox
         set status = 'failed', last_error = left(sqlerrm, 500), attempts = attempts + 1
       where id = v_job.id;
    end;
  end loop;

  return v_done;
end;
$$;
revoke all on function public.drain_gl_posting(integer) from public, anon, authenticated;
grant execute on function public.drain_gl_posting(integer) to service_role;

-- ----------------------------------------------------------------------------
-- 6. wp_profit — net WP→store returns out of the store-transfer material term
--    (body == LIVE 20260809001700 with the v_store query netting stock_returns).
--    A partial return has no stock_reversals row, so without this the WP P&L would
--    keep charging the full issue. Net each issue's sell by the returned qty at the
--    issue's sell-per-unit.
-- ----------------------------------------------------------------------------
create or replace function public.wp_profit(p_wp uuid)
returns table (
  budget           numeric,
  labor_sell       numeric,
  materials_cost   numeric,
  equipment_cost   numeric,
  equipment_costed boolean,
  profit           numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_budget    numeric;
  v_labor     numeric;
  v_materials numeric;
  v_store     numeric;
  v_equipment numeric;
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'wp_profit: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_packages where id = p_wp) then
    raise exception 'wp_profit: work package not found' using errcode = 'P0001';
  end if;

  select we.budget into v_budget
    from public.wp_economics we where we.work_package_id = p_wp;

  v_labor := public.wp_labor_sell(p_wp);

  select coalesce(sum(l.debit - l.credit), 0)
    into v_materials
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.gl_accounts a on a.id = l.account_id
    left join public.journal_entries orig on orig.id = e.reversal_of
   where l.work_package_id = p_wp
     and a.code = '1400'
     and coalesce(orig.source_table, e.source_table) = 'purchase_requests';

  -- Store transfer price (spec 178 U4) NET of WP→store returns (spec 209 U1): each
  -- non-reversed issue's sell, minus the returned qty valued at that issue's
  -- sell-per-unit. A fully-returned issue nets to 0; partial returns reduce pro-rata.
  select coalesce(sum(
           coalesce(si.total_sell, si.total_cost)
           - coalesce((select sum(rt.qty) from public.stock_returns rt where rt.issue_id = si.id), 0)
             * coalesce(si.total_sell, si.total_cost) / nullif(si.qty, 0)
         ), 0)
    into v_store
    from public.stock_issues si
   where si.work_package_id = p_wp
     and not exists (
       select 1 from public.stock_reversals r where r.issue_id = si.id);
  v_materials := v_materials + v_store;

  v_equipment := public.wp_equipment_sell(p_wp);

  return query select
    v_budget,
    v_labor,
    v_materials,
    v_equipment,
    true,
    (v_budget - v_labor - v_materials - v_equipment);
end;
$$;

revoke all on function public.wp_profit(uuid) from public;
grant execute on function public.wp_profit(uuid) to authenticated;

comment on function public.wp_profit(uuid) is
  'Spec 161 U3b + 146 U3 + 178 U4 + 209 U1 — WP P&L: budget − labor_sell − materials_cost − equipment_cost. materials_cost = GL acct-1400 purchase cost PLUS the store transfer-price (Σ non-reversed stock_issues at sell, NET of WP→store stock_returns). Gate super_admin/project_director.';
