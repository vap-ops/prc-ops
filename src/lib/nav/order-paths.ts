// Spec 135 U5 — single source of purchase-order-surface URLs. Mirrors project-paths
// (spec 82): the URL names what is shown (the order, its delivery), never the viewer's
// role. PO detail + the per-delivery detail page route through here so the next
// namespace move touches one file instead of scattered template literals.

export function poDetailHref(purchaseOrderId: string): string {
  return `/requests/orders/${purchaseOrderId}`;
}

export function deliveryDetailHref(purchaseOrderId: string, deliveryId: string): string {
  return `/requests/orders/${purchaseOrderId}/deliveries/${deliveryId}`;
}
