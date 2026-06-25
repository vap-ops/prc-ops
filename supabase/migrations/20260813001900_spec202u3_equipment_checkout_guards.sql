-- Spec 202 U3 / ADR 0055 — equipment check-out coherence guards (F2 + F3).
--
-- The 2026-06-25 lifecycle review found two latent bugs, now reachable since U2
-- wired the check-out/check-in UI:
--   F2: check_out_equipment validated the rate + WP + one-open-checkout, but NOT
--       the item's PHYSICAL status — so a WP could be billed for gear that's in
--       maintenance, returned to the owner, or lost. The two "where is it" axes
--       (equipment_movements = project-grain custody; equipment_usage_logs =
--       WP-grain billing) had no cross-check.
--   F3: equipment_status='in_use' was a dead enum value — no movement derived it
--       and check-out never set it, so a checked-out item still displayed its last
--       movement status.
--
-- This migration CREATE OR REPLACEs both usage RPCs to add the guards. NO new
-- table / column / grant / policy / enum value; grants are preserved across the
-- replace. No audit_log row — the usage RPCs are self-auditing append-only (the
-- append-only log IS the trail) and the status flip is a denormalisation exactly
-- like equipment_movement_derive_status (which writes no audit either).
--
-- RE-SOURCE DISCIPLINE: both bodies are the LIVE definitions from
-- 20260767000400_equipment_usage_director_gates.sql (the latest — no later
-- redefinition exists), which carry the FIVE-role gate (site_admin /
-- project_manager / project_director / procurement / super_admin; ADR 0058,
-- pgTAP 90/91). The F2/F3 lines are ADDED to that exact body — never re-derived
-- from the pre-director 20260767000100 original (which would drop project_director).

-- ----------------------------------------------------------------------------
-- check_out_equipment — + F2 (physical-availability guard) + F3 (in_use overlay).
-- ----------------------------------------------------------------------------
create or replace function public.check_out_equipment(p_item uuid, p_wp uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate      numeric(12,2);
  v_priced    boolean;
  v_status    public.equipment_status;   -- F2: the item's physical availability
  v_wp_status public.work_package_status;
  v_id        uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'super_admin') then
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
$$;

-- ----------------------------------------------------------------------------
-- check_in_equipment — + F3 restore (clear in_use to the movement-derived status).
-- ----------------------------------------------------------------------------
create or replace function public.check_in_equipment(p_log uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig public.equipment_usage_logs%rowtype;
  v_id   uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'project_director', 'procurement', 'super_admin') then
    raise exception 'check_in_equipment: role not permitted' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'check_in_equipment: check-in date required' using errcode = 'P0001';
  end if;

  select * into v_orig from public.equipment_usage_logs where id = p_log;
  if not found then
    raise exception 'check_in_equipment: checkout not found' using errcode = 'P0001';
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
$$;

comment on function public.check_out_equipment(uuid, uuid, date) is
  'Spec 146 U3 + 202 U3 — open an equipment usage span (item -> WP) at the item''s daily rate. Five-role gate (site_admin/pm/director/procurement/super). Guards: priced, F2 physical status in (available,on_site,in_use), WP open, one-open-checkout. Sets equipment_items.status=in_use (F3 overlay, non-authoritative).';
comment on function public.check_in_equipment(uuid, date) is
  'Spec 146 U3 + 202 U3 — close an open usage span via a superseding closed successor (append-only). Restores equipment_items.status from the item''s latest movement (F3; no movement -> available).';
