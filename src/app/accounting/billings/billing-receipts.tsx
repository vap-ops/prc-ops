"use client";

// Spec 249 U2 — per-billing เงินรับ drawer. 'use client' justified: sheet open
// state, controlled record form, submit pending, inline error. The server
// action + the SECURITY DEFINER RPC are the load-bearing validators.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { RECEIPT_METHOD_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { recordClientReceipt } from "./actions";

const FIELD =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const LABEL = "text-sm font-medium text-ink";

export interface ReceiptListRow {
  id: string;
  amount: number;
  receivedDate: string;
  method: string;
  note: string | null;
}

export function BillingReceipts({
  billingId,
  projectId,
  receipts,
  received,
  outstanding,
  canWrite,
}: {
  billingId: string;
  projectId: string;
  receipts: ReceiptListRow[];
  received: number;
  outstanding: number | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const amountNum = Number(amount);
  const canSubmit =
    amountNum > 0 && Number.isFinite(amountNum) && receivedDate !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await recordClientReceipt({
        projectId,
        billingId,
        amount: amountNum,
        receivedDate,
        method,
        note: note || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAmount("");
      setReceivedDate("");
      setMethod("bank_transfer");
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="border-edge mt-2 border-t pt-2">
      <div className="text-ink-secondary flex items-center justify-between gap-3 text-xs">
        <span>
          รับแล้ว <span className="text-ink font-semibold tabular-nums">{baht(received)}</span>
          {outstanding !== null ? (
            <>
              {" · ค้างรับ "}
              <span
                className={`font-semibold tabular-nums ${outstanding > 0 ? "text-attn-ink" : "text-done-strong"}`}
              >
                {baht(outstanding)}
              </span>
            </>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-action shrink-0 text-xs font-semibold underline-offset-2 hover:underline"
        >
          เงินรับ ({receipts.length})
        </button>
      </div>

      <BottomSheet open={open} title="เงินรับของงวดนี้" onClose={() => setOpen(false)}>
        {receipts.length === 0 ? (
          <p className="text-ink-muted py-2 text-sm">ยังไม่มีเงินรับ</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {receipts.map((r) => (
              <li
                key={r.id}
                className="rounded-control bg-sunk flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-ink">
                    {formatThaiDate(r.receivedDate)} ·{" "}
                    {RECEIPT_METHOD_LABEL[r.method as keyof typeof RECEIPT_METHOD_LABEL] ??
                      r.method}
                  </p>
                  {r.note ? <p className="text-ink-muted truncate text-xs">{r.note}</p> : null}
                </div>
                <p className="text-ink shrink-0 font-semibold tabular-nums">{baht(r.amount)}</p>
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <form onSubmit={handleSubmit} className="border-edge flex flex-col gap-4 border-t pt-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`rc-amount-${billingId}`} className={LABEL}>
                จำนวนเงิน (บาท)
              </label>
              <Input
                id={`rc-amount-${billingId}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={submitting}
                className="border-edge-strong bg-card text-ink h-11 text-right tabular-nums"
                placeholder="0.00"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`rc-date-${billingId}`} className={LABEL}>
                  วันที่รับ
                </label>
                <Input
                  id={`rc-date-${billingId}`}
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  disabled={submitting}
                  className="border-edge-strong bg-card text-ink h-11"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`rc-method-${billingId}`} className={LABEL}>
                  วิธีรับเงิน
                </label>
                <select
                  id={`rc-method-${billingId}`}
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  disabled={submitting}
                  className={FIELD}
                >
                  {Object.entries(RECEIPT_METHOD_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`rc-note-${billingId}`} className={LABEL}>
                หมายเหตุ (ไม่บังคับ)
              </label>
              <Input
                id={`rc-note-${billingId}`}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                disabled={submitting}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>

            {error && (
              <div role="alert" className={INLINE_ERROR}>
                {error}
              </div>
            )}

            <div className="flex items-center justify-end">
              <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
                {submitting ? "กำลังบันทึก…" : "บันทึกเงินรับ"}
              </button>
            </div>
          </form>
        ) : null}
      </BottomSheet>
    </div>
  );
}
