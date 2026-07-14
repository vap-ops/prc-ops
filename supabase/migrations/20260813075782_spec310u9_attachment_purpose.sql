-- Spec 310 U9 (operator 2026-07-13) — accounting needs to tell a payment slip
-- from a tax invoice. Tag each office-expense receipt with its document purpose.
-- Nullable: rows uploaded before this (generic receipts) stay null.

create type public.office_expense_doc_purpose as enum ('payment_slip', 'tax_invoice');

alter table public.office_expense_attachments
  add column purpose public.office_expense_doc_purpose;
