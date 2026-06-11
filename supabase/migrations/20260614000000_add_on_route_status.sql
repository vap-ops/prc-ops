-- Spec 22 / ADR 0027 — `on_route` joins the purchase-request lifecycle
-- between purchased and delivered.
--
-- Own migration ON PURPOSE: Postgres forbids using a new enum value in
-- the same transaction that adds it, and supabase db push wraps each
-- migration file in one transaction. The derive/audit trigger changes
-- that reference 'on_route' live in the NEXT migration (20260614000100).
alter type public.purchase_request_status add value 'on_route' after 'purchased';
