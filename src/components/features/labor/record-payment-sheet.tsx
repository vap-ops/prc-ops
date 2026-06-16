"use client";

// Spec 127 U2 — record a DC payment for one contractor × the viewed period.
// Money lives on the PM-only /payroll page; this client form prefills the
// recomputed owed and sends what was actually paid. The record_dc_payment RPC
// recomputes server-side (the prefill is convenience, not the source of truth),
// re-gates the role, and refuses a duplicate. The contractor's bank is shown
// inline as the transfer target (closes the "money scattered" gap, spec 127).
//
// 'use client' justified: open state + form state + the server-action call.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { RadioChip } from "@/components/features/common/radio-chip";
import { recordDcPayment } from "@/lib/labor/actions";
import { DC_PAYMENT_METHODS, DC_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";
import type { ContactBank } from "@/lib/contacts/bank";
import { useToast } from "@/lib/ui/use-toast";
import {
  BUTTON_PRIMARY,
  BUTTON_PRIMARY_COMPACT,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

interface RecordPaymentSheetProps {
  contractorId: string;
  contractorName: string;
  from: string;
  to: string;
  computedAmount: number;
  computedDays: number;
  bank: ContactBank | null;
  todayIso: string;
  revalidate: string;
}

function baht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

export function RecordPaymentSheet({
  contractorId,
  contractorName,
  from,
  to,
  computedAmount,
  computedDays,
  bank,
  todayIso,
  revalidate,
}: RecordPaymentSheetProps) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [paidAmount, setPaidAmount] = useState(String(computedAmount));
  const [paidAt, setPaidAt] = useState(todayIso);
  const [method, setMethod] = useState<string>("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasBank = bank && (bank.bankName || bank.bankAccountNo || bank.bankAccountName);

  function submit() {
    setError(null);
    const amount = Number(paidAmount);
    if (!Number.isFinite(amount)) {
      setError("จำนวนเงินไม่ถูกต้อง");
      return;
    }
    startTransition(async () => {
      const result = await recordDcPayment({
        contractorId,
        from,
        to,
        paidAt,
        paidAmount: amount,
        method,
        reference: reference.trim(),
        note: note.trim(),
        revalidate,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกการจ่ายแล้ว");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={BUTTON_PRIMARY_COMPACT} onClick={() => setOpen(true)}>
        บันทึกการจ่าย
      </button>

      <BottomSheet
        open={open}
        title={`บันทึกการจ่าย — ${contractorName}`}
        onClose={() => setOpen(false)}
      >
        <p className="text-ink-secondary text-xs">
          ยอดที่คำนวณได้ {baht(computedAmount)} · {computedDays.toLocaleString("th-TH")} วัน
        </p>

        {hasBank ? (
          <div className="bg-sunk border-edge mt-3 rounded-md border px-3 py-2">
            <p className="text-ink-muted text-xs">บัญชีโอนเงิน</p>
            <p className="text-ink text-sm font-medium">{bank.bankName}</p>
            <p className="text-ink text-sm">
              {bank.bankAccountNo}
              {bank.bankAccountName ? ` · ${bank.bankAccountName}` : ""}
            </p>
          </div>
        ) : null}

        <label className="text-ink-secondary mt-3 block text-sm">
          จำนวนที่จ่าย (บาท)
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={paidAmount}
            disabled={pending}
            onChange={(e) => {
              setPaidAmount(e.target.value);
              setError(null);
            }}
            className={FIELD_STACKED}
          />
        </label>

        <label className="text-ink-secondary mt-3 block text-sm">
          วันที่จ่าย
          <input
            type="date"
            value={paidAt}
            disabled={pending}
            onChange={(e) => setPaidAt(e.target.value)}
            className={`${FIELD_STACKED} appearance-none`}
          />
        </label>

        <fieldset className="mt-3">
          <legend className="text-ink-secondary text-sm">วิธีจ่าย</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {DC_PAYMENT_METHODS.map((m) => (
              <RadioChip
                key={m}
                name="dc-payment-method"
                label={DC_PAYMENT_METHOD_LABELS[m]}
                checked={method === m}
                onSelect={() => setMethod(m)}
              />
            ))}
          </div>
        </fieldset>

        <label className="text-ink-secondary mt-3 block text-sm">
          เลขอ้างอิง (ถ้ามี)
          <input
            value={reference}
            maxLength={120}
            disabled={pending}
            onChange={(e) => setReference(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>

        <label className="text-ink-secondary mt-3 block text-sm">
          หมายเหตุ (ถ้ามี)
          <textarea
            value={note}
            maxLength={500}
            rows={2}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>

        {error ? (
          <p role="alert" className={`mt-3 ${INLINE_ALERT_TEXT}`}>
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className={`mt-4 w-full ${BUTTON_PRIMARY}`}
        >
          {pending ? "กำลังบันทึก…" : "บันทึกการจ่าย"}
        </button>
      </BottomSheet>
    </>
  );
}
