"use client";

// Spec 180 (pro-max UX) — the purchase-request material picker. The PR item is
// catalog-only (spec 175 master), so this replaces the free-text box with a
// search-driven picker in the app's BottomSheet idiom (same as เบิก / stock):
// a trigger opens a sheet with a pinned search, category filter chips (spec 221:
// the MANAGED catalog_categories, grouped by category_id), and thumbnail rows with the
// matched text highlighted. Picking links catalog_item_id and the parent form
// derives the description + unit. An item not in the catalog is registered first
// at ตั้งค่า → แคตตาล็อก (no inline add) — a no-match search points there.
//
// Spec 228 (ADR 0066 / S7, D5/D8) — ScopedCatalogItemPicker: an optional
// `scopedCategoryIds` (the WP work-category's Relation-R material categories) +
// the item membership union surface the relevant items FIRST and pre-filter to
// them, but NEVER hide the rest — an always-present "แสดงทั้งหมด" escape clears
// the scope, and an empty/absent scope falls back to the full catalog. The
// ordering/flagging lives in the pure `scopeCatalogItems` helper.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ImageIcon, Search } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { RadioChip } from "@/components/features/common/radio-chip";
import { FIELD_INPUT } from "@/lib/ui/classes";
import { scopeCatalogItems } from "@/lib/catalog/scoped-picker";
import { WORK_CATEGORY_MATCH_LABEL } from "@/lib/i18n/labels";
import type { PurchaseRequestCatalogItem } from "./purchase-request-form";

const ALL = "all";
// Sentinel for the "items with no managed category" bucket (distinct from a uuid).
const UNCAT = "__uncat__";
const UNCAT_LABEL = "ไม่ระบุหมวด";
// Spec 228: a stable empty membership map for the unscoped show-all fallback.
const EMPTY_MEMBERSHIPS: ReadonlyMap<string, Set<string>> = new Map();

function itemLabel(item: PurchaseRequestCatalogItem): string {
  return item.baseItem + (item.specAttrs ? ` ${item.specAttrs}` : "");
}

// Wrap the matched substring (case-insensitive) so the requester sees WHY a row
// matched. Returns the label unchanged when the query is empty / not found.
function highlight(text: string, query: string) {
  if (query.length === 0) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return (
    <Fragment>
      {text.slice(0, idx)}
      <span className="text-action font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </Fragment>
  );
}

function Thumb({ url }: { url: string | null | undefined }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed URL, same as the catalog list
    <img src={url} alt="" className="border-edge size-10 shrink-0 rounded border object-cover" />
  ) : (
    <div
      role="img"
      aria-label="ไม่มีรูปภาพ"
      className="bg-sunk text-ink-muted border-edge flex size-10 shrink-0 items-center justify-center rounded border"
    >
      <ImageIcon aria-hidden className="size-5" />
    </div>
  );
}

export function ScopedCatalogItemPicker({
  items,
  categories,
  selectedId,
  onSelect,
  onClear,
  disabled = false,
  label = "รายการวัสดุ",
  scopedCategoryIds,
  membershipsByItem,
}: {
  items: PurchaseRequestCatalogItem[];
  /** Spec 221 cleanup: the managed main categories (ordered, id + name). Chips
   *  group items by category_id and label with the managed name. */
  categories: { id: string; name: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClear: () => void;
  disabled?: boolean;
  /** Field label above the trigger (the supply-plan grid passes "วัสดุ"). */
  label?: string;
  /** Spec 228 (ADR 0066 D5/D8): the WP work-category's Relation-R material
   *  categories. Non-empty → surface those items first + pre-filter to them with
   *  an always-present "แสดงทั้งหมด" escape; empty/absent → the full catalog
   *  (show-all fallback). The PR/self-purchase forms pass nothing (unscoped). */
  scopedCategoryIds?: readonly string[] | undefined;
  /** Spec 228: itemId → its secondary category ids (the S4 canonical∪secondary
   *  union source), so an item linked secondarily to a scoped category surfaces. */
  membershipsByItem?: ReadonlyMap<string, Set<string>> | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  // Spec 228: clears the scope pre-filter (the แสดงทั้งหมด escape).
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null;

  // Spec 221 cleanup — category chips: ทั้งหมด + each MANAGED category that has
  // items (group by category_id), in the prop's order, labelled by name. A
  // ไม่ระบุหมวด bucket is appended only when some item has no category_id.
  const present = categories.filter((c) => items.some((i) => i.categoryId === c.id));
  const hasUncategorised = items.some((i) => i.categoryId === null);

  const q = query.trim().toLowerCase();

  // Spec 228 — order + flag the catalog against the WP work-category's scope:
  // in-scope items first, the rest still present. Empty/absent scope → the full
  // catalog in order (D8 show-all fallback).
  const scoped = useMemo(
    () => scopeCatalogItems(items, membershipsByItem ?? EMPTY_MEMBERSHIPS, scopedCategoryIds),
    [items, membershipsByItem, scopedCategoryIds],
  );
  // Pre-filter to in-scope only when the scope actually has matches — otherwise
  // show everything (never an empty picker). The แสดงทั้งหมด escape clears it.
  const scopeActive = scoped.scoped && scoped.inScopeCount > 0;
  const baseEntries =
    scopeActive && !showAll ? scoped.entries.filter((e) => e.inScope) : scoped.entries;

  const matches = baseEntries.filter(
    ({ item: i }) =>
      (category === ALL ||
        (category === UNCAT ? i.categoryId === null : i.categoryId === category)) &&
      // Spec 214: the product code joins the haystack, so typing a code prefix
      // (e.g. 0101) filters to it.
      `${i.baseItem} ${i.specAttrs ?? ""} ${i.unit} ${i.productCode ?? ""}`
        .toLowerCase()
        .includes(q),
  );

  // Focus the search when the sheet opens. rAF runs after the BottomSheet's own
  // focus-on-open (which moves focus to the panel) so the input keeps it.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    setCategory(ALL);
    setShowAll(false);
  }
  function choose(id: string) {
    onSelect(id);
    close();
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-ink text-sm font-medium">{label}</span>

      {selected ? (
        <div className="rounded-control border-edge-strong bg-card flex items-center gap-3 border px-3 py-2">
          <Thumb url={selected.thumbnailUrl} />
          <span className="min-w-0 flex-1">
            <span className="text-ink block text-sm font-medium">{itemLabel(selected)}</span>
            <span className="text-ink-secondary text-meta block">
              {selected.categoryId ? `${selected.categoryName} · ` : ""}
              {selected.unit}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(true);
            }}
            disabled={disabled}
            className="text-action focus-visible:ring-action shrink-0 rounded text-sm font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
          >
            เปลี่ยน
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="rounded-control border-edge-strong bg-card text-ink-secondary hover:bg-page focus-visible:ring-action flex h-11 w-full items-center gap-2 border px-3 text-left text-sm shadow-xs focus:outline-none focus-visible:ring-2"
        >
          <Search aria-hidden className="text-ink-muted size-5 shrink-0" />
          เลือกวัสดุจากแคตตาล็อก
        </button>
      )}

      <BottomSheet open={open} title="เลือกวัสดุ" onClose={close}>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search
              aria-hidden
              className="text-ink-muted pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${FIELD_INPUT} pl-10`}
              placeholder="ค้นหาวัสดุ"
              aria-label="ค้นหาวัสดุ"
              autoComplete="off"
            />
          </div>

          {present.length + (hasUncategorised ? 1 : 0) > 1 ? (
            <div
              role="radiogroup"
              aria-label="กรองตามหมวดหมู่"
              // Tapping a category focuses its (sr-only) radio. BottomSheet's
              // onFocus centers any focused control via scrollIntoView — fine for
              // the search input (keyboard), but on a chip it scrolls the result
              // list up under the finger, so the follow-through tap lands on a
              // result row ("category turns into item selection", operator
              // 2026-06-23). Stop the chip focus from reaching that handler — the
              // radio still focuses, the sheet just doesn't re-center on it.
              onFocusCapture={(e) => e.stopPropagation()}
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            >
              <RadioChip
                name="pr-catalog-category"
                label="ทั้งหมด"
                checked={category === ALL}
                onSelect={() => setCategory(ALL)}
                className="shrink-0 whitespace-nowrap"
              />
              {present.map((c) => (
                <RadioChip
                  key={c.id}
                  name="pr-catalog-category"
                  label={c.name}
                  checked={category === c.id}
                  onSelect={() => setCategory(c.id)}
                  className="shrink-0 whitespace-nowrap"
                />
              ))}
              {hasUncategorised ? (
                <RadioChip
                  name="pr-catalog-category"
                  label={UNCAT_LABEL}
                  checked={category === UNCAT}
                  onSelect={() => setCategory(UNCAT)}
                  className="shrink-0 whitespace-nowrap"
                />
              ) : null}
            </div>
          ) : null}

          {/* Spec 228 (ADR 0066 D8): the scope pre-filters to the งาน's materials
              but NEVER hides the rest — this always-present escape clears it. */}
          {scopeActive ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-action text-meta focus-visible:ring-action self-start rounded font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
            >
              {showAll ? "เฉพาะที่ตรงกับงาน" : "แสดงทั้งหมด"}
            </button>
          ) : null}

          {matches.length > 0 ? (
            <ul className="flex flex-col">
              {matches.map(({ item: i, inScope }) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => choose(i.id)}
                    className="border-edge hover:bg-page focus-visible:ring-action flex w-full items-center gap-3 border-b px-1 py-2.5 text-left last:border-b-0 focus:outline-none focus-visible:ring-2"
                  >
                    <Thumb url={i.thumbnailUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="text-ink block text-sm">
                        {highlight(itemLabel(i), q)}{" "}
                        <span className="text-ink-secondary">({i.unit})</span>
                      </span>
                      <span className="text-ink-muted text-meta block">
                        {i.productCode ? (
                          <span className="text-ink bg-sunk mr-1.5 rounded px-1.5 py-0.5 font-mono">
                            {i.productCode}
                          </span>
                        ) : null}
                        {i.categoryId ? i.categoryName : UNCAT_LABEL}
                        {/* Spec 228: relevance flag — this item belongs to the
                            WP work-category's material scope (Relation R). */}
                        {inScope ? (
                          <span className="text-done-strong ml-1.5 inline-flex items-center gap-0.5 font-medium">
                            <Check aria-hidden className="size-3.5" /> {WORK_CATEGORY_MATCH_LABEL}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="border-edge-strong rounded-control flex items-start gap-3 border border-dashed px-3 py-4">
              <ImageIcon aria-hidden className="text-ink-muted mt-0.5 size-5 shrink-0" />
              <p className="text-ink-secondary text-sm">
                ไม่พบวัสดุที่ค้นหา — เพิ่มวัสดุที่{" "}
                <Link
                  href="/catalog"
                  className="text-action font-medium underline underline-offset-2"
                >
                  ตั้งค่า → แคตตาล็อก
                </Link>
              </p>
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
