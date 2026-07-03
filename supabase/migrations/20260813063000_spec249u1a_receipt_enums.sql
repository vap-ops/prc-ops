-- Spec 249 U1a — enums for client receipts, isolated per the enum-add house rule.
-- receipt_method is a NEW type (also reused by spec 251 subcontract payments);
-- the audit_action values back the 063500 RPCs.

create type public.receipt_method as enum ('bank_transfer', 'cheque', 'cash');

alter type public.audit_action add value if not exists 'client_receipt_record';
alter type public.audit_action add value if not exists 'client_receipt_supersede';
alter type public.audit_action add value if not exists 'client_billing_invoiced';
