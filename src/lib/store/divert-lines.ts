// Spec 198 U3 — map purchase_request rows (delivered, WP-bound, catalogued) to
// the DivertLine shape the คลัง page and the delivery detail page both render via
// DivertToStoreList. Pure: filters out any line already diverted (a stock_receipt
// already stamped with that PR) and formats item / WP labels. Shared so the two
// surfaces stay identical.

import type { DivertLine } from "@/components/features/store/divert-to-store-list";

export type DivertPrRow = {
  id: string;
  quantity: number | string;
  unit: string | null;
  amount: number | string | null;
  catalog_items: { base_item: string; spec_attrs: string | null } | null;
  work_packages: { code: string; name: string } | null;
};

export function toDivertLines(rows: DivertPrRow[], divertedIds: Set<string>): DivertLine[] {
  return rows
    .filter((r) => !divertedIds.has(r.id))
    .map((r) => ({
      requestId: r.id,
      itemLabel: `${r.catalog_items?.base_item ?? ""}${
        r.catalog_items?.spec_attrs ? ` · ${r.catalog_items.spec_attrs}` : ""
      }`,
      qty: Number(r.quantity),
      unit: r.unit ?? "",
      wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : "",
      cost: Number(r.amount ?? 0),
    }));
}
