-- Procurement bug 2 — "proof of payment" (สลิปโอน / หลักฐานการชำระเงิน) had no
-- home: purchase_request_attachments carried reference / delivery_confirmation /
-- invoice / quote, but the buyer's PAYMENT slip (distinct from the supplier's
-- invoice/receipt) had nowhere to go. Add a 'payment' purpose.
--
-- Enum-add in its OWN migration (a new enum value cannot be USED in the same
-- transaction that adds it) — the INSERT policy that references 'payment' lives
-- in the next migration.

alter type public.purchase_request_attachment_purpose add value if not exists 'payment';
