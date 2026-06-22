"use client";

// Spec 175 U1 — item-catalog list, grouped by category. U4 added a per-row image
// slot; U5 made the slot consistent (placeholder when empty); U6 added a category
// filter ("ทั้งหมด" + a chip per present category — operator: "select category
// first"). 'use client' justified: the filter selection state. The per-row edit
// control (EditCatalogItem, U3) is rendered here when `editable` — it can't be a
// server-injected render-prop now that this is a client component.

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { RadioChip } from "@/components/features/common/radio-chip";
import type { Database } from "@/lib/db/database.types";
import {
  ITEM_CATEGORY_LABEL,
  CATALOG_STOCKABLE_LABEL,
  CATALOG_NON_STOCKABLE_LABEL,
} from "@/lib/i18n/labels";
import { EditCatalogItem } from "./edit-catalog-item";

type ItemCategory = Database["public"]["Enums"]["item_category"];

export type CatalogItem = {
  id: string;
  category: ItemCategory;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  stockable: boolean;
  note?: string | null;
  // Spec 175 U4 — a signed URL for the item's reference image (minted by the
  // page); null when the item has no image.
  thumbnailUrl?: string | null;
};

const ALL = "all";

export function CatalogList({
  items,
  editable = false,
}: {
  items: CatalogItem[];
  editable?: boolean;
}) {
  const [selected, setSelected] = useState<string>(ALL);

  if (items.length === 0) {
    return <p className="text-ink-secondary text-body">ยังไม่มีรายการวัสดุ</p>;
  }

  // Enum order = the ITEM_CATEGORY_LABEL key order (declared to match the enum).
  const allCategories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];
  const present = allCategories.filter((c) => items.some((it) => it.category === c));
  const visible = selected === ALL ? present : present.filter((c) => c === selected);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="กรองตามหมวดหมู่">
        <RadioChip
          name="catalog-category"
          label={`ทั้งหมด (${items.length})`}
          checked={selected === ALL}
          onSelect={() => setSelected(ALL)}
        />
        {present.map((c) => (
          <RadioChip
            key={c}
            name="catalog-category"
            label={`${ITEM_CATEGORY_LABEL[c]} (${items.filter((it) => it.category === c).length})`}
            checked={selected === c}
            onSelect={() => setSelected(c)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-6">
        {visible.map((cat) => {
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
                    {it.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed URL, same as ZoomablePhoto
                      <img
                        src={it.thumbnailUrl}
                        alt=""
                        className="border-edge size-10 shrink-0 rounded border object-cover"
                      />
                    ) : (
                      // Consistent image slot: a placeholder when the item has no photo,
                      // so every row aligns (operator 2026-06-22).
                      <div
                        role="img"
                        aria-label="ไม่มีรูปภาพ"
                        className="bg-sunk text-ink-muted border-edge flex size-10 shrink-0 items-center justify-center rounded border"
                      >
                        <ImageIcon aria-hidden className="size-5" />
                      </div>
                    )}
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
                    {editable ? <EditCatalogItem item={it} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
