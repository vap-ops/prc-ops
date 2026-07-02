"use client";

// Spec 175 U1 — item-catalog list. Spec 221 U3c — grouped by the managed main
// category (category_id + names from the `categories` prop). Spec 239 U2 (ADR 0066
// / C1):
//   • BROWSE-BY-UNION — an item appears under its PRIMARY category AND every
//     SECONDARY membership (catalog_item_categories), not just the primary.
//   • The subcategory drill is FLATTENED away (0/251 items use it; schema parked).
//   • SEARCH-BY-SYNONYM — the search box also matches the item's search_terms.
// 'use client' justified: the filter selection + search state.

import { useState } from "react";
import { ImageIcon, Search } from "lucide-react";
import { RadioChip } from "@/components/features/common/radio-chip";
import { FIELD_INPUT } from "@/lib/ui/classes";
import { displayName } from "@/lib/i18n/display-name";
import type { Database } from "@/lib/db/database.types";
import type { CatalogUnitOption } from "./catalog-item-form";
import { EditCatalogItem } from "./edit-catalog-item";
import { SetSellRate } from "./set-sell-rate";

// Spec 221 — the managed main categories (id + name). The type now lives in the
// shared loader (src/lib/catalog/categories.ts); re-exported here so the existing
// catalog importers keep their path while the definition is single-sourced.
import type { CatalogCategoryOption } from "@/lib/catalog/categories";
export type { CatalogCategoryOption };

export type CatalogItem = {
  id: string;
  // Spec 221 — the item's PRIMARY (canonical) category FK (catalog_categories.id).
  categoryId: string | null;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  // Spec 214 — the structured 6-digit product code; null when unset.
  productCode?: string | null;
  note?: string | null;
  // Spec 219 — the item's subcategory FK; null/undefined when unset (UI flattened).
  subcategoryId?: string | null;
  // Spec 224 (ADR 0066 D3) — the catalog item facets (for the edit form pre-fill).
  kind: Database["public"]["Enums"]["catalog_item_kind"];
  fulfillmentMode: Database["public"]["Enums"]["catalog_fulfillment_mode"];
  ownerSupplied: boolean;
  // Spec 239 U2 — the SECONDARY category memberships (the item also appears under
  // these). The primary is `categoryId`; this list excludes it.
  secondaryCategoryIds?: string[];
  // Spec 239 U2 — search synonyms / alt names (matched by the search box).
  searchTerms?: string | null;
  // Spec 239 U2-fields — normal days to procure (for the edit-form pre-fill).
  leadTimeDays?: number | null;
  // Spec 175 U4 — a signed URL for the item's reference image; null when none.
  thumbnailUrl?: string | null;
  // Spec 178 U5 — the per-item SELL rate (super_admin only).
  sellRate?: number | null;
};

const ALL = "all";

// Spec 239 U2 — the full set of categories an item is browsable under: primary ∪
// secondaries (de-duplicated). Falls back to just the primary when no secondary
// data is threaded (keeps the existing single-category callers working).
function unionCategoryIds(it: CatalogItem): Set<string> {
  const ids = new Set<string>(it.secondaryCategoryIds ?? []);
  if (it.categoryId) ids.add(it.categoryId);
  return ids;
}

export function CatalogList({
  items,
  categories = [],
  units = [],
  editable = false,
  canSetSellRate = false,
}: {
  items: CatalogItem[];
  categories?: CatalogCategoryOption[];
  units?: CatalogUnitOption[];
  editable?: boolean;
  canSetSellRate?: boolean;
}) {
  const [selectedCat, setSelectedCat] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  if (items.length === 0) {
    return <p className="text-ink-secondary text-body">ยังไม่มีรายการวัสดุ</p>;
  }

  const catName = (id: string) => displayName(categories.find((c) => c.id === id)?.name);

  // Spec 214 / 239 U2 — text search across name, spec, product code and the
  // search-term synonyms. Overrides the category filter.
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const queried = !searching
    ? items
    : items.filter((it) =>
        `${it.baseItem} ${it.specAttrs ?? ""} ${it.productCode ?? ""} ${it.searchTerms ?? ""}`
          .toLowerCase()
          .includes(q),
      );

  // Spec 239 U2 — a category is "present" when SOME (queried) item is browsable
  // under it (primary OR secondary). Order = the loaded `categories` order.
  const present = categories
    .map((c) => c.id)
    .filter((id) => queried.some((it) => unionCategoryIds(it).has(id)));

  const countIn = (id: string) => queried.filter((it) => unionCategoryIds(it).has(id)).length;

  const sections: { key: string; label: string; rows: CatalogItem[] }[] = [];
  if (!searching && selectedCat !== ALL) {
    // Single chosen category: one section of every item browsable under it.
    const rows = queried.filter((it) => unionCategoryIds(it).has(selectedCat));
    if (rows.length) sections.push({ key: selectedCat, label: catName(selectedCat), rows });
  } else {
    // All categories (or search): an item appears under each category it belongs to.
    for (const id of present) {
      const rows = queried.filter((it) => unionCategoryIds(it).has(id));
      if (rows.length) sections.push({ key: id, label: catName(id), rows });
    }
  }

  function renderRow(it: CatalogItem) {
    // Spec 230 (ADR 0066 / S9) — the row's PRIMARY material-category badge (the
    // canonical home). Name from the `categories` prop; null/unresolved → no badge.
    const rowCat = it.categoryId
      ? (categories.find((c) => c.id === it.categoryId)?.name ?? null)
      : null;
    return (
      <li
        key={it.id}
        className="border-edge bg-card rounded-control flex flex-wrap items-center gap-3 border px-4 py-3"
      >
        {it.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, same as ZoomablePhoto
          <img
            src={it.thumbnailUrl}
            alt=""
            className="border-edge size-10 shrink-0 rounded border object-cover"
          />
        ) : (
          <div
            role="img"
            aria-label="ไม่มีรูปภาพ"
            className="bg-sunk text-ink-muted border-edge flex size-10 shrink-0 items-center justify-center rounded border"
          >
            <ImageIcon aria-hidden className="size-5" />
          </div>
        )}
        {/* Feedback 65de06ca — the name is floored at min-w-40 (NOT min-w-0):
            with a no-wrap row the fixed-width unit/price/edit siblings squeezed
            the name to ~1 character per line on a phone. The row wraps instead,
            pushing the control cluster below the name when space runs out. */}
        <span className="min-w-40 flex-1">
          <span className="text-ink text-body block font-semibold">{it.baseItem}</span>
          <span className="text-ink-secondary text-meta block">
            {it.productCode ? (
              <span className="text-ink bg-sunk mr-1.5 rounded px-1.5 py-0.5 font-mono">
                {it.productCode}
              </span>
            ) : null}
            {it.specAttrs}
          </span>
          {rowCat ? (
            <span className="border-edge bg-sunk text-ink-secondary text-meta mt-1 inline-flex max-w-full items-center rounded-full border px-2 py-0.5">
              <span className="truncate">{rowCat}</span>
            </span>
          ) : null}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <span className="text-ink-secondary text-meta">{it.unit}</span>
          {canSetSellRate ? <SetSellRate itemId={it.id} currentRate={it.sellRate ?? null} /> : null}
          {editable ? <EditCatalogItem item={it} categories={categories} units={units} /> : null}
        </span>
      </li>
    );
  }

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
          placeholder="ค้นหาด้วยชื่อ คำพ้อง หรือรหัสสินค้า (เช่น 0101)"
          aria-label="ค้นหาวัสดุ"
          autoComplete="off"
        />
      </div>

      <div
        className="flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto pb-1"
        role="radiogroup"
        aria-label="กรองตามหมวดหมู่"
      >
        <RadioChip
          name="catalog-category"
          label={`ทั้งหมด (${queried.length})`}
          checked={selectedCat === ALL}
          onSelect={() => setSelectedCat(ALL)}
        />
        {present.map((id) => (
          <RadioChip
            key={id}
            name="catalog-category"
            label={`${catName(id)} (${countIn(id)})`}
            checked={selectedCat === id}
            onSelect={() => setSelectedCat(id)}
          />
        ))}
      </div>

      {searching && queried.length === 0 ? (
        <p className="text-ink-secondary text-body">ไม่พบวัสดุที่ค้นหา</p>
      ) : null}

      <div className="flex flex-col gap-6">
        {sections.map((sec) => (
          <section key={sec.key} className="flex flex-col gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">
              {sec.label} <span className="text-ink-muted">({sec.rows.length})</span>
            </h2>
            <ul className="flex flex-col gap-2">{sec.rows.map(renderRow)}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}
