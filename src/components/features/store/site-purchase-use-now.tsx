"use client";

// Spec 208 U3b — ซื้อใช้ที่งานนี้เลย (buy & use on this WP now). One action that
// receives a catalogued item into the project store AND immediately issues it to
// THIS work package, via the site_purchase_use_now definer RPC (net Dr 1400/Cr
// 2100 at cost — same as a direct on-site purchase, but routed through the store
// for single-basis costing + traceability). Catalogued items only; an off-catalog
// on-site buy keeps the free-text บันทึกการซื้อหน้างาน path. 'use client': sheet
// state + submit transition + refresh.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { ITEM_CATEGORY_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";
import { sitePurchaseUseNow } from "@/app/store/actions";

type ItemCategory = Database["public"]["Enums"]["item_category"];

export type CatalogPick = {
  id: string;
  category: ItemCategory;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function SitePurchaseUseNow({
  projectId,
  workPackageId,
  catalogItems,
}: {
  projectId: string;
  workPackageId: string;
  catalogItems: CatalogPick[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const qtyNum = Number(qty);
  const costNum = Number(unitCost);
  const canSubmit =
    item !== "" &&
    qty !== "" &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    unitCost !== "" &&
    Number.isFinite(costNum) &&
    costNum >= 0 &&
    !pending;

  const categories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];

  function reset() {
    setItem("");
    setQty("");
    setUnitCost("");
    setNote("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await sitePurchaseUseNow({
        projectId,
        workPackageId,
        catalogItemId: item,
        qty: qtyNum,
        unitCost: costNum,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
        ซื้อเงินสด ใช้ที่งานนี้เลย
      </button>

      <BottomSheet open={open} title="ซื้อเงินสดใช้ที่งานนี้เลย" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Spec 208 U3b option B: cash buys only (no full tax invoice) — booked
              VAT-inclusive. A VAT-invoiced buy uses บันทึกการซื้อหน้างาน instead. */}
          <p className="text-ink-secondary text-meta">
            สำหรับซื้อเงินสดหน้างาน (ไม่มีใบกำกับภาษี) —
            ของจะถูกบันทึกรับเข้าคลังและเบิกเข้างานนี้ในครั้งเดียว หากมีใบกำกับภาษี ให้ใช้
            &quot;บันทึกการซื้อหน้างาน&quot;
          </p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="un-item" className={LABEL}>
              วัสดุ
            </label>
            <select
              id="un-item"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              disabled={pending}
              className={FIELD}
            >
              <option value="">เลือกวัสดุ</option>
              {categories.map((c) => {
                const opts = catalogItems.filter((ci) => ci.category === c);
                if (opts.length === 0) return null;
                return (
                  <optgroup key={c} label={ITEM_CATEGORY_LABEL[c]}>
                    {opts.map((ci) => (
                      <option key={ci.id} value={ci.id}>
                        {ci.baseItem}
                        {ci.specAttrs ? ` · ${ci.specAttrs}` : ""} ({ci.unit})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="un-qty" className={LABEL}>
                จำนวน
              </label>
              <input
                id="un-qty"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={pending}
                className={FIELD}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="un-cost" className={LABEL}>
                ราคาต้นทุน/หน่วย (บาท)
              </label>
              <input
                id="un-cost"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                disabled={pending}
                className={FIELD}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="un-note" className={LABEL}>
              หมายเหตุ (ถ้ามี)
            </label>
            <input
              id="un-note"
              type="text"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
              className={FIELD}
            />
          </div>

          {error ? (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {pending ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
