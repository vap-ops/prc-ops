-- Recovered from supabase_migrations.schema_migrations on 2026-06-07; originally applied to the live DB but never committed (drift recovery).
-- ADR 0016 §2: Add work_packages.deliverable_id — a nullable FK linking each
-- work package to its deliverable. See feature spec 04 (deliverable grouping).
--
-- Runs after 20260531000000_create_deliverables.sql so the FK target exists.

alter table public.work_packages
  add column deliverable_id uuid
    references public.deliverables(id) on delete set null;

-- Nullable: a WP with no deliverable is valid (renders in an "Ungrouped"
-- bucket). The pilots have full D01–D30 coverage, but the column must tolerate
-- gaps for future projects.
--
-- ON DELETE SET NULL (not cascade): removing a deliverable must NEVER delete
-- work packages — it only severs the grouping link.

-- Index for grouped-WP queries (joining WPs to their deliverable, ordering by
-- deliverable then code).
create index work_packages_deliverable_id_idx
  on public.work_packages (deliverable_id);
