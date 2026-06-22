-- Spec 177 U6 — two-party custody handshake on เบิก (issue now, receiver confirms).
--
-- Doctrine: every issued item has exactly ONE custodian, no gaps, so "who lost it"
-- is always answerable; shrinkage is a store-BU P&L hit. Operator (AskUserQuestion):
-- (1) keep เบิก as-is (stock decrements immediately) + name a RECEIVER who later
-- attests receipt; (2) the receiver is a WORKER (the team member who physically
-- takes the material — the self-governance actor, confirms via the worker portal).
--
-- stock_issues gains receiver_worker_id (nullable — legacy + the /store manager
-- path have none) + received_at (null = pending receipt). issue_stock gains a
-- trailing p_receiver_worker_id. confirm_stock_issue lets the NAMED receiver worker
-- attest (current_user_worker_id, the portal binding). RLS lets the receiver read
-- their own issue so the portal can list "to confirm".

alter table public.stock_issues
  add column receiver_worker_id uuid references public.workers(id),
  add column received_at timestamptz;

comment on column public.stock_issues.receiver_worker_id is
  'Spec 177 U6 — the worker who takes custody of the issued material (two-party handshake); null = no named receiver.';
comment on column public.stock_issues.received_at is
  'Spec 177 U6 — when the receiver worker attested receipt; null = pending receipt (the audit flag).';

-- READ: add the receiver-worker self-read arm so the portal can show their issues.
drop policy "stock_issues readable by project viewers or procurement" on public.stock_issues;
create policy "stock_issues readable by project viewers or procurement"
  on public.stock_issues for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
    or receiver_worker_id = (select public.current_user_worker_id())
  );

-- ----------------------------------------------------------------------------
-- issue_stock gains a trailing p_receiver_worker_id. Adding a parameter changes
-- the signature, so DROP the 5-arg + CREATE the 6-arg (a single overload). Body
-- reconstructed verbatim from the live pg_proc + the receiver capture. Existing
-- 5-positional-arg callers (pgTAP 182, the issueStock action) still resolve here,
-- the receiver defaulting to null.
-- ----------------------------------------------------------------------------
drop function if exists public.issue_stock(uuid, uuid, uuid, numeric, text);
create function public.issue_stock(
  p_project_id      uuid,
  p_catalog_item_id uuid,
  p_work_package_id uuid,
  p_qty             numeric,
  p_note            text default null,
  p_receiver_worker_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_decrement   numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES — site_admin draws at the WP, plus the PM tier.
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'issue_stock: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'issue_stock: not a project member' using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'issue_stock: qty must be > 0' using errcode = '22023';
  end if;
  -- The WP must belong to this project (you draw to a WP in the same store).
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'issue_stock: work package not in this project' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'issue_stock: unknown or inactive catalog item' using errcode = '22023';
  end if;
  -- A named receiver must be an ACTIVE worker on this project (or unassigned).
  if p_receiver_worker_id is not null and not exists (
    select 1 from public.workers w
     where w.id = p_receiver_worker_id and w.active
       and (w.project_id = p_project_id or w.project_id is null)
  ) then
    raise exception 'issue_stock: receiver is not an active worker on this project'
      using errcode = '22023';
  end if;

  -- Lock the on-hand row and check sufficiency.
  select qty_on_hand, total_value into v_qty_on_hand, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  if v_qty_on_hand is null or v_qty_on_hand < p_qty then
    raise exception 'issue_stock: insufficient stock on hand' using errcode = '22023';
  end if;

  -- Moving-average cost at issue (the cost basis). Decrement on-hand by qty and
  -- by qty*avg; fully depleting forces value to 0 so rounding dust never lingers.
  v_avg := round(v_value / v_qty_on_hand, 2);
  v_decrement := p_qty * v_avg;
  update public.stock_on_hand
     set qty_on_hand = v_qty_on_hand - p_qty,
         total_value = case when v_qty_on_hand - p_qty = 0 then 0 else v_value - v_decrement end,
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  insert into public.stock_issues
    (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, note, receiver_worker_id)
  values
    (p_project_id, p_catalog_item_id, p_work_package_id, p_qty, v_unit, v_avg, v_note,
     p_receiver_worker_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.issue_stock(uuid, uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.issue_stock(uuid, uuid, uuid, numeric, text, uuid) to authenticated;

comment on function public.issue_stock(uuid, uuid, uuid, numeric, text, uuid) is
  'Spec 177 U3/U6 — draw stock OUT to a WP at moving-average cost (SITE_STAFF tier + member); optionally names a receiver worker who later confirms receipt (custody handshake). Decrements stock_on_hand under a row lock; returns the issue id.';

-- ----------------------------------------------------------------------------
-- confirm_stock_issue — the NAMED receiver worker attests receipt (portal).
-- ----------------------------------------------------------------------------
create function public.confirm_stock_issue(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker   uuid := public.current_user_worker_id();
  v_receiver uuid;
  v_received timestamptz;
begin
  if v_worker is null then
    raise exception 'confirm_stock_issue: not a worker' using errcode = '42501';
  end if;
  select receiver_worker_id, received_at into v_receiver, v_received
    from public.stock_issues where id = p_issue_id;
  if not found then
    raise exception 'confirm_stock_issue: unknown issue' using errcode = '22023';
  end if;
  if v_receiver is null then
    raise exception 'confirm_stock_issue: no receiver named on this issue' using errcode = '22023';
  end if;
  if v_receiver <> v_worker then
    raise exception 'confirm_stock_issue: only the named receiver confirms' using errcode = '42501';
  end if;
  if v_received is not null then
    raise exception 'confirm_stock_issue: already confirmed' using errcode = '22023';
  end if;

  update public.stock_issues set received_at = now() where id = p_issue_id;
end;
$$;

revoke all on function public.confirm_stock_issue(uuid) from public, anon;
grant execute on function public.confirm_stock_issue(uuid) to authenticated;

comment on function public.confirm_stock_issue(uuid) is
  'Spec 177 U6 — the named receiver worker attests receipt of an issued item (current_user_worker_id must equal the issue receiver). Sets received_at. Completes the two-party custody handshake.';
