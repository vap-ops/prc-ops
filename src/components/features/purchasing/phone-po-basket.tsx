"use client";

// Spec 118 — phone PO creation, the "add-to-PO basket" model (operator-picked).
// On the phone worklist, the to_order (approved) tickets render here as compact
// cards with a "เพิ่มเข้าใบสั่งซื้อ" toggle; added ones ride a floating basket bar
// (above the tab bar) that opens the checkout sheet — the same create-PO form as
// desktop, docked at the bottom (the right phone idiom). Browse → add → checkout.
//
// 'use client': basket selection state + the sheet toggle. A sibling of the
// server-rendered worklist; it owns only the to_order band. All data in is the
// serializable ProcurementGridRecord the page already builds for the grid.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Plus, ShoppingCart } from "lucide-react";
import { StatusPill } from "@/components/features/common/status-pill";
import { purchaseRequestStatusPillClasses } from "@/lib/status-colors";
import { purchaseRequestStatusIcon } from "@/lib/status-icons";
import { PURCHASE_REQUEST_STATUS_LABEL } from "@/lib/i18n/labels";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import { WpCategoryCode } from "@/components/features/work-packages/wp-category-code";
import { BUTTON_SECONDARY } from "@/lib/ui/classes";
import type { SupplierOption } from "@/lib/purchasing/supplier-option";
import type { ProcurementGridRecord } from "@/components/features/purchasing/procurement-grid";
import {
  CreatePurchaseOrderSheet,
  type CreatePoLine,
} from "@/components/features/purchasing/create-purchase-order-sheet";
import { suggestVendorsForCategories } from "@/lib/purchasing/vendor-suggestion";

const IN_BASKET_BTN =
  "inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-control border border-action bg-action-soft px-4 text-body font-semibold text-action transition-colors active:translate-y-px";

export function PhonePoBasket({
  records,
  suppliers,
  categoryVendors = {},
}: {
  records: ReadonlyArray<ProcurementGridRecord>;
  suppliers: ReadonlyArray<SupplierOption>;
  // Spec 280 U1: categoryId → vendors who've supplied it before (ranked).
  categoryVendors?: Record<string, string[]>;
}) {
  const [basket, setBasket] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    setBasket((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function removeLine(id: string) {
    setBasket((prev) => {
      const next = new Set(prev);
      next.delete(id);
      if (next.size === 0) setOpen(false);
      return next;
    });
  }

  const lines = useMemo<CreatePoLine[]>(
    () =>
      records
        .filter((r) => basket.has(r.id))
        .map((r) => ({
          id: r.id,
          pr_number: r.pr_number,
          item_description: r.item_description,
          quantity: r.quantity,
          unit: r.unit,
          wp_code: r.wp_code,
          wp_category_code: r.wp_category_code,
        })),
    [records, basket],
  );

  // Spec 280 U1: suggest suppliers for the checkout sheet from the material
  // categories of the basketed lines (union, ranked by coverage).
  const suggestedSupplierIds = useMemo(
    () =>
      suggestVendorsForCategories(
        categoryVendors,
        records.filter((r) => basket.has(r.id)).map((r) => r.category_id),
      ),
    [categoryVendors, records, basket],
  );

  return (
    <>
      <ul className="flex flex-col gap-2">
        {records.map((r) => {
          const inBasket = basket.has(r.id);
          return (
            <li
              key={r.id}
              className={`rounded-card bg-card shadow-card border p-3 transition-colors ${
                inBasket ? "border-action bg-action-soft" : "border-edge"
              }`}
            >
              <Link href={`/requests/${r.id}`} className="flex min-w-0 flex-col gap-1">
                <span className="text-ink font-medium break-words">{r.item_description}</span>
                <span className="text-ink-muted text-meta">
                  {r.pr_number ? (
                    <span className="font-mono">{formatPrNumber(r.pr_number)}</span>
                  ) : null}
                  {r.wp_code ? (
                    <span>
                      {" · "}
                      <WpCategoryCode code={r.wp_code} categoryCode={r.wp_category_code} />
                    </span>
                  ) : null}{" "}
                  · {r.quantity} {r.unit}
                </span>
                <span className="mt-0.5">
                  <StatusPill
                    pillClasses={purchaseRequestStatusPillClasses(r.status)}
                    icon={purchaseRequestStatusIcon(r.status)}
                  >
                    {PURCHASE_REQUEST_STATUS_LABEL[r.status]}
                  </StatusPill>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => toggle(r.id)}
                aria-pressed={inBasket}
                className={inBasket ? IN_BASKET_BTN : `${BUTTON_SECONDARY} mt-2.5 w-full`}
              >
                {inBasket ? (
                  <>
                    <Check aria-hidden className="size-4" />
                    อยู่ในใบสั่งซื้อ · แตะเพื่อนำออก
                  </>
                ) : (
                  <>
                    <Plus aria-hidden className="size-4" />
                    เพิ่มเข้าใบสั่งซื้อ
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Floating basket bar — above the fixed bottom tab bar on phone (4rem +
          safe area); near the bottom on tablet (no tab bar there); the desktop
          grid owns bundling at lg, so this hides at lg. */}
      {basket.size > 0 ? (
        <>
          <div aria-hidden className="h-16" />
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 sm:bottom-4 lg:hidden">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="bg-fill text-on-fill shadow-card hover:bg-fill-press focus-visible:ring-action rounded-card mx-auto flex min-h-11 w-full max-w-lg items-center justify-between gap-3 px-4 py-3 font-semibold transition-colors focus:outline-none focus-visible:ring-2 active:translate-y-px"
            >
              <span className="flex items-center gap-2">
                <ShoppingCart aria-hidden className="size-5" />
                ใบสั่งซื้อ · {basket.size} รายการ
              </span>
              <span className="flex items-center gap-1">
                ดำเนินการ
                <ArrowRight aria-hidden className="size-4" />
              </span>
            </button>
          </div>
        </>
      ) : null}

      <CreatePurchaseOrderSheet
        open={open}
        lines={lines}
        suppliers={suppliers}
        suggestedSupplierIds={suggestedSupplierIds}
        onClose={() => setOpen(false)}
        onRemoveLine={removeLine}
        onCreated={() => {
          setOpen(false);
          setBasket(new Set());
        }}
      />
    </>
  );
}
