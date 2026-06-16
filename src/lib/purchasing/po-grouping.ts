// Spec 134 U2 — group worklist rows by purchase order. A band's rows arrive
// already priority-sorted (spec 110); this splits the bundled rows (those with a
// purchase_order_id) from the loose one-off rows so the in-transit band can render
// one PO card per order instead of scattering its member tickets. Pure (no DB / no
// React) → unit-tested.

export interface PoGroup<T> {
  poId: string;
  items: T[];
}

export interface PoGroupedRows<T> {
  // PO groups in first-appearance order (= earliest member in the sorted band).
  poGroups: Array<PoGroup<T>>;
  // Rows with no PO, in their original order.
  loose: T[];
}

export function groupByPurchaseOrder<T extends { purchase_order_id: string | null }>(
  rows: ReadonlyArray<T>,
): PoGroupedRows<T> {
  const order: string[] = [];
  const byPo = new Map<string, T[]>();
  const loose: T[] = [];

  for (const r of rows) {
    const poId = r.purchase_order_id;
    if (poId == null) {
      loose.push(r);
      continue;
    }
    let items = byPo.get(poId);
    if (!items) {
      items = [];
      byPo.set(poId, items);
      order.push(poId);
    }
    items.push(r);
  }

  return {
    poGroups: order.map((poId) => ({ poId, items: byPo.get(poId) ?? [] })),
    loose,
  };
}
