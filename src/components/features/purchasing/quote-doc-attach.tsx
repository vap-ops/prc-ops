"use client";

// Spec 182 U4 — attach a supplier's quotation document to a quote row. Mirrors
// InvoiceUploader (spec 66): prepare (spec 34 downscale) → bytes direct to
// pr-attachments at the canonical path → addQuoteAttachment (metadata; the
// server rebuilds the path + derives the kind, stamps purpose='quote' + the
// quote_id). Idempotent (23505 identity-complete replay) so a retry is safe.
//
// One doc per quote: this renders only while the quote has none (PriceComparison
// shows the link otherwise). 'use client' justified: file input + upload state.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { addQuoteAttachment } from "@/app/requests/actions";
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
import { INLINE_ALERT_TEXT } from "@/lib/ui/classes";

type UploadPhase = "idle" | "uploading" | "saving" | "error";

export function QuoteDocAttach({
  purchaseRequestId,
  projectId,
  quoteId,
}: {
  purchaseRequestId: string;
  projectId: string;
  quoteId: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function handleFile(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file) return;
    setError(null);

    // Spec 121: a PDF uploads raw; a photo is downscaled.
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
        return;
      }
      blob = prepared.blob;
      ext = prepared.ext;
    }

    const attachmentId = crypto.randomUUID();
    const path = buildPrAttachmentStoragePath(projectId, purchaseRequestId, attachmentId, ext);
    if (!path) {
      setPhase("error");
      setError("บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      return;
    }

    setPhase("uploading");
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from("pr-attachments")
      .upload(path, blob, { upsert: false, contentType: attachmentExtToMime(ext) });
    if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
      setPhase("error");
      setError("ส่งเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      return;
    }

    setPhase("saving");
    let result: Awaited<ReturnType<typeof addQuoteAttachment>>;
    try {
      result = await addQuoteAttachment({ purchaseRequestId, quoteId, attachmentId, ext });
    } catch (err) {
      console.error("[quote-doc-attach] action invocation failed", err);
      result = { ok: false, error: "บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!result.ok) {
      setPhase("error");
      setError(result.error);
      return;
    }
    setPhase("idle");
    startRefresh(() => router.refresh());
  }

  const busy = phase === "uploading" || phase === "saving";

  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT_MIME}
        className="sr-only"
        onChange={(e) => void handleFile(e.target.files)}
        disabled={busy}
      />
      <button
        type="button"
        aria-label="แนบเอกสาร"
        title="แนบใบเสนอราคา"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="text-ink-muted hover:text-ink focus-visible:ring-action inline-flex items-center gap-1 rounded-md p-1 text-xs focus:outline-none focus-visible:ring-2 disabled:opacity-60"
      >
        <Paperclip aria-hidden className="size-4" />
        {busy ? "…" : "แนบ"}
      </button>
      {error ? (
        <span role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
