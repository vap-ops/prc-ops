-- Spec 177 U11 — reversals (append-only undo of a wrong รับเข้า / เบิก).
--
-- A wrong stock movement is corrected by an append-only REVERSAL that undoes its
-- on-hand effect — never by editing the original (CLAUDE.md). stock_reversals
-- carries a TYPED FK to the reversed receipt OR issue (exactly one — no
-- mixed-content reference column); a partial unique index blocks reversing the
-- same movement twice. A receipt reversal subtracts its qty/value (guarded: the
-- receipt's quantity must still be on hand — you cannot un-receive stock that has
-- since been issued out); an issue reversal adds its qty/value back.
--
-- Gates mirror who creates each movement: receipt reversal = BACK_OFFICE (the
-- รับเข้า audience; procurement cross-project), issue reversal = SITE_STAFF.

create table public.stock_reversals (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  -- Exactly one of these is set (typed FKs, not a polymorphic column).
  receipt_id      uuid references public.stock_receipts(id),
  issue_id        uuid references public.stock_issues(id),
  qty             numeric(16, 2) not null,
  -- The on-hand value change applied (negative = receipt reversal removes value,
  -- positive = issue reversal adds it back).
  value_delta     numeric(18, 2) not null,
  note            text,
  reversed_by     uuid references public.users(id) default auth.uid(),
  reversed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint stock_reversals_exactly_one
    check ((receipt_id is not null) <> (issue_id is not null))
);

-- A movement can be reversed at most once.
create unique index stock_reversals_receipt_uniq
  on public.stock_reversals (receipt_id) where receipt_id is not null;
create unique index stock_reversals_issue_uniq
  on public.stock_reversals (issue_id) where issue_id is not null;
create index stock_reversals_project_item_idx
  on public.stock_reversals (project_id, catalog_item_id);

alter table public.stock_reversals enable row level security;
revoke all on public.stock_reversals from anon, authenticated;
grant select on public.stock_reversals to authenticated;
create policy "stock_reversals readable by project viewers or procurement"
  on public.stock_reversals for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );

comment on table public.stock_reversals is
  'Spec 177 — append-only reversals of a stock_receipts OR stock_issues movement (exactly one FK; unique per movement). value_delta is the on-hand value change applied. Written only via reverse_stock_receipt / reverse_stock_issue.';

-- ----------------------------------------------------------------------------
-- reverse_stock_receipt — undo a รับเข้า (subtract its qty/value from on-hand).
-- ----------------------------------------------------------------------------
create function public.reverse_stock_receipt(p_receipt_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        public.user_role := public.current_user_role();
  v_project     uuid;
  v_item        uuid;
  v_qty         numeric;
  v_total_cost  numeric;
  v_on_hand     numeric;
  v_value       numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: BACK_OFFICE_ROLES (who records รับเข้า).
  if v_role not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'reverse_stock_receipt: role not permitted' using errcode = '42501';
  end if;

  select project_id, catalog_item_id, qty, total_cost
    into v_project, v_item, v_qty, v_total_cost
    from public.stock_receipts where id = p_receipt_id;
  if v_project is null then
    raise exception 'reverse_stock_receipt: unknown receipt' using errcode = '22023';
  end if;
  -- Membership: PM/SA by membership; super/director see-all; procurement cross-project.
  if not (public.can_see_project(v_project) or v_role = 'procurement') then
    raise exception 'reverse_stock_receipt: not a project member' using errcode = '42501';
  end if;

  -- Record the reversal FIRST so a double reversal hits the unique index (23505)
  -- regardless of the on-hand state (after the first reversal, on-hand has already
  -- dropped below the receipt qty, which would otherwise mask the 23505 as a 22023).
  insert into public.stock_reversals (project_id, catalog_item_id, receipt_id, qty, value_delta, note)
  values (v_project, v_item, p_receipt_id, v_qty, -v_total_cost, v_note)
  returning id into v_id;

  -- Lock on-hand; the receipt's quantity must still be on hand to un-receive it.
  select qty_on_hand, total_value into v_on_hand, v_value
    from public.stock_on_hand
   where project_id = v_project and catalog_item_id = v_item
   for update;
  if v_on_hand is null or v_on_hand < v_qty then
    raise exception 'reverse_stock_receipt: stock already moved, cannot reverse'
      using errcode = '22023';
  end if;

  update public.stock_on_hand
     set qty_on_hand = v_on_hand - v_qty,
         total_value = case when v_on_hand - v_qty = 0 then 0 else v_value - v_total_cost end,
         updated_at  = now()
   where project_id = v_project and catalog_item_id = v_item;

  return v_id;
end;
$$;

revoke all on function public.reverse_stock_receipt(uuid, text) from public, anon;
grant execute on function public.reverse_stock_receipt(uuid, text) to authenticated;

comment on function public.reverse_stock_receipt(uuid, text) is
  'Spec 177 U11 — undo a รับเข้า: subtract the receipt''s qty/value from on-hand (BACK_OFFICE tier; the receipt''s qty must still be on hand). Append-only stock_reversals row; one reversal per receipt. Returns the reversal id.';

-- ----------------------------------------------------------------------------
-- reverse_stock_issue — undo a เบิก (add its qty/value back to on-hand).
-- ----------------------------------------------------------------------------
create function public.reverse_stock_issue(p_issue_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        public.user_role := public.current_user_role();
  v_project     uuid;
  v_item        uuid;
  v_qty         numeric;
  v_total_cost  numeric;
  v_on_hand     numeric;
  v_value       numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES (who records เบิก).
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'reverse_stock_issue: role not permitted' using errcode = '42501';
  end if;

  select project_id, catalog_item_id, qty, total_cost
    into v_project, v_item, v_qty, v_total_cost
    from public.stock_issues where id = p_issue_id;
  if v_project is null then
    raise exception 'reverse_stock_issue: unknown issue' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'reverse_stock_issue: not a project member' using errcode = '42501';
  end if;

  select qty_on_hand, total_value into v_on_hand, v_value
    from public.stock_on_hand
   where project_id = v_project and catalog_item_id = v_item
   for update;
  if v_on_hand is null then
    raise exception 'reverse_stock_issue: no on-hand row for this item' using errcode = '22023';
  end if;

  -- Record the reversal first (unique index blocks a double reversal → 23505).
  insert into public.stock_reversals (project_id, catalog_item_id, issue_id, qty, value_delta, note)
  values (v_project, v_item, p_issue_id, v_qty, v_total_cost, v_note)
  returning id into v_id;

  -- Add the issued qty/value back to on-hand.
  update public.stock_on_hand
     set qty_on_hand = v_on_hand + v_qty,
         total_value = v_value + v_total_cost,
         updated_at  = now()
   where project_id = v_project and catalog_item_id = v_item;

  return v_id;
end;
$$;

revoke all on function public.reverse_stock_issue(uuid, text) from public, anon;
grant execute on function public.reverse_stock_issue(uuid, text) to authenticated;

comment on function public.reverse_stock_issue(uuid, text) is
  'Spec 177 U11 — undo a เบิก: add the issue''s qty/value back to on-hand (SITE_STAFF tier + member). Append-only stock_reversals row; one reversal per issue. Returns the reversal id.';
