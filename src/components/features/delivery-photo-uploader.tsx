"use client";

// 'use client' justification (spec 23): file input + per-file upload
// state machine (uploading → saving → error/retry), phase-uploader
// precedent. Shown only on delivered request cards.
//
// Pipeline per selected file (spec 23 / spec 16 §4 staging contract):
//   1. derive ext from MIME (mimeToPhotoExt — filename casing never
//      decides), pre-assign the attachment uuid client-side;
//   2. upload bytes DIRECT to pr-attachments under the user session at
//      the canonical path (upsert:false — append-only bucket posture);
//   3. call addDeliveryConfirmationPhoto (metadata only — the server
//      rebuilds the path; a client path is never trusted);
//   4. router.refresh() so the Server Component re-reads the list.
// An upload that succeeds but whose action fails leaves a quiet bucket
// orphan — accepted (the table is the source of truth, photos precedent).

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDeliveryConfirmationPhoto } from "@/app/requests/actions";
import { createClient } from "@/lib/db/browser";
import { mimeToPhotoExt } from "@/lib/photos/path";
import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";

interface DeliveryPhotoUploaderProps {
  purchaseRequestId: string;
  projectId: string;
}

type UploadPhase = "idle" | "uploading" | "saving" | "error";

export function DeliveryPhotoUploader({
  purchaseRequestId,
  projectId,
}: DeliveryPhotoUploaderProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    for (const file of Array.from(files)) {
      const ext = mimeToPhotoExt(file.type);
      if (!ext) {
        setPhase("error");
        setError("ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพ (JPEG, PNG, WebP, HEIC)");
        continue;
      }
      const attachmentId = crypto.randomUUID();
      const path = buildPrAttachmentStoragePath(projectId, purchaseRequestId, attachmentId, ext);
      if (!path) {
        setPhase("error");
        setError("บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      setPhase("uploading");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("pr-attachments")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) {
        setPhase("error");
        setError("อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      setPhase("saving");
      const result = await addDeliveryConfirmationPhoto({
        purchaseRequestId,
        attachmentId,
        ext,
      });
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
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="sr-only"
        onChange={(e) => void handleFiles(e.target.files)}
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-400 bg-white px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {phase === "uploading"
          ? "กำลังอัปโหลด…"
          : phase === "saving"
            ? "กำลังบันทึก…"
            : "ยืนยันการรับของด้วยรูป"}
      </button>
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
