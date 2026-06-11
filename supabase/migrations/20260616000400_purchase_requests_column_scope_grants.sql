-- Spec 33 amendment (adversarial-review finding) — column-scope the
-- authenticated role's write privileges on purchase_requests.
--
-- The table carried TABLE-LEVEL insert/update grants to authenticated,
-- so every column — including the back-office fact set the spec-33 RPCs
-- exist to guard (supplier, supplier_id, order_ref, amount,
-- purchased_at, eta, shipped_at, delivered_at, received_by,
-- delivery_note) — was writable wherever an RLS policy admitted the row:
-- site_admin could set supplier_id at INSERT, PM/super could desync the
-- supplier snapshot via direct UPDATE. ADR 0038 chose RPCs because RLS
-- cannot restrict columns; the privilege layer CAN, and now does.
--
-- Column lists = exactly what the app's session-client paths use today:
--   INSERT: createPurchaseRequest (+ explicit id used by tests/fixtures)
--   UPDATE: decidePurchaseRequest + cancelPurchaseRequest
-- The SECURITY DEFINER RPCs and triggers run as the function owner and
-- are unaffected; appsheet_writer's own column-scoped grants are
-- untouched; service_role bypasses privileges.

revoke insert, update on public.purchase_requests from authenticated;

grant insert (id, work_package_id, item_description, quantity, unit,
              needed_by, priority, requested_by, source)
  on public.purchase_requests to authenticated;

grant update (status, approved_by, decided_at, decision_comment,
              cancelled_at, cancelled_by, cancellation_reason)
  on public.purchase_requests to authenticated;
