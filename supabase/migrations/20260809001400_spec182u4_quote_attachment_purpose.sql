-- Spec 182 U4 — a 'quote' attachment purpose for the supplier quotation doc.
--
-- Own migration: ALTER TYPE ... ADD VALUE cannot be referenced in the same
-- transaction it lands in — the next migration (…001500) names 'quote' in the
-- INSERT policy arm + the CHECK constraint, so it runs in its own transaction
-- (the spec-66 'invoice' precedent, 20260622000100 → …000400).

alter type public.purchase_request_attachment_purpose add value if not exists 'quote';
