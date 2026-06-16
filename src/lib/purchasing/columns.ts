// Canonical purchase_requests select-column list (spec 65). The
// /requests list and /requests/[requestId] detail page read the same
// fact columns; this is the single home (the detail page appends
// ", notes"). Keep it a literal so PostgREST's typed select inference
// still sees the column names.
export const PR_LIST_COLUMNS =
  "id, pr_number, work_package_id, item_description, quantity, unit, status, requested_at, requested_by, requested_by_email, decision_comment, decided_at, purchased_at, shipped_at, supplier, delivered_at, received_by, delivery_note, needed_by, eta, priority, purchase_order_id";
