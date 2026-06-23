"use client";

// Spec 170 U4c-2 — the DC WORKER bank-change request form on /portal. The worker
// analogue of BankChangeForm (contractors): a bound worker submits new bank
// details; they land PENDING for PM approval (ADR 0051 §6), never live
// immediately. While a request is pending, the form is replaced by a waiting
// notice. 'use client': form + pending state + the server-action call. Reuses
// validateBankChange — the shape/UX rules are identical to the contractor form.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitWorkerBankChange } from "@/lib/portal/actions";
import { validateBankChange } from "@/lib/portal/bank-change";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function WorkerBankChangeForm({ hasPending }: { hasPending: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [bankName, setBankName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (hasPending) {
    return (
      <div className={`${CARD} border-attn bg-attn-soft border-l-4`}>
        <p className="text-attn-ink text-sm font-medium">
          คำขอเปลี่ยนบัญชีธนาคารกำลังรอผู้จัดการอนุมัติ
        </p>
      </div>
    );
  }

  function submit() {
    setError(null);
    const v = validateBankChange({ bankName, accountNo, accountName });
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const result = await submitWorkerBankChange({
        bankName,
        accountNo,
        accountName,
        revalidate: "/portal",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ส่งคำขอแล้ว รอผู้จัดการอนุมัติ");
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">แจ้งเปลี่ยนบัญชีธนาคาร</p>
      <p className="text-ink-muted mt-0.5 text-xs">ผู้จัดการจะตรวจสอบก่อนใช้งานจริง</p>
      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อธนาคาร
        <input
          value={bankName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setBankName(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        เลขที่บัญชี
        <input
          value={accountNo}
          maxLength={50}
          inputMode="numeric"
          disabled={pending}
          onChange={(e) => setAccountNo(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อบัญชี
        <input
          value={accountName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => setAccountName(e.target.value)}
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
        {pending ? "กำลังส่ง…" : "ส่งคำขอเปลี่ยนบัญชี"}
      </button>
    </div>
  );
}
