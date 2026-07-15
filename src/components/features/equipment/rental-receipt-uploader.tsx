"use client";

// Spec 323 U1d — attach a receipt (payment slip / tax invoice) to a rental
// settlement. Immediate upload: prepare (photo downscale / PDF passthrough) → bytes
// to the private rental-settlement-receipts bucket → addRentalSettlementReceipt
// (admin metadata; the table is zero-grant) → onUploaded + refresh. One instance per
// purpose (สลิป / ใบกำกับภาษี). Mirrors expense-receipt-uploader.
//
// 'use client' justified: file input + per-file upload state machine.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { RentalReceiptPurpose } from "@/app/equipment/rentals/receipt-actions";
import { uploadRentalReceiptFile } from "@/lib/equipment/upload-rental-receipt";
import { ATTACHMENT_ACCEPT_MIME } from "@/lib/purchasing/attachment-file";
import { BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

type UploadPhase = "idle" | "uploading" | "error";

export function RentalReceiptUploader({
  settlementId,
  purpose,
  label,
  onUploaded,
}: {
  settlementId: string;
  purpose: RentalReceiptPurpose;
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

    let anyOk = false;
    for (const file of Array.from(files)) {
      setPhase("uploading");
      const result = await uploadRentalReceiptFile(settlementId, file, purpose);
      if (!result.ok) {
        setPhase("error");
        setError(result.error);
        continue;
      }
      setPhase("idle");
      anyOk = true;
      onUploaded?.();
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    // Only re-read the page when something actually landed.
    if (anyOk) startRefresh(() => router.refresh());
  }

  const busy = phase === "uploading";

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT_MIME}
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
        {busy ? "กำลังอัปโหลด…" : label}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
