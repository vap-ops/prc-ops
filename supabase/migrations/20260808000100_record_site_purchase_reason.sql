-- Spec 176 U4 (companion to 20260808000000) — record_site_purchase gains the
-- required reactive-reason code.
--
-- The function's CURRENT signature is (uuid, text, numeric, text, numeric amount,
-- numeric vat_rate) — the VAT param was added in 20260701000200. A REQUIRED
-- param must precede the defaulted ones, so p_reason_code is inserted BEFORE
-- p_amount, giving a 7-arg signature. The body is the LIVE 20260701000200
-- definition (VAT preserved) + the reason guard / insert / audit.
--
-- DROP both pre-existing overloads:
--   * the live VAT 6-arg (uuid, text, numeric, text, numeric, numeric)
--   * a vat-less reason 6-arg (uuid, text, numeric, text, reason_code, numeric)
--     — only present if 20260808000000 was applied before it was split; the
--     IF EXISTS makes the drop a no-op on a fresh rebuild.
-- then CREATE the 7-arg and RE-GRANT (the grant drops with the function).

drop function if exists public.record_site_purchase(uuid, text, numeric, text, numeric, numeric);
drop function if exists public.record_site_purchase(
  uuid, text, numeric, text, public.purchase_request_reason_code, numeric);
-- Self-drop the 7-arg target too, so re-applying this migration (e.g. after a
-- repair) is idempotent rather than colliding with its own prior CREATE.
drop function if exists public.record_site_purchase(
  uuid, text, numeric, text, public.purchase_request_reason_code, numeric, numeric);

create function public.record_site_purchase(
  p_work_package_id uuid,
  p_item_description text,
  p_quantity numeric,
  p_unit text,
  p_reason_code public.purchase_request_reason_code,
  p_amount numeric default null,
  p_vat_rate numeric default 0
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
  -- project_director rides along with project_manager (spec 152 / ADR 0058;
  -- pgTAP file 91 pins that every PM-gated RPC also names it) — the LIVE gate
  -- carried it (added by 20260751); reconstructing from the pre-152 body would
  -- have dropped it.
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
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
$$;

revoke all on function public.record_site_purchase(
  uuid, text, numeric, text, public.purchase_request_reason_code, numeric, numeric)
  from public, anon;
grant execute on function public.record_site_purchase(
  uuid, text, numeric, text, public.purchase_request_reason_code, numeric, numeric)
  to authenticated;
