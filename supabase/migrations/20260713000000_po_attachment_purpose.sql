-- Spec 134 U4a / ADR 0044 / ADR 0046 — proof-of-delivery as a distinct
-- purchase_order_attachments purpose.
--
-- purchase_order_attachments (spec 125) was single-purpose: the PO source document
-- (quotation / invoice). A manually uploaded proof-of-delivery (a signed delivery
-- note, or a photo of the received goods) is semantically distinct — it must render
-- in its own section, never mixed with the source docs — and the future Lalamove
-- auto-POD (spec 134 U4b) fans into the SAME purpose. Add a purpose discriminator,
-- DEFAULTED so every existing row and the create-PO source-doc INSERT path stay
-- 'source_document' with no code change.
--
-- This is a FRESH `create type` (not `alter type ... add value`), so its labels are
-- usable within this same migration — the ADD-VALUE-same-transaction hazard
-- (20260622000100) does not apply here.

create type public.purchase_order_attachment_purpose as enum
  ('source_document', 'proof_of_delivery');

alter table public.purchase_order_attachments
  add column purpose public.purchase_order_attachment_purpose
    not null default 'source_document';

-- The column-scoped authenticated INSERT grant must name `purpose` or app sessions
-- cannot set it (ADR 0038 column-scope posture; mirrors the table's other insert
-- grants). The existing "insert source document by back office" policy constrains
-- only role / author / parent-existence / superseded_by-null — not the purpose
-- column — so back office may insert either purpose; no policy change is needed
-- (a proof-of-delivery upload is a back-office/site action, same gate).
grant insert (purpose) on public.purchase_order_attachments to authenticated;

-- Recreate the current-state view to carry `purpose` (the ADR 0009/0015 content-row
-- anti-join + tombstone filter are unchanged; security_invoker preserved so reads
-- stay under the caller's RLS).
drop view public.purchase_order_attachments_current;
create view public.purchase_order_attachments_current
  with (security_invoker = true) as
  select a.id, a.purchase_order_id, a.kind, a.purpose, a.storage_path,
         a.created_by, a.created_at
  from public.purchase_order_attachments a
  where a.superseded_by is null
    and not exists (
      select 1 from public.purchase_order_attachments t where t.superseded_by = a.id
    );

revoke all on public.purchase_order_attachments_current from anon, authenticated;
grant select on public.purchase_order_attachments_current to authenticated;
