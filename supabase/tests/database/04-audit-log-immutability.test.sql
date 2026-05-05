begin;
select plan(3);

-- Insert a row as postgres (superuser, bypasses both REVOKE and RLS).
-- The trigger is the LAST line of defense and MUST still block writes.
insert into public.audit_log (action, target_table, target_id, payload)
  values ('other', 'pgtap', null, '{"test": true}'::jsonb);

-- Layer 3: trigger blocks UPDATE even for superuser
select throws_ok(
  $$ update public.audit_log
     set payload = '{"hacked": true}'::jsonb
     where target_table = 'pgtap' $$,
  'P0001',
  'audit_log is append-only',
  'trigger raises on UPDATE attempt'
);

-- Layer 3: trigger blocks DELETE even for superuser
select throws_ok(
  $$ delete from public.audit_log where target_table = 'pgtap' $$,
  'P0001',
  'audit_log is append-only',
  'trigger raises on DELETE attempt'
);

-- Layer 3: trigger blocks TRUNCATE
select throws_ok(
  $$ truncate table public.audit_log $$,
  NULL,
  NULL,
  'trigger raises on TRUNCATE attempt'
);

select * from finish();
rollback;
