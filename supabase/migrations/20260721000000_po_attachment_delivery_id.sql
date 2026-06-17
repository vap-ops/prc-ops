-- Spec 135 U4 / ADR 0054 — proof-of-delivery scopes to a delivery. A PO ships in
-- deliveries (งวด); a proof-of-delivery (signed delivery note / received-goods photo)
-- belongs to the delivery it documents, not the whole PO. Add a delivery_id FK on
-- purchase_order_attachments so the uploader + gallery scope per delivery.
--
-- Mirrors the 20260713000000 purpose migration: nullable column + name it in the
-- column-scoped INSERT grant (ADR 0038) + recreate the current-state view to carry
-- it. NO backfill — the table is append-only (the block-write trigger rejects
-- UPDATE), and legacy proof (delivery_id NULL) surfaces under the PO's DEFAULT
-- delivery in the app (groupProofByDelivery). The INSERT policy already gates
-- role / author / parent-existence and is unchanged; the action validates that the
-- delivery belongs to the PO before insert.

alter table public.purchase_order_attachments
  add column delivery_id uuid references public.purchase_order_deliveries(id);

create index purchase_order_attachments_delivery_id_idx
  on public.purchase_order_attachments (delivery_id);

grant insert (delivery_id) on public.purchase_order_attachments to authenticated;

-- Recreate the current-state view to carry delivery_id (anti-join + tombstone filter
-- unchanged; security_invoker preserved so reads stay under the caller's RLS).
drop view public.purchase_order_attachments_current;
create view public.purchase_order_attachments_current
  with (security_invoker = true) as
  select a.id, a.purchase_order_id, a.delivery_id, a.kind, a.purpose, a.storage_path,
         a.created_by, a.created_at
  from public.purchase_order_attachments a
  where a.superseded_by is null
    and not exists (
      select 1 from public.purchase_order_attachments t where t.superseded_by = a.id
    );

revoke all on public.purchase_order_attachments_current from anon, authenticated;
grant select on public.purchase_order_attachments_current to authenticated;
