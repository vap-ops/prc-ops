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
import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";
import { InvoiceUploader } from "@/components/features/invoice-uploader";

interface SitePurchaseFormProps {
  workPackageId: string;
  projectId: string;
}

export function SitePurchaseForm({ workPackageId, projectId }: SitePurchaseFormProps) {
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const qty = Number(quantity);
    const validated = validateSitePurchase({
      workPackageId,
      itemDescription: item,
      quantity: qty,
      unit,
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
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecordedId(result.id);
    });
  }

  if (recordedId) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="text-sm font-medium text-emerald-700">
          บันทึกการซื้อแล้ว — แนบใบส่งของ / ใบเสร็จ
        </p>
        <InvoiceUploader purchaseRequestId={recordedId} projectId={projectId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-900">
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
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-zinc-900">
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
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-zinc-900">
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
