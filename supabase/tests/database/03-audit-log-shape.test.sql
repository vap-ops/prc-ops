begin;
select plan(10);

-- enum exists
select has_type('public', 'audit_action',
  'audit_action enum exists');
select enum_has_labels(
  'public', 'audit_action',
  array['insert', 'update', 'delete', 'login', 'logout', 'role_change',
        'photo_upload', 'photo_supersede', 'approve', 'reject',
        'export', 'other', 'profile_update', 'purchase_request_decision',
        'purchase_request_purchase', 'purchase_request_delivery',
        'worker_change', 'labor_cost_freeze', 'purchase_order_create',
        'dc_payment_recorded', 'equipment_rate_change', 'equipment_batch_create',
        'equipment_allocation_create', 'gl_account_upsert',
        'accounting_period_open', 'accounting_period_status_change',
        'journal_posted', 'client_billing_create', 'client_billing_certify',
        'retention_due', 'retention_release', 'wht_certificate_record',
        -- Spec 250/249 (finance build): revenue documents chain + client receipts.
        'quotation_create', 'quotation_update', 'client_po_create',
        'client_po_update', 'project_contract_upsert', 'contract_installment_add',
        'contract_installment_update', 'contract_installment_remove',
        'client_billing_installment_set', 'client_receipt_record',
        'client_receipt_supersede', 'client_billing_invoiced',
        -- Spec 259: procurement self-service PO void/revert.
        'purchase_order_void',
        -- Spec 251: subcontracts (agreed vs paid).
        'subcontract_create', 'subcontract_update', 'subcontract_wps_set',
        'subcontract_payment_record', 'subcontract_payment_supersede',
        -- Spec 258: subcontract crew register.
        'subcontract_crew_member_add', 'subcontract_crew_member_update',
        'subcontract_crew_document_add',
        -- Spec 260: PO-level charges (transport/discount/other).
        'po_charge_add', 'po_charge_void',
        -- Spec 275 U2: one-time rental fees.
        'rental_charge_add', 'rental_charge_void',
        -- Spec 275 U3: rental settlement (vendor invoice).
        'rental_settlement_record', 'rental_settlement_supersede'],
  'audit_action has the expected v1+profile_update+purchasing+labor+equipment+accounting labels'
);

-- table shape
select has_table('public', 'audit_log', 'public.audit_log exists');
select col_is_pk('public', 'audit_log', 'id', 'id is primary key');
select col_type_is('public', 'audit_log', 'id', 'uuid', 'id is uuid');
select col_type_is('public', 'audit_log', 'action', 'audit_action',
  'action is audit_action');
select col_not_null('public', 'audit_log', 'action', 'action is NOT NULL');
select col_not_null('public', 'audit_log', 'created_at',
  'created_at is NOT NULL');

-- RLS enabled
select is(
  (select relrowsecurity from pg_class
   where oid = 'public.audit_log'::regclass),
  true,
  'RLS enabled on public.audit_log'
);

-- triggers exist that block UPDATE and DELETE
select has_trigger(
  'public', 'audit_log', 'audit_log_block_update',
  'block-update trigger exists'
);

select * from finish();
rollback;
