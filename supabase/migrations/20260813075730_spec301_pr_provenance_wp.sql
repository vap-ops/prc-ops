-- Spec 301 U2a — PR provenance: which work package the ขอซื้อ was raised from.
--
-- ADR 0065 (store-only procurement) forces work_package_id NULL on every new
-- PR so the material lands in the project store and is เบิก'd later — but that
-- also discarded the REQUEST's origin entirely (createPurchaseRequest comment:
-- "the WP intent, if any, is no longer recorded here"). Procurement asked for
-- the WP code on each PR (spec 301); the off-category flag (spec 297 follow-on)
-- needs the same anchor. This column records provenance ONLY:
--   * work_package_id        = delivery/custody binding (stays NULL, ADR 0065
--                              intact — store receipt paths key on it)
--   * requested_from_work_package_id = who asked (display + advisory flag)
alter table public.purchase_requests
  add column requested_from_work_package_id uuid
    references public.work_packages (id);

comment on column public.purchase_requests.requested_from_work_package_id is
  'Spec 301: the WP the request was raised from (provenance, display + off-category flag). NOT the delivery binding — ADR 0065 keeps work_package_id NULL on store-bound PRs.';

-- authenticated INSERTs purchase_requests through a COLUMN-LEVEL grant list
-- (13 of 44 columns, verified live 2026-07-12) — a new writable column must be
-- granted explicitly or the form insert fails 42501 (spec-275 U0 / #435 lesson).
grant insert (requested_from_work_package_id)
  on public.purchase_requests to authenticated;
