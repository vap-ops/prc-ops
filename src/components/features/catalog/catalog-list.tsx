// Spec 175 U1 — read-only item-catalog list, grouped by category.
// Pure presentational (server-renderable): takes already-fetched rows and
// renders one section per category that has items, in item_category enum order
// (the ITEM_CATEGORY_LABEL key order). No controls — viewing only this unit.

import type { Database } from "@/lib/db/database.types";
import {
  ITEM_CATEGORY_LABEL,
  CATALOG_STOCKABLE_LABEL,
  CATALOG_NON_STOCKABLE_LABEL,
} from "@/lib/i18n/labels";

type ItemCategory = Database["public"]["Enums"]["item_category"];

export type CatalogItem = {
  id: string;
  category: ItemCategory;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  stockable: boolean;
};

export function CatalogList({ items }: { items: CatalogItem[] }) {
  if (items.length === 0) {
    return <p className="text-ink-secondary text-body">ยังไม่มีรายการวัสดุ</p>;
  }

  // Enum order = the ITEM_CATEGORY_LABEL key order (declared to match the enum).
  const categories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];

  return (
    <div className="flex flex-col gap-6">
      {categories.map((cat) => {
        const rows = items.filter((it) => it.category === cat);
        if (rows.length === 0) return null;
        return (
          <section key={cat} className="flex flex-col gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">
              {ITEM_CATEGORY_LABEL[cat]} <span className="text-ink-muted">({rows.length})</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {rows.map((it) => (
                <li
                  key={it.id}
                  className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-ink text-body block font-semibold">{it.baseItem}</span>
                    {it.specAttrs ? (
                      <span className="text-ink-secondary text-meta block">{it.specAttrs}</span>
                    ) : null}
                  </span>
                  <span className="text-ink-secondary text-meta shrink-0">{it.unit}</span>
                  <span
                    className={
                      it.stockable
                        ? "bg-sunk text-ink-secondary rounded-control text-meta shrink-0 px-2 py-1 font-medium"
                        : "border-edge text-ink-muted rounded-control text-meta shrink-0 border px-2 py-1 font-medium"
                    }
                  >
                    {it.stockable ? CATALOG_STOCKABLE_LABEL : CATALOG_NON_STOCKABLE_LABEL}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
