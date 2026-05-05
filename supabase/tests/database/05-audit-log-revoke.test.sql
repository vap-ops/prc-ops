begin;
select plan(2);

-- Layer 1: authenticated and anon roles do NOT have UPDATE/DELETE
-- privileges on public.audit_log. has_table_privilege returns true if
-- ANY listed privilege is granted; we want to confirm UPDATE/DELETE
-- are absent.
select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE'),
  'authenticated role lacks UPDATE on audit_log'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'),
  'authenticated role lacks DELETE on audit_log'
);

select * from finish();
rollback;
