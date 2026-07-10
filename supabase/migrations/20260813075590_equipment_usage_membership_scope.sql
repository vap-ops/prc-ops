-- SA audit 2026-07 F3 — scope the equipment usage RPCs to project membership.
--
-- check_out_equipment opens a usage span (item -> WP) that accrues the item's
-- daily rental cost to that WP (wp_equipment_sell / wp_profit); check_in_equipment
-- closes it. Both gated ROLE-ONLY: any admitted role could open / close a span
-- against a WP in a project they are NOT a member of — the same shape as the F2
-- record_site_purchase hole (mig 075580 / #428): a WP-bound cost written by a
-- non-member. This scopes both to project membership.
--
-- WHY THE GATE IS ROLE-NARROWED (not a bare can_see_wp like F2): these RPCs admit
-- SIX roles — site_admin, project_manager, project_director, procurement,
-- procurement_manager, super_admin. public.can_see_project (which can_see_wp
-- resolves to) returns:
--   • TRUE  unconditionally for super_admin / project_director (see-all);
--   • membership (project_members OR project_lead) for project_manager / site_admin;
--   • FALSE for everyone else — INCLUDING procurement / procurement_manager (they
--     hold no project_members rows).
-- record_site_purchase could use a bare `if not can_see_wp then raise` because it
-- admits only the first two groups. Here a bare gate would return false for
-- procurement / procurement_manager and lock central logistics out of ALL
-- equipment check-out/in. The gate therefore fires ONLY for the membership-scoped
-- callers (site_admin / project_manager); the see-all and central roles are
-- untouched.
--
-- PLACEMENT: after the existence check (WP for check-out, the loaded log for
-- check-in), mirroring #428 — can_see_wp returns false for a nonexistent WP, so
-- gating before existence would turn an unknown-WP call from P0001 'not found'
-- into 42501. After existence, the only new behaviour is: an existing WP in a
-- non-member project is rejected 42501 'not a project member'.
--
-- equipment_movements is deliberately NOT changed here. It is the shared-pool
-- custody log; its project_id is set IFF kind='deployed' (the cross-project
-- dispatch act) and is null for received/returned/maintenance/lost. A membership
-- gate there breaks legitimate central relocation (procurement can_see_project =
-- false) and encodes a design decision on cross-project pool moves — raised as a
-- recommendation, not forced (LOW severity, no money column). See the PR body.
--
-- Body-only CREATE OR REPLACE: each body is the live pg_get_functiondef output
-- reproduced verbatim (six-role gate + spec 202 U3 F2/F3 guards, ADR 0058) and the
-- membership gate is the ONLY addition. No signature change, so grants are
-- preserved and there is no db:types drift.

-- ----------------------------------------------------------------------------
-- check_out_equipment — + F3 membership scope.
-- ----------------------------------------------------------------------------
create or replace function public.check_out_equipment(p_item uuid, p_wp uuid, p_date date)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role      public.user_role := public.current_user_role();
  v_rate      numeric(12,2);
  v_priced    boolean;
  v_status    public.equipment_status;   -- F2: the item's physical availability
  v_wp_status public.work_package_status;
  v_id        uuid;
begin
  if v_role is null
       or v_role not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'procurement_manager', 'super_admin') then
    raise exception 'check_out_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_out_equipment: checkout date required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item::text, 0));

  select daily_rate, daily_rate is not null, status
    into v_rate, v_priced, v_status
    from public.equipment_items where id = p_item;
  if not found then
    raise exception 'check_out_equipment: equipment item not found' using errcode = 'P0001';
  end if;
  if not v_priced then
    raise exception 'check_out_equipment: item has no daily rate (price it first)'
      using errcode = 'P0001';
  end if;
  -- F2: only gear physically on hand can be billed to a WP. maintenance / returned
  -- (to owner) / lost are blocked. 'in_use' passes HERE on purpose — a genuine
  -- in_use has an open span and is caught by the one-open-checkout guard below
  -- with the precise "already checked out" message; a manually-set in_use with no
  -- open span is legitimately checkout-able.
  if v_status not in ('available', 'on_site', 'in_use') then
    raise exception 'check_out_equipment: equipment not on site (maintenance/returned/lost)'
      using errcode = 'P0001';
  end if;

  select status into v_wp_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'check_out_equipment: work package not found' using errcode = 'P0001';
  end if;
  -- SA audit 2026-07 F3: project-membership scope. NARROWED to the two
  -- membership-scoped caller roles on purpose — the RPC also admits procurement /
  -- procurement_manager, for whom can_see_wp is always false (no project_members
  -- rows), so a bare gate would lock central logistics out of all equipment.
  -- Placed after the WP-existence check so an unknown WP stays P0001; super_admin /
  -- project_director keep see-all via can_see_wp.
  if v_role in ('site_admin', 'project_manager')
     and not public.can_see_wp(p_wp) then
    raise exception 'check_out_equipment: not a project member' using errcode = '42501';
  end if;
  if v_wp_status = 'complete' then
    raise exception 'check_out_equipment: work package is complete' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.equipment_usage_logs ul
     where ul.item_id = p_item
       and ul.checked_in_on is null
       and not exists (select 1 from public.equipment_usage_logs n where n.superseded_by = ul.id)
  ) then
    raise exception 'check_out_equipment: item is already checked out' using errcode = 'P0001';
  end if;

  insert into public.equipment_usage_logs
    (item_id, work_package_id, checked_out_on, daily_rate_snapshot, entered_by)
  values
    (p_item, p_wp, p_date, v_rate, auth.uid())
  returning id into v_id;

  -- F3: best-effort status overlay — the item is now in use. NOT authoritative:
  -- any later equipment_movements row re-derives status via its trigger and
  -- clobbers this; the open usage log remains the source of truth for "is it out".
  update public.equipment_items set status = 'in_use' where id = p_item;

  return v_id;
end;
$function$;

-- ----------------------------------------------------------------------------
-- check_in_equipment — + F3 membership scope.
-- ----------------------------------------------------------------------------
create or replace function public.check_in_equipment(p_log uuid, p_date date)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_orig public.equipment_usage_logs%rowtype;
  v_id   uuid;
begin
  if v_role is null
       or v_role not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'procurement_manager', 'super_admin') then
    raise exception 'check_in_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_in_equipment: check-in date required' using errcode = 'P0001';
  end if;

  select * into v_orig from public.equipment_usage_logs where id = p_log;
  if not found then
    raise exception 'check_in_equipment: checkout not found' using errcode = 'P0001';
  end if;
  -- SA audit 2026-07 F3: project-membership scope (mirror check_out_equipment). The
  -- WP is carried by the loaded checkout row; gate on it so a non-member site_admin
  -- / project_manager cannot close a span on a project they are not in. Placed after
  -- the checkout-existence check so an unknown log stays P0001. NARROWED to the
  -- membership-scoped roles — procurement / procurement_manager have can_see_wp =
  -- false; super_admin / project_director keep see-all.
  if v_role in ('site_admin', 'project_manager')
     and not public.can_see_wp(v_orig.work_package_id) then
    raise exception 'check_in_equipment: not a project member' using errcode = '42501';
  end if;
  if v_orig.checked_in_on is not null then
    raise exception 'check_in_equipment: checkout is already closed' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_orig.item_id::text, 0));
  if exists (select 1 from public.equipment_usage_logs n where n.superseded_by = p_log) then
    raise exception 'check_in_equipment: checkout already superseded' using errcode = 'P0001';
  end if;

  if p_date < v_orig.checked_out_on then
    raise exception 'check_in_equipment: check-in before check-out' using errcode = 'P0001';
  end if;

  insert into public.equipment_usage_logs
    (item_id, work_package_id, checked_out_on, checked_in_on,
     daily_rate_snapshot, entered_by, superseded_by)
  values
    (v_orig.item_id, v_orig.work_package_id, v_orig.checked_out_on, p_date,
     v_orig.daily_rate_snapshot, auth.uid(), p_log)
  returning id into v_id;

  -- F3: clear the in_use overlay — restore the status the item's LATEST movement
  -- implies (deployed→on_site, returned→returned, …; no movement → available),
  -- reusing the equipment_movement_derive_status mapping. Unconditional re-derive:
  -- idempotent and coherent whatever the current status (a movement may have
  -- clobbered in_use mid-checkout). Keeps the registry honest after a return.
  update public.equipment_items ei
     set status = coalesce((
       select (case m.kind
                 when 'received'    then 'available'
                 when 'deployed'    then 'on_site'
                 when 'returned'    then 'returned'
                 when 'maintenance' then 'maintenance'
                 when 'lost'        then 'lost'
               end)::public.equipment_status
         from public.equipment_movements m
        where m.item_id = v_orig.item_id
        order by m.occurred_at desc
        limit 1
     ), 'available'::public.equipment_status)
   where ei.id = v_orig.item_id;

  return v_id;
end;
$function$;

comment on function public.check_out_equipment(uuid, uuid, date) is
  'Spec 146 U3 + 202 U3 + SA-audit F3 — open an equipment usage span (item -> WP) at the item''s daily rate. Six-role gate (site_admin/pm/director/procurement/procurement_manager/super). Guards: priced, F2 physical status in (available,on_site,in_use), WP open, one-open-checkout, F3 project-membership (site_admin/pm scoped via can_see_wp). Sets equipment_items.status=in_use (non-authoritative overlay).';
comment on function public.check_in_equipment(uuid, date) is
  'Spec 146 U3 + 202 U3 + SA-audit F3 — close an open usage span via a superseding closed successor (append-only). F3 project-membership gate (site_admin/pm scoped via can_see_wp on the span''s WP). Restores equipment_items.status from the item''s latest movement (no movement -> available).';
