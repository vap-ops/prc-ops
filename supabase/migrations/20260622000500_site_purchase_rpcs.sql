-- Spec 66 / ADR 0043 — the two on-site-purchase RPCs. SECURITY DEFINER,
-- search_path pinned (ADR 0011 hygiene); each re-checks the guards the
-- INSERT/UPDATE RLS would give, because the owner-privileged function
-- bypasses RLS + column grants (the record_purchase pattern).
--
-- record_site_purchase creates a purchase_request born terminal
-- (status='site_purchased', source='site_purchase'), so it fires NO
-- notification (notify_pr_created keys on status='requested') and NO
-- derive/decision/delivery audit trigger (those are UPDATE-path). It writes
-- exactly one audit_log row, reusing the existing action='insert' value
-- (no new audit_action enum value). See ADR 0043 §6–§7.

create function public.record_site_purchase(
  p_work_package_id uuid,
  p_item_description text,
  p_quantity numeric,
  p_unit text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item  text := nullif(trim(coalesce(p_item_description, '')), '');
  v_unit  text := nullif(trim(coalesce(p_unit, '')), '');
  v_actor text;
  v_id    uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'record_site_purchase: role not permitted'
      using errcode = '42501';
  end if;

  if v_item is null then
    raise exception 'record_site_purchase: item description required'
      using errcode = 'P0001';
  end if;
  if length(v_item) > 500 then
    raise exception 'record_site_purchase: item description too long'
      using errcode = 'P0001';
  end if;
  if v_unit is null then
    raise exception 'record_site_purchase: unit required'
      using errcode = 'P0001';
  end if;
  if length(v_unit) > 40 then
    raise exception 'record_site_purchase: unit too long'
      using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'record_site_purchase: quantity must be positive'
      using errcode = 'P0001';
  end if;

  -- WP existence. v1 access is role-level (ADR 0013 — no membership): the
  -- admitted roles read every WP, so there is no per-project scope to
  -- probe; the role gate + this existence check are the full visibility
  -- guard (ADR 0043 §6). Revisit if a per-project access model lands.
  if not exists (select 1 from public.work_packages wp where wp.id = p_work_package_id) then
    raise exception 'record_site_purchase: work package not found'
      using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(u.full_name), ''), auth.uid()::text)
    into v_actor
    from public.users u
    where u.id = auth.uid();

  insert into public.purchase_requests
    (work_package_id, item_description, quantity, unit,
     status, source, requested_by, purchased_at, delivered_at, received_by)
  values
    (p_work_package_id, v_item, p_quantity, v_unit,
     'site_purchased', 'site_purchase', auth.uid(), now(), now(), v_actor)
  returning id into v_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(),
     public.current_user_role(),
     'insert',
     'purchase_requests',
     v_id,
     jsonb_build_object(
       'source',           'site_purchase',
       'work_package_id',  p_work_package_id,
       'item_description', v_item,
       'quantity',         p_quantity,
       'unit',             v_unit,
       'received_by',      v_actor
     ));

  return v_id;
end;
$$;

-- acknowledge_site_purchase — PM/super marks an on-site purchase as seen.
-- Scoped to source='site_purchase' + not-yet-acknowledged (idempotent).
-- Sets only the ack columns (not authenticated-writable); writes one audit
-- row. The ack UPDATE touches no fact column, so the derive trigger is a
-- no-op and status stays 'site_purchased'.
create function public.acknowledge_site_purchase(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'acknowledge_site_purchase: role not permitted'
      using errcode = '42501';
  end if;

  update public.purchase_requests
     set acknowledged_at = now(),
         acknowledged_by = auth.uid()
   where id = p_id
     and source = 'site_purchase'
     and acknowledged_at is null;
  if not found then
    raise exception 'acknowledge_site_purchase: not an unacknowledged site purchase'
      using errcode = 'P0001';
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(),
     public.current_user_role(),
     'update',
     'purchase_requests',
     p_id,
     jsonb_build_object('source', 'site_purchase', 'transition', 'acknowledged'));
end;
$$;

revoke all on function public.record_site_purchase(uuid, text, numeric, text)
  from public, anon;
grant execute on function public.record_site_purchase(uuid, text, numeric, text)
  to authenticated;

revoke all on function public.acknowledge_site_purchase(uuid)
  from public, anon;
grant execute on function public.acknowledge_site_purchase(uuid)
  to authenticated;
