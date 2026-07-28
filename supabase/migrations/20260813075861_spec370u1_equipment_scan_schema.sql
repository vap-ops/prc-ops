-- Spec 370 U1 — equipment scan in/out schema: condition photos + rate-optional
-- borrows + door/borrower attribution. Operator call 2026-07-28 ("b, continue"):
-- internal borrowing must not wait on fleet pricing (daily_rate was 0/64 and
-- check_out_equipment hard-refused unpriced items, so NO borrow door worked).
--
-- Four parts, one lane claim:
--   1. equipment_usage_logs: daily_rate_snapshot becomes NULLABLE; new `via`
--      (which door recorded the event) + `borrower_worker_id` (who physically
--      holds the tool — entered_by is always the recording SA under 370 D1).
--   2. check_out_equipment / check_in_equipment DROP+CREATE from the LIVE defs
--      (223 status guard, membership arm, one-open-log guard, advisory locks all
--      preserved verbatim): the unpriced refusal is REMOVED (a null rate now
--      snapshots null; wp_equipment_sell's SUM skips null products, so an
--      unpriced span charges 0 — pinned in 370-equipment-scan-schema.test.sql),
--      and both gain the attribution params.
--   3. equipment_usage_photos — condition evidence, REQUIRED by the UI in both
--      directions (370 D4). Photos key on the ORIGINAL log id; the check-in
--      supersede does NOT re-home them (readers follow the chain).
--   4. equipment-images storage INSERT policy REWRITE: the live predicate ended
--      `array_length(storage.foldername(name), 1) = 1`, which refused any
--      usage/<x>/ path for EVERYONE. Back office keeps the depth-1 root for
--      registry images; EQUIPMENT_MOVE_ROLES (incl. site_admin) may write only
--      under usage/ at depth 2.
--
-- ⚠️ Signature change: pgTAP files 100/105/223/290 pin the OLD signatures by
-- regprocedure — updated in this same PR. Between db:push and merge, other
-- lanes' merge-ref pgTAP runs of MAIN's copies will error; LANES.md carries the
-- warning.

-- 1a. Rate becomes optional on the log.
alter table public.equipment_usage_logs
  alter column daily_rate_snapshot drop not null;

-- 1b. Attribution columns. `via` is an enum (house rule: no free-text tags);
-- store is 368 U4's คืน door, wp_tab is 363 U7's browse door.
create type public.equipment_usage_via as enum ('scan', 'search', 'wp_tab', 'store');

alter table public.equipment_usage_logs
  add column via public.equipment_usage_via,
  add column borrower_worker_id uuid references public.workers (id);

comment on column public.equipment_usage_logs.via is
  'Which door recorded THIS row''s event (checkout row = the borrow door, closing row = the return door). Null on rows predating spec 370.';
comment on column public.equipment_usage_logs.borrower_worker_id is
  'Who physically took the tool. entered_by is the recording custodian (the SA at the store under 370 D1), so it cannot answer "who has it".';

-- 2. RPCs — DROP then CREATE with the new signatures (regprocedure pins in the
-- pgTAP suite are bumped in this same PR).
drop function public.check_out_equipment(uuid, uuid, date);
drop function public.check_in_equipment(uuid, date);

create function public.check_out_equipment(
  p_item uuid,
  p_wp uuid,
  p_date date,
  p_via public.equipment_usage_via default null,
  p_borrower_worker_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role      public.user_role := public.current_user_role();
  v_rate      numeric(12,2);
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

  -- Spec 370 U1: the unpriced refusal is gone (operator call b). A null
  -- daily_rate snapshots null — the span charges nothing in wp_equipment_sell
  -- until the fleet is priced; the borrow itself must not wait on pricing.
  select daily_rate, status
    into v_rate, v_status
    from public.equipment_items where id = p_item;
  if not found then
    raise exception 'check_out_equipment: equipment item not found' using errcode = 'P0001';
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

  -- Spec 370 U1: name the unknown-borrower failure instead of leaking a bare
  -- 23503 from the FK.
  if p_borrower_worker_id is not null
     and not exists (select 1 from public.workers w where w.id = p_borrower_worker_id) then
    raise exception 'check_out_equipment: borrower worker not found' using errcode = 'P0001';
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
    (item_id, work_package_id, checked_out_on, daily_rate_snapshot, entered_by,
     via, borrower_worker_id)
  values
    (p_item, p_wp, p_date, v_rate, auth.uid(), p_via, p_borrower_worker_id)
  returning id into v_id;

  -- F3: best-effort status overlay — the item is now in use. NOT authoritative:
  -- any later equipment_movements row re-derives status via its trigger and
  -- clobbers this; the open usage log remains the source of truth for "is it out".
  update public.equipment_items set status = 'in_use' where id = p_item;

  return v_id;
end;
$function$;

create function public.check_in_equipment(
  p_log uuid,
  p_date date,
  p_via public.equipment_usage_via default null
) returns uuid
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

  -- Spec 370 U1: the closing row keeps the ORIGINAL borrow's borrower and
  -- daily_rate_snapshot (null stays null), and records ITS OWN door in via —
  -- checkout row = the borrow door, closing row = the return door.
  insert into public.equipment_usage_logs
    (item_id, work_package_id, checked_out_on, checked_in_on,
     daily_rate_snapshot, entered_by, superseded_by, via, borrower_worker_id)
  values
    (v_orig.item_id, v_orig.work_package_id, v_orig.checked_out_on, p_date,
     v_orig.daily_rate_snapshot, auth.uid(), p_log, p_via, v_orig.borrower_worker_id)
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

-- DEFINER hygiene (house pattern): nothing executes these but signed-in users.
revoke all on function public.check_out_equipment(uuid, uuid, date, public.equipment_usage_via, uuid) from public, anon;
revoke all on function public.check_in_equipment(uuid, date, public.equipment_usage_via) from public, anon;
grant execute on function public.check_out_equipment(uuid, uuid, date, public.equipment_usage_via, uuid) to authenticated;
grant execute on function public.check_in_equipment(uuid, date, public.equipment_usage_via) to authenticated;

-- 3. Condition photos. Append-only in practice: SELECT + INSERT policies only —
-- no UPDATE/DELETE path for any app role. Photos reference the ORIGINAL log row;
-- the check-in supersede deliberately does NOT move them (the reader follows the
-- chain from the original id — pinned in the test).
create type public.equipment_photo_phase as enum ('out', 'in');

create table public.equipment_usage_photos (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.equipment_usage_logs (id),
  phase public.equipment_photo_phase not null,
  storage_path text not null,
  taken_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

alter table public.equipment_usage_photos enable row level security;

-- Read: the equipment staff set (mirrors "equipment_movements readable by staff").
create policy "equipment_usage_photos readable by staff"
  on public.equipment_usage_photos for select
  using (
    coalesce(
      (select public.current_user_role()) = any (array[
        'site_admin', 'project_manager', 'procurement', 'procurement_manager',
        'super_admin', 'project_director'
      ]::public.user_role[]),
      false
    )
  );

-- Write: the movers (the check_out/check_in audience), attributed to themselves.
create policy "equipment_usage_photos insert by movers"
  on public.equipment_usage_photos for insert
  with check (
    coalesce(
      (select public.current_user_role()) = any (array[
        'site_admin', 'project_manager', 'procurement', 'procurement_manager',
        'super_admin', 'project_director'
      ]::public.user_role[]),
      false
    )
    and taken_by = (select auth.uid())
  );

grant select, insert on public.equipment_usage_photos to authenticated;

-- 4. Storage: rewrite the equipment-images INSERT policy. The old WITH CHECK
-- ended `array_length(storage.foldername(name), 1) = 1`, refusing usage/<x>/
-- for every role. Registry images keep the back-office depth-1 root; condition
-- photos go under usage/ at depth 2 for the mover set. DROP+CREATE = a policy
-- REWRITE: re-wrap (select current_user_role()) and coalesce to false (the
-- unbound-caller trap).
drop policy "equipment-images uploads by back office" on storage.objects;

create policy "equipment-images uploads by back office"
  on storage.objects for insert
  with check (
    bucket_id = 'equipment-images'
    and (
      (
        coalesce(
          (select public.current_user_role()) = any (array[
            'project_manager', 'procurement', 'procurement_manager',
            'super_admin', 'project_director'
          ]::public.user_role[]),
          false
        )
        and array_length(storage.foldername(name), 1) = 1
      )
      or (
        coalesce(
          (select public.current_user_role()) = any (array[
            'site_admin', 'project_manager', 'procurement', 'procurement_manager',
            'super_admin', 'project_director'
          ]::public.user_role[]),
          false
        )
        and (storage.foldername(name))[1] = 'usage'
        and array_length(storage.foldername(name), 1) = 2
      )
    )
  );
