"use client";

// Spec 175 U1 — item-catalog list. Spec 219 U3 — a 2-level drill (หมวดหลัก →
// หมวดย่อย). Spec 221 U3c — the main category is now keyed on `categoryId` (the
// managed catalog_categories table) with names from the `categories` prop, NOT
// the item_category enum — so user-created categories appear here too. Search
// overrides the drill. 'use client' justified: the filter selection state.

import { useState } from "react";
import { ImageIcon, Search } from "lucide-react";
import { RadioChip } from "@/components/features/common/radio-chip";
import { FIELD_INPUT } from "@/lib/ui/classes";
import type { CatalogSubcategoryOption, CatalogUnitOption } from "./catalog-item-form";
import { EditCatalogItem } from "./edit-catalog-item";
import { SetSellRate } from "./set-sell-rate";

// Spec 221 — the managed main categories (id + name). The type now lives in the
// shared loader (src/lib/catalog/categories.ts); re-exported here so the existing
// catalog importers keep their path while the definition is single-sourced.
import type { CatalogCategoryOption } from "@/lib/catalog/categories";
export type { CatalogCategoryOption };

export type CatalogItem = {
  id: string;
  // Spec 221 — the item's main category FK (catalog_categories.id).
  categoryId: string | null;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  // Spec 214 — the structured 6-digit product code; null when unset.
  productCode?: string | null;
  note?: string | null;
  // Spec 219 — the item's subcategory FK; null/undefined when unset.
  subcategoryId?: string | null;
  // Spec 175 U4 — a signed URL for the item's reference image; null when none.
  thumbnailUrl?: string | null;
  // Spec 178 U5 — the per-item SELL rate (super_admin only).
  sellRate?: number | null;
};

const ALL = "all";
// Sentinel for the "items with no subcategory" bucket (distinct from a uuid).
const NO_SUB = "__none__";
const NO_SUB_LABEL = "ยังไม่มีหมวดย่อย";

export function CatalogList({
  items,
  categories = [],
  subcategories = [],
  units = [],
  editable = false,
  canSetSellRate = false,
}: {
  items: CatalogItem[];
  categories?: CatalogCategoryOption[];
  subcategories?: CatalogSubcategoryOption[];
  units?: CatalogUnitOption[];
  editable?: boolean;
  canSetSellRate?: boolean;
}) {
  const [selectedCat, setSelectedCat] = useState<string>(ALL);
  const [selectedSub, setSelectedSub] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  if (items.length === 0) {
    return <p className="text-ink-secondary text-body">ยังไม่มีรายการวัสดุ</p>;
  }

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  // Spec 214 — text search across name, spec and product code. Overrides the drill.
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const queried = !searching
    ? items
    : items.filter((it) =>
        `${it.baseItem} ${it.specAttrs ?? ""} ${it.productCode ?? ""}`.toLowerCase().includes(q),
      );

  // Category order = the loaded `categories` order (sort_order, code); only
  // those present in the (queried) items get a chip / section.
  const present = categories
    .map((c) => c.id)
    .filter((id) => queried.some((it) => it.categoryId === id));

  const drillActive = !searching && selectedCat !== ALL;

  const catItems = drillActive ? queried.filter((it) => it.categoryId === selectedCat) : [];
  const catSubs = drillActive ? subcategories.filter((s) => s.categoryId === selectedCat) : [];
  const presentSubs = catSubs.filter((s) => catItems.some((it) => it.subcategoryId === s.id));
  const hasUncoded = catItems.some((it) => !it.subcategoryId);
  const showSubStrip = drillActive && presentSubs.length > 0;

  const visibleCatItems =
    selectedSub === ALL
      ? catItems
      : selectedSub === NO_SUB
        ? catItems.filter((it) => !it.subcategoryId)
        : catItems.filter((it) => it.subcategoryId === selectedSub);

  const sections: { key: string; label: string; rows: CatalogItem[] }[] = [];
  if (drillActive) {
    for (const s of presentSubs) {
      const rows = visibleCatItems.filter((it) => it.subcategoryId === s.id);
      if (rows.length) sections.push({ key: s.id, label: s.name, rows });
    }
    const uncoded = visibleCatItems.filter((it) => !it.subcategoryId);
    if (uncoded.length) sections.push({ key: NO_SUB, label: NO_SUB_LABEL, rows: uncoded });
  } else {
    for (const id of present) {
      const rows = queried.filter((it) => it.categoryId === id);
      if (rows.length) sections.push({ key: id, label: catName(id), rows });
    }
  }

  const subName = (id: string) =>
    id === NO_SUB ? NO_SUB_LABEL : (subcategories.find((s) => s.id === id)?.name ?? id);

  function renderRow(it: CatalogItem) {
    return (
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
        {canSetSellRate ? <SetSellRate itemId={it.id} currentRate={it.sellRate ?? null} /> : null}
        {editable ? (
          <EditCatalogItem
            item={it}
            categories={categories}
            subcategories={subcategories}
            units={units}
          />
        ) : null}
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
          placeholder="ค้นหาด้วยชื่อ หรือรหัสสินค้า (เช่น 0101)"
          aria-label="ค้นหาวัสดุ"
          autoComplete="off"
        />
      </div>

      {drillActive ? (
        <nav aria-label="เส้นทางหมวดหมู่" className="text-meta flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setSelectedCat(ALL);
              setSelectedSub(ALL);
            }}
            className="text-action font-medium"
          >
            ทั้งหมด
          </button>
          <span aria-hidden className="text-ink-muted">
            ›
          </span>
          <button
            type="button"
            onClick={() => setSelectedSub(ALL)}
            className={
              selectedSub === ALL ? "text-ink-secondary font-medium" : "text-action font-medium"
            }
          >
            {catName(selectedCat)}
          </button>
          {selectedSub !== ALL ? (
            <>
              <span aria-hidden className="text-ink-muted">
                ›
              </span>
              <span className="text-ink-secondary font-medium">{subName(selectedSub)}</span>
            </>
          ) : null}
        </nav>
      ) : null}

      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="radiogroup"
        aria-label="กรองตามหมวดหมู่"
      >
        <RadioChip
          name="catalog-category"
          label={`ทั้งหมด (${queried.length})`}
          checked={selectedCat === ALL}
          onSelect={() => {
            setSelectedCat(ALL);
            setSelectedSub(ALL);
          }}
        />
        {present.map((id) => (
          <RadioChip
            key={id}
            name="catalog-category"
            label={`${catName(id)} (${queried.filter((it) => it.categoryId === id).length})`}
            checked={selectedCat === id}
            onSelect={() => {
              setSelectedCat(id);
              setSelectedSub(ALL);
            }}
          />
        ))}
      </div>

      {showSubStrip ? (
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="radiogroup"
          aria-label="กรองตามหมวดย่อย"
        >
          <RadioChip
            name="catalog-subcategory"
            label={`ทุกหมวดย่อย (${catItems.length})`}
            checked={selectedSub === ALL}
            onSelect={() => setSelectedSub(ALL)}
          />
          {presentSubs.map((s) => (
            <RadioChip
              key={s.id}
              name="catalog-subcategory"
              label={`${s.name} (${catItems.filter((it) => it.subcategoryId === s.id).length})`}
              checked={selectedSub === s.id}
              onSelect={() => setSelectedSub(s.id)}
            />
          ))}
          {hasUncoded ? (
            <RadioChip
              name="catalog-subcategory"
              label={`${NO_SUB_LABEL} (${catItems.filter((it) => !it.subcategoryId).length})`}
              checked={selectedSub === NO_SUB}
              onSelect={() => setSelectedSub(NO_SUB)}
            />
          ) : null}
        </div>
      ) : null}

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
