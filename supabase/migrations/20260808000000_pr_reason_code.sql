-- Spec 176 U4 — reactive-PR reason codes.
--
-- Every purchase request is a "scramble" order relative to the frozen supply
-- plan (spec 176). This migration makes the requester tag WHY the item wasn't
-- simply drawn from the plan/store. Only `unplanned_miss` counts against the
-- PM's planning accuracy (the scoring rule lives in U5 — this unit captures
-- the tag). Required on BOTH create paths: the form path
-- (createPurchaseRequest → RLS insert) and the on-site quick-record
-- (record_site_purchase RPC).
--
-- Posture (matches priority/needed_by — ADR 0026, requester-set fields):
--   * NULLABLE column, NO default — legacy rows (pre-feature) stay null and are
--     UNSCORED by U5; a dishonest backfill is avoided. Required-ness lives on
--     the write paths (the action validator + the RPC's required param), not a
--     column NOT NULL or a DB CHECK.
--   * The insert RLS policy is UNTOUCHED (the existing pins 70/73/91/115 and the
--     owner-role pgTAP fixtures keep working with a null reason_code).
--   * The INSERT grant is column-scoped (spec 33 / 20260616000400) — reason_code
--     joins the list additively. NO UPDATE grant: set once at create, like
--     priority (no edit path planned).
--
-- A plain CREATE TYPE may share this transaction with the column that
-- references it; the two-migration split discipline applies only to
-- ALTER TYPE ... ADD VALUE.

create type public.purchase_request_reason_code as enum (
  'unplanned_miss', 'rework', 'breakage', 'scope_change', 'unforeseeable');

alter table public.purchase_requests
  add column reason_code public.purchase_request_reason_code;

comment on column public.purchase_requests.reason_code is
  'Spec 176 U4 — why this request was made reactively instead of drawn from the supply plan. Required on new rows via the write-path validators + the record_site_purchase RPC (no DB CHECK, matching priority/needed_by — ADR 0026); nullable so legacy rows stay unscored. Only unplanned_miss counts against the PM (U5).';

-- Additive column-scoped INSERT grant (the table-level grant was revoked in
-- spec 33). No UPDATE grant — reason_code is set once at create.
grant insert (reason_code) on public.purchase_requests to authenticated;

-- The record_site_purchase RPC also gains a required reason_code — but that
-- function's CURRENT signature carries a VAT param (20260701000200), so its
-- DROP+CREATE lives in the companion migration 20260808000100 (which sources
-- the LIVE body so VAT behaviour is preserved). Keeping it separate avoids
-- accidentally shadowing the VAT version with a vat-less duplicate.
