-- Spec 66 / ADR 0043 — on-site cash purchases are a DISTINCT terminal
-- status, not a reuse of 'delivered'. Reusing 'delivered' would leak site
-- purchases into the appsheet_writer worklist, render the delivery-photo
-- uploader on the wrong rows, and conflate delivery reports/audit — all
-- fixed only by uncompiled predicate edits. A new enum value's blast
-- radius is typecheck-enforced (exhaustive switch/Record + _exhaustive)
-- plus one pgTAP pin. See ADR 0043 §3.
--
-- Own migration: ADD VALUE cannot be referenced in the transaction it
-- lands in (the RLS + RPC migrations that name 'site_purchased' run later).

alter type public.purchase_request_status add value 'site_purchased' after 'delivered';
