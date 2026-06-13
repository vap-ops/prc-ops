-- Data-architecture hardening (rank 6): pin that the AI-legibility comments
-- exist on the load-bearing tables/columns (20260625000400). A future
-- migration that strips them re-blinds any text-to-SQL/agent reading the DB.

begin;
select plan(4);

select isnt(
  obj_description('public.work_packages'::regclass, 'pg_class'), null,
  'work_packages has a table comment'
);
select isnt(
  obj_description('public.audit_log'::regclass, 'pg_class'), null,
  'audit_log has a table comment'
);
select isnt(
  col_description('public.labor_logs'::regclass,
    (select attnum from pg_attribute
      where attrelid = 'public.labor_logs'::regclass and attname = 'day_rate_snapshot')),
  null, 'labor_logs.day_rate_snapshot (money) is documented'
);
select isnt(
  col_description('public.workers'::regclass,
    (select attnum from pg_attribute
      where attrelid = 'public.workers'::regclass and attname = 'day_rate')),
  null, 'workers.day_rate (money) is documented'
);

select * from finish();
rollback;
