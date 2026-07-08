"use client";

// Spec 66 / ADR 0043 — the invoice/receipt (ใบส่งของ/ใบเสร็จ) uploader.
// Immediate upload: prepare (spec 34 downscale) → bytes direct to
// pr-attachments at the canonical path → addInvoiceAttachment (metadata;
// server rebuilds the path) → refresh. The action is idempotent (23505
// identity-complete replay), so a failed attempt is safe to retry.
//
// Unlike DeliveryPhotoUploader this is NOT offline-queue-bracketed —
// recorded seam (spec 66): invoice uploads in dead signal are a manual
// retry, not auto-replay, for v1.
//
// 'use client' justified: file input + per-file upload state machine.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addInvoiceAttachment } from "@/app/requests/actions";
import { createClient } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";
import {
  ATTACHMENT_ACCEPT_MIME,
  attachmentExtToMime,
  isPdfMime,
  type AttachmentExt,
} from "@/lib/purchasing/attachment-file";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

interface InvoiceUploaderProps {
  purchaseRequestId: string;
  projectId: string;
  /** Idle button label — defaults to the attach copy. */
  label?: string;
  /** Save action — defaults to addInvoiceAttachment; PaymentProofUploader passes
   *  addPaymentProofAttachment (same input/result contract, different purpose). */
  action?: typeof addInvoiceAttachment;
  /** Spec 285 U2 — fired on each SUCCESSFUL save so a parent (the site-expense
   *  form) can track evidence presence and derive completeness. Not fired on
   *  failure. (`| undefined` explicit so ItemPhotoUploader can forward it under
   *  exactOptionalPropertyTypes.) */
  onUploaded?: (() => void) | undefined;
}

type UploadPhase = "idle" | "uploading" | "saving" | "error";

export function InvoiceUploader({
  purchaseRequestId,
  projectId,
  label,
  action = addInvoiceAttachment,
  onUploaded,
}: InvoiceUploaderProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    for (const file of Array.from(files)) {
      // Spec 121 / ADR 0046 Layer A: a PDF uploads raw (the spec-34 downscale
      // pipeline is photo-only); a photo is prepared/downscaled as before.
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
      const path = buildPrAttachmentStoragePath(projectId, purchaseRequestId, attachmentId, ext);
      if (!path) {
        setPhase("error");
        setError("บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      setPhase("uploading");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("pr-attachments")
        .upload(path, blob, { upsert: false, contentType: attachmentExtToMime(ext) });
      if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
        setPhase("error");
        setError("ส่งเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      setPhase("saving");
      let result: Awaited<ReturnType<typeof addInvoiceAttachment>>;
      try {
        result = await action({ purchaseRequestId, attachmentId, ext });
      } catch (err) {
        console.error("[invoice-uploader] action invocation failed", err);
        result = { ok: false, error: "บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
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
        {phase === "uploading"
          ? "กำลังอัปโหลด…"
          : phase === "saving"
            ? "กำลังบันทึก…"
            : (label ?? "แนบใบส่งของ / ใบเสร็จ")}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
