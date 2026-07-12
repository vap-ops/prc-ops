"use client";

// Spec 310 U4 — attach a receipt to an office expense. Immediate upload:
// prepare (photo downscale) → bytes to the expense-attachments bucket at the
// canonical path → addExpenseReceipt (metadata; server rebuilds the path) →
// onUploaded. Mirrors the invoice uploader; idempotent on the server (23505).
//
// 'use client' justified: file input + per-file upload state machine.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { addExpenseReceipt } from "@/app/expenses/actions";
import { createClient } from "@/lib/db/browser";
import { buildExpenseAttachmentPath } from "@/lib/expenses/attachment-path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import {
  ATTACHMENT_ACCEPT_MIME,
  attachmentExtToMime,
  isPdfMime,
  type AttachmentExt,
} from "@/lib/purchasing/attachment-file";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
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
      let blob: Blob;
      let ext: AttachmentExt;
      if (isPdfMime(file.type)) {
        blob = file;
        ext = "pdf";
      } else {
        const prepared = await preparePhotoForUpload(file);
        if (!prepared) {
          setPhase("error");
          setError("ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพหรือ PDF");
          continue;
        }
        blob = prepared.blob;
        ext = prepared.ext;
      }
      const attachmentId = crypto.randomUUID();
      const path = buildExpenseAttachmentPath(officeExpenseId, attachmentId, ext);
      if (!path) {
        setPhase("error");
        setError("แนบใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      setPhase("uploading");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("expense-attachments")
        .upload(path, blob, { upsert: false, contentType: attachmentExtToMime(ext) });
      if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
        setPhase("error");
        setError("ส่งใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      setPhase("saving");
      let result: Awaited<ReturnType<typeof addExpenseReceipt>>;
      try {
        result = await addExpenseReceipt({ officeExpenseId, attachmentId, ext, purpose });
      } catch (err) {
        console.error("[expense-receipt-uploader] action invocation failed", err);
        result = { ok: false, error: "แนบใบเสร็จไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
      }
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
