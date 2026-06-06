-- AppSheet back-office role. Password here is a placeholder:
-- rotate per environment via dashboard/psql after applying.
do $$ begin
  if not exists (select from pg_roles where rolname = 'appsheet') then
    create role appsheet with login password 'CHANGE_ME_AFTER_APPLY';
  end if;
end $$;

grant connect on database postgres to appsheet;
grant usage on schema public to appsheet;
grant select on all tables in schema public to appsheet;
grant insert, update on projects, deliverables, work_packages, tasks to appsheet;
grant usage, select on all sequences in schema public to appsheet;

alter default privileges in schema public grant select on tables to appsheet;
alter default privileges in schema public grant usage, select on sequences to appsheet;