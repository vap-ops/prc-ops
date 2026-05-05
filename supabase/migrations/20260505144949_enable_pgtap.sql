-- pgTAP is the unit-testing framework used by `pnpm db:test`. It is dev-only
-- (never invoked by application code), but is recorded as a migration so
-- the remote schema is fully reproducible from supabase/migrations/.
create extension if not exists pgtap with schema extensions;
