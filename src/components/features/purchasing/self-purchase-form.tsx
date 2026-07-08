"use client";

// Spec 285 U1 — the on-site self-purchase is now an EXPENSE: catalog-only (no
// free-text — a site expense must reference a managed material) and amount is
// REQUIRED (an expense must carry a cost). It always records via
// recordSitePurchase (the attachable path) and the success state reveals the
// item-photo + receipt uploaders. The instant "ใช้ที่งานนี้เลย" store shortcut
// (site_purchase_use_now) is out of the expense flow (spec 285; it cannot carry
// the required receipt evidence). The ask-procurement PR (สร้างคำขอซื้อ) stays a
// separate affordance — see the split in spec 285 U3.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordSitePurchase } from "@/app/requests/actions";
import { validateSitePurchase } from "@/lib/purchasing/validate-site-purchase";
import { PURCHASE_REASON_CODES } from "@/lib/purchasing/reason-code";
import { CATALOG_LABEL, PURCHASE_REQUEST_REASON_CODE_LABEL } from "@/lib/i18n/labels";
import { ScopedCatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import { ItemPhotoUploader } from "@/components/features/purchasing/item-photo-uploader";
import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";

const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const LABEL = "text-ink flex flex-col gap-1 text-sm font-medium";
const TOGGLE_ROW = "text-ink flex items-center gap-2 text-sm font-medium";

export function SelfPurchaseForm({
  projectId,
  workPackageId,
  catalogItems,
  categories,
}: {
  projectId: string;
  workPackageId: string;
  catalogItems: PurchaseRequestCatalogItem[];
  // Spec 221 cleanup: the managed main categories (ordered, id + name) for the
  // shared catalog picker — group by category_id, label with the managed name.
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [catalogItemId, setCatalogItemId] = useState("");
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const [hasVat, setHasVat] = useState(false);
  const [vatRate, setVatRate] = useState("7");
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = catalogItems.find((c) => c.id === catalogItemId) ?? null;

  function submit() {
    setError(null);
    const qtyNum = Number(qty);
    const amountNum = amount.trim() === "" ? null : Number(amount);
    const vat = hasVat ? Number(vatRate) : 0;

    // Catalog-only: an expense must reference a managed material.
    if (!selected) {
      setError(`เลือกสินค้าจาก${CATALOG_LABEL}`);
      return;
    }
    const itemDescription = `${selected.baseItem}${selected.specAttrs ? ` ${selected.specAttrs}` : ""}`;
    const validated = validateSitePurchase({
      workPackageId,
      itemDescription,
      quantity: qtyNum,
      unit: selected.unit,
      amount: amountNum,
      reasonCode: reasonCode.length > 0 ? reasonCode : null,
      vatRate: vat,
    });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    startTransition(async () => {
      const result = await recordSitePurchase({
        workPackageId,
        itemDescription: validated.value.itemDescription,
        quantity: validated.value.quantity,
        unit: validated.value.unit,
        amount: validated.value.amount,
        reasonCode: validated.value.reasonCode,
        vatRate: validated.value.vatRate,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecordedId(result.id);
      router.refresh();
    });
  }

  if (recordedId) {
    // Record path success — a self-purchase carries the item photo + the docs (U11b).
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-done-strong text-sm font-medium">
          บันทึกการซื้อแล้ว — แนบรูปสินค้า และใบส่งของ / ใบเสร็จ
        </p>
        <ItemPhotoUploader purchaseRequestId={recordedId} projectId={projectId} />
        <InvoiceUploader purchaseRequestId={recordedId} projectId={projectId} />
      </div>
    );
  }

  // Catalog-only expense: with an empty catalog there is nothing to record against.
  if (catalogItems.length === 0) {
    return (
      <p className="text-meta text-ink-secondary">
        ยังไม่มีสินค้าใน{CATALOG_LABEL} — เพิ่มก่อนจึงบันทึกค่าใช้จ่ายได้
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Same search picker as สร้างคำขอซื้อ (CatalogItemPicker): a trigger opens a
          bottom sheet with search + category chips + thumbnail rows. Picking an
          item drives the description + unit (derived from `selected` above). */}
      <ScopedCatalogItemPicker
        items={catalogItems}
        categories={categories}
        selectedId={catalogItemId}
        onSelect={setCatalogItemId}
        onClear={() => setCatalogItemId("")}
        disabled={pending}
      />

      <div className="flex gap-2">
        <label className={`flex-1 ${LABEL}`}>
          จำนวน
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            disabled={pending}
            className={FIELD_INPUT}
            placeholder="10"
          />
        </label>
        <label className={`flex-1 ${LABEL}`}>
          จำนวนเงิน (บาท)
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            className={FIELD_INPUT}
            placeholder="1500"
          />
        </label>
      </div>

      {/* VAT (tax invoice) — splits reclaimable Input VAT (1300). */}
      <label className={TOGGLE_ROW}>
        <input
          type="checkbox"
          checked={hasVat}
          onChange={(e) => setHasVat(e.target.checked)}
          disabled={pending}
          className="size-4"
        />
        มีใบกำกับภาษี (แยกภาษีซื้อ)
      </label>
      {hasVat ? (
        <label className={LABEL}>
          อัตราภาษี (%)
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="any"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
            disabled={pending}
            className={FIELD_INPUT}
          />
        </label>
      ) : null}

      <label htmlFor="sp-reason" className={LABEL}>
        เหตุผลที่ต้องซื้อ
        <select
          id="sp-reason"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          disabled={pending}
          className={SELECT}
        >
          <option value="" disabled>
            เลือกเหตุผล
          </option>
          {PURCHASE_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {PURCHASE_REQUEST_REASON_CODE_LABEL[code]}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
      <button type="button" onClick={submit} disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? "กำลังบันทึก…" : "บันทึกการซื้อ"}
      </button>
    </div>
  );
}
