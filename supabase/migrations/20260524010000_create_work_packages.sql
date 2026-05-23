-- Create the work_packages table — child of projects (one project → many WPs).
-- Schema-only unit; the CSV import script and the rich WP model (cost,
-- subcon, QA, tasks, equipment, risk) are deferred to later units.
--
-- Access model: role-level per ADR 0013 (no membership in v1), via
-- public.current_user_role() (ADR 0011 helper — never self-join
-- public.users in a policy that gates on it). The split for writes —
-- SELECT for site_admin/project_manager/super_admin, INSERT/UPDATE for
-- project_manager + super_admin — reflects that PMs author WPs in v1
-- while site admins consume them read-only.
--
-- status is manual-only metadata in v1. In particular, 'pending_approval'
-- exists in the enum but no photo-driven transition logic is built here;
-- that belongs to the future photo-upload unit.

-- 1. Enum for WP lifecycle status.
create type public.work_package_status as enum (
  'not_started', 'in_progress', 'on_hold', 'complete', 'pending_approval'
);

-- 2. Work packages table. `code` is unique WITHIN a project (composite
--    unique on (project_id, code)) — two different projects may carry the
--    same WP code; the same code under the same project is rejected.
create table public.work_packages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  code        text not null,
  name        text not null,
  description text,
  status      public.work_package_status not null default 'not_started',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint work_packages_project_code_unique unique (project_id, code)
);

-- ON DELETE CASCADE on project_id is a safety/consistency default for the
-- case where a project is hard-deleted at the service-role layer (ADR 0013
-- forbids app-path deletes). The application never invokes this path.

-- Index for FK-lookups (joining WPs back to a project, listing a project's
-- WPs, etc.). The unique constraint already creates an index that starts
-- with project_id, so this is mostly redundant for selectivity — kept
-- explicit so the intent is visible and so a future change to the unique
-- constraint cannot accidentally remove the project_id index.
create index work_packages_project_id_idx
  on public.work_packages (project_id);

-- 3. updated_at maintenance via the existing public.set_updated_at()
--    function (defined in 20260505143544_create_users.sql). Do NOT
--    redefine the function — attach a new trigger that calls it.
create trigger work_packages_set_updated_at
  before update on public.work_packages
  for each row execute function public.set_updated_at();

-- 4. RLS — role-level access per ADR 0013.
alter table public.work_packages enable row level security;

-- SELECT: site_admin / project_manager / super_admin can read all WPs.
create policy "work_packages readable by privileged roles"
  on public.work_packages for select
  using (
    public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin'
    )
  );

-- INSERT: project_manager + super_admin only.
create policy "work_packages insert by pm or super_admin"
  on public.work_packages for insert
  with check (
    public.current_user_role() in ('project_manager', 'super_admin')
  );

-- UPDATE: project_manager + super_admin only. Both clauses gated so a
-- writer cannot transition a row out of their own visibility.
create policy "work_packages update by pm or super_admin"
  on public.work_packages for update
  using      (public.current_user_role() in ('project_manager', 'super_admin'))
  with check (public.current_user_role() in ('project_manager', 'super_admin'));

-- DELETE: no policy. With RLS enabled and no DELETE policy, every DELETE
-- against this table affects 0 rows — including those issued by
-- super_admin through the application path. Hard deletes require a
-- service-role context (explicit migration / console action). Same
-- archive-not-delete contract as projects.
