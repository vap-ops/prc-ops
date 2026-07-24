"use client";

// 'use client' justification (spec 23): file input + per-file upload
// state machine (uploading → saving → error/retry), phase-uploader
// precedent. Shown only on delivered request cards.
//
// Pipeline per selected file (spec 23 / spec 16 §4 staging contract):
//   1. prepare the photo (spec 34 downscale; ext comes from the
//      prepared result — filename casing never decides), pre-assign
//      the attachment uuid client-side;
//   2. upload bytes DIRECT to pr-attachments under the user session at
//      the canonical path (upsert:false — append-only bucket posture);
//   3. call addDeliveryConfirmationPhoto (metadata only — the server
//      rebuilds the path; a client path is never trusted);
//   4. router.refresh() so the Server Component re-reads the list.
// Spec 37: the pipeline is bracketed by the offline queue — a failed
// step leaves a queue item the global runner replays (idempotently),
// so failures here are "queued, will auto-send", not dead ends.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDeliveryConfirmationPhoto } from "@/app/requests/actions";
import { createClient } from "@/lib/db/browser";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { buildPrAttachmentStoragePath } from "@/lib/purchasing/attachment-path";
import {
  classifyStorageUploadError,
  queueNowMs,
  type QueuedUpload,
} from "@/lib/photos/upload-queue";
import { notifyQueueChanged, safeQueuePut, safeQueueRemove } from "@/lib/photos/upload-queue-idb";
import { BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { DELIVERY_PHOTO_COVERAGE_HINT } from "@/lib/i18n/labels";

interface DeliveryPhotoUploaderProps {
  purchaseRequestId: string;
  projectId: string;
  /** Session user — stamped on queue items (ADR 0039 attribution guard). */
  userId: string;
}

type UploadPhase = "idle" | "uploading" | "saving" | "error";

export function DeliveryPhotoUploader({
  purchaseRequestId,
  projectId,
  userId,
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
      // Spec 34 / ADR 0036: downscale before upload (failure → original).
      const prepared = await preparePhotoForUpload(file);
      if (!prepared) {
        setPhase("error");
        setError("ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพ (JPEG, PNG, WebP, HEIC)");
        continue;
      }
      const ext = prepared.ext;
      const attachmentId = crypto.randomUUID();
      const path = buildPrAttachmentStoragePath(projectId, purchaseRequestId, attachmentId, ext);
      if (!path) {
        setPhase("error");
        setError("บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        continue;
      }

      // Spec 37: queue bracket — from here the photo survives a crash,
      // an offline failure, or leaving the page; the global runner
      // resumes it (idempotently).
      const queueItem: QueuedUpload = {
        kind: "delivery_photo",
        id: attachmentId,
        userId,
        purchaseRequestId,
        ext,
        blob: prepared.blob,
        lastModifiedMs: file.lastModified,
        fileName: file.name,
        storagePath: path,
        step: "upload",
        attempts: 0,
        lastError: null,
        enqueuedAtMs: queueNowMs(),
        // Spec 352 U1: this input is capture="environment" (spec 303 —
        // forces the rear camera on mobile), so the affordance is "camera".
        captureMethod: "camera",
      };
      await safeQueuePut(queueItem);

      setPhase("uploading");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("pr-attachments")
        .upload(path, prepared.blob, { upsert: false, contentType: photoExtToMime(ext) });
      if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
        // The photo is QUEUED — "try again" copy here would make the
        // user re-pick the file under a new uuid and produce a
        // duplicate when both land (spec-37 review finding).
        notifyQueueChanged();
        setPhase("error");
        setError("ส่งรูปไม่สำเร็จ — รูปถูกเก็บไว้แล้ว ระบบจะส่งให้อัตโนมัติเมื่อมีสัญญาณ");
        continue;
      }
      await safeQueuePut({ ...queueItem, step: "insert" });

      setPhase("saving");
      let result: Awaited<ReturnType<typeof addDeliveryConfirmationPhoto>>;
      try {
        result = await addDeliveryConfirmationPhoto({
          purchaseRequestId,
          attachmentId,
          ext,
        });
      } catch (err) {
        console.error("[delivery-photo-uploader] action invocation failed", err);
        result = { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
      }
      if (!result.ok) {
        notifyQueueChanged();
        setPhase("error");
        setError("ส่งรูปไม่สำเร็จ — รูปถูกเก็บไว้แล้ว ระบบจะส่งให้อัตโนมัติเมื่อมีสัญญาณ");
        continue;
      }
      await safeQueueRemove(attachmentId);
      notifyQueueChanged();
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
        accept={PHOTO_ACCEPT_MIME}
        multiple
        // Spec 303: the receive proof is taken LIVE — capture forces the rear
        // camera on mobile (the SA's device); repeat taps add more shots.
        capture="environment"
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
            : "ยืนยันการรับของด้วยรูป"}
      </button>
      <p className="text-ink-secondary text-xs">{DELIVERY_PHOTO_COVERAGE_HINT}</p>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
