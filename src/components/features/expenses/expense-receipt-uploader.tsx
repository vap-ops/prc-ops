"use client";

// Spec 310 U4 — attach a receipt to an office expense. Immediate upload:
// prepare (photo downscale) → bytes to the expense-attachments bucket at the
// canonical path → addExpenseReceipt (metadata; server rebuilds the path) →
// onUploaded. Mirrors the invoice uploader; idempotent on the server (23505).
//
// 'use client' justified: file input + per-file upload state machine.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ATTACHMENT_ACCEPT_MIME } from "@/lib/purchasing/attachment-file";
import { uploadExpenseReceiptFile } from "@/lib/expenses/upload-expense-receipt";
import type { ExpenseDocPurpose } from "@/app/expenses/actions";
import { BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

type UploadPhase = "idle" | "uploading" | "saving" | "error";

export function ExpenseReceiptUploader({
  officeExpenseId,
  purpose,
  label,
  onUploaded,
}: {
  officeExpenseId: string;
  purpose: ExpenseDocPurpose;
  label: string;
  onUploaded?: (() => void) | undefined;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    for (const file of Array.from(files)) {
      setPhase("uploading");
      const result = await uploadExpenseReceiptFile(officeExpenseId, file, purpose);
      if (!result.ok) {
        setPhase("error");
        setError(result.error);
        continue;
      }
      setPhase("idle");
      onUploaded?.();
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    startRefresh(() => router.refresh());
  }

  const busy = phase === "uploading" || phase === "saving";

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT_MIME}
        multiple
        className="sr-only"
        onChange={(e) => void handleFiles(e.target.files)}
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className={BUTTON_SECONDARY_MUTED}
      >
        {phase === "uploading" ? "กำลังอัปโหลด…" : phase === "saving" ? "กำลังบันทึก…" : label}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
