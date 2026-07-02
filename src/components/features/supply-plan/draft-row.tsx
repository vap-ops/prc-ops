"use client";

// Spec 245 U4 — the shared draft-row sub-component of the supply-plan grid:
// item picker + qty + note + remove-row. Extracted from SupplyPlanManager so
// the stripped-down template editor reuses the SAME row instead of duplicating
// ~150 lines of JSX. The WP column is deliberately NOT part of the shared row —
// it exists only on a project plan: the manager passes its WP select + multi-WP
// panel in via wpSlot; the template editor passes nothing (a template has no
// project or WPs, spec 245 D5).

import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { ScopedCatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";

export type DraftRow = {
  key: number;
  catalogItemId: string;
  workPackageId: string;
  qty: string;
  note: string;
};

export const DRAFT_ROW_LABEL = "text-meta text-ink-secondary font-medium";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action h-11 w-full min-w-0 border px-3 text-sm focus:outline-none focus-visible:ring-2";

let rowSeq = 0;
export function blankRow(): DraftRow {
  rowSeq += 1;
  return { key: rowSeq, catalogItemId: "", workPackageId: "", qty: "", note: "" };
}

export function SupplyPlanDraftRow({
  row,
  catalogItems,
  categories,
  disabled,
  onPatch,
  onDrop,
  scopedCategoryIds,
  membershipsByItem,
  wpSlot,
}: {
  row: DraftRow;
  catalogItems: PurchaseRequestCatalogItem[];
  categories: { id: string; name: string }[];
  disabled: boolean;
  onPatch: (patch: Partial<DraftRow>) => void;
  onDrop: () => void;
  /** Spec 228: the row's WP-scoped material categories (manager only). */
  scopedCategoryIds?: readonly string[] | undefined;
  /** Spec 228: itemId → secondary category ids for the scoped picker. */
  membershipsByItem?: ReadonlyMap<string, Set<string>> | undefined;
  /** The manager's WP column (select + multi-WP panel); absent on a template. */
  wpSlot?: ReactNode;
}) {
  return (
    <div className="border-edge bg-card rounded-control flex flex-col gap-2 border p-3 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-[2] flex-col gap-1">
        <ScopedCatalogItemPicker
          label="วัสดุ"
          items={catalogItems}
          categories={categories}
          selectedId={row.catalogItemId}
          onSelect={(id) => onPatch({ catalogItemId: id })}
          onClear={() => onPatch({ catalogItemId: "" })}
          disabled={disabled}
          scopedCategoryIds={scopedCategoryIds}
          membershipsByItem={membershipsByItem}
        />
      </div>
      {wpSlot}
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-24">
        <label htmlFor={`spl-qty-${row.key}`} className={DRAFT_ROW_LABEL}>
          จำนวน
        </label>
        <input
          id={`spl-qty-${row.key}`}
          aria-label="จำนวน"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={row.qty}
          onChange={(e) => onPatch({ qty: e.target.value })}
          disabled={disabled}
          className={FIELD}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={`spl-note-${row.key}`} className={DRAFT_ROW_LABEL}>
          หมายเหตุ
        </label>
        <input
          id={`spl-note-${row.key}`}
          aria-label="หมายเหตุ"
          type="text"
          maxLength={1000}
          value={row.note}
          onChange={(e) => onPatch({ note: e.target.value })}
          disabled={disabled}
          className={FIELD}
        />
      </div>
      <button
        type="button"
        aria-label="เอาแถวออก"
        disabled={disabled}
        onClick={onDrop}
        className="text-ink-muted hover:text-ink focus-visible:ring-action mb-1 shrink-0 self-end rounded-md p-1 focus:outline-none focus-visible:ring-2"
      >
        <Trash2 aria-hidden className="size-5" />
      </button>
    </div>
  );
}
