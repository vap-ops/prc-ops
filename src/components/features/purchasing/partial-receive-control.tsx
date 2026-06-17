"use client";

// Spec 134 U3 / ADR 0052 — the "รับบางส่วน" control on an in-transit PO line. The
// buyer records that only part of an ordered quantity arrived; the server splits the
// ticket into a delivered portion + a remaining on_route child. The delivered amount
// prefills proportionally (amount × received / ordered) and is editable for an
// invoice that splits non-proportionally; it renders only for back office (money).
//
// 'use client' justified: a small expanding form + submit state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { splitPurchaseRequestOnReceipt } from "@/app/requests/actions";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

interface PartialReceiveControlProps {
  purchaseRequestId: string;
  orderedQty: number;
  unit: string;
  /** Per-line amount — back office only; null hides the editable amount field. */
  amount: number | null;
}

// Proportional delivered amount for a received quantity, rounded to 2dp (THB).
function proportionalAmount(amount: number, received: number, ordered: number): number {
  if (ordered <= 0) return 0;
  return Math.round(((amount * received) / ordered) * 100) / 100;
}

export function PartialReceiveControl({
  purchaseRequestId,
  orderedQty,
  unit,
  amount,
}: PartialReceiveControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const qtyNum = Number(qty);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0 && qtyNum < orderedQty;

  // Prefill the proportional amount as the quantity changes, until the buyer edits
  // the amount themselves (then their value sticks).
  function onQtyChange(next: string) {
    setQty(next);
    if (amount != null && !amountTouched) {
      const n = Number(next);
      setAmountStr(
        Number.isFinite(n) && n > 0 && n < orderedQty
          ? String(proportionalAmount(amount, n, orderedQty))
          : "",
      );
    }
  }

  function submit() {
    setError(null);
    if (!qtyValid) {
      setError(`จำนวนที่รับต้องมากกว่า 0 และน้อยกว่า ${orderedQty}`);
      return;
    }
    const deliveredAmount = amount != null && amountStr.trim() !== "" ? Number(amountStr) : null;
    if (deliveredAmount != null) {
      if (!Number.isFinite(deliveredAmount) || deliveredAmount < 0) {
        setError("จำนวนเงินไม่ถูกต้อง");
        return;
      }
      // Upper bound: the delivered share can't exceed the line's amount (the RPC
      // re-enforces this; a clear inline message beats the generic failure).
      if (amount != null && deliveredAmount > amount) {
        setError(`มูลค่าที่รับต้องไม่เกิน ${amount} บาท`);
        return;
      }
    }
    startTransition(async () => {
      const result = await splitPurchaseRequestOnReceipt({
        requestId: purchaseRequestId,
        receivedQty: qtyNum,
        deliveredAmount,
        deliveryNote: note.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setQty("");
      setAmountStr("");
      setAmountTouched(false);
      setNote("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY_MUTED}>
        รับบางส่วน
      </button>
    );
  }

  const inputCls =
    "border-edge-strong bg-card text-ink focus-visible:ring-action w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

  return (
    <div className="border-edge bg-sunk flex flex-col gap-2 rounded-md border p-3">
      <label className="text-ink-secondary text-xs font-medium">
        จำนวนที่รับจริง (จากทั้งหมด {orderedQty} {unit})
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={orderedQty}
          value={qty}
          onChange={(e) => onQtyChange(e.target.value)}
          className={`${inputCls} mt-1`}
          placeholder={`เช่น ${Math.max(1, Math.floor(orderedQty / 2))}`}
        />
      </label>
      {amount != null ? (
        <label className="text-ink-secondary text-xs font-medium">
          มูลค่าที่รับ (บาท) — ปรับได้
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={amountStr}
            onChange={(e) => {
              setAmountTouched(true);
              setAmountStr(e.target.value);
            }}
            className={`${inputCls} mt-1`}
          />
        </label>
      ) : null}
      <label className="text-ink-secondary text-xs font-medium">
        หมายเหตุ (ถ้ามี)
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={`${inputCls} mt-1`}
        />
      </label>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !qtyValid}
          className={`${BUTTON_PRIMARY} flex-1`}
        >
          {pending ? "กำลังบันทึก…" : "บันทึกการรับบางส่วน"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className={BUTTON_SECONDARY_MUTED}
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
