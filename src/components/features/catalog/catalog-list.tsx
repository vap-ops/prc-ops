"use client";

// Spec 175 U1 — item-catalog list, grouped by category. U4 added a per-row image
// slot; U5 made the slot consistent (placeholder when empty); U6 added a category
// filter ("ทั้งหมด" + a chip per present category — operator: "select category
// first"). 'use client' justified: the filter selection state. The per-row edit
// control (EditCatalogItem, U3) is rendered here when `editable` — it can't be a
// server-injected render-prop now that this is a client component.

import { useState } from "react";
import { ImageIcon, Search } from "lucide-react";
import { RadioChip } from "@/components/features/common/radio-chip";
import { FIELD_INPUT } from "@/lib/ui/classes";
import type { Database } from "@/lib/db/database.types";
import { ITEM_CATEGORY_LABEL } from "@/lib/i18n/labels";
import { EditCatalogItem } from "./edit-catalog-item";
import { SetSellRate } from "./set-sell-rate";

type ItemCategory = Database["public"]["Enums"]["item_category"];

export type CatalogItem = {
  id: string;
  category: ItemCategory;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  // Spec 214 — the structured 6-digit product code; null when unset.
  productCode?: string | null;
  note?: string | null;
  // Spec 175 U4 — a signed URL for the item's reference image (minted by the
  // page); null when the item has no image.
  thumbnailUrl?: string | null;
  // Spec 178 U5 — the per-item SELL rate (baht/unit); only populated for
  // super_admin (the page reads it via the admin client). undefined for everyone
  // else — the rate is margin-sensitive and never leaves the server for them.
  sellRate?: number | null;
};

const ALL = "all";

export function CatalogList({
  items,
  editable = false,
  canSetSellRate = false,
}: {
  items: CatalogItem[];
  editable?: boolean;
  canSetSellRate?: boolean;
}) {
  const [selected, setSelected] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  if (items.length === 0) {
    return <p className="text-ink-secondary text-body">ยังไม่มีรายการวัสดุ</p>;
  }

  // Spec 214 — text search across name, spec and product code, so typing a code
  // prefix (e.g. 0101) filters to it. Applied before the category grouping.
  const q = query.trim().toLowerCase();
  const queried =
    q === ""
      ? items
      : items.filter((it) =>
          `${it.baseItem} ${it.specAttrs ?? ""} ${it.productCode ?? ""}`.toLowerCase().includes(q),
        );

  // Enum order = the ITEM_CATEGORY_LABEL key order (declared to match the enum).
  const allCategories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];
  const present = allCategories.filter((c) => queried.some((it) => it.category === c));
  const visible = selected === ALL ? present : present.filter((c) => c === selected);

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Search
          aria-hidden
          className="text-ink-muted pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${FIELD_INPUT} pl-10`}
          placeholder="ค้นหาด้วยชื่อ หรือรหัสสินค้า (เช่น 0101)"
          aria-label="ค้นหาวัสดุ"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="กรองตามหมวดหมู่">
        <RadioChip
          name="catalog-category"
          label={`ทั้งหมด (${queried.length})`}
          checked={selected === ALL}
          onSelect={() => setSelected(ALL)}
        />
        {present.map((c) => (
          <RadioChip
            key={c}
            name="catalog-category"
            label={`${ITEM_CATEGORY_LABEL[c]} (${queried.filter((it) => it.category === c).length})`}
            checked={selected === c}
            onSelect={() => setSelected(c)}
          />
        ))}
      </div>

      {queried.length === 0 ? (
        <p className="text-ink-secondary text-body">ไม่พบวัสดุที่ค้นหา</p>
      ) : null}

      <div className="flex flex-col gap-6">
        {visible.map((cat) => {
          const rows = queried.filter((it) => it.category === cat);
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
                      <span className="text-ink-secondary text-meta block">
                        {it.productCode ? (
                          <span className="text-ink bg-sunk mr-1.5 rounded px-1.5 py-0.5 font-mono">
                            {it.productCode}
                          </span>
                        ) : null}
                        {it.specAttrs}
                      </span>
                    </span>
                    <span className="text-ink-secondary text-meta shrink-0">{it.unit}</span>
                    {canSetSellRate ? (
                      <SetSellRate itemId={it.id} currentRate={it.sellRate ?? null} />
                    ) : null}
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
