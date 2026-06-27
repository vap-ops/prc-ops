"use client";

// Spec 66 / ADR 0043 — record an on-site cash purchase (ซื้อหน้างาน).
// Two phases in one flow so the receipt has a home the moment the
// purchase is logged: (1) item + qty/unit → recordSitePurchase; (2) on
// success, reveal the InvoiceUploader for the new request id. The card
// for the new site purchase also appears in the WP's request list (the
// page refreshes when a receipt lands).
//
// 'use client' justified: form state + useTransition.

import { useState, useTransition } from "react";
import { recordSitePurchase } from "@/app/requests/actions";
import { validateSitePurchase } from "@/lib/purchasing/validate-site-purchase";
import { PURCHASE_REASON_CODES } from "@/lib/purchasing/reason-code";
import { PURCHASE_REQUEST_REASON_CODE_LABEL } from "@/lib/i18n/labels";
import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";
import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import { ItemPhotoUploader } from "@/components/features/purchasing/item-photo-uploader";

interface SitePurchaseFormProps {
  workPackageId: string;
  projectId: string;
}

export function SitePurchaseForm({ workPackageId, projectId }: SitePurchaseFormProps) {
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [amount, setAmount] = useState("");
  // Spec 176 U4: required reactive-reason — no preselect (empty = unchosen).
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const qty = Number(quantity);
    const parsedAmount = amount.trim() === "" ? null : Number(amount);
    const validated = validateSitePurchase({
      workPackageId,
      itemDescription: item,
      quantity: qty,
      unit,
      amount: parsedAmount,
      reasonCode: reasonCode.length > 0 ? reasonCode : null,
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
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecordedId(result.id);
    });
  }

  if (recordedId) {
    // Spec 211 U11b: a self-purchase carries TWO image types — the item photo
    // (รูปสินค้า) and the receipt/invoice docs.
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
      <label className="text-ink flex flex-col gap-1 text-sm font-medium">
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
      <div className="flex gap-2">
        <label className="text-ink flex flex-1 flex-col gap-1 text-sm font-medium">
          จำนวน
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={pending}
            className={FIELD_INPUT}
            placeholder="10"
          />
        </label>
        <label className="text-ink flex flex-1 flex-col gap-1 text-sm font-medium">
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
      </div>
      {/* Spec 103: optional amount — feeds dashboard material spend. */}
      <label className="text-ink flex flex-col gap-1 text-sm font-medium">
        จำนวนเงิน (บาท, ไม่บังคับ)
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
      {/* Spec 176 U4: required reactive-reason tag. */}
      <label htmlFor="sp-reason" className="text-ink flex flex-col gap-1 text-sm font-medium">
        เหตุผลที่ต้องสั่งซื้อ
        <select
          id="sp-reason"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          disabled={pending}
          className="rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
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
