"use client";

// Spec 324 U6 — the on-site SA flags a suspected over-count on a store receipt.
// 'use client': the field state, the live-camera file capture, and the
// upload-then-submit transition + router.refresh. The SA never reverses/corrects
// the receipt (that is BACK_OFFICE-gated); they escalate with a true count +
// reason + a REQUIRED live-camera photo. The photo uploads to pr-attachments
// (PR-keyed) first, then submit_receipt_correction_request stores its path.

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitReceiptCorrectionRequest } from "@/app/store/actions";
import { uploadReceiptFlagPhoto } from "@/lib/store/upload-receipt-flag-photo";
import { useToast } from "@/lib/ui/use-toast";
import { PHOTO_ACCEPT_MIME } from "@/lib/photos/path";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import {
  RECEIPT_CORRECTION_TRUE_QTY_LABEL,
  RECEIPT_CORRECTION_REASON_LABEL,
  RECEIPT_CORRECTION_ORDERED_HINT,
  RECEIPT_FLAG_PHOTO_LABEL,
  RECEIPT_FLAG_PHOTO_REQUIRED,
  RECEIPT_FLAG_SUBMIT_LABEL,
  RECEIPT_FLAG_RANGE,
  RECEIPT_FLAG_REASON_REQUIRED,
} from "@/lib/i18n/labels";

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function ReceiptFlagSheet({
  receiptId,
  projectId,
  purchaseRequestId,
  orderedQty,
  unit,
  itemLabel,
  onDone,
}: {
  receiptId: string;
  projectId: string;
  purchaseRequestId: string;
  orderedQty: number;
  unit: string;
  itemLabel?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const uid = useId();
  const trueQtyId = `flag-true-${uid}`;
  const reasonId = `flag-reason-${uid}`;
  const photoId = `flag-photo-${uid}`;

  const [trueQty, setTrueQty] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Cache the uploaded path so a submit RETRY (e.g. 23505 already-pending) does
  // NOT re-upload and orphan another object in pr-attachments. Cleared whenever a
  // new photo is picked (the old path no longer matches the current evidence).
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickFile(next: File | null) {
    setFile(next);
    setUploadedPath(null);
  }

  function submit() {
    const q = Number(trueQty);
    if (trueQty.trim() === "" || !Number.isFinite(q) || q < 0 || q >= orderedQty) {
      setError(RECEIPT_FLAG_RANGE);
      return;
    }
    if (reason.trim() === "") {
      setError(RECEIPT_FLAG_REASON_REQUIRED);
      return;
    }
    if (!file) {
      setError(RECEIPT_FLAG_PHOTO_REQUIRED);
      return;
    }
    setError(null);
    startTransition(async () => {
      let path = uploadedPath;
      if (!path) {
        const uploaded = await uploadReceiptFlagPhoto(projectId, purchaseRequestId, file);
        if (!uploaded.ok) {
          setError(uploaded.error);
          return;
        }
        path = uploaded.path;
        setUploadedPath(path);
      }
      const result = await submitReceiptCorrectionRequest({
        receiptId,
        proposedQty: q,
        reason,
        photoPath: path,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ส่งรายงานแล้ว รอฝ่ายจัดซื้อตรวจสอบ");
      router.refresh();
      onDone?.();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {itemLabel ? (
        <p className="text-ink-secondary text-meta">
          <span className="text-ink font-semibold">{itemLabel}</span> — บันทึกรับไว้ {orderedQty}{" "}
          {unit}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={trueQtyId} className={LABEL}>
          {RECEIPT_CORRECTION_TRUE_QTY_LABEL}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={trueQtyId}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={trueQty}
            onChange={(e) => setTrueQty(e.target.value)}
            disabled={pending}
            className={FIELD}
          />
          <span className="text-ink-secondary text-meta shrink-0">
            {unit} / {RECEIPT_CORRECTION_ORDERED_HINT} {orderedQty}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={reasonId} className={LABEL}>
          {RECEIPT_CORRECTION_REASON_LABEL}
        </label>
        <input
          id={reasonId}
          type="text"
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          disabled={pending}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={photoId} className={LABEL}>
          {RECEIPT_FLAG_PHOTO_LABEL}
        </label>
        <input
          id={photoId}
          ref={fileInputRef}
          type="file"
          accept={PHOTO_ACCEPT_MIME}
          // Spec 303: the evidence is taken LIVE — capture forces the rear
          // camera on the SA's phone.
          capture="environment"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          disabled={pending}
          className="text-ink text-sm"
        />
        {file ? <p className="text-ink-secondary text-meta">พร้อมส่ง: {file.name}</p> : null}
      </div>

      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onDone?.()}
          disabled={pending}
          className={BUTTON_SECONDARY}
        >
          ยกเลิก
        </button>
        <button type="button" onClick={submit} disabled={pending} className={BUTTON_PRIMARY}>
          {pending ? "กำลังส่ง…" : RECEIPT_FLAG_SUBMIT_LABEL}
        </button>
      </div>
    </div>
  );
}
