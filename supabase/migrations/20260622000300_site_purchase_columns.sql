-- Spec 66 / ADR 0043 — allow source='site_purchase' and add the PM
-- acknowledgement columns.
--
-- The ack columns are written ONLY by acknowledge_site_purchase (SECURITY
-- DEFINER, owner-privileged). They are deliberately NOT added to the
-- authenticated column-scope grants (20260616000400) — same posture as
-- the back-office fact columns: app sessions cannot write them directly.

alter table public.purchase_requests
  drop constraint pr_source_valid,
  add constraint pr_source_valid check (source in ('app', 'appsheet', 'site_purchase'));

alter table public.purchase_requests
  add column acknowledged_at timestamptz,
  add column acknowledged_by uuid references public.users(id);
