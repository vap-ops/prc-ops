-- v1 pilot data.
--
-- Project codes follow the PRC-YYYY-NNN convention. The two codes below are
-- PROVISIONAL — the operator will update them via a super_admin UPDATE when
-- the real project numbers are confirmed. Names match the two pilot
-- construction projects.
--
-- ON CONFLICT (code) DO NOTHING keeps this script idempotent — re-running it
-- against a database that already has these rows is a no-op (it does not
-- touch existing name / status / id values). The unique constraint is on
-- `code`, so that is the only column safe to conflict on.
--
-- Application note: `supabase db push` (the workflow this repo uses) does
-- NOT apply seed.sql. Seeds are applied by `supabase db reset` — which this
-- repo does not use because there is no local Docker stack (ADR 0006). To
-- apply this file against the linked remote project, run:
--
--   pnpm exec supabase db query --linked --file supabase/seed.sql
--
-- or paste the contents into the Supabase SQL editor and run it. Either
-- path runs as service_role / postgres and bypasses RLS, which is the
-- correct context for seeding before any super_admin user exists.

insert into public.projects (code, name) values
  ('PRC-2026-001', 'TFG Lam Sonthi'),
  ('PRC-2026-002', 'TFG Kham Muang')
on conflict (code) do nothing;
