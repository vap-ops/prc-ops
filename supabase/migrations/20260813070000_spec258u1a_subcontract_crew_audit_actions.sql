-- Spec 258 U1a — audit_action enum additions for the subcontract crew
-- register. Own migration: ALTER TYPE ... ADD VALUE cannot be used in the
-- same transaction as its subsequent use (house lesson, matches every other
-- audit-action-add migration in this build).

alter type public.audit_action add value if not exists 'subcontract_crew_member_add';
alter type public.audit_action add value if not exists 'subcontract_crew_member_update';
alter type public.audit_action add value if not exists 'subcontract_crew_document_add';
