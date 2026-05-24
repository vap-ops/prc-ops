-- Create the `reports` job-record table + the private `reports` Storage
-- bucket that holds generated PDFs.
--
-- Grain: one row = one async PDF-generation job. A PM requests a report
-- for a project; a Railway worker (separate later unit) picks up rows at
-- status='requested' under the service role, generates the PDF, uploads
-- it to the reports bucket, and updates the row to 'complete' (with
-- storage_path) or 'failed' (with error).
--
-- MUTABLE table — NOT append-only. The worker updates the row's status,
-- storage_path, and error in place. The shape mirrors the projects table
-- (set_updated_at trigger, role-level RLS via current_user_role per ADR
-- 0011, no triple-enforcement), NOT the photo_logs / approvals append-
-- only triple-enforcement shape.
--
-- Access model (role-level, ADR 0013):
--   SELECT: project_manager + super_admin only. NOT site_admin — SAs
--           do not consume reports in v1.
--   INSERT: project_manager + super_admin only. The reports row's
--           initial state is enforced by column defaults (status =
--           'requested', storage_path / error / null) — RLS can't
--           easily check column values, so the defaults are the
--           contract.
--   UPDATE: NO POLICY. App users cannot edit reports. The Railway
--           worker uses the service role, which bypasses RLS by
--           design; that is the only path that updates this table.
--   DELETE: NO POLICY. Same archive-not-delete posture as projects /
--           work_packages.

-- 1. Enum for the job lifecycle.
create type public.report_status as enum (
  'requested',  -- PM created the job; worker has not picked it up yet
  'processing', -- worker has claimed the job and is generating the PDF
  'complete',   -- PDF uploaded; storage_path set
  'failed'      -- worker hit an error; error text set for debugging
);

-- 2. Reports table. project_id is the report's subject; requested_by
--    is the PM who asked for it. storage_path is null until the worker
--    finishes successfully; error is null unless the worker failed.
create table public.reports (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null
                   references public.projects(id) on delete cascade,
  status         public.report_status not null default 'requested',
  storage_path   text,
  error          text,
  requested_by   uuid not null references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ON DELETE CASCADE on project_id is a defensive consistency default
-- for the case where a project is hard-deleted at the service-role
-- layer (ADR 0013 forbids app-path deletes). The application never
-- invokes this path.

-- 3. updated_at maintenance via the existing public.set_updated_at()
--    function (defined in 20260505143544_create_users.sql). Do NOT
--    redefine the function — attach a new trigger that calls it. Fires
--    on every UPDATE, which in practice means every worker state
--    transition (requested → processing → complete | failed).
create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

-- 4. Indexes.
--
-- project_id: standard FK-lookup index for "list reports for project X"
-- in the future PM UI. The future PM-report UI will query reports by
-- project.
create index reports_project_id_idx
  on public.reports (project_id);

-- status (partial): the Railway worker's hot-path query is "find me a
-- job to do" — rows at 'requested' (waiting for any worker) or
-- 'processing' (potentially stuck / for retry visibility). 'complete'
-- and 'failed' are terminal states the worker never looks for. The
-- partial index keeps only the active-job rows, which is the entire
-- rowset the worker scans on every poll cycle. Storage cost is bounded
-- by the size of the in-flight job queue, not the report archive.
create index reports_active_status_idx
  on public.reports (status)
  where status in ('requested', 'processing');

-- 5. RLS — role-level access per ADR 0013, via public.current_user_role()
--    (ADR 0011). Never self-joining public.users.
alter table public.reports enable row level security;

-- SELECT: PM + super_admin. site_admin is intentionally NOT in the set
-- (the visibility contract — SAs don't see reports in v1).
create policy "reports readable by pm or super_admin"
  on public.reports for select
  using (
    public.current_user_role() in ('project_manager', 'super_admin')
  );

-- INSERT: PM + super_admin. The initial state ('requested' / null /
-- null) is enforced by table defaults; callers omit those columns.
create policy "reports insert by pm or super_admin"
  on public.reports for insert
  with check (
    public.current_user_role() in ('project_manager', 'super_admin')
  );

-- No UPDATE policy. With RLS enabled and no UPDATE policy, every
-- application-path UPDATE affects zero rows (USING returns false for
-- every candidate row). The Railway worker uses the service role,
-- which bypasses RLS by design — that is the ONLY path that mutates
-- this table after insert.
--
-- No DELETE policy. Same archive-not-delete contract as projects and
-- work_packages: with RLS enabled and no matching policy, every
-- application-path DELETE affects zero rows. Hard deletes require a
-- service-role context (explicit migration / console action).

-- 6. Private `reports` Storage bucket.
--
-- Mirrors the photos-bucket migration's posture (no broad SELECT /
-- INSERT policies on storage.objects). The Railway worker writes via
-- the service role, which bypasses Storage RLS by design; downloads in
-- the future PM-report UI go via server-minted signed URLs (also
-- service-role-side). No direct authenticated/anon access by design —
-- leaving storage.objects unpolicied for this bucket keeps every read
-- and write going through the application path that decides "may this
-- user access this report".
--
-- 50 MiB ceiling: PDFs of a project's WPs + photos can run large
-- (current-photos × ~30 WPs × multiple per WP); 50 MiB is comfortable
-- headroom without inviting accidental upload of unrelated payloads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reports',
  'reports',
  false,
  52428800,                       -- 50 MiB
  array['application/pdf']
)
on conflict (id) do nothing;

-- No SELECT / INSERT / UPDATE / DELETE policies on storage.objects for
-- the `reports` bucket in this unit, by design (see header comment).
-- Service-role-only access. The PM-report UI unit will add the
-- signed-URL helper that mints download URLs via service role.
