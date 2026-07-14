"use client";

// Spec 298 U3 — the PM transcription form. The approver reads the SA-captured passbook
// (a short-lived signed image) and keys the bank into workers.bank_* via
// completeWorkerBank (→ complete_worker_bank RPC, which normalizes + validates the
// account number and never touches pay/level). On success the row is refreshed away.
// 'use client': controlled inputs + submit state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeWorkerBank } from "@/app/registrations/awaiting-bank/actions";
import { BankSelect } from "@/components/features/common/bank-select";
import { BUTTON_PRIMARY, FIELD_STACKED } from "@/lib/ui/classes";
import type { AwaitingBankRow } from "@/lib/register/worker-bank-queue";

export function WorkerBankCompleteForm({ row }: { row: AwaitingBankRow }) {
  const router = useRouter();
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const canSubmit =
    bankName.trim().length > 0 && accountNumber.trim().length > 0 && accountName.trim().length > 0;

  async function submit() {
    setError(null);
    setBusy(true);
    const res = await completeWorkerBank({
      workerId: row.workerId,
      bankName,
      accountNumber,
      accountName,
    });
    setBusy(false);
    if (res.ok) {
      startRefresh(() => router.refresh());
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="rounded-card border-edge bg-card shadow-card flex flex-col gap-3 border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ink text-body font-semibold">{row.name}</h2>
        {row.employeeId ? <span className="text-ink-muted text-meta">{row.employeeId}</span> : null}
      </div>
      {row.photoUrl ? (
        // Signed, short-lived URL to the walled passbook object — a plain <img> (next/image
        // would need the storage host allow-listed for a one-off, expiring URL).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.photoUrl}
          alt="รูปสมุดบัญชีธนาคาร"
          className="border-edge max-h-64 w-full rounded-lg border object-contain"
        />
      ) : (
        <p className="text-ink-muted text-sm">ไม่พบรูปสมุดบัญชี</p>
      )}
      {/* Spec 317 U7 follow-up — canonical picker (this form merged after the
          picker sweep, so it kept the old free-text input). */}
      <p className="text-ink-secondary text-sm">ธนาคาร</p>
      <BankSelect value={bankName} disabled={busy} onChange={setBankName} label="ธนาคาร" />
      <label className="text-ink-secondary block text-sm">
        เลขที่บัญชี
        <input
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          maxLength={30}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary block text-sm">
        ชื่อบัญชี
        <input
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          maxLength={120}
          className={FIELD_STACKED}
        />
      </label>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !canSubmit}
        onClick={() => void submit()}
        className={BUTTON_PRIMARY}
      >
        {busy ? "กำลังบันทึก…" : "บันทึกบัญชี"}
      </button>
    </div>
  );
}
