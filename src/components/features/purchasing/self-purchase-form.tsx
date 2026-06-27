"use client";

// Spec 211 U11c-B — the unified self-purchase form (one ซื้อเอง flow replacing
// U11a's two cards). The operator's "true unified buy": one form that handles
// every REAL self-purchase combination, routing to the existing VAT-aware RPCs.
//
// Item is catalog-OR-free-text (a mode toggle). VAT is a tax-invoice toggle (→
// Input VAT 1300 reclaimed). "ใช้ที่งานนี้เลย" is offered only for a CATALOG item
// (the store keys on catalog_item_id; a free-text item can't be stock-tracked, so
// it only has the record path — which already books it straight to the WP).
//
// Routing: catalog + use-now → sitePurchaseUseNow (receives into store + issues,
// U11c-A made it VAT-aware); everything else → recordSitePurchase (books the WP,
// then the success state reveals the item-photo + receipt uploaders, U11b).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordSitePurchase } from "@/app/requests/actions";
import { sitePurchaseUseNow } from "@/app/store/actions";
import { validateSitePurchase } from "@/lib/purchasing/validate-site-purchase";
import { PURCHASE_REASON_CODES } from "@/lib/purchasing/reason-code";
import { CATALOG_LABEL, PURCHASE_REQUEST_REASON_CODE_LABEL } from "@/lib/i18n/labels";
import { CatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import { ItemPhotoUploader } from "@/components/features/purchasing/item-photo-uploader";
import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";

const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const LABEL = "text-ink flex flex-col gap-1 text-sm font-medium";
const TOGGLE_ROW = "text-ink flex items-center gap-2 text-sm font-medium";

type Mode = "catalog" | "freetext";

export function SelfPurchaseForm({
  projectId,
  workPackageId,
  catalogItems,
}: {
  projectId: string;
  workPackageId: string;
  catalogItems: PurchaseRequestCatalogItem[];
}) {
  const router = useRouter();
  const hasCatalog = catalogItems.length > 0;
  const [mode, setMode] = useState<Mode>(hasCatalog ? "catalog" : "freetext");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [item, setItem] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const [hasVat, setHasVat] = useState(false);
  const [vatRate, setVatRate] = useState("7");
  const [useNow, setUseNow] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected =
    mode === "catalog" ? (catalogItems.find((c) => c.id === catalogItemId) ?? null) : null;
  // Use-now is a store flow → catalog items only (a free-text item isn't stockable).
  const canUseNow = selected !== null;
  const goUseNow = canUseNow && useNow;

  function reset() {
    setCatalogItemId("");
    setItem("");
    setUnit("");
    setQty("");
    setAmount("");
    setHasVat(false);
    setVatRate("7");
    setUseNow(false);
    setReasonCode("");
    setError(null);
  }

  function submit() {
    setError(null);
    const qtyNum = Number(qty);
    const amountNum = amount.trim() === "" ? null : Number(amount);
    const vat = hasVat ? Number(vatRate) : 0;

    if (goUseNow) {
      // Catalog + use-now: amount is the GROSS cost; the RPC takes a gross unit cost.
      if (!selected) {
        setError(`เลือกสินค้าจาก${CATALOG_LABEL}`);
        return;
      }
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        setError("จำนวนต้องมากกว่า 0");
        return;
      }
      if (amountNum === null || !Number.isFinite(amountNum) || amountNum <= 0) {
        setError("กรุณาระบุจำนวนเงิน");
        return;
      }
      startTransition(async () => {
        const result = await sitePurchaseUseNow({
          projectId,
          workPackageId,
          catalogItemId: selected.id,
          qty: qtyNum,
          unitCost: amountNum / qtyNum,
          note: "",
          vatRate: vat,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        reset();
        router.refresh();
      });
      return;
    }

    // Record path (free-text OR a catalog item not used now): books the WP.
    const itemDescription = selected
      ? `${selected.baseItem}${selected.specAttrs ? ` ${selected.specAttrs}` : ""}`
      : item;
    const unitVal = selected ? selected.unit : unit;
    const validated = validateSitePurchase({
      workPackageId,
      itemDescription,
      quantity: qtyNum,
      unit: unitVal,
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
        itemDescription,
        quantity: qtyNum,
        unit: unitVal,
        amount: amountNum,
        reasonCode: validated.value.reasonCode,
        vatRate: vat,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecordedId(result.id);
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

  return (
    <div className="flex flex-col gap-3">
      {/* Item source — catalog (stockable, can use now) vs free-text (record only). */}
      {hasCatalog ? (
        <div className="flex gap-2" role="group" aria-label="แหล่งที่มาของสินค้า">
          <button
            type="button"
            onClick={() => setMode("catalog")}
            aria-pressed={mode === "catalog"}
            className={`rounded-control border px-3 py-2 text-sm font-medium ${mode === "catalog" ? "border-action bg-action-soft text-action" : "border-edge-strong bg-card text-ink-secondary"}`}
          >
            เลือกจาก{CATALOG_LABEL}
          </button>
          <button
            type="button"
            onClick={() => setMode("freetext")}
            aria-pressed={mode === "freetext"}
            className={`rounded-control border px-3 py-2 text-sm font-medium ${mode === "freetext" ? "border-action bg-action-soft text-action" : "border-edge-strong bg-card text-ink-secondary"}`}
          >
            พิมพ์เอง
          </button>
        </div>
      ) : null}

      {mode === "catalog" ? (
        // Same search picker as สร้างคำขอซื้อ (CatalogItemPicker): a trigger opens a
        // bottom sheet with search + category chips + thumbnail rows. Picking an
        // item drives the description + unit (derived from `selected` below).
        <CatalogItemPicker
          items={catalogItems}
          selectedId={catalogItemId}
          onSelect={setCatalogItemId}
          onClear={() => {
            setCatalogItemId("");
            setUseNow(false);
          }}
          disabled={pending}
        />
      ) : (
        <>
          <label className={LABEL}>
            รายการที่ซื้อ
            <input
              type="text"
              value={item}
              maxLength={500}
              onChange={(e) => setItem(e.target.value)}
              disabled={pending}
              className={FIELD_INPUT}
              placeholder="ปูนถุง 50 กก."
            />
          </label>
          <label className={LABEL}>
            หน่วย
            <input
              type="text"
              value={unit}
              maxLength={40}
              onChange={(e) => setUnit(e.target.value)}
              disabled={pending}
              className={FIELD_INPUT}
              placeholder="ถุง"
            />
          </label>
        </>
      )}

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

      {/* Use-now — catalog items only (a free-text item can't be stock-tracked). */}
      {canUseNow ? (
        <label className={TOGGLE_ROW}>
          <input
            type="checkbox"
            checked={useNow}
            onChange={(e) => setUseNow(e.target.checked)}
            disabled={pending}
            className="size-4"
          />
          ซื้อเข้าคลังแล้วใช้ที่งานนี้เลย
        </label>
      ) : null}

      {/* Reason — only the record path needs it (use-now doesn't create a PR). */}
      {!goUseNow ? (
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
      ) : null}

      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
      <button type="button" onClick={submit} disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? "กำลังบันทึก…" : goUseNow ? "ซื้อใช้ที่งานนี้เลย" : "บันทึกการซื้อ"}
      </button>
    </div>
  );
}
