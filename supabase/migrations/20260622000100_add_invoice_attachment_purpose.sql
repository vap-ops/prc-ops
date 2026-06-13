-- Spec 66 / ADR 0043 — invoices/receipts (ใบส่งของ/ใบเสร็จ) get their own
-- attachment purpose, distinct from 'reference' (pre-decision) and
-- 'delivery_confirmation' (the proof photo that auto-completes delivery).
--
-- Own migration: ALTER TYPE ... ADD VALUE cannot be referenced in the
-- transaction it lands in — the RLS migration (…000400) that names
-- 'invoice' in policy predicates runs later, in its own transaction.
-- Safe vs the delivery auto-complete trigger (20260614110000): that
-- trigger keys strictly on purpose='delivery_confirmation', so 'invoice'
-- never advances status (ADR 0043 §1).

alter type public.purchase_request_attachment_purpose add value 'invoice';
