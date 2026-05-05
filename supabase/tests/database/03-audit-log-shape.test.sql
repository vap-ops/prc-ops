begin;
select plan(10);

-- enum exists
select has_type('public', 'audit_action',
  'audit_action enum exists');
select enum_has_labels(
  'public', 'audit_action',
  array['insert', 'update', 'delete', 'login', 'logout', 'role_change',
        'photo_upload', 'photo_supersede', 'approve', 'reject',
        'export', 'other'],
  'audit_action has the expected v1 labels'
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
