-- Spec 27 / ADR 0031 — `cancelled` joins the purchase-request lifecycle
-- as a terminal state after `rejected`.
--
-- Own migration ON PURPOSE: a new enum value is unusable inside the
-- transaction that adds it; the columns/trigger/CHECK that reference
-- 'cancelled' live in 20260614120100 (same split as on_route,
-- 20260614000000/-0100).
alter type public.purchase_request_status add value 'cancelled' after 'rejected';
