-- Spec 250 U1b — audit_action enum values for the revenue-documents-chain RPCs.
-- 062000 shipped the RPCs inserting these actions; audit_log.action is the
-- audit_action ENUM, so every value must exist or the RPC throws at runtime
-- (caught by pgTAP 253). Enum-add isolated in its own migration per the
-- db-migration house rule.

alter type public.audit_action add value if not exists 'quotation_create';
alter type public.audit_action add value if not exists 'quotation_update';
alter type public.audit_action add value if not exists 'client_po_create';
alter type public.audit_action add value if not exists 'client_po_update';
alter type public.audit_action add value if not exists 'project_contract_upsert';
alter type public.audit_action add value if not exists 'contract_installment_add';
alter type public.audit_action add value if not exists 'contract_installment_update';
alter type public.audit_action add value if not exists 'contract_installment_remove';
alter type public.audit_action add value if not exists 'client_billing_installment_set';
