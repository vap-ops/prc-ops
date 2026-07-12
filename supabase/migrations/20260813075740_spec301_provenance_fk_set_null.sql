-- Spec 301 U2a follow-up (fresh-eyes finding): the provenance FK must never
-- BLOCK a work-package delete. delete_work_package's empty-guard checks only
-- work_package_id (the binding), so under NO ACTION a WP that store PRs were
-- merely RAISED from would pass the guard and then throw a raw 23503 from
-- this column — breaking a previously working guarded path (and the project
-- hard-delete playbook). Provenance semantics on WP delete = drop the pointer,
-- keep the PR and its receipt/GL history → ON DELETE SET NULL.
-- (075730 is already applied — applied migrations are never edited; this is
-- the forward fix.)
alter table public.purchase_requests
  drop constraint purchase_requests_requested_from_work_package_id_fkey;
alter table public.purchase_requests
  add constraint purchase_requests_requested_from_work_package_id_fkey
    foreign key (requested_from_work_package_id)
    references public.work_packages (id)
    on delete set null;

-- The FK's parent-delete check (and future "PRs raised from this WP" reads)
-- otherwise seq-scan purchase_requests; work_package_id has the same index.
create index purchase_requests_requested_from_wp_idx
  on public.purchase_requests (requested_from_work_package_id);
