-- Recovered from supabase_migrations.schema_migrations on 2026-06-07; originally applied to the live DB but never committed (drift recovery).
-- ADR 0016: Create the deliverables table — a project-scoped domain entity,
-- sibling of work_packages under projects. A deliverable (e.g. D01) groups
-- many WPs under a coarser, customer-recognisable unit. See
-- docs/decisions/0016-deliverables-domain-table.md and feature spec 04.
--
-- Modelled relationally (not as denormalised columns on work_packages): the
-- deliverable name and order live in one row, referenced by many WPs — no
-- duplication, no rename drift, and a home for future deliverable attributes
-- (Amount, status, dates) if they are ever brought in scope. Only code, name,
-- and sort_order are modelled here (ADR 0016 §4 scope boundary).
--
-- Access model: role-level per ADR 0013 (no membership in v1), gated via
-- public.current_user_role() (ADR 0011 — never self-join public.users in a
-- policy). Same split as work_packages: SELECT for site_admin /
-- project_manager / super_admin; INSERT / UPDATE for project_manager +
-- super_admin (deliverables are authored / imported). No DELETE policy.

-- 1. Deliverables table. `code` (e.g. 'D01') is unique WITHIN a project
--    (composite unique on (project_id, code)) — each pilot gets its own copy
--    of D01–D30, exactly like WP codes are unique per project. sort_order is
--    DeliverableOrder (1..30); groups render in this order.
create table public.deliverables (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  code        text not null,
  name        text not null,
  sort_order  integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint deliverables_project_code_unique unique (project_id, code)
);

-- ON DELETE CASCADE on project_id is a safety/consistency default for the case
-- where a project is hard-deleted at the service-role layer (ADR 0013 forbids
-- app-path deletes). The application never invokes this path.

-- Index for FK-lookups (listing a project's deliverables, joining WPs back to
-- their deliverable). The unique constraint already creates an index starting
-- with project_id, so this is mostly redundant for selectivity — kept explicit
-- so the intent is visible and a future change to the unique constraint cannot
-- accidentally remove the project_id index. Mirrors work_packages.
create index deliverables_project_id_idx
  on public.deliverables (project_id);

-- 2. updated_at maintenance via the existing public.set_updated_at() function
--    (defined in 20260505143544_create_users.sql). Do NOT redefine the
--    function — attach a new trigger that calls it.
create trigger deliverables_set_updated_at
  before update on public.deliverables
  for each row execute function public.set_updated_at();

-- 3. RLS — role-level access per ADR 0013, mirroring work_packages.
alter table public.deliverables enable row level security;

-- SELECT: site_admin / project_manager / super_admin can read all deliverables.
create policy "deliverables readable by privileged roles"
  on public.deliverables for select
  using (
    public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin'
    )
  );

-- INSERT: project_manager + super_admin only.
create policy "deliverables insert by pm or super_admin"
  on public.deliverables for insert
  with check (
    public.current_user_role() in ('project_manager', 'super_admin')
  );

-- UPDATE: project_manager + super_admin only. Both clauses gated so a writer
-- cannot transition a row out of their own visibility.
create policy "deliverables update by pm or super_admin"
  on public.deliverables for update
  using      (public.current_user_role() in ('project_manager', 'super_admin'))
  with check (public.current_user_role() in ('project_manager', 'super_admin'));

-- DELETE: no policy. With RLS enabled and no DELETE policy, every DELETE
-- against this table affects 0 rows — including those issued by super_admin
-- through the application path. Hard deletes require a service-role context
-- (explicit migration / console action). Same archive-not-delete contract as
-- projects and work_packages.
