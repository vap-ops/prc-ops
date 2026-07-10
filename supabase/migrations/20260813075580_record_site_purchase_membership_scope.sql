-- SA audit 2026-07 F2 — scope record_site_purchase to project membership.
--
-- record_site_purchase files a status='site_purchased' purchase_requests row that
-- carries an AMOUNT (a project EXPENSE, + reclaimable Input VAT 1300 when vat_rate>0).
-- Its gate was ROLE-ONLY: any admitted role (site_admin / project_manager / …) could
-- file that expense against a WP in a project they are NOT a member of. The siblings
-- issue_stock / site_purchase_use_now already scope with can_see_project; this RPC
-- takes only the WP, so it scopes with can_see_wp (which resolves the WP's project and
-- defers to can_see_project — super_admin / project_director stay unconditional, a
-- member site_admin / PM passes, a non-member is denied 42501).
--
-- Body-only CREATE OR REPLACE: the live definition (pg_get_functiondef) is reproduced
-- verbatim and the membership gate is the ONLY addition. It is placed AFTER the
-- WP-existence check (not right after the role check) on purpose: can_see_wp returns
-- false for a NONEXISTENT WP, so gating before the existence check would turn an
-- unknown-WP call from P0001 'work package not found' into 42501 — a behaviour change
-- beyond the intended reject. Placing it after the existence check keeps every other
-- path identical; the ONLY new behaviour is: an existing WP in a non-member project is
-- rejected 42501. No signature change, so grants are preserved and there is no
-- db:types drift.

create or replace function public.record_site_purchase(p_work_package_id uuid, p_item_description text, p_quantity numeric, p_unit text, p_reason_code purchase_request_reason_code, p_amount numeric default null::numeric, p_vat_rate numeric default 0)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item  text := nullif(trim(coalesce(p_item_description, '')), '');
  v_unit  text := nullif(trim(coalesce(p_unit, '')), '');
  v_actor text;
  v_id    uuid;
begin
  -- project_director rides along with project_manager (spec 152 / ADR 0058;
  -- pgTAP file 91 pins that every PM-gated RPC also names it) — the LIVE gate
  -- carried it (added by 20260751); reconstructing from the pre-152 body would
  -- have dropped it.
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
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
  -- Spec 176 U4: the reactive-reason tag is required.
  if p_reason_code is null then
    raise exception 'record_site_purchase: reason code required'
      using errcode = 'P0001';
  end if;
  -- Spec 103: amount optional, positive when supplied.
  if p_amount is not null and p_amount <= 0 then
    raise exception 'record_site_purchase: amount must be positive'
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

  -- SA audit 2026-07 F2: project-membership scope. The v1 "no membership" note
  -- above is superseded here — a site_purchased row is an EXPENSE, and a role-only
  -- gate let any admitted role file it against a WP in a non-member project. Mirror
  -- the siblings issue_stock / site_purchase_use_now (which gate on can_see_project);
  -- this RPC takes only the WP, so gate on can_see_wp. Kept AFTER the existence check
  -- so an unknown WP stays a P0001 'not found' — the only new behaviour is this
  -- reject. super_admin / project_director stay unconditional via can_see_project.
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'record_site_purchase: not a project member'
      using errcode = '42501';
  end if;

  select coalesce(nullif(trim(u.full_name), ''), auth.uid()::text)
    into v_actor
    from public.users u
    where u.id = auth.uid();

  insert into public.purchase_requests
    (work_package_id, item_description, quantity, unit, amount, vat_rate, reason_code,
     status, source, requested_by, purchased_at, delivered_at, received_by, received_by_id)
  values
    (p_work_package_id, v_item, p_quantity, v_unit, p_amount, p_vat_rate, p_reason_code,
     'site_purchased', 'site_purchase', auth.uid(), now(), now(), v_actor, auth.uid())
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
       'amount',           p_amount,
       'vat_rate',         p_vat_rate,
       'reason_code',      p_reason_code,
       'received_by',      v_actor
     ));

  return v_id;
end;
$function$;
