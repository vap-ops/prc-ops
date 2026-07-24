"use client";

// Spec 134 U4a — the manual proof-of-delivery uploader on the PO detail. A signed
// delivery note (or a photo of the received goods) attaches at the PO level in the
// po-attachments bucket, stamped purpose 'proof_of_delivery'. Immediate upload:
// prepare (spec 34 downscale, PDFs raw) → bytes direct to po-attachments at the
// canonical {po_id}/{att}.{ext} path → addProofOfDeliveryAttachment (metadata; the
// server rebuilds the path) → refresh. Idempotent action (23505 replay), so a
// failed attempt is safe to retry. Mirrors InvoiceUploader (the PR-level invoice
// path); the bucket, path builder, and purpose differ.
//
// 'use client' justified: file input + per-file upload state machine.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProofOfDeliveryAttachment } from "@/app/requests/actions";
import { createClient } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { buildPoAttachmentStoragePath } from "@/lib/purchasing/po-attachment-path";
import {
  ATTACHMENT_ACCEPT_MIME,
  attachmentExtToMime,
  isPdfMime,
  type AttachmentExt,
} from "@/lib/purchasing/attachment-file";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { captureMethodMetadata } from "@/lib/photos/capture-method";
import { PO_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";
import { PROOF_OF_DELIVERY_LABEL } from "@/lib/i18n/labels";
import { BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

interface ProofOfDeliveryUploaderProps {
  purchaseOrderId: string;
  // Spec 135 U4: the proof attaches to a specific delivery (งวด).
  deliveryId: string;
  /** Spec 308: the SA receive page takes the truck photo LIVE — forces the
   *  rear camera on mobile. BO chooser (default) unchanged. */
  capture?: boolean;
  /** Idle button label override (the receive page names the truck photo). */
  label?: string;
}

type UploadPhase = "idle" | "uploading" | "saving" | "error";

export function ProofOfDeliveryUploader({
  purchaseOrderId,
  deliveryId,
  capture = false,
  label,
}: ProofOfDeliveryUploaderProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    for (const file of Array.from(files)) {
      // A PDF uploads raw (the downscale pipeline is photo-only); a photo is
      // prepared/downscaled (spec 34 / spec 121).
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
      const path = buildPoAttachmentStoragePath(purchaseOrderId, attachmentId, ext);
      if (!path) {
        setPhase("error");
        setError("บันทึกหลักฐานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      setPhase("uploading");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(PO_ATTACHMENTS_BUCKET)
        .upload(path, blob, {
          upsert: false,
          contentType: attachmentExtToMime(ext),
          // Spec 352 U2: the REAL per-call affordance — this input renders
          // capture="environment" only when `capture` is true (spec 308).
          metadata: captureMethodMetadata(capture ? "camera" : "picker"),
        });
      if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
        setPhase("error");
        setError("ส่งหลักฐานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      setPhase("saving");
      let result: Awaited<ReturnType<typeof addProofOfDeliveryAttachment>>;
      try {
        result = await addProofOfDeliveryAttachment({
          purchaseOrderId,
          deliveryId,
          attachmentId,
          ext,
        });
      } catch (err) {
        console.error("[proof-of-delivery-uploader] action invocation failed", err);
        result = { ok: false, error: "บันทึกหลักฐานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
      }
      if (!result.ok) {
        setPhase("error");
        setError(result.error);
        continue;
      }
      setPhase("idle");
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
        {...(capture ? { capture: "environment" as const } : {})}
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
            : (label ?? `แนบ${PROOF_OF_DELIVERY_LABEL}`)}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
