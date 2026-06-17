-- Spec 135 U6 / ADR 0054 — manual delivery dispatch. A PO ships in deliveries (งวด);
-- this records that a งวด is on its way, so the PO advances ordered (สั่งซื้อแล้ว) →
-- in_transit (กำลังจัดส่ง). Today on_route is only reachable via the per-ticket
-- record_shipment (buried on the PR detail) — the operator working at the delivery
-- level had no way to advance. This is the delivery-level batch of that action.
--
-- Posture mirrors record_shipment (20260616000200): back-office gate, set shipped_at
-- on the delivery's purchased lines; the EXISTING trigger chain (on_route derive +
-- fact-audit + notification, 20260614000100) flips them purchased → on_route and
-- audits — no new trigger here. U4b (Lalamove) later fills this same transition
-- automatically when a courier order is dispatched.

create function public.dispatch_purchase_order_delivery(p_delivery_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if public.current_user_role()
       not in ('project_manager', 'procurement', 'super_admin') then
    raise exception 'dispatch_purchase_order_delivery: role not permitted'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.purchase_order_deliveries where id = p_delivery_id
  ) then
    raise exception 'dispatch_purchase_order_delivery: delivery not found'
      using errcode = 'P0001';
  end if;

  -- Mark the งวด's not-yet-shipped lines as shipped; the derive trigger flips
  -- purchased → on_route and the audit/notification triggers fire (no explicit writes
  -- here, the record_shipment posture). Already-shipped / delivered lines are left
  -- as-is, so a re-dispatch is a harmless 0-row no-op.
  update public.purchase_requests
     set shipped_at = now()
   where delivery_id = p_delivery_id
     and status = 'purchased'
     and shipped_at is null;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.dispatch_purchase_order_delivery(uuid) from public, anon;
grant execute on function public.dispatch_purchase_order_delivery(uuid) to authenticated;
