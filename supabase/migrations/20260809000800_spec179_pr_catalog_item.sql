-- Spec 179 U1 — link a purchase request to a catalog item (spec 175 master).
--
-- Procurement (and any requester) can now PICK the requisition item from the
-- item catalog instead of free-typing it — killing the per-site spelling drift
-- the catalog exists to prevent. The link is a NULLABLE FK: an off-catalog
-- request leaves catalog_item_id NULL and keeps the free-text item_description/
-- unit path. The text columns stay the human-readable snapshot (they survive a
-- later edit/deactivation of the catalog row); the FK is the item identity used
-- by downstream reconciliation (PR -> stock-in -> on-hand) and spend-by-item.
--
-- Posture mirrors reason_code (spec 176 U4): a nullable column with NO default
-- (legacy rows stay null = pre-feature), the link set ONCE on the create path —
-- INSERT-granted, not UPDATE-granted. No RLS change: the INSERT policy pins
-- requested_by / source / role only; the FK column is unconstrained + nullable.

alter table public.purchase_requests
  add column catalog_item_id uuid references public.catalog_items(id);

-- purchase_requests carries COLUMN-SCOPED insert grants to authenticated
-- (migration 20260616000400 revoked the table-level insert and re-granted an
-- explicit column list). A newly added column is NOT covered by that grant, so
-- the session-client INSERT (createPurchaseRequest) would be denied on the new
-- column. Extend the INSERT grant — and only INSERT (set once at create, like
-- reason_code). SELECT stays table-level (granted in 20260608120000, never
-- revoked) so reads of the new column need no grant.
grant insert (catalog_item_id) on public.purchase_requests to authenticated;

comment on column public.purchase_requests.catalog_item_id is
  'Spec 179 — optional FK to catalog_items (the picked master item). NULL = off-catalog free-text request. item_description/unit remain the human snapshot.';
